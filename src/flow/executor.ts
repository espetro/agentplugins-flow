/**
 * FlowExecutor — extracted from index.ts for testability.
 *
 * Encapsulates the orchestration logic for running flows: cycle detection,
 * project-flow confirmation, parallel execution with failover, caching,
 * and telemetry.
 */

import type { FlowConfig } from "./agents.js";
import type {
	SingleResult,
	FlowDetails,
	FlowMetrics,
} from "../types/flow.js";
import { isFlowSuccess, isFlowError, isFlowComplete, getFlowOutput, emptyFlowUsage } from "../types/flow.js";

import { extractStructuredOutput } from "../snapshot/structured-output.js";

// ~6 KB limit to keep grouped audit intent under typical prompt budget while preserving enough context for meaningful audit
const MAX_AUDIT_OUTPUT_SLICE = 6000;

import { mapFlowConcurrent, runFlow } from "./runner.js";
import { getFlowSummaryText } from "../snapshot/runner-events.js";
import { normalizeFlowModeName, resolveFlowModelCandidates, resolveModelContextWindow, selectFlowModelStrategy, type LoadedFlowModelConfigs, type FlowModelStrategy } from "../config/config.js";
import { getComplexityTimeoutMs, resolveComplexity, getImpliedAuditLoop, type Complexity } from "./complexity.js";
import { setFlowComplete } from "../notify/notify-state.js";
import { setLiveText, clearLiveText } from '../tui/scramble/index.js';
import { logWarn } from '../config/log.js';
import { markFlowCompleted } from '../flow/index.js';
import type { GoalContext } from '../flow/types.js';

/**
 * Shallow-merge helper: copies audit-loop metadata fields from `source`
 * onto `target` without mutating the target's identity reference.
 * Used whenever a fresh SingleResult overwrites a slot that may already
 * carry ping-pong or parent-type metadata.
 */
export function preserveMetadata(target: SingleResult, source?: SingleResult): void {
	if (source?.pingPongMeta) {
		target.pingPongMeta = source.pingPongMeta;
	}
	if (source?.auditParentType) {
		target.auditParentType = source.auditParentType;
	}
	if (source?.auditLoopGroupId !== undefined) {
		target.auditLoopGroupId = source.auditLoopGroupId;
	}
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FlowExecutorDeps {
	/** All discovered flow configs. */
	flows: FlowConfig[];
	/** Current transition depth. */
	currentDepth: number;
	/** Maximum transition depth. */
	maxDepth: number;
	/** Ancestor flow stack (names). */
	ancestorFlowStack: string[];
	/** Whether cycle prevention is enabled. */
	preventCycles: boolean;
	/** Whether to use optimized tool list. */
	toolOptimize: boolean;
	/** Whether to inject structured output instructions. */
	structuredOutput: boolean;
	/** Working directory. */
	cwd: string;
	/** Loaded flow model configs. */
	loadedFlowModelConfigs: LoadedFlowModelConfigs;
	/** Max concurrency for parallel flow execution. */
	maxConcurrency: number;

	/** Default child-flow complexity. */
	defaultComplexity: Complexity;
	/** Abort signal. */
	signal?: AbortSignal;
	/** Streaming update callback. */
	onUpdate?: (result: import("@earendil-works/pi-agent-core").AgentToolResult<FlowDetails>) => void;
	/** Factory to wrap results into FlowDetails. */
	makeDetails: (results: SingleResult[]) => FlowDetails;
	/** Get a CLI flag value. */
	getFlag: (name: string) => unknown;
	/** Inherited CLI args for tier overrides. */
	tierOverrideResolver: (tier: "lite" | "flash" | "full") => string | undefined;
	/** Inherited fallback model. */
	fallbackModel?: string;
	/** Fork session snapshot JSONL. */
	forkSessionSnapshotJsonl: string | null;
	/** Project flows directory. */
	projectFlowsDir: string | null;
	/** Session manager for fork snapshot and session identification. */
	sessionManager: { getHeader: () => unknown; getBranch: () => unknown[]; getSessionId: () => string };
	/** Whether UI is available for confirmation. */
	hasUI: boolean;
	/** UI confirmation callback. */
	uiConfirm: (title: string, body: string) => Promise<boolean>;
	/** Telemetry callback. */
	onFlowMetrics?: (metrics: FlowMetrics) => void;
	/** Whether to prompt the user before running project-local flows. Default: true. */
	confirmProjectFlows?: boolean;
	/** Optional callback invoked after all flows complete to record goal usage. */
	goalContinuationCallback?: (results: SingleResult[]) => Promise<void>;
	/** Optional active goal context to inject into child flow prompts. */
	goalContext?: GoalContext;
}

export interface ExecuteFlowParams {
	type: string;
	intent: string;
	aim: string;
	acceptance?: string;
	cwd?: string;
	complexity: Complexity;
	/** Explicit tool list for the child process. Overrides flow frontmatter. */
	_childTools?: string[];
	/** Pre-dispatch results — tool outputs executed by the parent and injected into the child's prompt. */
	preDispatchResults?: string;
}

export interface ExecuteFlowResult {
	content: Array<{ type: string; text: string }>;
	details: FlowDetails;
	failed?: boolean;
	_toolCallId?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getFlowCycleViolations(
	requestedNames: Set<string>,
	ancestorFlowStack: string[],
): string[] {
	if (requestedNames.size === 0 || ancestorFlowStack.length === 0) return [];
	const stackSet = new Set(ancestorFlowStack);
	return Array.from(requestedNames).filter((name) => stackSet.has(name));
}

function getRequestedProjectFlows(
	flows: FlowConfig[],
	requestedNames: Set<string>,
): FlowConfig[] {
	return Array.from(requestedNames)
		.map((name) => flows.find((f) => f.name === name.toLowerCase()))
		.filter((f): f is FlowConfig => f?.source === "project");
}

async function confirmProjectFlowsIfNeeded(
	projectFlows: FlowConfig[],
	projectFlowsDir: string | null,
	hasUI: boolean,
	uiConfirm: (title: string, body: string) => Promise<boolean>,
): Promise<{ ok: boolean; blocked?: string }> {
	if (projectFlows.length === 0) return { ok: true };

	const names = projectFlows.map((f) => f.name).join(", ");
	const dir = projectFlowsDir ?? "(unknown)";

	if (hasUI) {
		const ok = await uiConfirm(
			"Run project-local flows?",
			`Flows: ${names}\nSource: ${dir}\n\nProject flows are repo-controlled. Only continue for trusted repositories.`,
		);
		return { ok };
	}

	return {
		ok: false,
		blocked: `Blocked: project-local flow confirmation required in non-UI mode.\nFlows: ${names}\nRe-run with confirmProjectFlows: false if trusted.`,
	};
}

function shouldFailover(result: SingleResult): boolean {
	if (result.stopReason === "aborted") return false;
	const text = `${result.errorMessage ?? ""}\n${result.stderr ?? ""}`.toLowerCase();
	if (!text.trim()) return false;
	if (text.includes("permission") || text.includes("invalid tool") || text.includes("bad settings")) {
		return false;
	}
	if (result.exitCode > 0) return true;
	// Some child runs log HTTP 400 / "Param Incorrect" to stderr while exiting 0
	// without completing a turn — treat as retryable for model failover.
	if (!isFlowComplete(result) && (text.includes("400") && text.includes("param"))) {
		return true;
	}
	return false;
}

export function createGhostResult(type: string, intent: string, aim: string, model?: string, maxContextTokens?: number): SingleResult {
	return {
		type,
		agentSource: "unknown",
		intent,
		aim,
		exitCode: -1,
		messages: [],
		stderr: "",
		usage: emptyFlowUsage(),
		...(model ? { model } : {}),
		...(maxContextTokens !== undefined ? { maxContextTokens } : {}),
	};
}

export function resolveAuditModel(
	flows: FlowConfig[],
	tierOverrideResolver: (tier: "lite" | "flash" | "full") => string | undefined,
	strategy: FlowModelStrategy,
	fallbackModel?: string,
): { model?: string; maxContextTokens?: number } {
	const auditFlow = flows.find((f) => f.name === "audit");
	const tier = auditFlow?.tier ?? "flash";
	const { candidates } = resolveFlowModelCandidates({
		tier,
		flowModel: auditFlow?.model,
		cliTierOverride: tierOverrideResolver(tier),
		strategy,
		fallbackModel,
	});
	const model = candidates[0];
	const maxContextTokens = resolveModelContextWindow(model);
	return { model, maxContextTokens };
}

export function buildReworkIntent(
	originalIntent: string,
	buildAim: string,
	acceptance: string | undefined,
	auditFeedback: string,
	cycleHistory?: CycleHistoryEntry[],
): string {
	const parts = [
		`## Original Intent`,
		originalIntent,
		``,
		`## Build Aim`,
		buildAim,
		``,
	];
	if (acceptance) {
		parts.push(`## Acceptance Criteria`, acceptance, ``);
	}
	parts.push(
		`## Audit Feedback`,
		auditFeedback,
		``,
	);
	if (cycleHistory && cycleHistory.length > 0) {
		// Show all prior build outputs (deep-loop: every cycle, not just latest)
		const buildOutputs = formatPriorBuildOutputs(cycleHistory);
		if (buildOutputs) {
			parts.push(buildOutputs, ``);
		}
		// Show all prior audit verdicts/feedbacks
		const auditHistory = formatPriorAuditHistory(cycleHistory);
		if (auditHistory) {
			parts.push(auditHistory, ``);
		}
	}
	parts.push(
		`Fix the above issues, preserving the Original Intent and incorporating all prior cycle feedback.`,
	);
	return parts.join("\n");
}

async function executeSingleFlow(
	deps: FlowExecutorDeps,
	item: ExecuteFlowParams,
	allResults: SingleResult[],
	resultIndex: number,
	toolCallId: string,
	emitProgress: (streamingText?: string) => void,
	selectedFlowModelConfig: LoadedFlowModelConfigs,
): Promise<SingleResult> {
	const {
		flows, currentDepth, maxDepth, ancestorFlowStack, preventCycles,
		toolOptimize, structuredOutput, cwd,
		defaultComplexity, signal, makeDetails,
		tierOverrideResolver, fallbackModel, forkSessionSnapshotJsonl,
		onFlowMetrics, goalContext,
	} = deps;

	const normalizedType = item.type.toLowerCase();
	const complexity = resolveComplexity(item.complexity, defaultComplexity);
	const lookupName = normalizedType;
	const targetFlow = flows.find((f) => f.name === lookupName);
	const effectiveMaxDepth =
		targetFlow?.maxDepth !== undefined ? targetFlow.maxDepth : maxDepth;

	const shouldInheritContext = targetFlow?.inheritContext !== false;
	const tier = targetFlow?.tier ?? "flash";
	const { candidates } = resolveFlowModelCandidates({
		tier,
		flowModel: targetFlow?.model,
		cliTierOverride: tierOverrideResolver(tier),
		strategy: selectedFlowModelConfig.strategy,
		fallbackModel,
	});
	const attemptModels = candidates.length > 0 ? candidates : [undefined];
	const attemptedModels: string[] = [];
	let result = allResults[resultIndex];
	const flowStart = Date.now();

	for (let attempt = 0; attempt < attemptModels.length; attempt++) {
		const candidateModel = attemptModels[attempt];
		if (candidateModel) attemptedModels.push(candidateModel);
		const attemptStartMs = Date.now();
		const attemptTimeoutMs = getComplexityTimeoutMs(complexity);
		const maxContextTokens = resolveModelContextWindow(candidateModel);
		const previous = allResults[resultIndex];
		allResults[resultIndex] = {
			type: normalizedType,
			agentSource: targetFlow?.source ?? "unknown",
			intent: item.intent,
			aim: item.aim,
			exitCode: -1,
			messages: [],
			stderr: "",
			usage: emptyFlowUsage(),
			model: candidateModel,
			startedAtMs: attemptStartMs,
			deadlineAtMs: attemptStartMs + attemptTimeoutMs,
			...(maxContextTokens !== undefined ? { maxContextTokens } : {}),
		};
		preserveMetadata(allResults[resultIndex], previous);
		emitProgress();
		result = await runFlow({
			cwd,
			flows,
			flowName: lookupName,
			intent: item.intent,
			aim: item.aim,
			acceptance: item.acceptance,
			taskCwd: item.cwd,
			forkSessionSnapshotJsonl: shouldInheritContext ? forkSessionSnapshotJsonl : null,
			parentDepth: currentDepth,
			parentFlowStack: ancestorFlowStack,
			maxDepth: effectiveMaxDepth,
			preventCycles,
			toolOptimize,
			structuredOutput,
			complexity,
			model: candidateModel,
			maxContextTokens,
			goalContext,
			tools: item._childTools,
			preDispatchResults: item.preDispatchResults,
			signal,
			onUpdate: (partial) => {
				if (partial.details?.results[0]) {
					const previous = allResults[resultIndex];
					allResults[resultIndex] = partial.details.results[0];
					preserveMetadata(allResults[resultIndex], previous);
					const flowText = partial.content?.[0]?.text;
					if (flowText !== undefined) {
						setLiveText(`${toolCallId || 'collapsed'}#${resultIndex}`, flowText);
						setLiveText(`collapsed#${resultIndex}`, flowText);
					}
					emitProgress(partial.content?.[0]?.text);
				}
			},
			makeDetails,
		});
		const previous2 = allResults[resultIndex];
		allResults[resultIndex] = result;
		preserveMetadata(allResults[resultIndex], previous2);
		emitProgress();
		if (isFlowSuccess(result) || signal?.aborted) break;
		if (attempt < attemptModels.length - 1 && shouldFailover(result)) {
			continue;
		}
		break;
	}

	if (result && !isFlowSuccess(result) && attemptedModels.length > 1) {
		const summary = `Model failover attempts: ${attemptedModels.join(" -> ")}`;
		const baseStderr = result.stderr.trim();
		result.stderr = baseStderr ? `${baseStderr}\n\n${summary}` : summary;
		const previous3 = allResults[resultIndex];
		allResults[resultIndex] = result;
		preserveMetadata(allResults[resultIndex], previous3);
		emitProgress();
	}

	if (onFlowMetrics) {
		const flowDuration = Date.now() - flowStart;
		onFlowMetrics({
			type: normalizedType,
			durationMs: flowDuration,
			exitCode: result.exitCode,
			success: isFlowSuccess(result),
			model: result.model,
			failoverCount: Math.max(0, attemptedModels.length - 1),
			usage: result.usage,
			source: result.agentSource,
			depth: currentDepth + 1,
		});
	}

	return result;
}

export interface CycleHistoryEntry {
	cycle: number;
	buildOutputs: string[];
	verdict: string;
	feedback?: string;
	buildFeedbacks?: (string | null)[];
}

export function formatPriorAuditHistory(entries: CycleHistoryEntry[]): string {
	if (entries.length === 0) return "";

	const lines = entries.map((e) => {
		const parts = [
			`**Cycle ${e.cycle + 1}**`,
			`- Verdict: ${e.verdict}`,
		];
		if (e.feedback) {
			parts.push(`- Feedback: ${e.feedback.slice(0, 2000)}`);
		}
		if (e.buildFeedbacks && e.buildFeedbacks.length > 0) {
			parts.push(`- Per-Build Feedback:`);
			e.buildFeedbacks.forEach((fb, i) => {
				if (fb) {
					parts.push(`  - Build ${i + 1}: ${fb.slice(0, 1500)}`);
				} else {
					parts.push(`  - Build ${i + 1}: pass`);
				}
			});
		}
		return parts.join("\n");
	});

	return `## Prior Audit History\n\n${lines.join("\n\n")}`;
}

export function formatPriorBuildOutputs(entries: CycleHistoryEntry[]): string {
	if (entries.length === 0) return "";

	const lines = entries.map((e) => {
		const parts = [`**Cycle ${e.cycle + 1}**`];
		if (e.buildOutputs.length > 0) {
			parts.push(`- Build Outputs:`);
			e.buildOutputs.forEach((bo, i) => {
				parts.push(`  - Build ${i + 1}: ${bo.slice(0, 3000)}`);
			});
		}
		return parts.join("\n");
	});

	return `## Prior Build Outputs\n\n${lines.join("\n\n")}`;
}

export function buildGroupAuditIntent(
	builds: Array<{ aim: string; intent: string; acceptance?: string; output: string }>,
	cycleHistory?: CycleHistoryEntry[],
): string {
	const sections = builds.map((b, i) => {
		const section = [
			`### Build ${i + 1}`,
			``,
			`## Build Aim`,
			b.aim,
			``,
		];
		if (b.acceptance) {
			section.push(`## Acceptance Criteria`, b.acceptance, ``);
		}
		if (b.intent) {
			section.push(`## Build Intent`, b.intent, ``);
		}
		section.push(
			`## Build Output`,
			b.output.slice(0, MAX_AUDIT_OUTPUT_SLICE),
		);
		return section.join("\n");
	});

	const parts = [
		...sections,
		``,
	];

	if (cycleHistory && cycleHistory.length > 0) {
		const auditHistory = formatPriorAuditHistory(cycleHistory);
		if (auditHistory) {
			parts.push(auditHistory, ``);
		}
		const buildOutputs = formatPriorBuildOutputs(cycleHistory);
		if (buildOutputs) {
			parts.push(buildOutputs, ``);
		}
	}

	parts.push(
		`Check for: security issues, correctness, completeness, edge cases, and any overlooked requirements per build. For each build, indicate whether it passes or needs rework with specific actionable feedback.`,
	);

	return parts.join("\n\n");
}

interface PingPongGroup {
  items: ExecuteFlowParams[];
  auditLoop: number;
  buildIndices: number[];
  auditIndex: number;
  /** Explicit group ID so executeGroupedPingPong can stamp auditLoopGroupId on
   *  re-created ghosts (it overwrites the pre-allocated ghosts from executeFlows). */
  groupId: number;
}

async function executeGroupedPingPong(
  deps: FlowExecutorDeps,
  group: PingPongGroup,
  allResults: SingleResult[],
  toolCallId: string,
  emitProgress: (streamingText?: string) => void,
  selectedFlowModelConfig: LoadedFlowModelConfigs,
): Promise<SingleResult[]> {
  const { items, auditLoop, buildIndices, auditIndex } = group;
  const maxCycles = (auditLoop ?? 0) + 1;
  let cycle = 0;
  const verdictHistory: Array<{ cycle: number; verdict: string; feedback?: string }> = [];
  const cycleHistory: CycleHistoryEntry[] = [];
  const auditFeedbacks: (string | null)[] = new Array(items.length).fill(null);

  // Initialize all slots (re-creates ghosts; must stamp auditLoopGroupId
  // because executeFlows pre-allocation gets overwritten here).
  for (let i = 0; i < items.length; i++) {
    allResults[buildIndices[i]] = createGhostResult(items[i].type, items[i].intent, items[i].aim);
    allResults[buildIndices[i]].status = "running";
    allResults[buildIndices[i]].pingPongMeta = { cycles: 0, verdicts: [], finalVerdict: "pending" };
    allResults[buildIndices[i]].auditLoopGroupId = group.groupId;
  }
  const { model: auditModel, maxContextTokens: auditMaxCtx } = resolveAuditModel(deps.flows, deps.tierOverrideResolver, selectedFlowModelConfig.strategy, deps.fallbackModel);
  allResults[auditIndex] = createGhostResult("audit", "", `Audit ${items.length} build outputs`, auditModel, auditMaxCtx);
  allResults[auditIndex].status = "awaiting";
  allResults[auditIndex].auditParentType = "build";
  allResults[auditIndex].auditLoopGroupId = group.groupId;

  const key = toolCallId || 'collapsed';
  const buildResults: SingleResult[] = new Array(items.length);

  while (cycle < maxCycles) {
    // ─── Phase A: Run all builds in parallel ───
    for (let i = 0; i < items.length; i++) {
      allResults[buildIndices[i]].status = "running";
      allResults[buildIndices[i]].exitCode = -1;
      allResults[buildIndices[i]].streamingText = undefined;
      allResults[buildIndices[i]].startedAtMs = undefined;
      allResults[buildIndices[i]].deadlineAtMs = undefined;
    }
    allResults[auditIndex].status = "awaiting";
    allResults[auditIndex].exitCode = -1;
    clearLiveText(`${key}#${auditIndex}`);
    setLiveText(`${key}#${auditIndex}`, "[awaiting...]");
    setLiveText(`collapsed#${auditIndex}`, "[awaiting...]");
    emitProgress();

    // Run all builds in parallel
    const buildPromises = items.map((item, i) => {
      const buildInput = cycle > 0
        ? buildReworkIntent(item.intent, item.aim, item.acceptance, auditFeedbacks[i] ?? "No issues found.", cycleHistory)
        : item.intent;
      const buildItem: ExecuteFlowParams = { ...item, intent: buildInput };
      return executeSingleFlow(deps, buildItem, allResults, buildIndices[i], toolCallId, emitProgress, selectedFlowModelConfig);
    });
    const newBuildResults = await Promise.all(buildPromises);

    for (let i = 0; i < items.length; i++) {
      buildResults[i] = newBuildResults[i];
      preserveMetadata(buildResults[i], allResults[buildIndices[i]]);
      allResults[buildIndices[i]] = buildResults[i];
      allResults[buildIndices[i]].status = isFlowSuccess(buildResults[i]) ? "done" : "error";
      allResults[buildIndices[i]].streamingText = undefined;
      allResults[buildIndices[i]].startedAtMs = undefined;
      allResults[buildIndices[i]].deadlineAtMs = undefined;
    }
    emitProgress();

    // Check if any build failed
    const anyBuildFailed = buildResults.some(r => !isFlowSuccess(r));
    if (anyBuildFailed) {
      const { model: skipAuditModel, maxContextTokens: skipAuditMaxCtx } = resolveAuditModel(deps.flows, deps.tierOverrideResolver, selectedFlowModelConfig.strategy, deps.fallbackModel);
      allResults[auditIndex] = {
        ...createGhostResult("audit", "", `Audit ${items.length} build outputs`, skipAuditModel, skipAuditMaxCtx),
        status: "skipped",
        exitCode: 0,
        stderr: "",
        auditParentType: "build",
        auditLoopGroupId: allResults[auditIndex]?.auditLoopGroupId,
      };
      emitProgress();
      break;
    }

    // ─── Phase B: Run ONE audit that reviews all builds ───
    for (let i = 0; i < items.length; i++) {
      allResults[buildIndices[i]].status = "awaiting";
      clearLiveText(`${key}#${buildIndices[i]}`);
      setLiveText(`${key}#${buildIndices[i]}`, "[awaiting...]");
      setLiveText(`collapsed#${buildIndices[i]}`, "[awaiting...]");
    }
    allResults[auditIndex].status = "running";
    allResults[auditIndex].exitCode = -1;
    allResults[auditIndex].streamingText = undefined;
    allResults[auditIndex].startedAtMs = undefined;
    allResults[auditIndex].deadlineAtMs = undefined;
    emitProgress();

    const auditInput = buildGroupAuditIntent(
      items.map((item, i) => ({
        aim: item.aim,
        intent: item.intent,
        acceptance: item.acceptance,
        output: getFlowSummaryText(buildResults[i]),
      })),
      cycleHistory,
    );
    const auditItem: ExecuteFlowParams = {
      type: "audit",
      intent: `Audit the completed build flows.\n\n${auditInput}`,
      aim: `Audit ${items.length} build outputs`,
      acceptance: "Verify correctness, security, and completeness of all build flows' outputs.",
      complexity: items[0]?.complexity ?? "moderate",
    };
    const auditResult = await executeSingleFlow(deps, auditItem, allResults, auditIndex, toolCallId, emitProgress, selectedFlowModelConfig);
    auditResult.auditParentType = items[0].type;
    allResults[auditIndex] = auditResult;

    // Parse per-build verdicts
    const perBuildVerdicts = auditResult.structuredOutput?.builds;
    const topLevelVerdict = auditResult.structuredOutput?.verdict ?? "pass";
    const topLevelFeedback = auditResult.structuredOutput?.feedback;

    let anyReworkNeeded = false;

    if (Array.isArray(perBuildVerdicts)) {
      for (let i = 0; i < items.length; i++) {
        const bv = perBuildVerdicts.find((b: { index: number | string; verdict?: string; feedback?: string }) => Number(b.index) === i);
        if (bv?.verdict === "rework") {
          auditFeedbacks[i] = bv.feedback ?? "Fix issues found in audit.";
          anyReworkNeeded = true;
        } else {
          auditFeedbacks[i] = null;
        }
      }
    } else {
      // Fallback: top-level verdict applies to all builds
      if (topLevelVerdict === "rework") {
        for (let i = 0; i < items.length; i++) {
          auditFeedbacks[i] = topLevelFeedback ?? "Fix issues found in audit.";
        }
        anyReworkNeeded = true;
      } else {
        for (let i = 0; i < items.length; i++) {
          auditFeedbacks[i] = null;
        }
      }
    }

    verdictHistory.push({
      cycle,
      verdict: anyReworkNeeded ? "rework" : "pass",
      ...(anyReworkNeeded && topLevelFeedback ? { feedback: topLevelFeedback } : {}),
    });

    cycleHistory.push({
      cycle,
      buildOutputs: buildResults.map((r) => getFlowSummaryText(r)),
      verdict: anyReworkNeeded ? "rework" : "pass",
      feedback: anyReworkNeeded ? topLevelFeedback : undefined,
      buildFeedbacks: [...auditFeedbacks],
    });

    auditResult.status = auditResult.exitCode === 0 ? "done" : "error";
    preserveMetadata(auditResult, allResults[auditIndex]);
    allResults[auditIndex] = auditResult;
    emitProgress();

    if (!anyReworkNeeded) {
      break;
    }

    if (cycle + 1 >= maxCycles) {
      break; // Loop exhausted
    }

    cycle++;
    // Continue loop — builds needing rework will re-run
  }

  // Finalize: set real exit codes
  for (let i = 0; i < items.length; i++) {
    allResults[buildIndices[i]].exitCode = isFlowSuccess(buildResults[i]) ? 0 : (buildResults[i].exitCode > 0 ? buildResults[i].exitCode : 1);
    allResults[buildIndices[i]].status = isFlowSuccess(buildResults[i]) ? "done" : "error";
  }
  if (allResults[auditIndex].status === "skipped") {
    allResults[auditIndex].exitCode = 0;
  } else {
    allResults[auditIndex].exitCode = isFlowSuccess(allResults[auditIndex]) ? 0 : (allResults[auditIndex].exitCode > 0 ? allResults[auditIndex].exitCode : 1);
    allResults[auditIndex].status = "done";
  }

  // Populate pingPongMeta on each build result
  for (let i = 0; i < items.length; i++) {
    allResults[buildIndices[i]].pingPongMeta = {
      cycles: cycle + 1,
      verdicts: verdictHistory,
      finalVerdict: allResults[auditIndex].structuredOutput?.verdict ?? (allResults[auditIndex].status === "skipped" ? "fail" : "pass"),
    };
  }

  emitProgress();
  return buildResults;
}


// ---------------------------------------------------------------------------
// FlowExecutor
// ---------------------------------------------------------------------------

/**
 * Execute a set of flow tasks with full orchestration: cycle detection,
 * project confirmation, parallel execution with model failover, and telemetry.
 */
export async function executeFlows(
	deps: FlowExecutorDeps,
	params: ExecuteFlowParams[],
	toolCallId: string,
	auditLoop: number,
): Promise<ExecuteFlowResult> {
	const {
		flows, currentDepth, maxDepth, ancestorFlowStack, preventCycles,
		toolOptimize, structuredOutput, cwd, loadedFlowModelConfigs,
		maxConcurrency, defaultComplexity, signal, onUpdate, makeDetails,
		getFlag, tierOverrideResolver, fallbackModel, forkSessionSnapshotJsonl,
		projectFlowsDir, hasUI, uiConfirm, onFlowMetrics,
		confirmProjectFlows,
		goalContext,
	} = deps;

	const requested = new Set<string>(params.map((f) => f.type.toLowerCase()));

	// Cycle check
	if (preventCycles) {
		const violations = getFlowCycleViolations(requested, ancestorFlowStack);
		if (violations.length > 0) {
			const stack = ancestorFlowStack.join(" -> ") || "(root)";
			return {
				content: [{
					type: "text",
					text: `Blocked: cycle detected. Flow(s) in stack: ${violations.join(", ")}\nStack: ${stack}`,
				}],
				details: makeDetails([]),
				failed: true,
			};
		}
	}

	// Project flow confirmation
	const projectFlows = getRequestedProjectFlows(flows, requested);
	if (projectFlows.length > 0 && confirmProjectFlows !== false) {
		const { ok, blocked } = await confirmProjectFlowsIfNeeded(projectFlows, projectFlowsDir, hasUI, uiConfirm);
		if (!ok) {
			return {
				content: [{ type: "text", text: blocked ?? "Canceled: project-local flows not approved." }],
				details: makeDetails([]),
				failed: !blocked,
			};
		}
	}

	// Resolve model strategy
	const cliFlowMode = normalizeFlowModeName(getFlag("flow-mode"));
	const cliFlowModelConfig = normalizeFlowModeName(getFlag("flow-model-config"));
	if (cliFlowMode !== undefined && cliFlowModelConfig !== undefined && cliFlowMode !== cliFlowModelConfig) {
		logWarn(
			`[pi-agent-flow] Both --flow-mode "${cliFlowMode}" and --flow-model-config "${cliFlowModelConfig}" were provided. Using --flow-mode.`,
		);
	}
	const selectedFlowModelConfig = selectFlowModelStrategy(
		loadedFlowModelConfigs.configs,
		cliFlowMode ?? cliFlowModelConfig ?? loadedFlowModelConfigs.selectedName,
	);

	// Partition params into regular and grouped ping-pong flows
	const regularParams: ExecuteFlowParams[] = [];
	const regularIndices: number[] = [];
	const groups: PingPongGroup[] = [];

	// Compute effective audit loop per build = max(explicit override, complexity-implied)
	const effectiveAuditLoops = params.map((p) => {
		if (p.type.toLowerCase() === "build") {
			return Math.max(auditLoop ?? 0, getImpliedAuditLoop(p.complexity));
		}
		return 0;
	});
	const hasBuildsWithAudit = effectiveAuditLoops.some((loop, i) =>
		params[i].type.toLowerCase() === "build" && loop > 0,
	);

	let nextIndex = 0;
	let buildGroup: PingPongGroup | undefined;
	for (let i = 0; i < params.length; i++) {
		if (hasBuildsWithAudit && params[i].type.toLowerCase() === "audit") {
			logWarn(`Manual audit flow skipped — audit auto-spawned by complexity or auditLoop`);
			continue;
		}
		if (params[i].type.toLowerCase() === "build" && effectiveAuditLoops[i] > 0) {
			if (buildGroup) {
				buildGroup.items.push(params[i]);
				buildGroup.buildIndices.push(nextIndex++);
				buildGroup.auditLoop = Math.max(buildGroup.auditLoop, effectiveAuditLoops[i]);
			} else {
				const buildIndex = nextIndex++;
				buildGroup = {
					items: [params[i]],
					auditLoop: effectiveAuditLoops[i],
					buildIndices: [buildIndex],
					auditIndex: -1, // placeholder; assigned after all builds
					groupId: -1,   // placeholder; set after auditIndex is assigned
				};
				groups.push(buildGroup!);
			}
		} else {
			regularIndices.push(nextIndex);
			regularParams.push(params[i]);
			nextIndex++;
			// Non-build param breaks contiguity — reset so later builds start a new group
			buildGroup = undefined;
		}
	}

	// Assign audit indices after all builds are allocated
	let groupCounter = 0;
	for (const group of groups) {
		group.auditIndex = nextIndex++;
		group.groupId = groupCounter++;
	}

	// Pre-allocate results array
	const allResults: SingleResult[] = new Array(nextIndex);
	for (let i = 0; i < regularParams.length; i++) {
		const idx = regularIndices[i];
		allResults[idx] = {
			type: regularParams[i].type,
			agentSource: "unknown",
			intent: regularParams[i].intent,
			aim: regularParams[i].aim,
			acceptance: regularParams[i].acceptance,
			exitCode: -1,
			messages: [],
			stderr: "",
			usage: emptyFlowUsage(),
		};
	}
	for (const group of groups) {
		for (let i = 0; i < group.items.length; i++) {
			const buildIndex = group.buildIndices[i];
			allResults[buildIndex] = createGhostResult(group.items[i].type, group.items[i].intent, group.items[i].aim);
			allResults[buildIndex].status = "running";
			allResults[buildIndex].pingPongMeta = { cycles: 0, verdicts: [], finalVerdict: "pending" };
			allResults[buildIndex].auditLoopGroupId = group.groupId;
		}
		const { model: auditModel, maxContextTokens: auditMaxCtx } = resolveAuditModel(flows, tierOverrideResolver, selectedFlowModelConfig.strategy, fallbackModel);
		allResults[group.auditIndex] = createGhostResult("audit", "", `Audit ${group.items.length} build outputs`, auditModel, auditMaxCtx);
		allResults[group.auditIndex].status = "awaiting";
		allResults[group.auditIndex].auditParentType = "build";
		allResults[group.auditIndex].auditLoopGroupId = group.groupId;
	}

	// Streaming progress
	let lastEmittedSignature: string | undefined;
	const emitProgress = (streamingText?: string) => {
		const activeStreamingText = allResults
			.filter((r) => r.exitCode === -1)
			.map((r) => r.streamingText)
			.filter((text): text is string => Boolean(text))
			.at(-1);
		const text = streamingText ?? activeStreamingText ?? "";

		// Update live text store FIRST — always
		const key = toolCallId || 'collapsed';
		setLiveText(key, text);
		setLiveText('collapsed', text);
		for (let i = 0; i < allResults.length; i++) {
			const r = allResults[i];
			if (r.streamingText) {
				setLiveText(`${key}#${i}`, r.streamingText);
				setLiveText(`collapsed#${i}`, r.streamingText);
			}
		}

		// Now check onUpdate for host callback
		if (!onUpdate) return;

		const signature =
			text +
			"|" +
			allResults
				.map((r) => {
					const remainingSeconds = r.exitCode === -1 && typeof r.deadlineAtMs === "number"
						? Math.max(0, Math.ceil((r.deadlineAtMs - Date.now()) / 1000))
						: "";
					return `${r.messages.length}:${r.usage.toolCalls}:${r.usage.input}:${r.usage.output}:${r.usage.contextTokens}:${r.usage.smoothedTps ?? 0}:${r.startedAtMs ?? ""}:${r.deadlineAtMs ?? ""}:${remainingSeconds}:${r.errorMessage ?? ""}`;
				})
				.join(";");
		if (signature === lastEmittedSignature) return;
		lastEmittedSignature = signature;
		try {
			onUpdate({
				content: [{ type: "text", text }],
				details: makeDetails([...allResults]),
				_toolCallId: toolCallId,
			});
		} catch (err) {
			if (err instanceof Error && err.message.includes("outside active run")) {
				// Agent listener invoked from async callback (child stdout handler)
				// after the active run context ended. Safe to drop this update.
				return;
			}
			throw err;
		}
	};

	emitProgress();

	// Execute all flows
	const executionStart = Date.now();
	const regularPromise = regularParams.length > 0
		? mapFlowConcurrent(regularParams, maxConcurrency, async (item, localIndex) => {
			const globalIndex = regularIndices[localIndex];
			return executeSingleFlow(deps, item, allResults, globalIndex, toolCallId, emitProgress, selectedFlowModelConfig);
		})
		: Promise.resolve([]);

	const groupPromises = groups.map((group) =>
		executeGroupedPingPong(deps, group, allResults, toolCallId, emitProgress, selectedFlowModelConfig),
	);

	await Promise.all([regularPromise, ...groupPromises]);

	const results = [...allResults];

	// Record last flow completion for dynamic notifications
	const lastResult = results[results.length - 1];
	if (lastResult) {
		setFlowComplete(
			lastResult.type,
			lastResult.acceptance,
			results.length - 1,
			results.length,
		);
	}

	// Mark flow completion for the continuation hold — gives the user
	// time to read the result before the next flow auto-spawns.
	markFlowCompleted(deps.sessionManager.getSessionId());

	// Goal continuation callback
	if (deps.goalContinuationCallback) {
		await deps.goalContinuationCallback(results);
	}

	// Build tool result
	const successCount = results.filter((r) => isFlowSuccess(r)).length;
	const flowReports = results.map((r) => {
		const output = getFlowSummaryText(r);
		const status = isFlowError(r) ? "failed" : "accomplished";
		return `flow [${r.type}] ${status}\n\n${output}`;
	});

	return {
		content: [{
			type: "text" as const,
			text: `Flow: ${successCount}/${results.length} completed\n\n${flowReports.join("\n\n---\n\n")}`,
		}],
		details: makeDetails(results),
		_toolCallId: toolCallId,
	};
}

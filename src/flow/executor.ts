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
import { getTransitionAdvice } from "./transitions.js";
import { mapFlowConcurrent, runFlow } from "./runner.js";
import { getFlowSummaryText } from "../snapshot/runner-events.js";
import { normalizeFlowModeName, resolveFlowModelCandidates, resolveModelContextWindow, selectFlowModelStrategy, type LoadedFlowModelConfigs, type FlowModelStrategy } from "../config/config.js";
import { getAgentSessionTimeoutMs, resolveAgentSessionMode, type AgentSessionMode } from "./session-mode.js";
import { setFlowComplete } from "../notify/notify-state.js";
import { setLiveText } from '../tui/scramble/index.js';
import { logWarn } from '../config/log.js';
import { markFlowCompleted } from '../flow/index.js';
import type { GoalContext } from '../flow/types.js';

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

	/** Default child-flow session mode. */
	defaultSessionMode: AgentSessionMode;
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
	sessionMode?: AgentSessionMode;
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
): Promise<ExecuteFlowResult> {
	const {
		flows, currentDepth, maxDepth, ancestorFlowStack, preventCycles,
		toolOptimize, structuredOutput, cwd, loadedFlowModelConfigs,
		maxConcurrency, defaultSessionMode, signal, onUpdate, makeDetails,
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

	// Pre-allocate results array
	const allResults: SingleResult[] = new Array(params.length);
	for (let i = 0; i < params.length; i++) {
		allResults[i] = {
			type: params[i].type,
			agentSource: "unknown",
			intent: params[i].intent,
			aim: params[i].aim,
			acceptance: params[i].acceptance,
			exitCode: -1,
			messages: [],
			stderr: "",
			usage: emptyFlowUsage(),
		};
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

// (debug trace removed — was writing to /tmp/pi-flow-debug.log on every emitProgress call)

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
		onUpdate({
			content: [{ type: "text", text }],
			details: makeDetails([...allResults]),
			_toolCallId: toolCallId,
		});
	};

	emitProgress();

	// Execute all flows in parallel
	const executionStart = Date.now();
	const results = await mapFlowConcurrent(params, maxConcurrency, async (item, index) => {
		const normalizedType = item.type.toLowerCase();
		const sessionMode = resolveAgentSessionMode(item.sessionMode, defaultSessionMode);
		const targetFlow = flows.find((f) => f.name === normalizedType);
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
		let result = allResults[index];
		const flowStart = Date.now();

		for (let attempt = 0; attempt < attemptModels.length; attempt++) {
			const candidateModel = attemptModels[attempt];
			if (candidateModel) attemptedModels.push(candidateModel);
			const attemptStartMs = Date.now();
			const attemptTimeoutMs = getAgentSessionTimeoutMs(sessionMode);
			const maxContextTokens = resolveModelContextWindow(candidateModel);
			allResults[index] = {
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
			emitProgress();
			result = await runFlow({
				cwd,
				flows,
				flowName: normalizedType,
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
				sessionMode,
				model: candidateModel,
				maxContextTokens,
				goalContext: deps.goalContext,
				signal,
				onUpdate: (partial) => {
					if (partial.details?.results[0]) {
						allResults[index] = partial.details.results[0];
						// Update per-flow live text
						const flowText = partial.content?.[0]?.text;
						if (flowText !== undefined) {
							setLiveText(`${toolCallId || 'collapsed'}#${index}`, flowText);
							setLiveText(`collapsed#${index}`, flowText);  // ← predictable fallback
						}
						emitProgress(partial.content?.[0]?.text);
					}
				},
				makeDetails,
			});
			allResults[index] = result;
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
			allResults[index] = result;
			emitProgress();
		}

		// Telemetry for individual flow
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
	});

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

	// Post-flow advisory messages from the transition matrix
	const advisors = getTransitionAdvice(params, results);
	const advisorBlock = advisors.length > 0
		? "\n\n---\n\n💡 " + advisors.join("\n💡 ")
		: "";

	return {
		content: [{
			type: "text" as const,
			text: `Flow: ${successCount}/${results.length} completed\n\n${flowReports.join("\n\n---\n\n")}${advisorBlock}`,
		}],
		details: makeDetails(results),
		_toolCallId: toolCallId,
	};
}

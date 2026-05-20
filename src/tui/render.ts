/**
 * TUI rendering for flow-state tool calls and results.
 *
 * Option B: collapsed view shows structured report (Summary/Done/Not Done/Next Steps).
 * Expanded view adds raw tool call traces.
 */

import * as os from "node:os";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text, TruncatedText } from "@earendil-works/pi-tui";
import { getFlowSummaryText } from "../snapshot/runner-events.js";
import type {
	SingleResult,
	FlowDetails,
} from "../types/flow.js";
import {
	aggregateFlowUsage,
	getFlowOutput,
	isFlowError,
	isFlowSuccess,
} from "../types/flow.js";
import {
	type DisplayItem,
	getFlowDisplayItems,
	getLastToolCall,
	getLastAssistantText,
	countPendingToolCalls,
	countPendingOps,
} from "../types/ui.js";
import { formatBatchOpsSummary } from "../batch/summary.js";
import { scrambleManager, runScrambleTimer, DynamicScrambleText, getLiveText, hashNoise, THIN_BRAILLE_SPARK } from "./scramble/index.js";

// ---------------------------------------------------------------------------
// Anonymous flow-id counter — prevents scramble-state collisions when multiple
// flow widgets share the screen and toolCallId is absent from result/args.
// ---------------------------------------------------------------------------
let anonFlowIdCounter = 0;
function getAnonymousFlowId(): string {
	return `flow-${++anonFlowIdCounter}`;
}

/** Reset the anonymous counter — call in tests for deterministic ids. */
export function resetAnonymousFlowIdCounter(): void {
	anonFlowIdCounter = 0;
}

function getLiveTextWithFallback(id: string): string | undefined {
	const value = getLiveText(id);
	if (value !== undefined) return value;
	const fallbackId = id.includes("#") ? "collapsed" + id.slice(id.indexOf("#")) : "collapsed";
	return getLiveText(fallbackId);
}
import { formatCompactStats, formatFlowTypeName, lowerFirstWord, truncateChars, tailText, getTruncationBudget, visibleLength, stripAnsi, formatModelLabel, formatContextLabel, formatTps, italic } from "./render-utils.js";

function shortenPath(p: string): string {
	const home = os.homedir();
	return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

import {
  type FlowColorConfig,
  type FlowTheme,
  applyRole,
  DEFAULT_FLOW_COLORS,
} from "./flow-colors.js";
type ThemeFg = (color: string, text: string) => string;

function formatCollapsedFlowHeaderTypeName(type: string): string {
	return type.toLowerCase();
}

function formatFlowToolCall(toolName: string, args: Record<string, unknown>, fg: ThemeFg): string {
	const pathArg = (args.file_path || args.path || "...") as string;

	switch (toolName) {
		case "bash": {
			const cmd = ((args.command as string) || "...").replace(/[\n\r\t]+/g, " ").replace(/ +/g, " ").trim();
			return fg("muted", "$ ") + fg("toolOutput", cmd);
		}
		case "read": {
			let text = fg("accent", shortenPath(pathArg));
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			if (offset !== undefined || limit !== undefined) {
				const start = offset ?? 1;
				const end = limit !== undefined ? start + limit - 1 : "";
				text += fg("warning", `:${start}${end ? `-${end}` : ""}`);
			}
			return fg("muted", "read ") + text;
		}
		case "write": {
			const lines = ((args.content || "") as string).split("\n").length;
			let text = fg("muted", "write ") + fg("accent", shortenPath(pathArg));
			if (lines > 1) text += fg("dim", ` (${lines} lines)`);
			return text;
		}
		case "edit":
			return fg("muted", "edit ") + fg("accent", shortenPath(pathArg));
		case "ls":
			return fg("muted", "ls ") + fg("accent", shortenPath((args.path || ".") as string));
		case "find":
			return fg("muted", "find ") + fg("accent", (args.pattern || "*") as string) + fg("dim", ` in ${shortenPath((args.path || ".") as string)}`);
		case "grep":
			return fg("muted", "grep ") + fg("accent", `/${(args.pattern || "") as string}/`) + fg("dim", ` in ${shortenPath((args.path || ".") as string)}`);
		case "batch":
		case "batch_read": {
			const summary = formatBatchOpsSummary(args);
			return fg("muted", `${toolName} `) + fg("accent", summary);
		}
		default:
			return fg("accent", toolName) + fg("dim", ` ${JSON.stringify(args)}`);
	}
}

// ---------------------------------------------------------------------------
// Shared rendering building blocks
// ---------------------------------------------------------------------------

function splitOutputLines(text: string): string[] {
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
	return lines;
}

function renderToolTraces(
	items: DisplayItem[],
	theme: FlowTheme,
	config?: FlowColorConfig,
): string {
	const lines: string[] = [];
	for (const item of items) {
		if (item.type === "toolCall") {
			lines.push(applyRole("prefixLabel", "→ ", theme, config) + formatFlowToolCall(item.name, item.args, theme.fg.bind(theme)));
		}
	}
	return lines.join("\n");
}

function renderFlowReport(
	output: string,
	theme: FlowTheme,
	config?: FlowColorConfig,
): string {
	const lines = splitOutputLines(output);
	return lines.map((line) => applyRole("actContent", line, theme, config)).join("\n");
}

function getFlowStatus(r: SingleResult): string {
	return r.status ?? (r.exitCode === -1 ? "running" : r.exitCode === 0 ? "done" : "error");
}

function isFlowStatusComplete(r: SingleResult): boolean {
	const status = getFlowStatus(r);
	return status === "done" || status === "error" || status === "skipped";
}

function isFlowRunning(r: SingleResult): boolean {
	const status = getFlowStatus(r);
	return status === "running" || status === "pending";
}

function isFlowAwaiting(r: SingleResult): boolean {
	return getFlowStatus(r) === "awaiting";
}

// ---------------------------------------------------------------------------
// Grouped audit-loop tree rendering helpers
// ---------------------------------------------------------------------------

export interface FlowGroup {
  /** indices into results[] that are builds in this group */
  buildIndices: number[];
  /** index into results[] of the capstone audit */
  auditIndex: number;
}

export interface GroupDetectionResult {
  groups: FlowGroup[];
  /** indices into results[] of standalone flows not in any group */
  rootIndices: number[];
}

/**
 * Detect audit-loop groups.
 *
 * When the executor stamps `auditLoopGroupId` on results, grouping is
 * explicit and works regardless of array layout (no contiguity required).
 *
 * When no `auditLoopGroupId` is present (legacy / hand-crafted results),
 * we fall back to contiguity-based detection: N contiguous builds with
 * `pingPongMeta` followed immediately by an audit with
 * `auditParentType === "build"`.
 */
export function detectGroups(results: SingleResult[]): GroupDetectionResult {
  const groups: FlowGroup[] = [];
  const rootIndices: number[] = [];

  // Phase 1: explicit grouping by auditLoopGroupId
  const groupMap = new Map<number, { buildIndices: number[]; auditIndex: number }>();
  const ungroupedIndices: number[] = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.auditLoopGroupId !== undefined) {
      let g = groupMap.get(r.auditLoopGroupId);
      if (!g) {
        g = { buildIndices: [], auditIndex: -1 };
        groupMap.set(r.auditLoopGroupId, g);
      }
      if (r.pingPongMeta) {
        g.buildIndices.push(i);
      } else if (r.auditParentType === "build") {
        g.auditIndex = i;
      }
    } else {
      ungroupedIndices.push(i);
    }
  }

  for (const g of groupMap.values()) {
    if (g.auditIndex !== -1) {
      groups.push({ buildIndices: g.buildIndices, auditIndex: g.auditIndex });
    } else {
      // Orphaned builds with groupId but no audit capstone
      rootIndices.push(...g.buildIndices);
    }
  }

  // Phase 2: legacy fallback on ungrouped results (contiguity-based)
  let i = 0;
  while (i < ungroupedIndices.length) {
    const idx = ungroupedIndices[i];
    const r = results[idx];

    if (r.pingPongMeta) {
      const buildIndices: number[] = [];
      while (i < ungroupedIndices.length && results[ungroupedIndices[i]].pingPongMeta) {
        buildIndices.push(ungroupedIndices[i]);
        i++;
      }
      if (i < ungroupedIndices.length && results[ungroupedIndices[i]].auditParentType === "build") {
        groups.push({ buildIndices, auditIndex: ungroupedIndices[i] });
        i++;
      } else {
        rootIndices.push(...buildIndices);
      }
    } else if (r.auditParentType === "build" && i > 0 && results[ungroupedIndices[i - 1]].pingPongMeta) {
      i++; // orphan audit already consumed
    } else {
      rootIndices.push(idx);
      i++;
    }
  }

  return { groups, rootIndices };
}

/**
 * Get the status icon dot for a result (● ○ ✗ ⊘).
 */
function flowStatusIcon(r: SingleResult, theme: { fg: ThemeFg }): string {
	const status = getFlowStatus(r);
	switch (status) {
		case "running":
		case "pending":
			return theme.fg("warning", "●");
		case "awaiting":
			return theme.fg("muted", "○");
		case "done":
			return theme.fg("success", "●");
		case "error":
			return theme.fg("error", "✗");
		case "skipped":
			return theme.fg("muted", "⊘");
		default:
			return theme.fg("muted", "?");
	}
}

function hashStrToSeed(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

function getScintillatingStatusDot(r: SingleResult, theme: { fg: ThemeFg }, now: number, flowId?: string): string {
	const status = getFlowStatus(r);
	switch (status) {
		case "running":
		case "pending": {
			const isPending = status === "pending";
			const seed = hashStrToSeed(flowId || r.type);
			const bucketSize = isPending ? 7000 : 5000;
			const bucket = Math.floor(now / bucketSize);
			const t = now % bucketSize;

			const burstCount = isPending
				? 1 + Math.floor(hashNoise(seed, bucket, 0, 0x5a4f) * 2) // 1-2
				: 2 + Math.floor(hashNoise(seed, bucket, 0, 0x5a4f) * 2); // 2-3

			let cursor = 50;
			for (let b = 0; b < burstCount; b++) {
				const gap = isPending
					? 800 + Math.floor(hashNoise(seed, bucket, b * 4, 0xb8a0) * 1400) // 800-2200ms
					: 500 + Math.floor(hashNoise(seed, bucket, b * 4, 0xb8a0) * 1300);  // 500-1800ms
				cursor += gap;
				const duration = isPending
					? 80 + Math.floor(hashNoise(seed, bucket, b * 4 + 1, 0xc0de) * 170)  // 80-250ms
					: 100 + Math.floor(hashNoise(seed, bucket, b * 4 + 1, 0xc0de) * 250); // 100-350ms
				const burstStart = cursor;
				const burstEnd = cursor + duration;
				cursor = burstEnd;

				if (t >= burstStart && t < burstEnd) {
					const tInBurst = t - burstStart;
					const tick = 12 + Math.floor(hashNoise(seed, bucket, b * 4 + 3, 0xd1a0) * 10); // 12-22ms per stutter step

					// Vary stutter depth: 3-tick ○●○ or 5-tick ○●○●○ per burst
					const rawStutterTicks = hashNoise(seed, bucket, b * 4 + 2, 0xe7a1) > 0.5 ? 5 : 3;
					const stutterLen5 = tick * 5;
					const onRunMax5 = duration - stutterLen5 - 5;
					const stutterTicks = (rawStutterTicks === 5 && onRunMax5 >= tick) ? 5 : 3;
					const stutterLen = tick * stutterTicks;

					const onRunMax = duration - stutterLen - 5;
					const onRun = Math.max(tick, Math.min(
						Math.floor(duration * (0.35 + hashNoise(seed, bucket, b * 4 + 2, 0xf1c0) * 0.3)),
						onRunMax
					));
					const cycleLen = onRun + stutterLen;
					const phaseInCycle = tInBurst % cycleLen;
					const cycleIdx = Math.floor(tInBurst / cycleLen);

					// Helper: dip ○ with occasional sparkle
					const dipDot = (dipIndex: number): string => {
						if (hashNoise(seed, bucket, cycleIdx + dipIndex * 100, 0x5ab0) < 0.05) {
							const sparkIdx = Math.floor(hashNoise(seed, bucket, cycleIdx + dipIndex * 100, 0x5b1) * THIN_BRAILLE_SPARK.length);
							return theme.fg("muted", THIN_BRAILLE_SPARK[sparkIdx]);
						}
						return theme.fg("muted", "○");
					};

					if (phaseInCycle < onRun) {
						// Sustained bright ●
						return theme.fg("warning", "●");
					} else if (phaseInCycle < onRun + tick) {
						return dipDot(0); // ○ dip 1
					} else if (phaseInCycle < onRun + tick * 2) {
						return theme.fg("warning", "●"); // ● flash 1
					} else if (phaseInCycle < onRun + tick * 3) {
						return dipDot(1); // ○ dip 2
					} else if (stutterTicks >= 5 && phaseInCycle < onRun + tick * 4) {
						return theme.fg("warning", "●"); // ● flash 2 (5-tick only)
					} else if (stutterTicks >= 5 && phaseInCycle < onRun + tick * 5) {
						return dipDot(2); // ○ dip 3 (5-tick only)
					} else {
						// Fallback: shouldn't reach if scheduling is correct
						return theme.fg("warning", "●");
					}
				}
			}
			return theme.fg("warning", "●");
		}
		case "awaiting":
			return theme.fg("muted", "○");
		case "done":
			return theme.fg("success", "●");
		case "error":
			return theme.fg("error", "✗");
		case "skipped":
			return theme.fg("muted", "⊘");
		default:
			return theme.fg("muted", "?");
	}
}

/** Center a label in a fixed-width header using em-dashes. Total width = 20. */
function sectionHeader(label: string): string {
	const total = 20;
	const innerLen = label.length + 2; // account for spaces around label
	const side = (total - innerLen) / 2;
	const left = "─".repeat(Math.floor(side));
	const right = "─".repeat(Math.ceil(side));
	return `${left} ${label} ${right}`;
}

/** Single segment of a multi-part header with its original plain length and style. */
export interface HeaderSegment {
	text: string;
	style: (text: string) => string;
}

/** Reconstruct multi-segment ANSI styles on a flat string by splitting at
 *  original segment boundaries and re-applying each segment's style function.
 */
export function reconstructHeader(content: string, segments: HeaderSegment[]): string {
	let offset = 0;
	const parts: string[] = [];
	for (const seg of segments) {
		const len = seg.text.length;
		if (offset >= content.length) break;
		parts.push(seg.style(content.slice(offset, offset + len)));
		offset += len;
	}
	if (offset < content.length) {
		parts.push(content.slice(offset));
	}
	return parts.join("");
}


// ---------------------------------------------------------------------------
// renderFlowCall — shown while the flow is being invoked
// ---------------------------------------------------------------------------

export function renderFlowCall(args: Record<string, any>, theme: FlowTheme, config?: FlowColorConfig): Container | Text {
	let container: Container | Text = new Text("", 0, 0);

	// In-place mutation pattern: reuse the stored root container
	// so the TUI host's cached reference stays valid.
	if (args?.state) {
		const s = args.state as Record<string, any>;
		if (!s.__rootContainer) {
			const root = new Container();
			root.addChild(container);
			s.__rootContainer = root;
			container = root;
		} else if (container !== s.__rootContainer) {
			const root = s.__rootContainer as Container;
			root.clear();
			root.addChild(container);
			root.invalidate();
			container = root;
		}
	}

	return container;
}

// ---------------------------------------------------------------------------
// renderFlowResult — shown after the flow completes
// ---------------------------------------------------------------------------

export function renderFlowResult(
	result: { content: Array<{ type: string; text?: string }>; details?: unknown },
	expanded: boolean,
	theme: FlowTheme,
	args?: Record<string, any>,
	config?: FlowColorConfig,
): Container | Text {
	const details = result.details as FlowDetails | undefined;
	const streamingText = result.content?.[0]?.type === "text" ? result.content[0].text : undefined;

	// Resolve a stable id for this flow widget. Once an id is stored in
	// state we keep reusing it to prevent mid-render id switches that would
	// reset scramble animation state. On first render we prefer result._toolCallId,
	// then args inputs, then a per-state anonymous counter.
	// This prevents scramble-state collisions when multiple flow widgets are
	// visible simultaneously (e.g. sequential flows) and toolCallId is absent.
	let resolvedToolCallId: string | undefined;
	if (args?.state) {
		const s = args.state as Record<string, any>;
		resolvedToolCallId = s.__widgetId;
		if (!resolvedToolCallId) {
			resolvedToolCallId = (result as any)._toolCallId || (args as any)?.toolCallId || (args as any)?.id;
			if (!resolvedToolCallId) {
				resolvedToolCallId = getAnonymousFlowId();
			}
			s.__widgetId = resolvedToolCallId;
		}
	} else {
		resolvedToolCallId = (result as any)._toolCallId || (args as any)?.toolCallId || (args as any)?.id;
	}

	let container: Container | Text;

	if (!details || details.results.length === 0) {
		// Ghost Dashboard: render a placeholder status line during the zero state
		const flowRequest = args?.flow?.[0];
		if (flowRequest) {
			const ghostResult: SingleResult = {
				type: flowRequest.type || "unknown",
				agentSource: "user",
				intent: flowRequest.intent || "Processing...",
				aim: flowRequest.aim || flowRequest.intent || "Processing...",
				acceptance: flowRequest.acceptance,
				exitCode: -1, // In progress
				messages: [],
				stderr: "",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0, toolCalls: 0 },
			};
			const ghostId = resolvedToolCallId || 'ghost';
			if (expanded) {
				const now = Date.now();
				container = renderFlowExpanded(ghostResult, flowStatusIcon(ghostResult, theme), false, getFlowDisplayItems([]), getFlowOutput([]), theme, ghostId, now, false, streamingText || "", config);
			} else {
				container = renderFlowCollapsed(ghostResult, flowStatusIcon(ghostResult, theme), false, streamingText || "", theme, undefined, ghostId, config);
			}
		} else {
			container = new Text(scrambleManager.renderStatic(streamingText || ""), 0, 0);
		}
	} else if (details.results.length === 1) {
		container = renderSingleFlowResult(details.results[0], expanded, theme, streamingText, resolvedToolCallId, config);
	} else {
		container = renderMultiFlowResult(details, expanded, theme, resolvedToolCallId, config);
	}

	// In-place mutation pattern: reuse the stored root container
	// so the TUI host's cached reference stays valid.
	if (args?.state) {
		const s = args.state as Record<string, any>;
		if (!s.__rootContainer) {
			// First render: store the container (always wrap Text in a Container for consistency)
			if (container instanceof Container) {
				s.__rootContainer = container;
			} else {
				const root = new Container();
				root.addChild(container);
				s.__rootContainer = root;
			}
		} else if (container !== s.__rootContainer) {
			// Subsequent renders: transfer children to the stored container.
			// Use a snapshot of the children array so the loop remains safe even if
			// addChild() mutates the source array (removes from old parent).
			const root = s.__rootContainer as Container;
			root.clear();
			if (container instanceof Container) {
				const children = [...(container as Container).children];
				for (const child of children) {
					root.addChild(child);
				}
			} else {
				// container is a Text — wrap it as a child
				root.addChild(container);
			}
			root.invalidate();
			container = root;
		}
	}

	// Scramble animation timer — shared helper so any renderer can animate.
	// Use resolvedToolCallId so the timer scope matches the state scope.
	let timerId: string;
	if (!details || details.results.length === 0) {
		const flowRequest = args?.flow?.[0];
		timerId = resolvedToolCallId || (flowRequest ? 'ghost' : 'single');
	} else if (details.results.length === 1) {
		timerId = resolvedToolCallId || 'single';
	} else {
		timerId = resolvedToolCallId || 'multi';
	}
	runScrambleTimer(args as Record<string, any> | undefined, timerId);

	return container;
}

// ---------------------------------------------------------------------------
// Single flow result
// ---------------------------------------------------------------------------

export function renderSingleFlowResult(
	r: SingleResult,
	expanded: boolean,
	theme: FlowTheme,
	streamingText?: string,
	toolCallId?: string,
	config?: FlowColorConfig,
): Container | Text {
	const id = toolCallId || "single";
	const error = isFlowError(r);
	const icon = flowStatusIcon(r, theme);
	const displayItems = getFlowDisplayItems(r.messages);
	const flowOutput = getFlowOutput(r.messages);
	const now = Date.now();
	const isComplete = isFlowStatusComplete(r);

	if (expanded) {
		return renderFlowExpanded(r, icon, error, displayItems, flowOutput, theme, id, now, isComplete, streamingText, config);
	}
	return renderFlowCollapsed(r, icon, error, flowOutput, theme, streamingText, id, config);
}

function renderFlowExpanded(
	r: SingleResult,
	icon: string,
	error: boolean,
	displayItems: DisplayItem[],
	flowOutput: string,
	theme: FlowTheme,
	id: string,
	now: number,
	isComplete: boolean,
	streamingText?: string,
	config?: FlowColorConfig,
): Container {
	const mdTheme = getMarkdownTheme();
	const container = new Container();

	const typeName = formatFlowTypeName(r.type);
	const initialDot = flowStatusIcon(r, theme);
	let header = `${initialDot} ${applyRole("flowName", typeName, theme, config)}`;
	const errorSegment = error && r.stopReason ? ` [${r.stopReason}]` : "";
	if (errorSegment) header += ` ${theme.fg("error", errorSegment)}`;
	const dotPlaceholder = stripAnsi(initialDot) + ' ';
	const plainHeader = dotPlaceholder + typeName + errorSegment;
	const headerSegments: HeaderSegment[] = [
		{ text: dotPlaceholder, style: (_s) => getScintillatingStatusDot(r, theme, Date.now(), id) + " " },
		{ text: typeName, style: (s) => applyRole("flowName", s, theme, config) },
	];
	if (errorSegment) {
		headerSegments.push({ text: errorSegment, style: (s) => theme.fg("error", s) });
	}
	container.addChild(new DynamicScrambleText(
		header,
		() => {
			const now = Date.now();
			const result = scrambleManager.updateText(id, 'header', plainHeader, now, isComplete);
			return reconstructHeader(result.content, headerSegments);
		}
	));
	if (error && r.errorMessage) {
		container.addChild(new Text(scrambleManager.renderStatic(theme.fg("error", `Error: ${r.errorMessage}`)), 0, 0));
	}

	// Stats: dashboard format
	const inlineStats = formatCompactStats(r.usage, r.model);
	container.addChild(new DynamicScrambleText(
		applyRole("stats", inlineStats, theme, config),
		() => {
			const result = scrambleManager.updateText(id, 'stats', stripAnsi(inlineStats), Date.now(), isComplete);
			return result.isAnimating ? applyRole("stats", result.content, theme, config) : applyRole("stats", inlineStats, theme, config);
		}
	));

	// Intent — column-aware truncation (budget recalculated inside closure for resize handling)
	const intentBudget = getTruncationBudget(0);
	const displayIntent = truncateChars(r.intent, intentBudget);
	container.addChild(new Spacer(1));
	container.addChild(new Text(applyRole("prefixLabel", sectionHeader("intent"), theme, config), 0, 0));
	container.addChild(new DynamicScrambleText(
		applyRole("aimContent", displayIntent, theme, config),
		() => {
			const budget = getTruncationBudget(0);
			const text = truncateChars(r.intent, budget);
			const result = scrambleManager.updateText(id, 'intent', text, Date.now(), isComplete);
			return result.isAnimating ? applyRole("aimContent", result.content, theme, config) : applyRole("aimContent", text, theme, config);
		}
	));

	// Acceptance
	if (r.acceptance) {
		const acceptanceRaw = r.acceptance;
		const acceptanceBudget = getTruncationBudget(0);
		const acceptanceText = truncateChars(acceptanceRaw, acceptanceBudget);
		container.addChild(new Spacer(1));
		container.addChild(new Text(applyRole("prefixLabel", sectionHeader("acceptance"), theme, config), 0, 0));
		container.addChild(new DynamicScrambleText(
			applyRole("aimContent", acceptanceText, theme, config),
			() => {
				const budget = getTruncationBudget(0);
				const text = truncateChars(acceptanceRaw, budget);
				const result = scrambleManager.updateText(id, 'acceptance', text, Date.now(), isComplete);
				return result.isAnimating ? applyRole("aimContent", result.content, theme, config) : applyRole("aimContent", text, theme, config);
			}
		));
	}

	// Flow report (structured output)
	container.addChild(new Spacer(1));
	container.addChild(new Text(applyRole("prefixLabel", sectionHeader("report"), theme, config), 0, 0));

	// Structured output summary (compact badge when available)
	if (r.structuredOutput) {
		const so = r.structuredOutput;
		const statusColor = so.status === "complete" ? "success" : so.status === "partial" ? "warning" : "error";
		const statusText = `[${so.status}] ${so.summary}`;
		const statusStatic = `${theme.fg(statusColor, `[${so.status}]`)} ${applyRole("aimContent", so.summary, theme, config)}`;
		container.addChild(new DynamicScrambleText(
			statusStatic,
			() => {
				const result = scrambleManager.updateText(id, 'report-status', statusText, Date.now(), isComplete, false);
				return result.isAnimating ? `${theme.fg(statusColor, result.content.split(' ')[0])} ${applyRole("aimContent", result.content.slice(result.content.indexOf(' ') + 1), theme, config)}` : statusStatic;
			}
		));
		if (so.files.length > 0) {
			const filesText = `Files: ${so.files.map((f) => f.path).join(", ")}`;
			container.addChild(new DynamicScrambleText(
				applyRole("aimContent", filesText, theme, config),
				() => {
					const result = scrambleManager.updateText(id, 'report-files', filesText, Date.now(), isComplete, false);
					return result.isAnimating ? applyRole("aimContent", result.content, theme, config) : applyRole("aimContent", filesText, theme, config);
				}
			));
		}
		if (so.commands?.length > 0) {
			const cmdLabels = so.commands.map((c) => {
				const short = c.command.length > 30 ? c.command.slice(0, 30) + "..." : c.command;
				return `${c.tool ?? "cmd"}: ${short}`;
			});
			const commandsText = `Commands: ${cmdLabels.join(", ")}`;
			container.addChild(new DynamicScrambleText(
				applyRole("aimContent", commandsText, theme, config),
				() => {
					const result = scrambleManager.updateText(id, 'report-commands', commandsText, Date.now(), isComplete, false);
					return result.isAnimating ? applyRole("aimContent", result.content, theme, config) : applyRole("aimContent", commandsText, theme, config);
				}
			));
		}
		if (so.notDone.length > 0) {
			const notDoneText = `Not Done: ${so.notDone.map((item) => {
				const details = [
					item.reason ? `reason: ${item.reason}` : undefined,
					item.blocker ? `blocker: ${item.blocker}` : undefined,
					item.nextStep ? `next: ${item.nextStep}` : undefined,
				].filter(Boolean).join("; ");
				return details ? `${item.item} (${details})` : item.item;
			}).join("; ")}`;
			container.addChild(new DynamicScrambleText(
				applyRole("aimContent", notDoneText, theme, config),
				() => {
					const result = scrambleManager.updateText(id, 'report-notDone', notDoneText, Date.now(), isComplete, false);
					return result.isAnimating ? applyRole("aimContent", result.content, theme, config) : applyRole("aimContent", notDoneText, theme, config);
				}
			));
		}
		if (so.nextSteps.length > 0) {
			const nextStepsText = `Next: ${so.nextSteps.join("; ")}`;
			container.addChild(new DynamicScrambleText(
				applyRole("aimContent", nextStepsText, theme, config),
				() => {
					const result = scrambleManager.updateText(id, 'report-nextSteps', nextStepsText, Date.now(), isComplete, false);
					return result.isAnimating ? applyRole("aimContent", result.content, theme, config) : applyRole("aimContent", nextStepsText, theme, config);
				}
			));
		}
		container.addChild(new Spacer(1));
	}

	// Output: animate streaming text; show clean markdown when complete
	if (isFlowAwaiting(r)) {
		container.addChild(new Text(applyRole("prefixLabel", "[awaiting...]", theme, config), 0, 0));
	} else if (!isComplete && streamingText != null) {
		const msgBudget = getTruncationBudget(0);
		const displayMsg = tailText(stripAnsi(streamingText), msgBudget);
		container.addChild(new DynamicScrambleText(
			displayMsg,
			() => {
				const budget = getTruncationBudget(0);
				const freshStreamingText = getLiveTextWithFallback(id) ?? streamingText;
				const text = tailText(stripAnsi(freshStreamingText), budget);
				return scrambleManager.updateMsg(id, text, Date.now(), isComplete, undefined, true).content;
			}
		));
	} else if (flowOutput) {
		container.addChild(new Markdown(flowOutput.trim(), 0, 0, mdTheme));
	} else {
		const summary = getFlowSummaryText(r);
		container.addChild(new DynamicScrambleText(
			applyRole("msgContent", summary, theme, config),
			() => {
				const result = scrambleManager.updateText(id, 'output-summary', summary, Date.now(), isComplete, false);
				return result.isAnimating ? applyRole("msgContent", result.content, theme, config) : applyRole("msgContent", summary, theme, config);
			}
		));
	}

	// Tool traces (expanded only) — per-line scramble
	const toolCallItems = displayItems.filter((item) => item.type === "toolCall");
	if (toolCallItems.length > 0) {
		container.addChild(new Spacer(1));
		container.addChild(new Text(applyRole("prefixLabel", sectionHeader("tool calls"), theme, config), 0, 0));
		const toolPrefixLen = visibleLength("→ ");
		const toolBudget = getTruncationBudget(toolPrefixLen);
		for (let i = 0; i < toolCallItems.length; i++) {
			const item = toolCallItems[i] as Extract<DisplayItem, { type: "toolCall" }>;
			const lineText = applyRole("prefixLabel", "→ ", theme, config) + formatFlowToolCall(item.name, item.args, theme.fg.bind(theme));
			const plainText = stripAnsi(lineText);
			const displayTool = truncateChars(plainText, toolBudget);
			const initialScrambled = scrambleManager.updateText(id, `tool#${i}`, displayTool, now, isComplete).content;
			container.addChild(new DynamicScrambleText(
				initialScrambled,
				() => {
					const budget = getTruncationBudget(toolPrefixLen);
					const freshPlain = stripAnsi(lineText);
					const text = truncateChars(freshPlain, budget);
					return scrambleManager.updateText(id, `tool#${i}`, text, Date.now(), isComplete).content;
				}
			));
		}
	}

	if (isComplete) {
		scrambleManager.completeFlow(id);
	}

	return container;
}

function renderFlowCollapsed(
	r: SingleResult,
	icon: string,
	error: boolean,
	flowOutput: string,
	theme: FlowTheme,
	streamingText?: string,
	toolCallId?: string,
	config?: FlowColorConfig,
): Container {
	const id = toolCallId || "collapsed";
	const now = Date.now();
	const container = new Container();
	const maxWidth = process.stdout.columns ?? 80;
	const typeName = formatCollapsedFlowHeaderTypeName(r.type);
	const modelLabel = formatModelLabel(r.model);
	const headerPrefixLen = visibleLength(typeName) + visibleLength(modelLabel ? `  ${modelLabel} · ` : "  ");

	const isComplete = isFlowStatusComplete(r);

	// Build header stats: ctxLabel · t/s
	const statsParts: string[] = [];
	if (r.maxContextTokens !== undefined || r.usage.contextTokens > 0) {
		const ctxLabel = formatContextLabel(r.usage.contextTokens, r.maxContextTokens);
		statsParts.push(ctxLabel);
	}
	const tpsFormatted = formatTps(r.usage.smoothedTps);
	statsParts.push(tpsFormatted);
	let displayStats = statsParts.join(" · ");

	// Flash TPS value when it changes
	const tpsNum = tpsFormatted.slice(0, -4); // remove " t/s" suffix
	if (r.usage.smoothedTps && r.usage.smoothedTps > 0) {
		const scrambledTps = scrambleManager.updateTps(id, tpsNum, now, isComplete, true);
		if (scrambledTps !== tpsNum) {
			displayStats = displayStats.replace(`${tpsNum} t/s`, `${scrambledTps} t/s`);
		}
	}

	const modelSegment = modelLabel ? `  ${modelLabel} · ` : "  ";
	const statsSegment = stripAnsi(displayStats);
	const errorSegment = error && r.stopReason ? ` [${r.stopReason}]` : "";
	const initialDot = flowStatusIcon(r, theme);
	let header = `${initialDot} ${applyRole("flowName", typeName, theme, config)}${applyRole("modelName", modelSegment, theme, config)}${applyRole("stats", displayStats, theme, config)}`;
	if (errorSegment) header += ` ${theme.fg("error", errorSegment)}`;
	const dotPlaceholder = stripAnsi(initialDot) + ' ';
	const plainHeader = dotPlaceholder + typeName + modelSegment + statsSegment + errorSegment;
	const headerSegments: HeaderSegment[] = [
		{ text: dotPlaceholder, style: (_s) => getScintillatingStatusDot(r, theme, Date.now(), id) + " " },
		{ text: typeName, style: (s) => applyRole("flowName", s, theme, config) },
		{ text: modelSegment, style: (s) => applyRole("modelName", s, theme, config) },
		{ text: statsSegment, style: (s) => applyRole("stats", s, theme, config) },
	];
	if (errorSegment) {
		headerSegments.push({ text: errorSegment, style: (s) => theme.fg("error", s) });
	}
	container.addChild(new DynamicScrambleText(
		header,
		() => {
			const now = Date.now();
			const result = scrambleManager.updateText(id, 'header', plainHeader, now, isComplete, true);
			return reconstructHeader(result.content, headerSegments);
		},
		true,
	));

	// aim: line — glitch on text change
	if (r.aim) {
		const aimTree = "├─";
		const aimLabel = ` aim ▸ `;
		const aimPrefix = `${aimTree}${aimLabel}`;
		const budget = getTruncationBudget(visibleLength(aimPrefix));
		const displayAim = isFlowAwaiting(r) ? "[awaiting...]" : truncateChars(lowerFirstWord(r.aim), budget);
		container.addChild(new DynamicScrambleText(
			`${applyRole("treeChars", aimTree, theme, config)}${applyRole("prefixLabel", aimLabel, theme, config)}${applyRole(isFlowAwaiting(r) ? "prefixLabel" : "aimContent", italic(displayAim), theme, config)}`,
			() => {
				const now = Date.now();
				const freshAimLabel = ` aim ▸ `;
				const freshAimPrefix = `${aimTree}${freshAimLabel}`;
				const freshBudget = getTruncationBudget(visibleLength(freshAimPrefix));
				const freshText = isFlowAwaiting(r) ? "[awaiting...]" : truncateChars(lowerFirstWord(r.aim), freshBudget);
				const result = scrambleManager.updateAim(id, freshText, now, isComplete, true);
				return `${applyRole("treeChars", aimTree, theme, config)}${applyRole("prefixLabel", freshAimLabel, theme, config)}${applyRole(isFlowAwaiting(r) ? "prefixLabel" : "aimContent", italic(result.content), theme, config)}`;
			},
			true,
		));
	}

	// act: line (last tool call with count)
	const lastTool = getLastToolCall(r.messages);
	const actStr = lastTool ? formatFlowToolCall(lastTool.name, lastTool.args, theme.fg.bind(theme)) : "[n/a]";
	const isLite = config?.bodyVerbosity !== "full";
	const actTree = isLite ? "└─" : "├─";
	const actLabel = ` cmd ▸ `;
	const prefixStub = `${actTree}${actLabel}`;
	const budget = getTruncationBudget(visibleLength(prefixStub));
	const actFullText = stripAnsi(lowerFirstWord(actStr));
	const initialActContent = isFlowAwaiting(r) ? "[n/a]" : (actFullText.length > budget ? tailText(actFullText, budget) : actFullText);
	container.addChild(new DynamicScrambleText(
		`${applyRole("treeChars", actTree, theme, config)}${applyRole("prefixLabel", actLabel, theme, config)}${applyRole(isFlowAwaiting(r) ? "prefixLabel" : "actContent", italic(initialActContent), theme, config)}`,
		() => {
			const now = Date.now();
			const actLabel = ` cmd ▸ `;
			const actPrefix = `${actTree}${actLabel}`;
			const freshBudget = getTruncationBudget(visibleLength(actPrefix));
			const displayAct = isFlowAwaiting(r) ? "[n/a]" : tailText(actFullText, freshBudget);
			const actContent = scrambleManager.updateAct(id, displayAct, now, isComplete, true).content;
			return `${applyRole("treeChars", actTree, theme, config)}${applyRole("prefixLabel", actLabel, theme, config)}${applyRole(isFlowAwaiting(r) ? "prefixLabel" : "actContent", italic(actContent), theme, config)}`;
		},
		true,
	));

	// msg: line (last assistant text or streaming) — full mode only
	if (!isLite) {
		const msgPrefixStub = `└─ msg ▸ `;
		const msgBudget = getTruncationBudget(visibleLength(msgPrefixStub));

		let rawMsg: string;
		let useError = false;
		if (isFlowAwaiting(r)) {
			rawMsg = "[awaiting...]";
		} else if (r.status === "skipped") {
			rawMsg = "[skipped]";
		} else {
			const liveMsgText = isFlowRunning(r) ? getLiveTextWithFallback(id) : undefined;
			if (liveMsgText != null) {
				rawMsg = stripAnsi(liveMsgText);
			} else if (isFlowRunning(r) && streamingText != null) {
				rawMsg = stripAnsi(streamingText);
			} else if (r.structuredOutput?.summary) {
				rawMsg = stripAnsi(r.structuredOutput.summary);
			} else if (flowOutput) {
				rawMsg = stripAnsi(flowOutput);
			} else if (error && r.errorMessage) {
				rawMsg = stripAnsi(r.errorMessage);
				useError = true;
			} else {
				const summary = getFlowSummaryText(r);
				rawMsg = stripAnsi(summary) || "[n/a]";
			}
		}

		const initialNeedsTail = !isFlowAwaiting(r) && isFlowRunning(r) && (streamingText != null || getLiveTextWithFallback(id) != null);
		const initialMsgContent = initialNeedsTail
			? tailText(rawMsg, msgBudget)
			: truncateChars(rawMsg, msgBudget);
		const msgTree = "└─";
		const msgLabel = ` msg ▸ `;
		const initialMsgPrefix = `${msgTree}${msgLabel}`;
		container.addChild(new DynamicScrambleText(
			`${applyRole("treeChars", msgTree, theme, config)}${applyRole("prefixLabel", msgLabel, theme, config)}${applyRole(useError ? "msgError" : "msgContent", italic(initialMsgContent), theme, config)}`,
			() => {
				const now = Date.now();
				const msgLabel = ` msg ▸ `;
				const msgPrefix = `${msgTree}${msgLabel}`;
				let freshRawMsg: string;
				let needsTail: boolean;
				if (isFlowAwaiting(r)) {
					freshRawMsg = "[awaiting...]";
					needsTail = false;
				} else if (r.status === "skipped") {
					freshRawMsg = "[skipped]";
					needsTail = false;
				} else {
					const isRunningNow = isFlowRunning(r);
					freshRawMsg = (isRunningNow ? getLiveTextWithFallback(id) : undefined) ?? rawMsg;
					needsTail = isRunningNow && (streamingText != null || getLiveTextWithFallback(id) != null);
				}
				const displayMsg = needsTail ? tailText(freshRawMsg, msgBudget) : truncateChars(freshRawMsg, msgBudget);
				const result = scrambleManager.updateMsg(id, displayMsg, now, isComplete, undefined, true);
				return `${applyRole("treeChars", msgTree, theme, config)}${applyRole("prefixLabel", msgLabel, theme, config)}${applyRole(useError ? "msgError" : "msgContent", italic(result.content), theme, config)}`;
			},
			true,
		));
		}

	if (isComplete) {
		scrambleManager.completeFlow(id);
	}

	return container;
}

// ---------------------------------------------------------------------------
// Multi-flow result
// ---------------------------------------------------------------------------

function renderMultiFlowResult(
	details: FlowDetails,
	expanded: boolean,
	theme: FlowTheme,
	toolCallId?: string,
	config?: FlowColorConfig,
): Container | Text {
	const baseId = toolCallId || "multi";
	const results = details.results;
	const successCount = results.filter((r) => isFlowSuccess(r)).length;
	const failCount = results.filter((r) => isFlowError(r)).length;
	const icon = failCount > 0 ? theme.fg("warning", "(!)") : theme.fg("success", "(ok)");
	const now = Date.now();

	if (expanded) {
		return renderMultiFlowExpanded(results, successCount, icon, theme, baseId, now, config);
	}
	return renderMultiFlowCollapsed(results, theme, baseId, config);
}

function renderMultiFlowExpanded(
	results: SingleResult[],
	successCount: number,
	icon: string,
	theme: FlowTheme,
	baseId: string,
	now: number,
	config?: FlowColorConfig,
): Container {
	const mdTheme = getMarkdownTheme();
	const container = new Container();

	// Summary: just show count, no icon
	container.addChild(new Text(
		applyRole("flowName", `${results.length} flows`, theme, config),
		0, 0,
	));

	for (let flowIdx = 0; flowIdx < results.length; flowIdx++) {
		const r = results[flowIdx];
		const flowId = `${baseId}#${flowIdx}`;
		const isComplete = isFlowStatusComplete(r);
		const displayItems = getFlowDisplayItems(r.messages);
		const flowOutput = getFlowOutput(r.messages);
		const typeName = formatFlowTypeName(r.type);

		container.addChild(new Spacer(1));
		// Per-flow header: ─── EXPLORER (no icon)
		const headerStatic = applyRole("prefixLabel", sectionHeader(typeName), theme, config);
		container.addChild(new DynamicScrambleText(
			headerStatic,
			() => {
				const result = scrambleManager.updateText(flowId, 'header', typeName, Date.now(), isComplete, true);
				return result.isAnimating ? applyRole("prefixLabel", result.content, theme, config) : headerStatic;
			}
		));

		// Stats: dashboard format
		const flowStats = formatCompactStats(r.usage, r.model);
		container.addChild(new DynamicScrambleText(
			applyRole("stats", flowStats, theme, config),
			() => {
				const result = scrambleManager.updateText(flowId, 'stats', stripAnsi(flowStats), Date.now(), isComplete, true);
				return result.isAnimating ? applyRole("stats", result.content, theme, config) : applyRole("stats", flowStats, theme, config);
			}
		));

		// Intent: just show text, no prefix (budget computed dynamically for resize recalculation)
		const intentBudget = getTruncationBudget(0);
		const displayIntent = truncateChars(r.intent, intentBudget);
		container.addChild(new DynamicScrambleText(
			applyRole("aimContent", displayIntent, theme, config),
			() => {
				const budget = getTruncationBudget(0);
				const text = truncateChars(r.intent, budget);
				const result = scrambleManager.updateText(flowId, 'intent', text, Date.now(), isComplete, true);
				return result.isAnimating ? applyRole("aimContent", result.content, theme, config) : applyRole("aimContent", text, theme, config);
			}
		));

		if (r.acceptance) {
			const acceptanceRaw = r.acceptance;
			const acceptancePrefix = "Acceptance: ";
			const acceptanceBudget = getTruncationBudget(visibleLength(acceptancePrefix));
			const acceptanceText = truncateChars(acceptanceRaw, acceptanceBudget);
			const acceptanceStatic = applyRole("aimContent", `${acceptancePrefix}${acceptanceText}`, theme, config);
			container.addChild(new DynamicScrambleText(
				acceptanceStatic,
				() => {
					const budget = getTruncationBudget(visibleLength(acceptancePrefix));
					const text = truncateChars(acceptanceRaw, budget);
					const result = scrambleManager.updateText(flowId, 'acceptance', text, Date.now(), isComplete, true);
					return result.isAnimating ? applyRole("aimContent", `${acceptancePrefix}${result.content}`, theme, config) : applyRole("aimContent", `${acceptancePrefix}${text}`, theme, config);
				}
			));
		}

		// Output: animate streaming text; show clean markdown when complete
		if (isFlowAwaiting(r)) {
			container.addChild(new Text(applyRole("prefixLabel", "[awaiting...]", theme, config), 0, 0));
		} else if (!isComplete && r.streamingText != null) {
			const streamingRaw = r.streamingText;
			const msgBudget = getTruncationBudget(0);
			const displayMsg = tailText(stripAnsi(streamingRaw), msgBudget);
			container.addChild(new DynamicScrambleText(
				displayMsg,
				() => {
					const budget = getTruncationBudget(0);
					const freshStreamingText = getLiveTextWithFallback(flowId) ?? streamingRaw;
					const text = tailText(stripAnsi(freshStreamingText), budget);
					return scrambleManager.updateMsg(flowId, text, Date.now(), isComplete, undefined, true).content;
				}
			));
		} else if (flowOutput) {
			container.addChild(new Spacer(1));
			container.addChild(new Markdown(flowOutput.trim(), 0, 0, mdTheme));
		}

		// Tool traces in expanded view — per-line scramble
		const toolCallItems = displayItems.filter((item) => item.type === "toolCall");
		if (toolCallItems.length > 0) {
			container.addChild(new Spacer(1));
			container.addChild(new Text(applyRole("prefixLabel", sectionHeader("tool calls"), theme, config), 0, 0));
			const toolPrefixLen = visibleLength("→ ");
			const toolBudget = getTruncationBudget(toolPrefixLen);
			for (let i = 0; i < toolCallItems.length; i++) {
				const item = toolCallItems[i] as Extract<DisplayItem, { type: "toolCall" }>;
				const lineText = applyRole("prefixLabel", "→ ", theme, config) + formatFlowToolCall(item.name, item.args, theme.fg.bind(theme));
				const plainText = stripAnsi(lineText);
				const displayTool = truncateChars(plainText, toolBudget);
				const initialScrambled = scrambleManager.updateText(flowId, `tool#${i}`, displayTool, now, isComplete).content;
				container.addChild(new DynamicScrambleText(
					initialScrambled,
					() => {
						const budget = getTruncationBudget(toolPrefixLen);
						const freshPlain = stripAnsi(lineText);
						const text = truncateChars(freshPlain, budget);
						return scrambleManager.updateText(flowId, `tool#${i}`, text, Date.now(), isComplete).content;
					}
				));
			}
		}

		if (isComplete) {
			scrambleManager.completeFlow(flowId);
		}
	}

	// Total stats: dashboard format
	const totalUsage = aggregateFlowUsage(results);
	const totalModel = results[0]?.model;
	const totalStats = formatCompactStats(totalUsage, totalModel);
	container.addChild(new Spacer(1));
	container.addChild(new Text(applyRole("stats", totalStats, theme, config), 0, 0));

	return container;
}

function renderActivityPanel(
	results: SingleResult[],
	theme: FlowTheme,
	baseId?: string,
	config?: FlowColorConfig,
): Container {
	const idPrefix = baseId || "panel";
	const container = new Container();
	const now = Date.now();

	const { groups, rootIndices } = detectGroups(results);

	// Build ordered list of "root items" — each is either a standalone flow index
	// or a group index (rendered in original order).
	let groupCursor = 0;
	let rootCursor = 0;
	const orderedItems: Array<
		| { kind: "flow"; index: number }
		| { kind: "group"; groupIndex: number }
	> = [];

	for (let i = 0; i < results.length; i++) {
		// Is this index the start of a group?
		if (groupCursor < groups.length) {
			const g = groups[groupCursor];
			if (g.buildIndices[0] === i || g.auditIndex === i) {
				orderedItems.push({ kind: "group", groupIndex: groupCursor });
				groupCursor++;
				continue;
			}
		}
		// Is this a standalone flow?
		if (rootCursor < rootIndices.length && rootIndices[rootCursor] === i) {
			orderedItems.push({ kind: "flow", index: i });
			rootCursor++;
		}
	}

	for (let itemIdx = 0; itemIdx < orderedItems.length; itemIdx++) {
		const item = orderedItems[itemIdx];
		const isLastRoot = itemIdx === orderedItems.length - 1;

		if (item.kind === "flow") {
			renderStandaloneFlow(
				container, results[item.index], item.index,
				idPrefix, theme, now, config, isLastRoot,
			);
		} else {
			renderGroup(
				container, groups[item.groupIndex], results,
				idPrefix, theme, now, config, isLastRoot,
			);
		}

		// No blank line separator between root items — compact tree
	}

	return container;
}

// ---------------------------------------------------------------------------
// Standalone flow (rendered at depth 0)
// ---------------------------------------------------------------------------
function renderStandaloneFlow(
	container: Container,
	r: SingleResult,
	index: number,
	idPrefix: string,
	theme: FlowTheme,
	now: number,
	config?: FlowColorConfig,
	isLastRoot: boolean = false,
): void {
	const flowId = `${idPrefix}#${index}`;
	const headerPrefix = isLastRoot ? "└─" : "├─";
	const childPrefix = isLastRoot ? "   " : "│  ";

	renderFlowHeader(container, r, flowId, headerPrefix, theme, now, config);
	renderFlowBody(container, r, flowId, childPrefix, theme, now, config);

	if (isFlowStatusComplete(r)) {
		scrambleManager.completeFlow(flowId);
	}
}

// ---------------------------------------------------------------------------
// Group rendering (rendered at depth 1)
// ---------------------------------------------------------------------------
function renderGroup(
	container: Container,
	group: FlowGroup,
	results: SingleResult[],
	idPrefix: string,
	theme: FlowTheme,
	now: number,
	config?: FlowColorConfig,
	isLastRoot: boolean = false,
): void {
	// ─── Group header line ───
	const headerPrefix = isLastRoot ? "" : "├─";
	const headerText = `${headerPrefix}${headerPrefix ? ' ' : ''}audit-loop`;
	container.addChild(new Text(applyRole("treeChars", headerText, theme, config), 0, 0));

	// ─── Build children ───
	for (let b = 0; b < group.buildIndices.length; b++) {
		const buildIdx = group.buildIndices[b];
		const r = results[buildIdx];
		const flowId = `${idPrefix}#${buildIdx}`;
		const isLastBuild = b === group.buildIndices.length - 1;
		// Audit always follows the last build, so every build uses ├─; only audit gets └─
		const buildHeaderPrefix = isLastRoot ? "├─" : "│  ├─";
		const buildChildPrefix = isLastRoot ? "│  " : "│  │  "; // All builds: audit follows, tree line continues

		renderFlowHeader(container, r, flowId, buildHeaderPrefix, theme, now, config);
		renderFlowBody(container, r, flowId, buildChildPrefix, theme, now, config);

		if (isFlowStatusComplete(r)) {
			scrambleManager.completeFlow(flowId);
		}

		// No blank line between builds or before audit capstone — compact tree
	}

	// ─── Audit capstone ───
	const auditIdx = group.auditIndex;
	const auditResult = results[auditIdx];
	const auditFlowId = `${idPrefix}#${auditIdx}`;
	const auditHeaderPrefix = isLastRoot ? "└─" : "│  └─";
	const auditChildPrefix = isLastRoot ? "   " : "│     ";

	renderFlowHeader(container, auditResult, auditFlowId, auditHeaderPrefix, theme, now, config);
	renderFlowBody(container, auditResult, auditFlowId, auditChildPrefix, theme, now, config);

	if (isFlowStatusComplete(auditResult)) {
		scrambleManager.completeFlow(auditFlowId);
	}

	// No extra spacer — renderActivityPanel handles uniform inter-item spacing
}

// ---------------------------------------------------------------------------
// Shared flow rendering helpers
// ---------------------------------------------------------------------------

function renderFlowHeader(
	container: Container,
	r: SingleResult,
	flowId: string,
	headerPrefix: string,
	theme: FlowTheme,
	now: number,
	config?: FlowColorConfig,
): void {
	const typeName = formatCollapsedFlowHeaderTypeName(r.type);
	const modelLabel = formatModelLabel(r.model);
	const isComplete = isFlowStatusComplete(r);
	const flowComplete = isComplete;
	const error = isFlowError(r);
	const errorSegment = error && r.stopReason ? ` [${r.stopReason}]` : "";
	const initialDot = flowStatusIcon(r, theme);
	const dotPlaceholder = stripAnsi(initialDot) + ' ';

	let headerLine: string;
	let plainHeader: string;
	const headerSegments: HeaderSegment[] = [
		{ text: headerPrefix + " ", style: (s) => applyRole("treeChars", s, theme, config) },
		{ text: dotPlaceholder, style: (_s) => getScintillatingStatusDot(r, theme, Date.now(), flowId) + " " },
		{ text: typeName, style: (s) => applyRole("flowName", s, theme, config) },
	];

	{
		// Standard flow: model + stats
		const statsParts: string[] = [];
		if (r.maxContextTokens !== undefined || r.usage.contextTokens > 0) {
			const ctxLabel = formatContextLabel(r.usage.contextTokens, r.maxContextTokens);
			statsParts.push(ctxLabel);
		}
		const tpsFormatted = formatTps(r.usage.smoothedTps);
		statsParts.push(tpsFormatted);
		let displayStats = statsParts.join(" · ");

		const tpsNum = tpsFormatted.slice(0, -4); // remove " t/s" suffix
		if (r.usage.smoothedTps && r.usage.smoothedTps > 0) {
			const scrambledTps = scrambleManager.updateTps(flowId, tpsNum, now, flowComplete, true);
			if (scrambledTps !== tpsNum) {
				displayStats = displayStats.replace(`${tpsNum} t/s`, `${scrambledTps} t/s`);
			}
		}

		const modelSegment = modelLabel ? `  ${modelLabel}` : "";
		const statsSegment = ` · ${displayStats}`;
		const statsPlain = stripAnsi(statsSegment);
		headerLine = `${applyRole("treeChars", headerPrefix, theme, config)} ${initialDot} ${applyRole("flowName", typeName, theme, config)}${applyRole("modelName", modelSegment, theme, config)}${applyRole("stats", statsSegment, theme, config)}`;
		if (errorSegment) {
			headerLine += ` ${theme.fg("error", errorSegment)}`;
		}
		plainHeader = headerPrefix + " " + dotPlaceholder + typeName + modelSegment + statsPlain + errorSegment;
		headerSegments.push(
			{ text: modelSegment, style: (s) => applyRole("modelName", s, theme, config) },
			{ text: statsPlain, style: (s) => applyRole("stats", s, theme, config) },
		);
	}
	if (errorSegment) {
		headerSegments.push({ text: errorSegment, style: (s) => theme.fg("error", s) });
	}
	container.addChild(new DynamicScrambleText(
		headerLine,
		() => {
			const now = Date.now();
			const result = scrambleManager.updateText(flowId, 'header', plainHeader, now, flowComplete, true);
			return reconstructHeader(result.content, headerSegments);
		},
		true,
	));
}

function renderFlowBody(
	container: Container,
	r: SingleResult,
	flowId: string,
	indent: string,
	theme: FlowTheme,
	now: number,
	config?: FlowColorConfig,
): void {
	const isComplete = isFlowStatusComplete(r);
	const flowComplete = isComplete;

	// aim: line — glitch on text change
	if (r.aim) {
		const aimTree = indent + "├─";
		const aimLabel = ` aim ▸ `;
		const aimPrefix = `${aimTree}${aimLabel}`;
		const budget = getTruncationBudget(visibleLength(aimPrefix));
		const displayAim = isFlowAwaiting(r) ? "[awaiting...]" : truncateChars(lowerFirstWord(r.aim), budget);
		container.addChild(new DynamicScrambleText(
			`${applyRole("treeChars", aimTree, theme, config)}${applyRole("prefixLabel", aimLabel, theme, config)}${applyRole(isFlowAwaiting(r) ? "prefixLabel" : "aimContent", italic(displayAim), theme, config)}`,
			() => {
				const now = Date.now();
				const freshAimLabel = ` aim ▸ `;
				const freshAimPrefix = `${aimTree}${freshAimLabel}`;
				const freshBudget = getTruncationBudget(visibleLength(freshAimPrefix));
				const freshText = isFlowAwaiting(r) ? "[awaiting...]" : truncateChars(lowerFirstWord(r.aim), freshBudget);
				const result = scrambleManager.updateAim(flowId, freshText, now, flowComplete, true);
				return `${applyRole("treeChars", aimTree, theme, config)}${applyRole("prefixLabel", freshAimLabel, theme, config)}${applyRole(isFlowAwaiting(r) ? "prefixLabel" : "aimContent", italic(result.content), theme, config)}`;
			},
			true,
		));
	}

	// act: line (last tool call with count)
	const lastTool = getLastToolCall(r.messages);
	const actStr = lastTool ? formatFlowToolCall(lastTool.name, lastTool.args, theme.fg.bind(theme)) : "[n/a]";
	const isLite = config?.bodyVerbosity !== "full";
	const actTree = isLite ? `${indent}└─` : `${indent}├─`;
	const actLabel = ` cmd ▸ `;
	const prefixStub = `${actTree}${actLabel}`;
	const budget = getTruncationBudget(visibleLength(prefixStub));
	const actFullText = stripAnsi(lowerFirstWord(actStr));
	const initialActContent = isFlowAwaiting(r) ? "[n/a]" : (actFullText.length > budget ? tailText(actFullText, budget) : actFullText);
	container.addChild(new DynamicScrambleText(
		`${applyRole("treeChars", actTree, theme, config)}${applyRole("prefixLabel", actLabel, theme, config)}${applyRole(isFlowAwaiting(r) ? "prefixLabel" : "actContent", italic(initialActContent), theme, config)}`,
		() => {
			const now = Date.now();
			const actLabel = ` cmd ▸ `;
			const actPrefix = `${actTree}${actLabel}`;
			const freshBudget = getTruncationBudget(visibleLength(actPrefix));
			const displayAct = isFlowAwaiting(r) ? "[n/a]" : tailText(actFullText, freshBudget);
			const actContent = scrambleManager.updateAct(flowId, displayAct, now, flowComplete, true).content;
			return `${applyRole("treeChars", actTree, theme, config)}${applyRole("prefixLabel", actLabel, theme, config)}${applyRole(isFlowAwaiting(r) ? "prefixLabel" : "actContent", italic(actContent), theme, config)}`;
		},
		true,
	));

	// msg: line (live streaming text or last assistant text) — full mode only
	if (!isLite) {
		const msgTree = `${indent}└─`;
		const msgLabel = ` msg ▸ `;
		const msgPrefixStub = `${msgTree}${msgLabel}`;
		const msgBudget = getTruncationBudget(visibleLength(msgPrefixStub));

		let rawMsg: string;
		let useError = false;
		if (isFlowAwaiting(r)) {
			rawMsg = "[awaiting...]";
		} else if (r.status === "skipped") {
			rawMsg = "[skipped]";
		} else if (isFlowStatusComplete(r) && !isFlowRunning(r)) {
			if (isFlowError(r) && r.errorMessage) {
				rawMsg = stripAnsi(r.errorMessage);
				useError = true;
			} else if (r.pingPongMeta && r.pingPongMeta.finalVerdict === "pass") {
				rawMsg = "[approved]";
			} else {
				rawMsg = "[finished]";
			}
		} else {
			const liveMsgText = isFlowRunning(r) ? getLiveTextWithFallback(flowId) : undefined;
			if (liveMsgText != null) {
				rawMsg = stripAnsi(liveMsgText);
			} else if (isFlowRunning(r) && r.streamingText != null) {
				rawMsg = stripAnsi(r.streamingText);
			} else if (r.structuredOutput?.summary) {
				rawMsg = stripAnsi(r.structuredOutput.summary);
			} else {
				const flowOutput = getFlowOutput(r.messages);
				if (flowOutput) {
					rawMsg = stripAnsi(flowOutput);
				} else if (isFlowError(r) && r.errorMessage) {
					rawMsg = stripAnsi(r.errorMessage);
					useError = true;
				} else {
					const summary = getFlowSummaryText(r);
					rawMsg = stripAnsi(summary) || "[n/a]";
				}
			}
		}

		const initialNeedsTail = !isFlowAwaiting(r) && isFlowRunning(r) && (r.streamingText != null || getLiveTextWithFallback(flowId) != null);
		const initialDisplayMsg = initialNeedsTail ? tailText(rawMsg, msgBudget) : truncateChars(rawMsg, msgBudget);
		container.addChild(new DynamicScrambleText(
			`${applyRole("treeChars", msgTree, theme, config)}${applyRole("prefixLabel", msgLabel, theme, config)}${applyRole(useError ? "msgError" : "msgContent", italic(initialDisplayMsg), theme, config)}`,
			() => {
				const now = Date.now();
				const msgLabel = ` msg ▸ `;
				const msgPrefix = `${msgTree}${msgLabel}`;
				let freshRawMsg: string;
				let needsTail: boolean;
				if (isFlowAwaiting(r)) {
					freshRawMsg = "[awaiting...]";
					needsTail = false;
				} else if (r.status === "skipped") {
					freshRawMsg = "[skipped]";
					needsTail = false;
				} else {
					const isRunningNow = isFlowRunning(r);
					freshRawMsg = (isRunningNow ? getLiveTextWithFallback(flowId) : undefined) ?? rawMsg;
					needsTail = isRunningNow && (r.streamingText != null || getLiveTextWithFallback(flowId) != null);
				}
				const displayMsg = needsTail ? tailText(freshRawMsg, msgBudget) : truncateChars(freshRawMsg, msgBudget);
				const result = scrambleManager.updateMsg(flowId, displayMsg, now, flowComplete, undefined, true);
				return `${applyRole("treeChars", msgTree, theme, config)}${applyRole("prefixLabel", msgLabel, theme, config)}${applyRole(useError ? "msgError" : "msgContent", italic(result.content), theme, config)}`;
			},
			true,
		));
		}
}
function renderMultiFlowCollapsed(
	results: SingleResult[],
	theme: FlowTheme,
	baseId?: string,
	config?: FlowColorConfig,
): Container {
	return renderActivityPanel(results, theme, baseId, config);
}



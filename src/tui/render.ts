/**
 * TUI rendering for flow-state tool calls and results.
 *
 * Option B: collapsed view shows structured report (Summary/Done/Not Done/Next Steps).
 * Expanded view adds raw tool call traces.
 */

import { Container, Text } from "@earendil-works/pi-tui";
import type { FlowDetails } from "../types/flow.js";
import { isFlowError, isFlowSuccess } from "../types/flow.js";
import { getFlowDisplayItems } from "../types/ui.js";
import { getFlowOutput } from "../types/flow.js";
import { scrambleManager, runScrambleTimer, DynamicScrambleText } from "./scramble/index.js";
import { buildBootPhaseSingleResult, getFlowLiveState } from "./flow-live-state.js";
import type { FlowColorConfig, FlowTheme } from "./flow-colors.js";
import { applyRole } from "./flow-colors.js";
import type { SingleResult } from "../types/flow.js";
import { stripAnsi } from "./render-utils.js";

import {
	FlowGroup, GroupDetectionResult, detectGroups,
	flowStatusIcon, getFlowStatus, isFlowStatusComplete, isFlowRunning,
	hashStrToSeed, getScintillatingStatusDot,
} from "./grouping.js";

import {
	HeaderSegment, reconstructHeader,
	sectionHeader, renderFlowHeader,
	formatCollapsedFlowHeaderTypeName,
} from "./header.js";

import {
	renderFlowExpanded, renderFlowCollapsed, renderFlowBody, renderMultiFlowExpanded,
} from "./body-render.js";

import {
	getContentRole, applyScrambledContextLabel, getLiveTextWithFallback,
	shortenPath, formatFlowToolCall, splitOutputLines,
	renderToolTraces, renderFlowReport,
} from "./traces.js";

// Re-export all extracted symbols for backward compatibility
export {
	FlowGroup, GroupDetectionResult, detectGroups,
	flowStatusIcon, getFlowStatus, isFlowStatusComplete,
	hashStrToSeed, getScintillatingStatusDot,
} from "./grouping.js";

export {
	HeaderSegment, reconstructHeader,
	sectionHeader, renderFlowHeader,
	formatCollapsedFlowHeaderTypeName,
} from "./header.js";

export {
	renderFlowExpanded, renderFlowCollapsed, renderFlowBody, renderMultiFlowExpanded,
} from "./body-render.js";

export {
	getContentRole, applyScrambledContextLabel, getLiveTextWithFallback,
	shortenPath, formatFlowToolCall, splitOutputLines,
	renderToolTraces, renderFlowReport,
} from "./traces.js";

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

// ---------------------------------------------------------------------------
// renderFlowCall — shown while the flow is being invoked
// ---------------------------------------------------------------------------

interface FlowRenderState {
	__rootContainer?: Container;
	__widgetId?: string;
}

interface FlowRenderArgs {
	state?: FlowRenderState;
	toolCallId?: string;
	id?: string;
	flow?: unknown[];
	sharedContext?: FlowDetails["sharedContext"];
	invalidate?: () => void;
	[key: string]: unknown;
}

export function renderFlowCall(args: Record<string, unknown>, theme: FlowTheme, config?: FlowColorConfig): Container | Text {
	let container: Container | Text = new Text("", 0, 0);

	// In-place mutation pattern: reuse the stored root container
	// so the TUI host's cached reference stays valid.
	if (args?.state) {
		const s = args.state as FlowRenderState;
		if (!s.__rootContainer) {
			const root = new Container();
			root.addChild(container);
			s.__rootContainer = root;
			container = root;
		} else {
			const root = s.__rootContainer;
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
	args?: FlowRenderArgs,
	config?: FlowColorConfig,
): Container | Text {
	const details = result.details as FlowDetails | undefined;
	const streamingText = result.content?.[0]?.type === "text" ? result.content[0].text : undefined;
	const resolvedIdForLive =
		(result as { _toolCallId?: string })._toolCallId
		|| args?.toolCallId
		|| args?.id;
	const live = getFlowLiveState(resolvedIdForLive);
	const sharedContext =
		details?.sharedContext
		?? args?.sharedContext
		?? live?.sharedContext;

	let resolvedToolCallId: string | undefined;
	if (args?.state) {
		const s = args.state;
		resolvedToolCallId = s.__widgetId;
		if (!resolvedToolCallId) {
			resolvedToolCallId = (result as { _toolCallId?: string })._toolCallId || args?.toolCallId || args?.id;
			if (!resolvedToolCallId) {
				resolvedToolCallId = getAnonymousFlowId();
			}
			s.__widgetId = resolvedToolCallId;
		}
	} else {
		resolvedToolCallId = (result as { _toolCallId?: string })._toolCallId || args?.toolCallId || args?.id;
	}

	let container: Container | Text;

	const flowRequest = args?.flow?.[0] as { type?: string; intent?: string; aim?: string; model?: string; maxContextTokens?: number } | undefined;
	const bootResult = buildBootPhaseSingleResult(live, flowRequest);
	const results =
		details?.results?.length
			? details.results
			: bootResult
				? [bootResult]
				: [];

	if (results.length === 0) {
		container = new Text(scrambleManager.renderStatic(streamingText || ""), 0, 0);
	} else if (results.length === 1) {
		container = renderSingleFlowResult(results[0], expanded, theme, streamingText, resolvedToolCallId, config, sharedContext);
	} else if (details && details.results.length > 1) {
		container = renderMultiFlowResult(details, expanded, theme, resolvedToolCallId, config, sharedContext);
	} else {
		container = renderMultiFlowResult(
			{
				mode: "flow",
				flowStyle: "fork",
				projectAgentsDir: details?.projectAgentsDir ?? null,
				results,
				sharedContext,
			},
			expanded,
			theme,
			resolvedToolCallId,
			config,
			sharedContext,
		);
	}

	// In-place mutation pattern: reuse the stored root container
	// so the TUI host's cached reference stays valid.
	if (args?.state) {
		const s = args.state;
		if (!s.__rootContainer) {
			// First render: store the container (always wrap Text in a Container for consistency)
			if (container instanceof Container) {
				s.__rootContainer = container;
			} else {
				const root = new Container();
				root.addChild(container);
				s.__rootContainer = root;
			}
		} else {
			// Subsequent renders: transfer children to the stored container.
			// Use a snapshot of the children array so the loop remains safe even if
			// addChild() mutates the source array (removes from old parent).
			const root = s.__rootContainer;
			root.clear();
			if (container instanceof Container) {
				const children = [...container.children];
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
	const timerId =
		resolvedToolCallId
		|| (results.length > 1 ? "multi" : results.length === 1 ? "single" : "empty");
	runScrambleTimer(args, timerId);

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
	sharedContext?: {
		messageCount: number;
		userMessageCount: number;
		assistantMessageCount: number;
		toolCalls: Record<string, number>;
		totalTokens: number;
		preview: string;
	},
): Container | Text {
	const id = toolCallId || "single";
	const error = isFlowError(r);
	const icon = flowStatusIcon(r, theme);
	const displayItems = getFlowDisplayItems(r.messages);
	const flowOutput = getFlowOutput(r.messages);
	const now = Date.now();
	const isComplete = isFlowStatusComplete(r);

	if (expanded) {
		return renderFlowExpanded(r, icon, error, displayItems, flowOutput, theme, id, now, isComplete, streamingText, config, sharedContext);
	}
	return renderFlowCollapsed(r, icon, error, flowOutput, theme, streamingText, id, config, sharedContext);
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
	sharedContext?: {
		messageCount: number;
		userMessageCount: number;
		assistantMessageCount: number;
		toolCalls: Record<string, number>;
		totalTokens: number;
		preview: string;
	},
): Container | Text {
	const baseId = toolCallId || "multi";
	const results = details.results;
	const successCount = results.filter((r) => isFlowSuccess(r)).length;
	const failCount = results.filter((r) => isFlowError(r)).length;
	const icon = failCount > 0 ? theme.fg("warning", "(!)") : theme.fg("success", "(ok)");
	const now = Date.now();

	if (expanded) {
		return renderMultiFlowExpanded(results, successCount, icon, theme, baseId, now, config, sharedContext);
	}
	return renderMultiFlowCollapsed(results, theme, baseId, config, sharedContext);
}

function renderMultiFlowCollapsed(
	results: SingleResult[],
	theme: FlowTheme,
	baseId?: string,
	config?: FlowColorConfig,
	sharedContext?: {
		messageCount: number;
		userMessageCount: number;
		assistantMessageCount: number;
		toolCalls: Record<string, number>;
		totalTokens: number;
		preview: string;
	},
): Container {
	return renderActivityPanel(results, theme, baseId, config, sharedContext);
}

// ---------------------------------------------------------------------------
// Activity panel
// ---------------------------------------------------------------------------

function renderActivityPanel(
	results: SingleResult[],
	theme: FlowTheme,
	baseId?: string,
	config?: FlowColorConfig,
	sharedContext?: {
		messageCount: number;
		userMessageCount: number;
		assistantMessageCount: number;
		toolCalls: Record<string, number>;
		totalTokens: number;
		preview: string;
	},
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

	for (const item of orderedItems) {
		if (item.kind === "flow") {
			renderStandaloneFlow(
				container, results[item.index], item.index,
				idPrefix, theme, now, config, sharedContext,
			);
		} else {
			renderGroup(
				container, groups[item.groupIndex], results,
				idPrefix, theme, now, config, sharedContext,
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
	sharedContext?: {
		messageCount: number;
		userMessageCount: number;
		assistantMessageCount: number;
		toolCalls: Record<string, number>;
		totalTokens: number;
		preview: string;
	},
): void {
	const flowId = `${idPrefix}#${index}`;
	const headerPrefix = "";
	const childPrefix = "";

	renderFlowHeader(container, r, flowId, headerPrefix, theme, now, config, sharedContext);
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
	sharedContext?: {
		messageCount: number;
		userMessageCount: number;
		assistantMessageCount: number;
		toolCalls: Record<string, number>;
		totalTokens: number;
		preview: string;
	},
): void {
	// ─── Group status (aggregate from children) ───
	const allIndices = [...group.buildIndices, group.auditIndex];
	let groupIsRunning = false;
	let groupHasAwaiting = false;
	let groupAllComplete = true;
	for (const idx of allIndices) {
		const r = results[idx];
		if (isFlowRunning(r)) groupIsRunning = true;
		if (getFlowStatus(r) === "awaiting") groupHasAwaiting = true;
		if (!isFlowStatusComplete(r)) groupAllComplete = false;
	}

	const groupFlowId = `${idPrefix}#group-${group.buildIndices[0]}`;
	const groupStatus: string = groupIsRunning ? "running" : groupHasAwaiting ? "awaiting" : groupAllComplete ? "done" : "running";

	// Status dot for the group header
	let initialDot: string;
	switch (groupStatus) {
		case "running":
		case "pending":
			initialDot = theme.fg("warning", "●");
			break;
		case "awaiting":
			initialDot = theme.fg("muted", "○");
			break;
		case "done":
			initialDot = theme.fg("success", "●");
			break;
		case "error":
			initialDot = theme.fg("error", "✗");
			break;
		default:
			initialDot = theme.fg("muted", "?");
	}
	const dotPlaceholder = stripAnsi(initialDot);

	// ─── Group header line (flush-left, scintillating dot, DynamicScrambleText) ───
	const groupLabel = "audit-loop";

	const headerLine =
		initialDot + " " +
		applyRole("groupHeader", groupLabel, theme, config);

	const plainHeader = dotPlaceholder + " " + groupLabel;

	const headerSegments: HeaderSegment[] = [
		{ text: dotPlaceholder + " ", style: (_s) => getScintillatingStatusDot(
			{ ...results[group.buildIndices[0]], status: groupStatus } as SingleResult,
			theme, Date.now(), groupFlowId,
		) + " " },
		{ text: groupLabel, style: (s) => applyRole("groupHeader", s, theme, config) },
	];

	container.addChild(new DynamicScrambleText(
		headerLine,
		() => {
			const now = Date.now();
			const result = scrambleManager.updateText(groupFlowId, 'header', plainHeader, now, groupAllComplete, true);
			return reconstructHeader(result.content, headerSegments);
		},
		true,
	));

	if (groupAllComplete) {
		scrambleManager.completeFlow(groupFlowId);
	}

	// ─── Build children ───
	for (let b = 0; b < group.buildIndices.length; b++) {
		const buildIdx = group.buildIndices[b];
		const r = results[buildIdx];
		const flowId = `${idPrefix}#${buildIdx}`;
		const buildHeaderPrefix = "├─";
		const buildChildPrefix = "│  ";

		renderFlowHeader(container, r, flowId, buildHeaderPrefix, theme, now, config, sharedContext);
		renderFlowBody(container, r, flowId, buildChildPrefix, theme, now, config);

		if (isFlowStatusComplete(r)) {
			scrambleManager.completeFlow(flowId);
		}
	}

	// ─── Audit capstone ───
	const auditIdx = group.auditIndex;
	const auditResult = results[auditIdx];
	const auditFlowId = `${idPrefix}#${auditIdx}`;
	const auditHeaderPrefix = "└─";
	const auditChildPrefix = "   ";

	renderFlowHeader(container, auditResult, auditFlowId, auditHeaderPrefix, theme, now, config, sharedContext);
	renderFlowBody(container, auditResult, auditFlowId, auditChildPrefix, theme, now, config);

	if (isFlowStatusComplete(auditResult)) {
		scrambleManager.completeFlow(auditFlowId);
	}
}

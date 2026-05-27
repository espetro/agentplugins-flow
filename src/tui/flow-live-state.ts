import type { SharedContext } from "../core2/snapshot.js";
import { computeInitialContextTokens, resolveDisplayContextTokens } from "./context-display.js";
import { emptyFlowUsage, type SingleResult } from "../types/flow.js";

type FlowLivePhase = "boot" | "running" | "done";

export interface FlowLiveState {
	phase: FlowLivePhase;
	sharedContext?: SharedContext;
	model?: string;
	maxContextTokens?: number;
	contextTokens?: number;
	flowType?: string;
	intent?: string;
	aim?: string;
}

const liveByToolCallId = new Map<string, FlowLiveState>();

export interface BeginFlowLiveSessionOpts {
	sharedContext?: SharedContext;
	model?: string;
	maxContextTokens?: number;
	intent: string;
	aim?: string;
	flowType?: string;
	prompt?: string;
}

export function beginFlowLiveSession(toolCallId: string, opts: BeginFlowLiveSessionOpts): void {
	const contextTokens = computeInitialContextTokens(opts.sharedContext, opts.intent, opts.prompt);
	liveByToolCallId.set(toolCallId, {
		phase: "boot",
		sharedContext: opts.sharedContext,
		model: opts.model,
		maxContextTokens: opts.maxContextTokens,
		contextTokens,
		flowType: opts.flowType,
		intent: opts.intent,
		aim: opts.aim,
	});
}

export function markFlowLiveRunning(toolCallId: string): void {
	const live = liveByToolCallId.get(toolCallId);
	if (live) live.phase = "running";
}

export function endFlowLiveSession(toolCallId: string): void {
	liveByToolCallId.delete(toolCallId);
}

export function getFlowLiveState(toolCallId: string | undefined): FlowLiveState | undefined {
	if (!toolCallId) return undefined;
	return liveByToolCallId.get(toolCallId);
}

/** Synthetic in-progress result while the host renders before runFlow's first partial. */
export function buildBootPhaseSingleResult(
	live: FlowLiveState | undefined,
	flowRequest?: {
		type?: string;
		intent?: string;
		aim?: string;
		model?: string;
		maxContextTokens?: number;
	},
): SingleResult | undefined {
	if (!live || live.phase !== "boot") return undefined;
	const intent = flowRequest?.intent || live.intent || "Processing...";
	const contextTokens =
		live.contextTokens
		?? resolveDisplayContextTokens({ contextTokens: 0, input: 0, output: 0 }, live.sharedContext)
		?? computeInitialContextTokens(live.sharedContext, intent);
	return {
		type: flowRequest?.type || live.flowType || "unknown",
		agentSource: "user",
		intent,
		aim: flowRequest?.aim ?? live.aim ?? intent,
		exitCode: -1,
		messages: [],
		stderr: "",
		usage: { ...emptyFlowUsage(), contextTokens },
		...(flowRequest?.model || live.model ? { model: flowRequest?.model ?? live.model } : {}),
		...(flowRequest?.maxContextTokens !== undefined || live.maxContextTokens !== undefined
			? { maxContextTokens: flowRequest?.maxContextTokens ?? live.maxContextTokens }
			: {}),
	};
}

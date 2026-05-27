import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { FlowDetails } from "../types/flow.js";
import { setLiveText, clearLiveText } from "../tui/scramble/index.js";
import {
	beginFlowLiveSession,
	endFlowLiveSession,
	markFlowLiveRunning,
	type BeginFlowLiveSessionOpts,
} from "../tui/flow-live-state.js";
import { runFlow, type RunFlowOptions } from "./runner.js";
import type { SingleResult } from "../types/flow.js";

type FlowUpdateCallback = (partial: AgentToolResult<FlowDetails>) => void;

/** Publish aggregate streaming body for a tool call. */
export function publishFlowLiveText(toolCallId: string, text: string): void {
	setLiveText(toolCallId, text);
}

/** Publish per-flow-index streaming body (multi-flow sidebar). */
export function publishFlowLiveTextAtIndex(toolCallId: string, index: number, text: string): void {
	setLiveText(`${toolCallId}#${index}`, text);
	setLiveText(`collapsed#${index}`, text);
}

function clearFlowLiveText(toolCallId: string): void {
	clearLiveText(toolCallId);
}

/**
 * Wrap host onUpdate: attach _toolCallId, publish live text, mark running.
 * Single place for trace + flow executor parity.
 */
export function wrapFlowOnUpdate(
	toolCallId: string,
	onUpdate?: FlowUpdateCallback,
): FlowUpdateCallback | undefined {
	if (!onUpdate) return undefined;
	return (partial) => {
		markFlowLiveRunning(toolCallId);
		const text = partial?.content?.[0]?.text;
		if (text !== undefined) {
			publishFlowLiveText(toolCallId, text);
		}
		onUpdate({ ...partial, _toolCallId: toolCallId });
	};
}

export async function runFlowWithLiveSession(
	toolCallId: string,
	liveOpts: BeginFlowLiveSessionOpts,
	runOpts: RunFlowOptions,
): Promise<SingleResult> {
	beginFlowLiveSession(toolCallId, liveOpts);
	try {
		return await runFlow({
			...runOpts,
			toolCallId,
			onUpdate: wrapFlowOnUpdate(toolCallId, runOpts.onUpdate),
		});
	} finally {
		endFlowLiveSession(toolCallId);
		clearFlowLiveText(toolCallId);
	}
}

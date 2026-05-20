import { Type } from "@sinclair/typebox";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { runFlow } from "../flow/runner.js";
import { discoverFlows } from "../flow/agents.js";
import { buildCore2Snapshot } from "../core2/snapshot.js";
import { renderTraceCall, renderTraceResult } from "../tui/render.js";
import { DEFAULT_FLOW_COLORS } from "../tui/flow-colors.js";
import { getFlowOutput, type SingleResult } from "../types/flow.js";
import type { FlowDepthConfig } from "../flow/depth.js";

// ---------------------------------------------------------------------------
// Tool parameter schema
// ---------------------------------------------------------------------------

export const TraceParams = Type.Object({
	ids: Type.Array(Type.String(), {
		description: "Ordered list of tool_call_id values from prior results.",
	}),
	remark: Type.String({
		description: "Objective for the trace state (e.g. 'synthesize findings').",
	}),
	marks: Type.Optional(Type.Array(
		Type.Object({
			id: Type.String({ description: "ID to annotate" }),
			useful: Type.Boolean({ description: "Whether this result is valid/useful" }),
			note: Type.Optional(Type.String({ description: "Reason for the mark" })),
		}),
		{ description: "Optional per-ID annotations." },
	)),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildReplayedResults(branch: any[], ids: string[], marks?: { id: string; useful: boolean; note?: string }[]): string[] {
	const resultTexts: string[] = [];
	for (const id of ids) {
		for (const entry of branch) {
			const msg = (entry as any)?.message ?? entry;
			if (!msg) continue;
			const role = msg.role;
			if (role !== "tool" && role !== "toolResult") continue;
			const entryId = msg.toolCallId ?? msg.tool_call_id;
			if (entryId !== id) continue;

			const mark = marks?.find((m) => m.id === id);
			const annotation = mark
				? `<!-- mark: ${mark.useful ? "USEFUL" : "STALE"}${mark.note ? ` — ${mark.note}` : ""} -->`
				: "";

			const content = msg.content;
			if (typeof content === "string" && content.trim()) {
				resultTexts.push(`<!-- tool_call_id: ${id} -->\n${annotation}\n${content.trim()}`.trim());
			} else if (Array.isArray(content)) {
				const textParts = content
					.filter((c: any) => c?.type === "text" && typeof c?.text === "string")
					.map((c: any) => c.text.trim())
					.join("\n");
				if (textParts) {
					resultTexts.push(`<!-- tool_call_id: ${id} -->\n${annotation}\n${textParts}`.trim());
				}
			}
			break;
		}
	}
	return resultTexts;
}

function makeTraceDetailsFactory(projectAgentsDir: string | null) {
	return (results: SingleResult[]) => ({
		mode: "flow" as const,
		flowStyle: "fork" as const,
		projectAgentsDir,
		results,
	});
}

// ---------------------------------------------------------------------------
// Trace tool (flow-like — spawns a child reflection agent)
// ---------------------------------------------------------------------------

export interface TraceToolOptions {
	/** Resolve toolOptimize lazily at execute time (follows flow-tool pattern). */
	getSettings?: () => { toolOptimize?: boolean; structuredOutput?: boolean; bodyVerbosity?: "lite" | "full" } | undefined;
	/** Resolve depth config lazily at execute time. */
	getDepthConfig?: () => FlowDepthConfig | undefined;
}

/**
 * Extract tool results from a child flow's message history.
 * Returns full verbatim tool outputs the child agent saw.
 */
function getTraceToolResults(
	messages: { role: string; toolCallId?: string; tool_call_id?: string; content?: unknown }[],
): string[] {
	const sections: string[] = [];

	for (const msg of messages) {
		if (!msg || (msg.role !== "tool" && msg.role !== "toolResult")) continue;

		const id = msg.toolCallId ?? msg.tool_call_id ?? "";
		if (!id) continue;

		// Extract text content (string or first text part in array)
		let text: string | undefined;

		if (typeof msg.content === "string" && msg.content.trim()) {
			text = msg.content.trim();
		} else if (Array.isArray(msg.content)) {
			const textParts = msg.content
				.filter((c: any) => c?.type === "text" && typeof c?.text === "string")
				.map((c: any) => c.text.trim())
				.join("\n");
			if (textParts) text = textParts;
		}

		if (!text) continue;

		// Build section with tool_call_id header
		const header = `tool_call_id: ${id}`;
		sections.push(`${header}\n\n${text}`);
	}

	return sections;
}

export function createTraceTool(opts: TraceToolOptions = {}) {
	return {
		name: "trace",
		label: "trace",
		promptSnippet: "Dive into a specialized trace state to reflect, synthesize, and validate evidence.",
		promptGuidelines: [
			"Use `trace` to review and synthesize evidence from earlier tool calls.",
			"Provide the `tool_call_id` for each result you want to replay. These IDs are typically found in tool result headers or metadata.",
			"Set `remark` as the objective for the trace state (e.g., 'synthesize results and draft a plan').",
			"Optionally use `marks` to label specific IDs as useful, stale, or misleading.",
		],
		description: "Dives into a specialized trace state to replay prior results verbatim and synthesize findings. Ideal for checkpointing progress and ensuring plan validity.",
		parameters: TraceParams,

		async execute(
			toolCallId: string,
			params: { ids: string[]; remark: string; marks?: { id: string; useful: boolean; note?: string }[] },
			signal: AbortSignal | undefined,
			onUpdate: any,
			ctx: ExtensionContext,
		): Promise<AgentToolResult> {
			if (!opts.getSettings?.()) {
				throw new Error("Error: session not initialized");
			}

			const depthConfig = opts.getDepthConfig?.();
			const parentDepth = depthConfig?.currentDepth ?? 0;
			const parentFlowStack = depthConfig?.ancestorFlowStack ?? [];

			const branch = ctx.sessionManager.getBranch();
			const replayedResults = buildReplayedResults(branch, params.ids, params.marks);

			const forkSessionSnapshotJsonl = buildCore2Snapshot(ctx.sessionManager);
			if (!forkSessionSnapshotJsonl) {
				throw new Error("Trace failed: invalid session snapshot");
			}

			const discovery = discoverFlows(ctx.cwd, "all");
			const makeDetails = makeTraceDetailsFactory(discovery.projectFlowsDir);

			const intent = params.remark?.trim()
				? params.remark.trim()
				: "trace and reflect on prior tool results";

			const preDispatchResults = replayedResults.join("\n\n");

			const result = await runFlow({
				cwd: ctx.cwd,
				flows: discovery.flows,
				flowName: "trace",
				intent,
				aim: "trace and reflect",
				forkSessionSnapshotJsonl,
				parentDepth,
				parentFlowStack,
				maxDepth: 0,
				preventCycles: true,
				toolOptimize: opts.getSettings?.()?.toolOptimize,
				structuredOutput: false,
				complexity: "snap",
				preDispatchResults: preDispatchResults || undefined,
				makeDetails,
				signal,
				onUpdate,
			});

			// Extract the child's tool results (evidence) + synthesis
			const childToolResults = getTraceToolResults(result.messages);
			const childSynthesis = getFlowOutput(result.messages) || "Trace completed.";

			let outputText: string;
			if (childToolResults.length > 0) {
				outputText = [
					`## Tool Results\n\n${childToolResults.join("\n\n")}`,
					`---`,
					`## Synthesis\n\n${childSynthesis}`,
				].join("\n\n");
			} else {
				outputText = childSynthesis;
			}

			const toolResult: AgentToolResult<import("../types/flow.js").FlowDetails> = {
				content: [{ type: "text" as const, text: outputText }],
				details: makeDetails([result]),
				failed: result.exitCode !== 0 && result.exitCode !== undefined,
				_toolCallId: toolCallId,
			};

			return toolResult;
		},

		renderCall: (args: any, theme: any) => renderTraceCall(args, theme, { ...DEFAULT_FLOW_COLORS, bodyVerbosity: opts.getSettings?.()?.bodyVerbosity ?? "lite" }),
		renderResult: (result: any, { expanded }: any, theme: any, args: any) =>
			renderTraceResult(result, expanded, theme, args, { ...DEFAULT_FLOW_COLORS, bodyVerbosity: opts.getSettings?.()?.bodyVerbosity ?? "lite" }),
	};
}

/**
 * Trace tool — standalone quick verbatim reads and checks.
 *
 * Split from the `flow` tool to eliminate the confusion where the agent
 * nested dispatch ops as siblings in the `flow[]` array instead of inside
 * a task object. Trace is self-defining (agents/trace.md already
 * contains the full mission), so it needs zero required fields.
 */

import { Type, type Static } from "@sinclair/typebox";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { runFlowWithLiveSession } from "../flow/flow-live.js";
import { discoverFlows, getFlowTier, type FlowConfig } from "../flow/agents.js";
import { buildCore2Snapshot, parseSharedContext } from "../core2/snapshot.js";
import {
	resolveFlowModelCandidates,
	resolveModelContextWindow,
	selectFlowModelStrategy,
	type LoadedFlowModelConfigs,
	type FlowModelStrategy,
} from "../config/config.js";
import { renderFlowCall, renderFlowResult } from "../tui/render.js";
import { getFlowLiveState } from "../tui/flow-live-state.js";
import { emptyFlowUsage } from "../types/flow.js";
import { DEFAULT_FLOW_COLORS } from "../tui/flow-colors.js";
import { getFlowOutput, type SingleResult, type FlowDetails } from "../types/flow.js";
import { executeOperations } from "../batch/execute.js";
import { runBashWithLimits } from "../batch/batch-bash.js";
import { runWebOps } from "./web-ops.js";
import type { FileOpInput } from "../batch/constants.js";
import type { WebOpInput } from "./web-ops.js";
import { extractTraceStructuredOutput, resolveToolEvidence } from "../snapshot/trace-output.js";

// ---------------------------------------------------------------------------
// Dispatch schemas — mirror of the flow-tool dispatch (kept here to avoid
// circular imports with src/index.ts).
// ---------------------------------------------------------------------------

const BatchDispatchOp = Type.Object({
	tool: Type.Literal("batch"),
	ops: Type.Array(Type.Object({
		o: Type.String(),
		p: Type.Optional(Type.String()),
		s: Type.Optional(Type.Number()),
		l: Type.Optional(Type.Number()),
		i: Type.Optional(Type.Union([Type.String(), Type.Boolean()])),
		t: Type.Optional(Type.Union([Type.Number(), Type.String()])),
		c: Type.Optional(Type.String()),
		e: Type.Optional(Type.Array(Type.Object({ f: Type.String(), r: Type.String() }))),
		h: Type.Optional(Type.String()),
		q: Type.Optional(Type.String()),
		n: Type.Optional(Type.Number()),
		u: Type.Optional(Type.Number()),
	}), { description: "File/batch operations matching the batch tool schema." }),
});

const BashDispatchOp = Type.Object({
	tool: Type.Literal("bash"),
	ops: Type.Array(Type.Object({
		c: Type.String({ description: "Shell command" }),
		h: Type.Optional(Type.String({ description: "Working directory override" })),
		t: Type.Optional(Type.Number({ description: "Timeout in ms" })),
	}), { description: "Bash command objects." }),
});

const WebDispatchOp = Type.Object({
	tool: Type.Literal("web"),
	ops: Type.Array(Type.Object({
		o: Type.Union([Type.Literal("search"), Type.Literal("fetch")]),
		q: Type.Optional(Type.String()),
		u: Type.Optional(Type.String()),
		f: Type.Optional(Type.String()),
	}), { description: "Web operations matching the web tool schema." }),
});

const DispatchOpSchema = Type.Union([BatchDispatchOp, BashDispatchOp, WebDispatchOp], {
	description: "Pre-dispatch tool call with discriminated tool type and typed ops array.",
});

async function executeDispatchOps(
	dispatch: Array<
		| { tool: "batch"; ops: FileOpInput[] }
		| { tool: "bash"; ops: Array<{ c: string; h?: string; t?: number }> }
		| { tool: "web"; ops: WebOpInput[] }
	>,
	cwd: string,
	ctx: ExtensionContext,
	signal?: AbortSignal,
): Promise<{ promptString: string; messages: Message[] }> {
	const parts: string[] = [];
	const messages: Message[] = [];
	let toolCallIndex = 0;

	for (const group of dispatch) {
		if (signal?.aborted) break;
		const toolCallId = `pre_dispatch_${group.tool}_${toolCallIndex++}`;

		let resultString = "";
		try {
			if (group.tool === "batch") {
				const fileOps = group.ops.filter((op) => op.o !== "bash");
				const bashOps = group.ops.filter((op) => op.o === "bash");

				const subParts: string[] = [];
				if (fileOps.length > 0) {
					const fileOutput = await executeOperations(fileOps as FileOpInput[], cwd, signal, { includeLimitWarnings: true });
					subParts.push(fileOutput.contentText);
				}

				if (bashOps.length > 0) {
					for (const op of bashOps) {
						const { stdout, stderr, exitCode } = await runBashWithLimits(op.c ?? "", op.h ?? cwd, op.t ?? 30000, signal);
						subParts.push(`stdout:\n${stdout}${stderr ? `\nstderr:\n${stderr}` : ""}${exitCode !== 0 ? `\nexitCode: ${exitCode}` : ""}`);
					}
				}
				resultString = subParts.join("\n\n");
				parts.push(`### batch (file ops)\n\ntool_call_id: ${toolCallId}\n\n${resultString}`);
			} else if (group.tool === "bash") {
				const subParts: string[] = [];
				for (const cmd of group.ops) {
					const { stdout, stderr, exitCode } = await runBashWithLimits(cmd.c, cmd.h ?? cwd, cmd.t ?? 30000, signal);
					subParts.push(`stdout:\n${stdout}${stderr ? `\nstderr:\n${stderr}` : ""}${exitCode !== 0 ? `\nexitCode: ${exitCode}` : ""}`);
				}
				resultString = subParts.join("\n\n");
				parts.push(`### bash\n\ntool_call_id: ${toolCallId}\n\n${resultString}`);
			} else if (group.tool === "web") {
				const webOutput = await runWebOps({ op: group.ops }, ctx, signal);
				resultString = webOutput.content[0].text;
				parts.push(`### web\n\ntool_call_id: ${toolCallId}\n\n${resultString}`);
			}
		} catch (err) {
			resultString = `Error: ${err instanceof Error ? err.message : String(err)}`;
			parts.push(`### ${group.tool}\n\ntool_call_id: ${toolCallId}\n\n${resultString}`);
		}

		// Add mock messages
		messages.push({
			role: "assistant",
			content: [
				{
					type: "toolCall",
					toolCallId,
					name: group.tool,
					arguments: group.tool === "batch"
						? { o: group.ops }
						: group.tool === "bash"
							? { ops: group.ops }
							: { op: group.ops },
				}
			]
		} as unknown as Message);
		messages.push({
			role: "tool",
			toolCallId,
			content: [
				{
					type: "text",
					text: resultString,
				}
			]
		} as unknown as Message);
	}

	return {
		promptString: parts.join("\n\n"),
		messages,
	};
}

// ---------------------------------------------------------------------------
// Override tool params — zero required fields
// ---------------------------------------------------------------------------

export const TraceParams = Type.Object({
	intent: Type.Optional(Type.String({
		description: "Optional mission override. Defaults to the trace agent's built-in description.",
	})),
	dispatch: Type.Optional(Type.Array(DispatchOpSchema, {
		description: "Tools to run before the trace starts (results injected into prompt).",
	})),
	cwd: Type.Optional(Type.String({ description: "Working directory override." })),
	complexity: Type.Optional(Type.Union([
		Type.Literal("snap"),
		Type.Literal("simple"),
		Type.Literal("moderate"),
		Type.Literal("complex"),
		Type.Literal("intricate"),
	], { description: "Budget level. Default: simple." })),
}, {
	title: "TraceToolParams",
	description: "Activate trace mode — read files verbatim, run checks, explore codebase. All fields optional.",
	examples: [
		{},
		{ dispatch: [{ tool: "batch", ops: [{ o: "read", p: "src/main.ts" }] }] },
	],
});

export interface TraceToolOptions {
	getSettings?: () => { toolOptimize: boolean; structuredOutput: boolean; bodyVerbosity: "lite" | "full" } | undefined;
	getDepthConfig?: () => { currentDepth: number; maxDepth: number; ancestorFlowStack: string[]; preventCycles: boolean } | undefined;
	getLoadedFlowModelConfigs?: () => LoadedFlowModelConfigs | undefined;
	tierOverrideResolver?: (tier: "lite" | "flash" | "full") => string | undefined;
	fallbackModel?: string;
}

function resolveTraceRuntime(
	opts: TraceToolOptions,
	traceFlow: FlowConfig,
	ctx: ExtensionContext,
	toolCallId: string,
	intent: string,
) {
	const tier = (traceFlow.tier ?? "lite") as "lite" | "flash" | "full";
	let selectedStrategy: FlowModelStrategy | undefined;
	const loadedFlowModelConfigs = opts.getLoadedFlowModelConfigs?.();
	if (loadedFlowModelConfigs) {
		const selectedFlowModelConfig = selectFlowModelStrategy(
			loadedFlowModelConfigs.configs,
			loadedFlowModelConfigs.selectedName,
		);
		selectedStrategy = selectedFlowModelConfig.strategy;
	}
	const { candidates } = resolveFlowModelCandidates({
		tier,
		flowModel: traceFlow.model,
		cliTierOverride: opts.tierOverrideResolver?.(tier),
		strategy: selectedStrategy ?? {},
		fallbackModel: opts.fallbackModel,
	});
	const resolvedModel = candidates[0];
	const maxContextTokens = resolveModelContextWindow(resolvedModel);
	const forkSessionSnapshotJsonl = buildCore2Snapshot(ctx.sessionManager, {
		activeToolCallId: toolCallId,
		tier: traceFlow.tier ?? getFlowTier("trace"),
	});
	const sharedContext = parseSharedContext(forkSessionSnapshotJsonl);
	return {
		resolvedModel,
		maxContextTokens,
		forkSessionSnapshotJsonl,
		sharedContext,
		intent,
	};
}

export function createTraceTool(opts: TraceToolOptions = {}) {
	let lastResolvedModel: string | undefined;
	let lastResolvedMaxCtx: number | undefined;

	return {
		name: "trace",
		label: "Trace",
		promptSnippet: "Quick verbatim reads, checks, and exploration. All fields optional.",
		promptGuidelines: [
			"All fields optional — the trace agent infers its mission from context.",
			"Optional `dispatch` runs pre-flight reads before the trace starts.",
		],
		description: "Read files verbatim, run checks, explore the codebase. All fields optional.",
		parameters: TraceParams,

		async execute(
			toolCallId: string,
			params: Static<typeof TraceParams>,
			signal: AbortSignal | undefined,
			onUpdate: any,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<FlowDetails>> {
			if (!opts.getSettings?.()) {
				throw new Error("Error: session not initialized");
			}

			const depthConfig = opts.getDepthConfig?.();
			const parentDepth = depthConfig?.currentDepth ?? 0;
			const parentFlowStack = depthConfig?.ancestorFlowStack ?? [];
			const maxDepth = 0; // trace is a leaf — never transitions further
			const preventCycles = depthConfig?.preventCycles ?? true;

			const discovery = discoverFlows(ctx.cwd, "all");
			const traceFlow = discovery.flows.find(f => f.name === "trace");

			if (!traceFlow) {
				throw new Error("Trace agent not found. Expected agents/trace.md to be present.");
			}

			const intent = params.intent ?? traceFlow.description;
			const runtime = resolveTraceRuntime(opts, traceFlow, ctx, toolCallId, intent);
			const {
				resolvedModel,
				maxContextTokens,
				forkSessionSnapshotJsonl,
				sharedContext,
			} = runtime;

			const makeDetails = (results: SingleResult[]): FlowDetails => ({
				mode: "flow",
				flowStyle: "fork",
				projectAgentsDir: discovery.projectFlowsDir,
				results,
				sharedContext,
			});

			lastResolvedModel = resolvedModel;
			lastResolvedMaxCtx = maxContextTokens;

			const preDispatch = params.dispatch?.length
				? await executeDispatchOps(params.dispatch, params.cwd ?? ctx.cwd, ctx, signal)
				: undefined;
			const preDispatchResults = preDispatch?.promptString;
			const preDispatchMessages = preDispatch?.messages ?? [];

			const result = await runFlowWithLiveSession(
				toolCallId,
				{
					sharedContext,
					model: resolvedModel,
					maxContextTokens,
					intent,
					flowType: "trace",
				},
				{
					cwd: ctx.cwd,
					flows: discovery.flows,
					flowName: "trace",
					intent,
					aim: "",
					taskCwd: params.cwd,
					forkSessionSnapshotJsonl,
					parentDepth,
					parentFlowStack,
					maxDepth,
					preventCycles,
					toolOptimize: opts.getSettings?.()?.toolOptimize,
					structuredOutput: opts.getSettings?.()?.structuredOutput,
					complexity: params.complexity ?? "simple",
					model: resolvedModel,
					maxContextTokens,
					preDispatchResults,
					makeDetails,
					signal,
					onUpdate,
				},
			);

			const rawOutput = getFlowOutput(result.messages) || "Trace completed.";
			const traceOutput = extractTraceStructuredOutput(rawOutput) ?? { note: rawOutput, tool_ids: [] };

			let outputText = traceOutput.note;
			const evidence = resolveToolEvidence(
				traceOutput.tool_ids,
				[...preDispatchMessages, ...result.messages],
				ctx.sessionManager.getBranch(),
			);
			if (evidence) {
				outputText += "\n\n" + evidence;
			}

			// Inject enriched evidence into messages so renderer shows it after completion.
		result.messages.push({
			role: "assistant",
			content: [{ type: "text", text: outputText }],
		});

		const success = result.exitCode === 0;

			return {
				content: [{ type: "text" as const, text: outputText }],
				details: makeDetails([result]),
				failed: !success,
				_toolCallId: toolCallId,
			};
		},

		renderCall: (args: any, theme: any) =>
			renderFlowCall(args, theme, { ...DEFAULT_FLOW_COLORS, bodyVerbosity: opts.getSettings?.()?.bodyVerbosity ?? "lite" }),

		renderResult: (result: any, { expanded }: any, theme: any, args: any) => {
			const details = result?.details as FlowDetails | undefined;
			const toolCallId = result?._toolCallId || args?.toolCallId || args?.id;
			const live = getFlowLiveState(toolCallId);
			const enrichedArgs = {
				...(args?.flow?.[0]
					? args
					: {
							...(args || {}),
							flow: [
								{
									type: "trace",
									intent: args?.intent || "Trace mode",
									aim: "",
									model: live?.model ?? lastResolvedModel,
									maxContextTokens: live?.maxContextTokens ?? lastResolvedMaxCtx,
								},
							],
						}),
				sharedContext: details?.sharedContext ?? live?.sharedContext,
			};
			return renderFlowResult(result, expanded, theme, enrichedArgs, { ...DEFAULT_FLOW_COLORS, bodyVerbosity: opts.getSettings?.()?.bodyVerbosity ?? "lite" });
		},
	};
}

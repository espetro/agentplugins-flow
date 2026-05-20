/**
 * Override tool — standalone quick verbatim reads and checks.
 *
 * Split from the `flow` tool to eliminate the confusion where the agent
 * nested dispatch ops as siblings in the `flow[]` array instead of inside
 * a task object. Override is self-defining (agents/override.md already
 * contains the full mission), so it needs zero required fields.
 */

import { Type, type Static } from "@sinclair/typebox";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { runFlow } from "../flow/runner.js";
import { discoverFlows } from "../flow/agents.js";
import { buildCore2Snapshot } from "../core2/snapshot.js";
import { renderFlowCall, renderFlowResult } from "../tui/render.js";
import { DEFAULT_FLOW_COLORS } from "../tui/flow-colors.js";
import { getFlowOutput, type SingleResult, type FlowDetails } from "../types/flow.js";
import { executeOperations } from "../batch/execute.js";
import { runBashWithLimits } from "../batch/batch-bash.js";
import { runWebOps } from "./web-ops.js";
import type { FileOpInput } from "../batch/constants.js";
import type { WebOpInput } from "./web-ops.js";

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

export const DispatchOpSchema = Type.Union([BatchDispatchOp, BashDispatchOp, WebDispatchOp], {
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
): Promise<string> {
	const parts: string[] = [];
	let toolCallIndex = 0;

	for (const group of dispatch) {
		if (signal?.aborted) break;
		const toolCallId = `pre_dispatch_${group.tool}_${toolCallIndex++}`;

		try {
			if (group.tool === "batch") {
				const fileOps = group.ops.filter((op) => op.o !== "bash");
				const bashOps = group.ops.filter((op) => op.o === "bash");

				if (fileOps.length > 0) {
					const fileOutput = await executeOperations(fileOps as FileOpInput[], cwd, signal, { includeLimitWarnings: true });
					parts.push(`### batch (file ops)\n\ntool_call_id: ${toolCallId}\n\n${fileOutput.contentText}`);
				}

				if (bashOps.length > 0) {
					for (const op of bashOps) {
						const { stdout, stderr, exitCode } = await runBashWithLimits(op.c ?? "", op.h ?? cwd, op.t ?? 30000, signal);
						parts.push(`### batch (bash op)\n\ntool_call_id: ${toolCallId}\n\nstdout:\n${stdout}${stderr ? `\nstderr:\n${stderr}` : ""}${exitCode !== 0 ? `\nexitCode: ${exitCode}` : ""}`);
					}
				}
			} else if (group.tool === "bash") {
				for (const cmd of group.ops) {
					const { stdout, stderr, exitCode } = await runBashWithLimits(cmd.c, cmd.h ?? cwd, cmd.t ?? 30000, signal);
					parts.push(`### bash\n\ntool_call_id: ${toolCallId}\n\nstdout:\n${stdout}${stderr ? `\nstderr:\n${stderr}` : ""}${exitCode !== 0 ? `\nexitCode: ${exitCode}` : ""}`);
				}
			} else if (group.tool === "web") {
				const webOutput = await runWebOps({ op: group.ops }, ctx, signal);
				parts.push(`### web\n\ntool_call_id: ${toolCallId}\n\n${webOutput}`);
			}
		} catch (err) {
			parts.push(`### ${group.tool}\n\ntool_call_id: ${toolCallId}\n\nError: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Override tool params — zero required fields
// ---------------------------------------------------------------------------

export const OverrideParams = Type.Object({
	intent: Type.Optional(Type.String({
		description: "Optional mission override. Defaults to the override agent's built-in description.",
	})),
	dispatch: Type.Optional(Type.Array(DispatchOpSchema, {
		description: "Tools to run before the override starts (results injected into prompt).",
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
	title: "OverrideToolParams",
	description: "Activate override mode — read files verbatim, run checks, explore codebase. All fields optional.",
	examples: [
		{},
		{ dispatch: [{ tool: "batch", ops: [{ o: "read", p: "src/main.ts" }] }] },
	],
});

export interface OverrideToolOptions {
	getSettings?: () => { toolOptimize: boolean; structuredOutput: boolean; bodyVerbosity: "lite" | "full" } | undefined;
	getDepthConfig?: () => { currentDepth: number; maxDepth: number; ancestorFlowStack: string[]; preventCycles: boolean } | undefined;
}

export function createOverrideTool(opts: OverrideToolOptions = {}) {
	return {
		name: "override",
		label: "Override",
		promptSnippet: "Activate override mode — read files verbatim, run checks, explore codebase. Optional dispatch for pre-flight reads. No boilerplate required.",
		promptGuidelines: [
			"Use `override` for quick verbatim file reads, bash checks, and codebase exploration.",
			"No `intent`, `aim`, or `complexity` required — the agent knows its mission.",
			"Optional `dispatch` runs tools before the override starts.",
		],
		description: "Activates override mode to read files verbatim, run checks, and explore the codebase. Minimal schema — all fields optional.",
		parameters: OverrideParams,

		async execute(
			toolCallId: string,
			params: Static<typeof OverrideParams>,
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
			const maxDepth = 0; // override is a leaf — never transitions further
			const preventCycles = depthConfig?.preventCycles ?? true;

			const discovery = discoverFlows(ctx.cwd, "all");
			const overrideFlow = discovery.flows.find(f => f.name === "override");

			if (!overrideFlow) {
				throw new Error("Override agent not found. Expected agents/override.md to be present.");
			}

			const makeDetails = (results: SingleResult[]): FlowDetails => ({
				mode: "flow",
				flowStyle: "fork",
				projectAgentsDir: discovery.projectFlowsDir,
				results,
			});

			const preDispatchResults = params.dispatch?.length
				? await executeDispatchOps(params.dispatch, params.cwd ?? ctx.cwd, ctx, signal)
				: undefined;

			const forkSessionSnapshotJsonl = buildCore2Snapshot(ctx.sessionManager);

			const result = await runFlow({
				cwd: ctx.cwd,
				flows: discovery.flows,
				flowName: "override",
				intent: params.intent ?? overrideFlow.description,
				aim: "Override mode",
				taskCwd: params.cwd,
				forkSessionSnapshotJsonl,
				parentDepth,
				parentFlowStack,
				maxDepth,
				preventCycles,
				toolOptimize: opts.getSettings?.()?.toolOptimize,
				structuredOutput: opts.getSettings?.()?.structuredOutput,
				complexity: params.complexity ?? "simple",
				preDispatchResults,
				makeDetails,
				signal,
				onUpdate,
			});

			const outputText = getFlowOutput(result.messages) || "Override completed.";
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

		renderResult: (result: any, { expanded }: any, theme: any, args: any) =>
			renderFlowResult(result, expanded, theme, args, { ...DEFAULT_FLOW_COLORS, bodyVerbosity: opts.getSettings?.()?.bodyVerbosity ?? "lite" }),
	};
}

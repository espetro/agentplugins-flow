/**
 * Trace tool — standalone quick verbatim reads and checks.
 *
 * Bash-style CLI: single `cmd` field with optional flags and pre-flight dispatch.
 */

import { Type, type Static } from "@sinclair/typebox";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { runFlowWithLiveSession } from "../flow/flow-live.js";
import { discoverFlows, type FlowConfig } from "../flow/agents.js";
import { buildSnapshotWithCompression, parseSharedContext } from "../core2/snapshot.js";
import {
	resolveFlowModelCandidates,
	resolveModelContextWindow,
	selectFlowModelStrategy,
	type LoadedFlowModelConfigs,
	type FlowModelStrategy,
} from "../config/config.js";
import { renderFlowCall, renderFlowResult } from "../tui/render.js";
import { getFlowLiveState } from "../tui/flow-live-state.js";
import { DEFAULT_FLOW_COLORS } from "../tui/flow-colors.js";
import { getFlowOutput, type SingleResult, type FlowDetails } from "../types/flow.js";
import { logWarn } from "../config/log.js";
import { extractTraceStructuredOutput, resolveToolEvidence } from "../snapshot/trace-output.js";
import { runBatchCli } from "../cli/batch.js";
import { splitOnDoubleDash } from "../cli/chain.js";
import { tokenize } from "../cli/tokenize.js";
import { parseCommand, CliError } from "../cli/parse.js";

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

const TRACE_HELP = `trace — read-first investigation tool

USAGE:
  trace [flags] [-- <batch-dispatch>]

FLAGS:
  --intent <text>        Mission override. Default: trace agent's built-in description.
  --cwd <path>           Working directory override. Default: session cwd.
  --complexity <level>   snap | simple | moderate | complex | intricate. Default: simple.
  --help, -h             Show this help text.

DISPATCH:
  Everything after the first top-level \`--\` is a batch-style command.
  Examples:
    trace -- batch read src/index.ts
    trace --intent "verify auth" -- batch read src/auth.ts; batch rg -q "password" src/

EXAMPLES:
  trace                           # default mission, no dispatch
  trace --intent "verify auth"    # override mission
  trace --cwd /tmp                # override cwd
  trace --complexity moderate     # override budget
  trace -- batch read foo.txt     # pre-flight read
  trace help                      # show this help
`;

// ---------------------------------------------------------------------------
// Flag spec
// ---------------------------------------------------------------------------

const TRACE_FLAG_SPEC = {
	intent: { short: "i", type: "string" as const, description: "Mission override" },
	cwd: { type: "string" as const, description: "Working directory override" },
	complexity: { short: "x", type: "string" as const, description: "Budget level: snap, simple, moderate, complex, intricate" },
	help: { short: "h", type: "boolean" as const, description: "Show help" },
};

const VALID_COMPLEXITY = ["snap", "simple", "moderate", "complex", "intricate"];

// ---------------------------------------------------------------------------
// Command parser
// ---------------------------------------------------------------------------

export function parseTraceCmd(cmd: string): { flags: { intent?: string; cwd?: string; complexity?: string }; dispatch: string; help: boolean } {
	const trimmed = cmd.trim();
	if (trimmed.length === 0 || trimmed === "help" || trimmed === "--help" || trimmed === "-h") {
		return { flags: {}, dispatch: "", help: true };
	}

	const { pre, post } = splitOnDoubleDash(trimmed);
	let tokens = tokenize(pre);

	if (tokens[0] === "trace") {
		tokens.shift();
	}

	if (tokens.length > 0 && (tokens[0] === "help" || tokens[0] === "--help" || tokens[0] === "-h")) {
		return { flags: {}, dispatch: "", help: true };
	}

	if (tokens.length === 0) {
		return { flags: {}, dispatch: post.trim(), help: false };
	}

	// Prepend dummy subcommand so parseCommand can parse flags
	tokens.unshift("trace");
	const parsed = parseCommand(tokens, TRACE_FLAG_SPEC);

	if (parsed.flags.help) {
		return { flags: {}, dispatch: "", help: true };
	}

	const flags: { intent?: string; cwd?: string; complexity?: string } = {};

	if (parsed.flags.intent) {
		flags.intent = String(parsed.flags.intent);
	}
	if (parsed.flags.cwd) {
		flags.cwd = String(parsed.flags.cwd);
	}
	if (parsed.flags.complexity) {
		flags.complexity = String(parsed.flags.complexity);
	}

	if (flags.complexity && !VALID_COMPLEXITY.includes(flags.complexity)) {
		throw new CliError(
			`Invalid complexity: ${flags.complexity}`,
			`Valid levels: ${VALID_COMPLEXITY.join(", ")}`,
		);
	}

	return { flags, dispatch: post.trim(), help: false };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const TraceCliParams = Type.Object({
	cmd: Type.String({
		description: "Trace command. Optional flags (--intent, --cwd, --complexity) followed by optional pre-flight dispatch after `--`. Run with `cmd: 'help'` for the man page.",
	}),
});

export interface TraceToolOptions {
	getSettings?: () => { toolOptimize: boolean; structuredOutput: boolean; bodyVerbosity: "lite" | "full"; contextCompression?: import("../core2/snapshot.js").CompressionLevel } | undefined;
	getDepthConfig?: () => { currentDepth: number; maxDepth: number; ancestorFlowStack: string[]; preventCycles: boolean } | undefined;
	getLoadedFlowModelConfigs?: () => LoadedFlowModelConfigs | undefined;
	tierOverrideResolver?: (tier: "lite" | "flash" | "full") => string | undefined;
	fallbackModel?: string;
}

// ---------------------------------------------------------------------------
// Runtime resolution
// ---------------------------------------------------------------------------

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
	const { snapshot: forkSessionSnapshotJsonl, stats: compressionStats } = buildSnapshotWithCompression(
		ctx.sessionManager,
		{
			activeToolCallId: toolCallId,
			compressionLevel: opts.getSettings?.()?.contextCompression,
		},
		maxContextTokens,
	);
	const sharedContext = parseSharedContext(forkSessionSnapshotJsonl);
	if (compressionStats) {
		logWarn(`[pi-agent-flow] Context compression applied: ${compressionStats.level} (${compressionStats.preBytes} → ${compressionStats.postBytes} bytes, ${compressionStats.messagesDropped} messages dropped)`);
	}
	return {
		resolvedModel,
		maxContextTokens,
		forkSessionSnapshotJsonl,
		sharedContext,
		compressionStats,
		intent,
	};
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createTraceTool(opts: TraceToolOptions = {}) {
	let lastResolvedModel: string | undefined;
	let lastResolvedMaxCtx: number | undefined;
	let lastResolvedIntent: string | undefined;

	return {
		name: "trace",
		label: "Trace",
		promptSnippet: "Quick verbatim reads, checks, and exploration. All fields optional.",
		promptGuidelines: [
			"All fields optional — the trace agent infers its mission from context.",
			"Optional pre-flight dispatch runs batch-style commands before the trace starts.",
		],
		description: "Spawn the `trace` agent for read-first investigation. Pass flags (`--intent`, `--cwd`, `--complexity`) and optional pre-flight ops after `--`. Examples: `trace` • `trace --intent \"verify auth\"` • `trace -- batch read src/auth.ts`. NOT a shell. Defaults to `simple` budget. Use for code investigation, exploration, and verification. Pass [cmd]: \"help\" for the man page.",
		parameters: TraceCliParams,

		async execute(
			toolCallId: string,
			params: Static<typeof TraceCliParams>,
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
			const maxDepth = 0;
			const preventCycles = depthConfig?.preventCycles ?? true;

			const discovery = discoverFlows(ctx.cwd, "all");
			const traceFlow = discovery.flows.find(f => f.name === "trace");

			if (!traceFlow) {
				throw new Error("Trace agent not found. Expected agents/trace.md to be present.");
			}

			// Parse the trace command
			let parsed: ReturnType<typeof parseTraceCmd>;
			try {
				parsed = parseTraceCmd(params.cmd ?? "");
			} catch (err) {
				if (err instanceof CliError) {
					const text = err.hint ? `${err.message} (hint: ${err.hint})` : err.message;
					return {
						content: [{ type: "text", text }],
						details: undefined,
						failed: true,
						_toolCallId: toolCallId,
					};
				}
				throw err;
			}

			// Help response
			if (parsed.help) {
				return {
					content: [{ type: "text", text: TRACE_HELP }],
					details: undefined,
					failed: false,
					_toolCallId: toolCallId,
				};
			}

			const intent = parsed.flags.intent ?? traceFlow.description;
			const runtime = resolveTraceRuntime(opts, traceFlow, ctx, toolCallId, intent);
			const {
				resolvedModel,
				maxContextTokens,
				forkSessionSnapshotJsonl,
				sharedContext,
				compressionStats,
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
			lastResolvedIntent = intent;

			// Pre-flight dispatch via batch CLI
			let preDispatchResults: string | undefined;
			const preDispatchMessages: Message[] = [];
			const resolvedCwd = parsed.flags.cwd ?? ctx.cwd;

			if (parsed.dispatch.length > 0) {
				const dispatchResult = await runBatchCli(
					parsed.dispatch,
					resolvedCwd,
					undefined,
					ctx.sessionManager,
					signal,
				);
				preDispatchResults = dispatchResult.text;

				const preDispatchToolCallId = "pre_dispatch_batch_0";
				preDispatchMessages.push({
					role: "assistant",
					content: [
						{
							type: "toolCall",
							toolCallId: preDispatchToolCallId,
							name: "batch",
							arguments: { cmd: parsed.dispatch },
						} as any,
					],
				} as unknown as Message);
				preDispatchMessages.push({
					role: "tool",
					toolCallId: preDispatchToolCallId,
					content: [
						{
							type: "text",
							text: dispatchResult.text,
						} as any,
					],
				} as unknown as Message);
			}

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
					taskCwd: parsed.flags.cwd,
					forkSessionSnapshotJsonl,
					parentDepth,
					parentFlowStack,
					maxDepth,
					preventCycles,
					toolOptimize: opts.getSettings?.()?.toolOptimize,
					structuredOutput: opts.getSettings?.()?.structuredOutput,
					complexity: (parsed.flags.complexity ?? "simple") as "snap" | "simple" | "moderate" | "complex" | "intricate",
					model: resolvedModel,
					maxContextTokens,
					compressionStats,
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
								intent: lastResolvedIntent || "Trace mode",
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

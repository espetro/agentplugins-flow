/**
 * batch_read and batch CLI tool factories.
 */

import { Type } from "@sinclair/typebox";
import { CliError } from "./parse.js";
import type { BatchTheme } from "../batch/constants.js";
import { renderBatchReadResult, renderBatchReadCall } from "../batch/render.js";
import type { BashProcessTracker } from "../batch/batch-bash.js";
import {
  runBatchReadCli,
  BatchReadCliParams,
  BATCH_READ_CLI_DESCRIPTION,
  BATCH_READ_CLI_SNIPPET,
  BATCH_READ_CLI_GUIDELINES,
} from "./batch-read.js";
import {
  runBatchCli,
  BatchCliParams,
  BATCH_CLI_DESCRIPTION,
  BATCH_CLI_SNIPPET,
  BATCH_CLI_GUIDELINES,
} from "./batch.js";

interface CliToolContext {
  cwd: string;
  sessionManager?: { getSessionDir(): string };
}

interface CliToolConfig {
  name: string;
  label: string;
  description: string;
  promptSnippet: string;
  promptGuidelines: string[];
  parameters: any;
  runner: (cmd: string, cwd: string, signal: AbortSignal | undefined, ctx: CliToolContext) => Promise<{ text: string; results: any[]; hasError: boolean }>;
}

function createCliTool(config: CliToolConfig) {
  return {
    name: config.name,
    label: config.label,
    description: config.description,
    promptSnippet: config.promptSnippet,
    promptGuidelines: config.promptGuidelines,
    parameters: config.parameters,

    async execute(
      _toolCallId: string,
      input: unknown,
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: CliToolContext,
    ) {
      let cmd: string;
      let cwd: string;

      if (input && typeof input === "object") {
        const args = input as Record<string, unknown>;
        cmd = typeof args.cmd === "string" ? args.cmd : "";
        cwd = typeof args.cwd === "string" ? args.cwd : ctx.cwd;
      } else {
        cmd = "";
        cwd = ctx.cwd;
      }

      try {
        const { text, results, hasError } = await config.runner(cmd, cwd, signal, ctx);
        return {
          content: [{ type: "text", text }],
          details: { results },
          isError: hasError || undefined,
        };
      } catch (err) {
        if (err instanceof CliError) {
          const hint = err.hint ? `\nHint: ${err.hint}` : "";
          return {
            isError: true,
            content: [{ type: "text", text: `Error: ${err.message}${hint}` }],
          };
        }
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${message}` }],
        };
      }
    },

    renderCall: (args: Record<string, unknown>, theme: BatchTheme) => renderBatchReadCall(args, theme),
    renderResult: (result: any, { expanded, isPartial }: { expanded: boolean; isPartial?: boolean }, theme: BatchTheme, args?: Record<string, unknown>) =>
      renderBatchReadResult(result, { expanded, isPartial: isPartial ?? false }, theme, args),
  };
}

export function createBatchReadCliTool() {
  return createCliTool({
    name: "batch_read",
    label: "batch_read",
    description: BATCH_READ_CLI_DESCRIPTION,
    promptSnippet: BATCH_READ_CLI_SNIPPET,
    promptGuidelines: BATCH_READ_CLI_GUIDELINES,
    parameters: BatchReadCliParams,
    runner: (cmd, cwd, signal) => runBatchReadCli(cmd, cwd, signal),
  });
}

export function createBatchCliTool(bashTracker?: BashProcessTracker, toolOptimize?: boolean) {
  return createCliTool({
    name: "batch",
    label: "batch",
    description: BATCH_CLI_DESCRIPTION,
    promptSnippet: BATCH_CLI_SNIPPET,
    promptGuidelines: [
      ...BATCH_CLI_GUIDELINES,
      ...(toolOptimize ? ["Batch is your ONLY edit tool — no separate edit command."] : []),
    ],
    parameters: BatchCliParams,
    runner: (cmd, cwd, signal, ctx) => runBatchCli(cmd, cwd, bashTracker, ctx.sessionManager, signal),
  });
}

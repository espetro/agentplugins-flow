/**
 * batch_read and batch CLI tool factories.
 */

import { Type } from "@sinclair/typebox";
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
import { CliError } from "./parse.js";
import type { BatchTheme } from "../batch/constants.js";
import { renderBatchReadResult, renderBatchReadCall } from "../batch/render.js";
import type { BashProcessTracker } from "../batch/batch-bash.js";

export function createBatchReadCliTool() {
  return {
    name: "batch_read",
    label: "batch_read",
    description: BATCH_READ_CLI_DESCRIPTION,
    promptSnippet: BATCH_READ_CLI_SNIPPET,
    promptGuidelines: BATCH_READ_CLI_GUIDELINES,
    parameters: BatchReadCliParams,

    async execute(
      _toolCallId: string,
      input: unknown,
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: { cwd: string },
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
        const { text, results, hasError } = await runBatchReadCli(cmd, cwd, signal);
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

export function createBatchCliTool(bashTracker?: BashProcessTracker, toolOptimize?: boolean) {
  return {
    name: "batch",
    label: "batch",
    description: BATCH_CLI_DESCRIPTION,
    promptSnippet: BATCH_CLI_SNIPPET,
    promptGuidelines: [
      ...BATCH_CLI_GUIDELINES,
      ...(toolOptimize ? ["Batch is your ONLY edit tool — no separate edit command."] : []),
    ],
    parameters: BatchCliParams,

    async execute(
      _toolCallId: string,
      input: unknown,
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: { cwd: string },
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
        const { text, results, hasError } = await runBatchCli(cmd, cwd, bashTracker, signal);
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

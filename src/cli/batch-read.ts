/**
 * batch_read — bash-style CLI tool.
 *
 * Replaces the legacy batch_read mega-schema with a simple cmd string
 * that uses subcommands and flags.
 */

import { Type } from "@sinclair/typebox";
import { tokenize } from "./tokenize.js";
import { splitChain } from "./chain.js";
import { parseCommand, CliError, type FlagSpec } from "./parse.js";
import { renderHelp, type SubcommandHelp } from "./help.js";
import { formatChainedOutput, type ChainedOp } from "./format.js";
import { executeOperations } from "../batch/execute.js";
import type { FileOpInput } from "../batch/constants.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const BatchReadCliParams = Type.Object({
  cmd: Type.String({
    description: "batch_read command string, e.g. 'batch_read read src/index.ts' or 'batch_read rg -q pattern src/'",
  }),
  cwd: Type.Optional(
    Type.String({
      description: "Working directory override. Default: current session cwd.",
    }),
  ),
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BATCH_READ_CLI_DESCRIPTION =
  "Read-only file and ripgrep tool. Bash-style CLI: pass a single [cmd] string with subcommands and flags. Optional [cwd] override.";

export const BATCH_READ_CLI_SNIPPET =
  "Read files or grep via bash-style CLI (read-only)";

export const BATCH_READ_CLI_GUIDELINES = [
  "Use `batch_read read <paths>` for files. Add `:N` or `:N-M` for line ranges.",
  "Use `batch_read rg -q <pattern> <path>` for ripgrep.",
  "Chain with `;` for sequential ops and `&&` for conditional ops.",
  "Pass `cmd: \"help\"` or `--help` for the man page.",
];

// ---------------------------------------------------------------------------
// Flag specs
// ---------------------------------------------------------------------------

export const READ_FLAGS: FlagSpec = {
  start: { short: "s", type: "number", description: "1-indexed start line" },
  limit: { short: "l", type: "number", description: "Maximum lines to read" },
  end: { short: "e", type: "number", description: "End line (used with -s)" },
};

export const RG_FLAGS: FlagSpec = {
  query: { short: "q", type: "string", description: "Search pattern for rg" },
  "ignore-case": { short: "i", type: "boolean", description: "Ignore case for rg" },
  "files-only": { short: "l", type: "boolean", description: "Return filenames only for rg" },
  type: { short: "t", type: "string", description: "Type filter for rg (e.g., ts, js)" },
  "max-count": { short: "n", type: "number", description: "Max matches per file for rg" },
  "ignore-level": { short: "u", type: "number", description: "Ignore level for rg (0-3)" },
};

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

const subcommands: SubcommandHelp[] = [
  {
    name: "read",
    description: "Read file contents. Paths may include :N or :N-M line ranges.",
    flags: {
      start: { short: "s", type: "number", description: "1-indexed start line" },
      limit: { short: "l", type: "number", description: "Maximum lines to read" },
      end: { short: "e", type: "number", description: "End line (used with -s)" },
    },
  },
  {
    name: "rg",
    description: "Search with ripgrep.",
    flags: {
      query: { short: "q", type: "string", description: "Search pattern (required)" },
      "ignore-case": { short: "i", type: "boolean", description: "Ignore case" },
      "files-only": { short: "l", type: "boolean", description: "Return filenames only" },
      type: { short: "t", type: "string", description: "Type filter (e.g., ts, js)" },
      "max-count": { short: "n", type: "number", description: "Max matches per file" },
      "ignore-level": { short: "u", type: "number", description: "Ignore level (0-3)" },
    },
  },
];

export const BATCH_READ_HELP = renderHelp(
  "batch_read",
  "Read-only file and ripgrep tool. Does not execute shell commands, write to files, or fetch URLs.",
  subcommands,
);

// ---------------------------------------------------------------------------
// Path spec parser
// ---------------------------------------------------------------------------

function parsePathSpec(spec: string): { path: string; start?: number; end?: number } {
  // Find the last colon that might be a line-range marker.
  // POSIX paths rarely contain colons except at the root, so we look for
  // patterns like :N or :N-M at the end.
  const match = spec.match(/^(.*):(\d+)(?:-(\d+))?$/);
  if (match) {
    const pathPart = match[1];
    const start = parseInt(match[2], 10);
    const end = match[3] ? parseInt(match[3], 10) : undefined;
    return { path: pathPart, start, end };
  }
  return { path: spec };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function runReadSubcommand(
  parsed: { flags: Record<string, unknown>; positionals: string[] },
  cwd: string,
  signal?: AbortSignal,
): Promise<{ output: string; results: import("../batch/constants.js").OpResult[]; error?: string; failed: boolean }> {
  if (parsed.positionals.length === 0) {
    throw new CliError("read requires at least one path.", "Usage: batch_read read [flags] <path> ...");
  }

  const flagStart = typeof parsed.flags.start === "number" ? parsed.flags.start : undefined;
  const flagLimit = typeof parsed.flags.limit === "number" ? parsed.flags.limit : undefined;
  const flagEnd = typeof parsed.flags.end === "number" ? parsed.flags.end : undefined;

  const ops: FileOpInput[] = [];
  for (const spec of parsed.positionals) {
    const { path, start, end } = parsePathSpec(spec);
    const effectiveStart = start ?? flagStart;
    let effectiveLimit: number | undefined;
    if (end !== undefined && effectiveStart !== undefined) {
      effectiveLimit = end - effectiveStart + 1;
    } else if (end !== undefined) {
      effectiveLimit = end;
    } else {
      effectiveLimit = flagLimit;
    }
    if (flagEnd !== undefined && effectiveStart !== undefined && effectiveLimit === undefined) {
      effectiveLimit = flagEnd - effectiveStart + 1;
    }

    ops.push({
      o: "read",
      p: path,
      s: effectiveStart,
      l: effectiveLimit,
    });
  }

  const { contentText, results } = await executeOperations(
    ops,
    cwd,
    signal,
    {
      readOptions: { truncate: false, toolName: "batch_read" },
      includeLimitWarnings: false,
    },
  );

  const failed = results.some((r) => r.status === "error");
  const error = failed
    ? (results.find((r) => r.status === "error")?.error ?? "operation failed")
    : undefined;
  return { output: contentText, results, error, failed };
}

async function runRgSubcommand(
  parsed: { flags: Record<string, unknown>; positionals: string[] },
  cwd: string,
  signal?: AbortSignal,
): Promise<{ output: string; results: import("../batch/constants.js").OpResult[]; error?: string; failed: boolean }> {
  const query = typeof parsed.flags.query === "string" ? parsed.flags.query : undefined;
  if (!query) {
    throw new CliError("rg requires -q <pattern>.", "Usage: batch_read rg -q <pattern> [flags] <path>");
  }

  if (parsed.positionals.length === 0) {
    throw new CliError("rg requires a search path.", "Usage: batch_read rg -q <pattern> [flags] <path>");
  }
  const searchPath = parsed.positionals[0];

  const op = {
    o: "rg" as const,
    p: searchPath,
    q: query,
    i: parsed.flags["ignore-case"] === true ? true : undefined,
    l: parsed.flags["files-only"] === true ? true : undefined,
    t: typeof parsed.flags.type === "string" ? parsed.flags.type : undefined,
    n: typeof parsed.flags["max-count"] === "number" ? parsed.flags["max-count"] : undefined,
    u: typeof parsed.flags["ignore-level"] === "number" ? parsed.flags["ignore-level"] : undefined,
  } as unknown as FileOpInput;

  const { contentText, results } = await executeOperations(
    [op],
    cwd,
    signal,
    {
      readOptions: { truncate: false, toolName: "batch_read" },
      includeLimitWarnings: false,
    },
  );

  const failed = results.some((r) => r.status === "error");
  const error = failed
    ? (results.find((r) => r.status === "error")?.error ?? "operation failed")
    : undefined;
  return { output: contentText, results, error, failed };
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function runBatchReadCli(
  cmd: string,
  cwd?: string,
  signal?: AbortSignal,
): Promise<{ text: string; results: import("../batch/constants.js").OpResult[]; hasError: boolean }> {
  const trimmed = cmd.trim();
  if (trimmed.length === 0) {
    return { text: BATCH_READ_HELP, results: [], hasError: false };
  }

  const chain = splitChain(trimmed);
  const ops: ChainedOp[] = [];
  let previousFailed = false;
  const allResults: import("../batch/constants.js").OpResult[] = [];

  for (const link of chain) {
    if (link.kind === "and" && previousFailed) {
      ops.push({ cmd: link.cmd, output: "", skipped: true });
      continue;
    }

    let output = "";
    let failed = false;
    let error: string | undefined;

    try {
      const tokens = tokenize(link.cmd);
      // Remove leading "batch_read" if present (the model may include it)
      if (tokens[0] === "batch_read") {
        tokens.shift();
      }

      if (tokens.length === 0) {
        output = BATCH_READ_HELP;
      } else {
        const subcommand = tokens[0];
        if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
          output = BATCH_READ_HELP;
        } else {
          const flagSpec = subcommand === "rg" ? RG_FLAGS : READ_FLAGS;
          const parsed = parseCommand(tokens, flagSpec);

          let result: { output: string; results: import("../batch/constants.js").OpResult[]; error?: string; failed: boolean };
          switch (parsed.subcommand) {
            case "read": {
              result = await runReadSubcommand(parsed, cwd ?? process.cwd(), signal);
              break;
            }
            case "rg": {
              result = await runRgSubcommand(parsed, cwd ?? process.cwd(), signal);
              break;
            }
            default: {
              throw new CliError(
                `Unknown subcommand: ${parsed.subcommand}`,
                `Did you mean: read, rg? Run with --help for usage.`,
              );
            }
          }
          output = result.output;
          allResults.push(...result.results);
          if (result.failed) {
            failed = true;
            error = result.error ?? "operation failed";
          }
        }
      }
    } catch (err) {
      failed = true;
      if (err instanceof CliError) {
        error = err.hint ? `${err.message} (hint: ${err.hint})` : err.message;
      } else {
        error = `internal error: ${err instanceof Error ? err.message : String(err)}`;
      }
      output = error;
    }

    ops.push({ cmd: link.cmd, output, error, failed, skipped: false });
    if (failed) {
      previousFailed = true;
    }
  }

  const hasError = ops.some((op) => op.error !== undefined || op.skipped || op.failed);
  return { text: formatChainedOutput(ops), results: allResults, hasError };
}

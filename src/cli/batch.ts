/**
 * batch — bash-style CLI tool.
 *
 * Replaces the legacy batch mega-schema with a simple cmd string
 * that uses subcommands and flags.
 */

import { Type } from "@sinclair/typebox";
import { tokenize } from "./tokenize.js";
import { splitChain } from "./chain.js";
import { parseCommand, CliError } from "./parse.js";
import { renderHelp, type SubcommandHelp } from "./help.js";
import { formatChainedOutput, type ChainedOp } from "./format.js";
import type { BashProcessTracker } from "../batch/batch-bash.js";
import {
  READ_FLAGS,
  WRITE_FLAGS,
  EDIT_FLAGS,
  DELETE_FLAGS,
  PATCH_FLAGS,
  BASH_FLAGS,
  RG_FLAGS,
  WEB_FLAGS,
  POLL_FLAGS,
} from "./flags/index.js";
import {
  runReadSubcommand,
  runWriteSubcommand,
  runEditSubcommand,
  runDeleteSubcommand,
  runPatchSubcommand,
  runBashSubcommand,
  runRgSubcommand,
  runWebSubcommand,
  runPollSubcommand,
} from "./exec/index.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const BatchCliParams = Type.Object({
  cmd: Type.String({
    description: "batch command string, e.g. 'batch read src/index.ts' or 'batch write -c \"hello\" file.txt'",
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

export const BATCH_CLI_DESCRIPTION =
  "Multi-op executor — NOT a shell. Subcommands: `read` • `write` • `edit` • `delete` • `patch` • `bash` • `rg` • `web` • `poll`. Pass a single [cmd] string of the form `batch <subcommand> <flags> <args>`. There is no `ls`/`cd`/`git`; the `bash` subcommand is the ONLY way to run shell. File/shell ops run first; web after. Chain with `;` (sequential) or `&&` (conditional). For read-only work, prefer `batch_read` (lighter, no write tools). Pass [cmd]: \"help\" for the man page.";

export const BATCH_CLI_SNIPPET =
  "Batch: file ops + bash + web in one call via CLI";

export const BATCH_CLI_GUIDELINES = [
  "**This is a structured command, NOT a shell.** There is no `ls`, `cd`, `git`, or arbitrary command. The only operations available are the documented subcommands (`read` • `write` • `edit` • `delete` • `patch` • `bash` • `rg` • `web` • `poll`). To run shell, use `batch bash <cmd>`.",
  "Use `batch read <paths>` for files. Add `:N` or `:N-M` for line ranges.",
  "Use `batch write -c <content> <path>` to write files.",
  "Use `batch edit -f <oldText> -r <newText> <path>` for targeted edits. Repeat -f/-r for multi-edit.",
  "Use `batch delete <path>` to remove files.",
  "Use `batch patch -c <patch_text>` to apply patch.",
  "Use `batch bash <command>` for shell commands. Chain with ; and &&.",
  "Use `batch rg -q <pattern> <path>` for ripgrep.",
  "Use `batch web search -q <query>` or `batch web fetch -u <url>` for web ops.",
  "Use `batch poll -i <id>` to check pending bash commands.",
  "Pass `cmd: \"help\"` or `--help` for the man page.",
];

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
    name: "write",
    description: "Write content to file(s).",
    flags: {
      content: { short: "c", type: "string", description: "File content (required)" },
    },
  },
  {
    name: "edit",
    description: "Targeted file edit using --find/--replace pairs.",
    flags: {
      find: { short: "f", type: "string", description: "Exact text to find (oldText). Repeatable." },
      replace: { short: "r", type: "string", description: "Replacement text (newText). Repeatable." },
      append: { short: "a", type: "boolean", description: "Append instead of replace" },
      "all-occurrences": { short: "A", type: "boolean", description: "Replace all occurrences instead of requiring unique match" },
    },
  },
  {
    name: "delete",
    description: "Delete file(s).",
    flags: {},
  },
  {
    name: "patch",
    description: "Apply a patch.",
    flags: {
      content: { short: "c", type: "string", description: "Patch text (required)" },
    },
  },
  {
    name: "bash",
    description: "Execute a shell command.",
    flags: {
      id: { short: "i", type: "string", description: "Unique ID for this bash operation (auto-generated if omitted)" },
      timeout: { short: "t", type: "number", description: "Timeout in ms" },
      cwd: { short: "h", type: "string", description: "Working directory override for this command" },
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
  {
    name: "web",
    description: "Web operations: search or fetch.",
    flags: {
      query: { short: "q", type: "string", description: "Search query (for web search)" },
      url: { short: "u", type: "string", description: "URL to fetch (for web fetch)" },
      format: { short: "f", type: "string", description: "Output format for fetch: markdown, text, html" },
    },
  },
  {
    name: "poll",
    description: "Poll pending bash commands by ID.",
    flags: {
      id: { short: "i", type: "string", description: "Bash operation ID to poll (required, repeatable)" },
    },
  },
];

export const BATCH_HELP = renderHelp(
  "batch",
  "Multi-op executor. File/shell ops ([read] [write] [edit] [delete] [patch] [bash] [rg]) execute first; web ([search] [fetch]) runs after. Supports chaining with ; and &&.",
  subcommands,
);

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function dispatchSubcommand(
  subcommand: string,
  parsed: { flags: Record<string, unknown>; positionals: string[] },
  cwd: string,
  bashTracker: BashProcessTracker | undefined,
  sessionManager: { getSessionDir(): string } | undefined,
  signal?: AbortSignal,
): Promise<{ output: string; results: import("../batch/constants.js").OpResult[]; error?: string; failed: boolean }> {
  switch (subcommand) {
    case "read":
      return runReadSubcommand(parsed, cwd, signal);
    case "write":
      return runWriteSubcommand(parsed, cwd, signal);
    case "edit":
      return runEditSubcommand(parsed, cwd, signal);
    case "delete":
      return runDeleteSubcommand(parsed, cwd, signal);
    case "patch":
      return runPatchSubcommand(parsed, cwd, signal);
    case "bash":
      return runBashSubcommand(parsed, cwd, bashTracker, signal);
    case "rg":
      return runRgSubcommand(parsed, cwd, signal);
    case "web":
      return runWebSubcommand(parsed, cwd, sessionManager, signal);
    case "poll":
      return runPollSubcommand(parsed, cwd, bashTracker, signal);
    default:
      throw new CliError(
        `Unknown subcommand: ${subcommand}`,
        `Did you mean: ${subcommands.map((s) => s.name).join(", ")}? Run with --help for usage.`,
      );
  }
}

function getFlagSpec(subcommand: string): Record<string, any> {
  switch (subcommand) {
    case "read": return READ_FLAGS;
    case "write": return WRITE_FLAGS;
    case "edit": return EDIT_FLAGS;
    case "delete": return DELETE_FLAGS;
    case "patch": return PATCH_FLAGS;
    case "bash": return BASH_FLAGS;
    case "rg": return RG_FLAGS;
    case "web": return WEB_FLAGS;
    case "poll": return POLL_FLAGS;
    default: return {};
  }
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function runBatchCli(
  cmd: string,
  cwd: string,
  bashTracker: BashProcessTracker | undefined,
  sessionManager?: { getSessionDir(): string },
  signal?: AbortSignal,
): Promise<{ text: string; results: import("../batch/constants.js").OpResult[]; hasError: boolean }> {
  const trimmed = cmd.trim();
  if (trimmed.length === 0) {
    return { text: BATCH_HELP, results: [], hasError: false };
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
      // Remove leading "batch" if present (the model may include it)
      if (tokens[0] === "batch") {
        tokens.shift();
      }

      if (tokens.length === 0) {
        output = BATCH_HELP;
      } else {
        const subcommand = tokens[0];
        if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
          output = BATCH_HELP;
        } else {
          const RECOGNIZED_SUBS = new Set(["read", "write", "edit", "delete", "patch", "bash", "rg", "web", "poll"]);
          let parsed;
          let result;
          if (!RECOGNIZED_SUBS.has(subcommand)) {
            // Defer to dispatchSubcommand's default branch for a clear "Unknown subcommand" error.
            result = await dispatchSubcommand(
              subcommand,
              { flags: {}, positionals: tokens.slice(1) },
              cwd,
              bashTracker,
              sessionManager,
              signal,
            );
          } else {
            const flagSpec = getFlagSpec(subcommand);
            try {
              parsed = parseCommand(tokens, flagSpec);
            } catch (err) {
              if (err instanceof CliError && err.message.startsWith("Unknown flag")) {
                const validFlags = Object.keys(flagSpec).map((n) => `--${n}`).join(", ");
                throw new CliError(
                  err.message,
                  `\`${subcommand}\` supports: ${validFlags}. Run [cmd]: \"help\" for the man page.`,
                );
              }
              throw err;
            }
            result = await dispatchSubcommand(
              parsed.subcommand,
              parsed,
              cwd,
              bashTracker,
              sessionManager,
              signal,
            );
          }
          output = result.output;
          allResults.push(...result.results);
          if (result.failed) {
            failed = true;
            error = `${result.error ?? "operation failed"}\nTIP: This is not a shell. Valid subcommands: read, write, edit, delete, patch, bash, rg, web, poll. Run [cmd]: \"help\" for the man page.`;
          }
        }
      }
    } catch (err) {
      failed = true;
      if (err instanceof CliError) {
        const baseError = err.hint ? `${err.message} (hint: ${err.hint})` : err.message;
        error = `${baseError}\nTIP: This is not a shell. Valid subcommands: read, write, edit, delete, patch, bash, rg, web, poll. Run [cmd]: \"help\" for the man page.`;
      } else {
        error = `internal error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    ops.push({ cmd: link.cmd, output, error, failed, skipped: false });
    if (failed) {
      previousFailed = true;
    } else {
      previousFailed = false;
    }
  }

  const hasError = ops.some((op) => op.error !== undefined || op.skipped || op.failed);
  return { text: formatChainedOutput(ops), results: allResults, hasError };
}

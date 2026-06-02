/**
 * batch — bash-style CLI tool.
 *
 * Replaces the legacy batch mega-schema with a simple cmd string
 * that uses subcommands and flags.
 */

import { Type } from "@sinclair/typebox";
import { CliError } from "./parse.js";
import { renderHelp, type SubcommandHelp, flagSpecToHelp } from "./help.js";
import { runChain } from "./runner.js";
import type { BashProcessTracker } from "../batch/batch-bash.js";
import { READ_FLAGS } from "./flags/read.js";
import { WRITE_FLAGS } from "./flags/write.js";
import { EDIT_FLAGS } from "./flags/edit.js";
import { PATCH_FLAGS } from "./flags/patch.js";
import { BASH_FLAGS } from "./flags/bash.js";
import { RG_FLAGS } from "./flags/rg.js";
import { WEB_FLAGS } from "./flags/web.js";
import { POLL_FLAGS } from "./flags/poll.js";
import { DELETE_FLAGS } from "./flags/delete.js";
import { runReadSubcommand } from "./exec/read.js";
import { runWriteSubcommand } from "./exec/write.js";
import { runEditSubcommand } from "./exec/edit.js";
import { runDeleteSubcommand } from "./exec/delete.js";
import { runPatchSubcommand } from "./exec/patch.js";
import { runBashSubcommand } from "./exec/bash.js";
import { runRgSubcommand } from "./exec/rg.js";
import { runWebSubcommand } from "./exec/web.js";
import { runPollSubcommand } from "./exec/poll.js";

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
  "Pass `cmd: \"help\"`, `--help`, or `-h` for the man page.",
];

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

const subcommands: SubcommandHelp[] = [
  { name: "read", description: "Read file contents. Paths may include :N or :N-M line ranges.", flags: flagSpecToHelp(READ_FLAGS) },
  { name: "write", description: "Write content to file(s).", flags: flagSpecToHelp(WRITE_FLAGS) },
  { name: "edit", description: "Targeted file edit using --find/--replace pairs.", flags: flagSpecToHelp(EDIT_FLAGS) },
  { name: "delete", description: "Delete file(s).", flags: flagSpecToHelp(DELETE_FLAGS) },
  { name: "patch", description: "Apply a patch.", flags: flagSpecToHelp(PATCH_FLAGS) },
  { name: "bash", description: "Execute a shell command.", flags: flagSpecToHelp(BASH_FLAGS) },
  { name: "rg", description: "Search with ripgrep.", flags: flagSpecToHelp(RG_FLAGS) },
  { name: "web", description: "Web operations: search or fetch.", flags: flagSpecToHelp(WEB_FLAGS) },
  { name: "poll", description: "Poll pending bash commands by ID.", flags: flagSpecToHelp(POLL_FLAGS) },
];

export const BATCH_HELP = renderHelp(
  "batch",
  "Multi-op executor. File/shell ops ([read] [write] [edit] [delete] [patch] [bash] [rg]) execute first; web ([search] [fetch]) runs after. Supports chaining with ; and &&.",
  subcommands,
);

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const RECOGNIZED_SUBS = new Set(["read", "write", "edit", "delete", "patch", "bash", "rg", "web", "poll"]);

function getFlagSpec(subcommand: string) {
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
  return runChain(cmd, cwd, signal, {
    toolPrefix: "batch",
    recognizedSubs: RECOGNIZED_SUBS,
    getFlagSpec,
    dispatch: (subcommand, parsed, cwd, signal) =>
      dispatchSubcommand(subcommand, parsed, cwd, bashTracker, sessionManager, signal),
    helpText: BATCH_HELP,
    validSubcommandsTip: "read, write, edit, delete, patch, bash, rg, web, poll",
  });
}

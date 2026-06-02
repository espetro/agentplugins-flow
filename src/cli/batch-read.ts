/**
 * batch_read — bash-style CLI tool.
 *
 * Replaces the legacy batch_read mega-schema with a simple cmd string
 * that uses subcommands and flags.
 */

import { Type } from "@sinclair/typebox";
import { CliError } from "./parse.js";
import { renderHelp, type SubcommandHelp, flagSpecToHelp } from "./help.js";
import { runChain } from "./runner.js";
import { READ_FLAGS } from "./flags/read.js";
import { RG_FLAGS } from "./flags/rg.js";
import { runReadSubcommand } from "./exec/read.js";
import { runRgSubcommand } from "./exec/rg.js";

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
  "Read-only file & grep tool — NOT a shell. Supports ONLY two subcommands: `read` (file contents) and `rg` (ripgrep). Pass a single [cmd] string of the form `batch_read <subcommand> <flags> <args>`. There is no `ls`, no `cd`, no `git`. Examples: `batch_read read src/index.ts` • `batch_read rg -q \"TODO\" src/`. Pass [cmd]: \"help\" for the man page.";

export const BATCH_READ_CLI_SNIPPET =
  "Read files or grep — NOT a shell (read-only)";

export const BATCH_READ_CLI_GUIDELINES = [
  "**This is a structured command, NOT a shell.** There is no `ls`, `cd`, `git`, or arbitrary command. The only operations available are the documented subcommands (`read`, `rg`).",
  "Use `batch_read read <paths>` for files. Add `:N` or `:N-M` for line ranges.",
  "Use `batch_read rg -q <pattern> <path>` for ripgrep.",
  "Chain with `;` for sequential ops and `&&` for conditional ops.",
  "Pass `cmd: \"help\"`, `--help`, or `-h` for the man page.",
];

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

const subcommands: SubcommandHelp[] = [
  { name: "read", description: "Read file contents. Paths may include :N or :N-M line ranges.", flags: flagSpecToHelp(READ_FLAGS) },
  { name: "rg", description: "Search with ripgrep.", flags: flagSpecToHelp(RG_FLAGS) },
];

export const BATCH_READ_HELP = renderHelp(
  "batch_read",
  "Read-only file and ripgrep tool. Does not execute shell commands, write to files, or fetch URLs.",
  subcommands,
);

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const RECOGNIZED_SUBS = new Set(["read", "rg"]);

async function dispatch(
  subcommand: string,
  parsed: { flags: Record<string, unknown>; positionals: string[] },
  cwd: string,
  signal?: AbortSignal,
): Promise<{ output: string; results: import("../batch/constants.js").OpResult[]; error?: string; failed: boolean }> {
  switch (subcommand) {
    case "read": {
      return runReadSubcommand(parsed, cwd, signal, "batch_read");
    }
    case "rg": {
      return runRgSubcommand(parsed, cwd, signal, "batch_read");
    }
    default: {
      throw new CliError(
        `Unknown subcommand: ${subcommand}`,
        `Did you mean: read, rg? Run with --help for usage.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function runBatchReadCli(
  cmd: string,
  cwd?: string,
  signal?: AbortSignal,
): Promise<{ text: string; results: import("../batch/constants.js").OpResult[]; hasError: boolean }> {
  return runChain(cmd, cwd ?? process.cwd(), signal, {
    toolPrefix: "batch_read",
    recognizedSubs: RECOGNIZED_SUBS,
    getFlagSpec: (subcommand) => (subcommand === "rg" ? RG_FLAGS : READ_FLAGS),
    dispatch,
    helpText: BATCH_READ_HELP,
    validSubcommandsTip: "read, rg",
  });
}

/**
 * ask_user — bash-style CLI tool.
 *
 * Replaces the legacy ask_user JSON schema with a simple cmd string
 * that uses a positional question and repeatable option flags.
 */

import { Type } from "@sinclair/typebox";
import { tokenize } from "./tokenize.js";
import { parseCommand, CliError } from "./parse.js";
import type { QuestionOption } from "../tui/single-select-layout.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const AskUserCliParams = Type.Object({
  cmd: Type.String({
    description: "ask_user command string, e.g. 'ask_user \"Continue?\" -o Yes -o No' or 'ask_user help'",
  }),
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ASK_USER_CLI_DESCRIPTION =
  "Ask the user a focused question with multiple-choice answers. Bash-style CLI: pass a single cmd string with a quoted question and repeatable -o flags. NOT a shell. Examples: `ask_user \"Continue?\" -o Yes -o No`. Pass `cmd: \"help\"` for the man page.";

export const ASK_USER_CLI_SNIPPET =
  "Ask the user a focused question with multiple-choice answers";

export const ASK_USER_CLI_GUIDELINES = [
  "Use `ask_user` when the user's intent is ambiguous, when a decision requires explicit user input, or when multiple valid options exist.",
  "Ask exactly one focused question per `ask_user` call.",
  "Do not combine multiple numbered, multipart, or unrelated questions into one `ask_user` prompt.",
  "Pass options with `-o \"Title\"` or `-o \"Title: description\"`.",
  "Pass `cmd: \"help\"` or `--help` for the man page.",
];

// ---------------------------------------------------------------------------
// Flag spec
// ---------------------------------------------------------------------------

export const ASK_USER_FLAG_SPEC = {
  option: { short: "o", type: "string" as const, description: "Option title and optional description (title:description)", multi: true },
  help: { short: "h", type: "boolean" as const, description: "Show help text" },
};

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

export const ASK_USER_HELP = `USAGE: ask_user <question> -o <title[:description]>...

Ask the user a focused question with multiple-choice answers.

FLAGS:
  -o, --option <title[:description]>  A choice option. Repeatable.
  -h, --help                           Show this help text.

EXAMPLES:
  ask_user "Continue?" -o Yes -o No
  ask_user "Pick a database" -o "PostgreSQL:Robust relational" -o "SQLite:Simple file-based"
  ask_user "Ship it?" -o "Yes: build & publish" -o "No: pause" -o "Cancel: abandon"
`;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export async function parseAskUserCmd(cmd: string): Promise<{ help?: string; parsed?: { question: string; options: QuestionOption[] } }> {
  return parseAskUserCmdSync(cmd);
}

// ---------------------------------------------------------------------------
// Synchronous parser for render and execute use
// ---------------------------------------------------------------------------

export function parseAskUserCmdSync(cmd: string): { help?: string; parsed?: { question: string; options: QuestionOption[] } } {
  const trimmed = cmd.trim();

  if (trimmed.length === 0) {
    return { help: ASK_USER_HELP };
  }

  const tokens = tokenize(trimmed);

  // Strip leading "ask_user" token if present
  if (tokens[0] === "ask_user") {
    tokens.shift();
  }

  // Help check after stripping prefix
  if (
    tokens[0] === "help" ||
    tokens[0] === "--help" ||
    tokens[0] === "-h"
  ) {
    return { help: ASK_USER_HELP };
  }

  // Prepend dummy subcommand so parseCommand doesn't consume the question as a subcommand
  const tokensForParse = ["ask_user", ...tokens];

  const parsed = parseCommand(tokensForParse, ASK_USER_FLAG_SPEC);

  if (parsed.flags.help === true) {
    return { help: ASK_USER_HELP };
  }

  const question = parsed.positionals[0];
  if (!question) {
    throw new CliError("Missing required argument: <question>", "Usage: ask_user <question> -o <title[:description]>...");
  }

  if (parsed.positionals.length > 1) {
    throw new CliError("Unexpected extra arguments", "Usage: ask_user <question> -o <title[:description]>...");
  }

  const rawOptions = parsed.flags.option;
  if (!rawOptions || (Array.isArray(rawOptions) && rawOptions.length === 0)) {
    throw new CliError("Missing required flag: -o (--option)", "Usage: ask_user <question> -o <title[:description]>...");
  }

  const optionsArray = Array.isArray(rawOptions) ? rawOptions : [rawOptions];
  const options: QuestionOption[] = [];

  for (const opt of optionsArray) {
    const str = String(opt);
    if (str.trim().length === 0) {
      throw new CliError("Empty option value", "Each -o flag must have a non-empty title.");
    }
    const colonIdx = str.indexOf(":");
    if (colonIdx === -1) {
      options.push({ title: str, description: str });
    } else {
      const title = str.slice(0, colonIdx);
      const description = str.slice(colonIdx + 1);
      if (title.trim().length === 0) {
        throw new CliError("Empty option title", "Each -o flag must have a non-empty title.");
      }
      options.push({ title, description });
    }
  }

  return { parsed: { question, options } };
}

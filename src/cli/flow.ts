/**
 * flow — bash-style CLI tool.
 *
 * Replaces the legacy flow mega-schema with a simple cmd string
 * that uses flags and chaining.
 */

import { Type } from "@sinclair/typebox";
import { splitOnDoubleDash } from "./chain.js";
import { parseCommand, CliError } from "./parse.js";
import { renderHelp, flagSpecToHelp, type SubcommandHelp } from "./help.js";
import { runChain } from "./runner.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const FlowCliParams = Type.Object({
  cmd: Type.String({
    description: "Flow command. Multiple items chained with `;` or `&&`. Each item: --type --intent --aim --concern [--acceptance] [--cwd] [--complexity] [-- <batch-dispatch>]. Global: --confirm, --audit <n> (first item only). Run with `cmd: 'help'` for the man page.",
  }),
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const FLOW_CLI_DESCRIPTION =
  "Spawns specialized agent flows — NOT a shell. Required per item: `--type` (one of: `scout` • `build` • `debug` • `audit` • `craft` • `ideas` • `trace`), `--intent`, `--aim`, `--concern`. Optional: `--acceptance`, `--cwd`, `--complexity` (`snap` • `simple` • `moderate` • `complex` • `intricate`). Chain multiple items with `;` or `&&`. For simple reads/checks, use `trace` instead. Pass [cmd]: \"help\" for the man page.";

export const FLOW_CLI_SNIPPET =
  "Dive into specialized flows (scout, debug, build, craft, audit, ideas) via bash-style CLI.";

export const FLOW_CLI_GUIDELINES = [
  "**This is a structured command, NOT a shell.** There is no `ls`, `cd`, `git`, or arbitrary command. Use only the documented flags.",
  "Use `flow --type <name> --intent <text> --aim <text> --concern <text>` to spawn a flow.",
  "Chain multiple flows with `;` (sequential) or `&&` (conditional).",
  "Add `--acceptance <text>` for success criteria.",
  "Add `--complexity <level>` for budget: snap, simple, moderate, complex, intricate.",
  "Add `-- <batch-dispatch>` for pre-flight ops (e.g., `-- batch read src/auth.ts`).",
  "For quick file reads/checks, use `trace` instead.",
  "Pass `cmd: \"help\"` or `--help` for the man page.",
];

const VALID_TYPES = new Set([
  "scout", "build", "debug", "audit", "craft", "ideas", "trace",
]);

const VALID_COMPLEXITIES = new Set([
  "snap", "simple", "moderate", "complex", "intricate",
]);

// ---------------------------------------------------------------------------
// Flag specs
// ---------------------------------------------------------------------------

const GLOBAL_FLAG_SPEC = {
  confirm: { short: "y", type: "string" as const, description: "Prompt before running project flows" },
  audit: { short: "u", type: "number" as const, description: "Override audit cycles (0-3)" },
  help: { short: "h", type: "boolean" as const, description: "Show help text" },
};

const ITEM_FLAG_SPEC = {
  type: { short: "t", type: "string" as const, description: "Flow type" },
  intent: { short: "i", type: "string" as const, description: "Mission" },
  aim: { short: "a", type: "string" as const, description: "Headline" },
  concern: { short: "c", type: "string" as const, description: "Risks" },
  acceptance: { short: "A", type: "string" as const, description: "Acceptance criteria" },
  cwd: { short: "w", type: "string" as const, description: "Working dir" },
  complexity: { short: "x", type: "string" as const, description: "Budget level" },
  help: { short: "h", type: "boolean" as const, description: "Show help text" },
};

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

const subcommands: SubcommandHelp[] = [
  {
    name: "flow",
    description: "Spawn a specialized agent flow.",
    flags: flagSpecToHelp(ITEM_FLAG_SPEC),
  },
  {
    name: "global",
    description: "Global flags (first chain link only)",
    flags: flagSpecToHelp(GLOBAL_FLAG_SPEC),
  },
];

const FLOW_HELP = renderHelp("flow", "Spawns specialized agent flows.", subcommands);

export { FLOW_HELP };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedFlowItem {
  type: string;
  intent: string;
  aim: string;
  concern: string;
  acceptance?: string;
  cwd?: string;
  complexity?: string;
  dispatch?: string;
  kind?: "run" | "and";
}

export interface ParsedFlowCmd {
  confirm: boolean;
  audit: number;
  items: ParsedFlowItem[];
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export async function parseFlowCmd(cmd: string): Promise<{ help?: string; parsed?: ParsedFlowCmd }> {
  const trimmed = cmd.trim();

  if (trimmed.length === 0 || trimmed === "help" || trimmed === "--help" || trimmed === "-h" || trimmed === "flow help" || trimmed === "flow --help" || trimmed === "flow -h") {
    return { help: FLOW_HELP };
  }

  // Remove leading "flow" keyword if present (the model may include it)
  let working = trimmed;
  if (working.startsWith("flow ")) {
    working = working.slice(5);
  }

  let confirm = true;
  let audit = 0;
  const items: ParsedFlowItem[] = [];
  let isFirstLink = true;
  let helpTriggered = false;

  const result = await runChain(working, "", undefined, {
    toolPrefix: "flow",
    recognizedSubs: new Set(["flow"]),
    fixedSubcommand: "flow",
    getFlagSpec: () => {
      if (isFirstLink) {
        return { ...GLOBAL_FLAG_SPEC, ...ITEM_FLAG_SPEC };
      }
      return ITEM_FLAG_SPEC;
    },
    dispatch: async (subcommand, parsed, cwd, signal, extra) => {
      if (parsed.flags.help === true) {
        helpTriggered = true;
        return { output: FLOW_HELP, results: [], failed: false };
      }

      if (isFirstLink) {
        if (parsed.flags.confirm !== undefined) {
          confirm = parsed.flags.confirm === "true" || parsed.flags.confirm === true;
        }
        if (parsed.flags.audit !== undefined) {
          audit = parsed.flags.audit as number;
        }
        isFirstLink = false;
      }

      const { dispatch, kind } = extra as { dispatch: string; kind: "run" | "and" };
      items.push(extractItem(parsed, dispatch, kind));
      return { output: "", results: [], failed: false };
    },
    helpText: FLOW_HELP,
    validSubcommandsTip: "flow",
    preprocessLink: (link) => {
      const { pre, post } = splitOnDoubleDash(link.cmd);
      return { cmd: pre, extra: { dispatch: post, kind: link.kind } };
    },
  });

  if (helpTriggered || result.text === FLOW_HELP) {
    return { help: FLOW_HELP };
  }

  if (result.errors.length > 0) {
    const first = result.errors[0];
    throw new CliError(first.message, first.hint);
  }

  if (items.length === 0) {
    throw new CliError("No flow items found. At least one --type is required.", "Run with --help for usage.");
  }

  return { parsed: { confirm, audit, items } };
}

function extractItem(parsed: ReturnType<typeof parseCommand>, dispatch: string, kind?: "run" | "and"): ParsedFlowItem {
  const type = parsed.flags.type as string | undefined;
  const intent = parsed.flags.intent as string | undefined;
  const aim = parsed.flags.aim as string | undefined;
  const concern = parsed.flags.concern as string | undefined;
  const acceptance = parsed.flags.acceptance as string | undefined;
  const cwd = parsed.flags.cwd as string | undefined;
  const complexity = parsed.flags.complexity as string | undefined;

  if (!type) {
    throw new CliError("Missing required flag: --type", `Valid types: ${Array.from(VALID_TYPES).join(", ")}`);
  }
  if (!VALID_TYPES.has(type.toLowerCase())) {
    throw new CliError(
      `Invalid flow type: ${type}`,
      `Valid types: ${Array.from(VALID_TYPES).join(", ")}`,
    );
  }
  if (!intent) {
    throw new CliError("Missing required flag: --intent");
  }
  if (!aim) {
    throw new CliError("Missing required flag: --aim");
  }
  if (!concern) {
    throw new CliError("Missing required flag: --concern");
  }
  if (complexity && !VALID_COMPLEXITIES.has(complexity.toLowerCase())) {
    throw new CliError(
      `Invalid complexity: ${complexity}`,
      `Valid complexities: ${Array.from(VALID_COMPLEXITIES).join(", ")}`,
    );
  }

  const item: ParsedFlowItem = {
    type: type.toLowerCase(),
    intent,
    aim,
    concern,
  };
  if (acceptance) item.acceptance = acceptance;
  if (cwd) item.cwd = cwd;
  if (complexity) item.complexity = complexity.toLowerCase();
  if (dispatch) item.dispatch = dispatch;
  if (kind) item.kind = kind;

  return item;
}

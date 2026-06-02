/**
 * flow — bash-style CLI tool.
 *
 * Replaces the legacy flow mega-schema with a simple cmd string
 * that uses flags and chaining.
 */

import { Type } from "@sinclair/typebox";
import { tokenize } from "./tokenize.js";
import { splitChain, splitOnDoubleDash } from "./chain.js";
import { parseCommand, CliError } from "./parse.js";
import { renderHelp, type SubcommandHelp } from "./help.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const FlowCliParams = Type.Object({
  cmd: Type.String({
    description: "Flow command. Multiple items chained with `;` or `&&`. Each item: --type --intent --aim --concern [--acceptance] [--cwd] [--complexity] [-- <batch-dispatch>]. Global: --confirm <bool>, --audit <n> (first item only). Run with `cmd: 'help'` for the man page.",
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

const ITEM_FLAG_SPEC = {
  type: { short: "t", type: "string" as const, description: "Flow type" },
  intent: { short: "i", type: "string" as const, description: "Mission" },
  aim: { short: "a", type: "string" as const, description: "Headline" },
  concern: { short: "c", type: "string" as const, description: "Risks" },
  acceptance: { type: "string" as const, description: "Acceptance criteria" },
  cwd: { type: "string" as const, description: "Working dir" },
  complexity: { type: "string" as const, description: "Budget level" },
};

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

const subcommands: SubcommandHelp[] = [
  {
    name: "flow",
    description: "Spawn a specialized agent flow.",
    flags: {
      type: { short: "t", type: "string", description: "Flow type (scout|build|debug|audit|craft|ideas|trace)" },
      intent: { short: "i", type: "string", description: "Detailed mission" },
      aim: { short: "a", type: "string", description: "Short headline (5-7 words)" },
      concern: { short: "c", type: "string", description: "Known risks" },
      acceptance: { type: "string", description: "Success criteria" },
      cwd: { type: "string", description: "Working directory override" },
      complexity: { type: "string", description: "Budget: snap|simple|moderate|complex|intricate" },
    },
  },
];

const GLOBAL_HELP = {
  name: "global",
  description: "Global flags (first chain link only)",
  flags: {
    confirm: { type: "boolean", description: "Prompt before running project flows. Default: true." },
    audit: { type: "number", description: "Override audit cycles (0-3). Default: 0." },
  },
};

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

export function parseFlowCmd(cmd: string): { help?: string; parsed?: ParsedFlowCmd } {
  const trimmed = cmd.trim();

  if (trimmed.length === 0 || trimmed === "help" || trimmed === "--help" || trimmed === "-h" || trimmed === "flow help" || trimmed === "flow --help" || trimmed === "flow -h") {
    return { help: FLOW_HELP };
  }

  // Remove leading "flow" keyword if present (the model may include it)
  let working = trimmed;
  if (working.startsWith("flow ")) {
    working = working.slice(5);
  }

  // Chain splitting: splitChain handles quotes/escapes and ;/&&,
  // then splitOnDoubleDash separates pre (flags) from post (dispatch) per link.
  const chain = splitChain(working);
  const links = chain.map(link => {
    const { pre, post } = splitOnDoubleDash(link.cmd);
    return { kind: link.kind, pre, post };
  });

  if (links.length === 0) {
    return { help: FLOW_HELP };
  }

  let confirm = true;
  let audit = 0;
  const items: ParsedFlowItem[] = [];

  for (let linkIdx = 0; linkIdx < links.length; linkIdx++) {
    const link = links[linkIdx];
    const pre = link.pre;
    const post = link.post;
    const tokens = tokenize(pre);

    // Remove leading "flow" if present in this fragment
    if (tokens[0] === "flow") {
      tokens.shift();
    }

    if (tokens.length === 0) {
      continue;
    }

    // Prepend a dummy subcommand if the first token is a flag so parseCommand
    // doesn't consume the real flag as the subcommand.
    const tokensForParse = tokens.length > 0 && tokens[0].startsWith("-")
      ? ["flow", ...tokens]
      : tokens.length > 0 ? tokens : ["flow"];

    if (linkIdx === 0) {
      // Parse first link with combined spec (global + item flags).
      const combinedSpec = {
        confirm: { type: "string" as const, description: "Prompt before running project flows" },
        audit: { type: "number" as const, description: "Override audit cycles (0-3)" },
        ...ITEM_FLAG_SPEC,
      };
      const parsed = parseCommand(tokensForParse, combinedSpec);
      if (parsed.flags.confirm !== undefined) {
        confirm = parsed.flags.confirm === "true";
      }
      if (parsed.flags.audit !== undefined) {
        audit = parsed.flags.audit as number;
      }
      items.push(extractItem(parsed, post, link.kind));
    } else {
      // Detect global flags on non-first links and throw a clear error
      for (const tok of tokens) {
        if (tok === "--confirm" || tok === "--audit") {
          throw new CliError(
            `Global flag ${tok} is not allowed on subsequent chain links.`,
            "Put --confirm and --audit on the first flow item only."
          );
        }
        if (tok.startsWith("--confirm=") || tok.startsWith("--audit=")) {
          throw new CliError(
            `Global flag ${tok.split("=")[0]} is not allowed on subsequent chain links.`,
            "Put --confirm and --audit on the first flow item only."
          );
        }
      }
      const parsed = parseCommand(tokensForParse, ITEM_FLAG_SPEC);
      items.push(extractItem(parsed, post, link.kind));
    }
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

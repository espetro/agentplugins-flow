/**
 * Generic chain execution helper for bash-style CLI tools.
 */

import { tokenize } from "./tokenize.js";
import { splitChain, type ChainOp } from "./chain.js";
import { parseCommand, CliError, type FlagSpec, type ParsedCommand } from "./parse.js";
import { formatChainedOutput, type ChainedOp } from "./format.js";
import type { ExecResult } from "./exec/util.js";
import type { OpResult } from "../batch/constants.js";

export interface ChainConfig {
  toolPrefix: string;
  recognizedSubs: Set<string>;
  getFlagSpec: (subcommand: string) => FlagSpec;
  dispatch: (subcommand: string, parsed: ParsedCommand, cwd: string, signal?: AbortSignal, extra?: unknown) => Promise<ExecResult>;
  helpText: string;
  validSubcommandsTip: string;
  preprocessLink?: (link: ChainOp) => { cmd: string; extra?: unknown };
  fixedSubcommand?: string;
}

export async function runChain(
  cmd: string,
  cwd: string,
  signal: AbortSignal | undefined,
  config: ChainConfig,
): Promise<{ text: string; results: OpResult[]; hasError: boolean; errors: Array<{ message: string; hint?: string }> }> {
  const trimmed = cmd.trim();
  if (trimmed.length === 0) {
    return { text: config.helpText, results: [], hasError: false, errors: [] };
  }

  const chain = splitChain(trimmed);
  const ops: ChainedOp[] = [];
  let previousFailed = false;
  const allResults: OpResult[] = [];
  const errors: Array<{ message: string; hint?: string }> = [];

  for (const link of chain) {
    if (link.kind === "and" && previousFailed) {
      ops.push({ cmd: link.cmd, output: "", skipped: true });
      continue;
    }

    let output = "";
    let failed = false;
    let error: string | undefined;
    let linkExtra: unknown = undefined;

    try {
      const processed = config.preprocessLink ? config.preprocessLink(link) : { cmd: link.cmd };
      linkExtra = processed.extra;
      const tokens = tokenize(processed.cmd);
      // Remove leading tool keyword if present (the model may include it)
      if (tokens[0] === config.toolPrefix) {
        tokens.shift();
      }

      if (tokens.length === 0) {
        output = config.helpText;
      } else {
        const subcommand = config.fixedSubcommand ?? tokens[0];
        if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
          output = config.helpText;
        } else {
          let parsed: ParsedCommand;
          const shouldParse = config.fixedSubcommand || config.recognizedSubs.has(subcommand);
          if (!shouldParse) {
            // Defer to dispatch's default branch for a clear "Unknown subcommand" error.
            parsed = { subcommand, flags: {}, positionals: tokens.slice(1) };
          } else {
            const flagSpec = config.getFlagSpec(subcommand);
            const tokensToParse = config.fixedSubcommand ? [subcommand, ...tokens] : tokens;
            try {
              parsed = parseCommand(tokensToParse, flagSpec);
            } catch (err) {
              if (err instanceof CliError && err.message.startsWith("Unknown flag")) {
                const validFlags = Object.keys(flagSpec).map((n) => `--${n}`).join(", ");
                throw new CliError(
                  err.message,
                  `\`${subcommand}\` supports: ${validFlags}. Run [cmd]: "help" for the man page.`,
                );
              }
              throw err;
            }
          }

          if (parsed.flags.help === true) {
            output = config.helpText;
          } else {
            const result = await config.dispatch(parsed.subcommand, parsed, cwd, signal, linkExtra);
            output = result.output;
            allResults.push(...result.results);
            if (result.failed) {
              failed = true;
              error = `${result.error ?? "operation failed"}\nTIP: This is not a shell. Valid subcommands: ${config.validSubcommandsTip}. Run [cmd]: "help" for the man page.`;
            }
          }
        }
      }
    } catch (err) {
      failed = true;
      if (err instanceof CliError) {
        const baseError = err.hint ? `${err.message} (hint: ${err.hint})` : err.message;
        error = `${baseError}\nTIP: This is not a shell. Valid subcommands: ${config.validSubcommandsTip}. Run [cmd]: "help" for the man page.`;
        errors.push({ message: err.message, hint: err.hint });
      } else {
        error = `internal error: ${err instanceof Error ? err.message : String(err)}`;
        errors.push({ message: err instanceof Error ? err.message : String(err) });
      }
    }

    ops.push({ cmd: link.cmd, output, error, failed, skipped: false });
    if (failed) {
      previousFailed = true;
    } else {
      previousFailed = false;
    }
  }

  const hasError = ops.some((op) => op.error !== undefined || op.skipped || op.failed) || errors.length > 0;
  return { text: formatChainedOutput(ops), results: allResults, hasError, errors };
}

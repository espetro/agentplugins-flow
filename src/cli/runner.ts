/**
 * Generic chain execution helper for bash-style CLI tools.
 */

import { tokenize } from "./tokenize.js";
import { splitChain } from "./chain.js";
import { parseCommand, CliError, type FlagSpec, type ParsedCommand } from "./parse.js";
import { formatChainedOutput, type ChainedOp } from "./format.js";
import type { ExecResult } from "./exec/util.js";
import type { OpResult } from "../batch/constants.js";

export interface ChainConfig {
  toolPrefix: string;
  recognizedSubs: Set<string>;
  getFlagSpec: (subcommand: string) => FlagSpec;
  dispatch: (subcommand: string, parsed: ParsedCommand, cwd: string, signal?: AbortSignal) => Promise<ExecResult>;
  helpText: string;
  validSubcommandsTip: string;
}

export async function runChain(
  cmd: string,
  cwd: string,
  signal: AbortSignal | undefined,
  config: ChainConfig,
): Promise<{ text: string; results: OpResult[]; hasError: boolean }> {
  const trimmed = cmd.trim();
  if (trimmed.length === 0) {
    return { text: config.helpText, results: [], hasError: false };
  }

  const chain = splitChain(trimmed);
  const ops: ChainedOp[] = [];
  let previousFailed = false;
  const allResults: OpResult[] = [];

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
      // Remove leading tool keyword if present (the model may include it)
      if (tokens[0] === config.toolPrefix) {
        tokens.shift();
      }

      if (tokens.length === 0) {
        output = config.helpText;
      } else {
        const subcommand = tokens[0];
        if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
          output = config.helpText;
        } else {
          let parsed: ParsedCommand;
          if (!config.recognizedSubs.has(subcommand)) {
            // Defer to dispatch's default branch for a clear "Unknown subcommand" error.
            parsed = { subcommand, flags: {}, positionals: tokens.slice(1) };
          } else {
            const flagSpec = config.getFlagSpec(subcommand);
            try {
              parsed = parseCommand(tokens, flagSpec);
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

          const result = await config.dispatch(parsed.subcommand, parsed, cwd, signal);
          output = result.output;
          allResults.push(...result.results);
          if (result.failed) {
            failed = true;
            error = `${result.error ?? "operation failed"}\nTIP: This is not a shell. Valid subcommands: ${config.validSubcommandsTip}. Run [cmd]: "help" for the man page.`;
          }
        }
      }
    } catch (err) {
      failed = true;
      if (err instanceof CliError) {
        const baseError = err.hint ? `${err.message} (hint: ${err.hint})` : err.message;
        error = `${baseError}\nTIP: This is not a shell. Valid subcommands: ${config.validSubcommandsTip}. Run [cmd]: "help" for the man page.`;
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

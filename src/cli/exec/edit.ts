import { executeOperations } from "../../batch/execute.js";
import type { FileOpInput, EditReplacement } from "../../batch/constants.js";
import { CliError } from "../parse.js";
import { finalizeExec, type ExecResult } from "./util.js";

export async function runEditSubcommand(
  parsed: { flags: Record<string, unknown>; positionals: string[] },
  cwd: string,
  signal?: AbortSignal,
): Promise<ExecResult> {
  if (parsed.positionals.length === 0) {
    throw new CliError("edit requires at least one path.", "Usage: batch edit [flags] <path> ...");
  }

  const find = parsed.flags.find;
  const replace = parsed.flags.replace;
  const findArray = Array.isArray(find) ? find : find !== undefined ? [find] : [];
  const replaceArray = Array.isArray(replace) ? replace : replace !== undefined ? [replace] : [];

  if (findArray.length === 0) {
    throw new CliError("edit requires at least one --find <text>.", "Usage: batch edit -f <oldText> -r <newText> <path>");
  }

  if (findArray.length !== replaceArray.length) {
    throw new CliError(
      `Mismatched edit pairs: ${findArray.length} --find flag(s) but ${replaceArray.length} --replace flag(s).`,
      "Provide the same number of --find and --replace flags."
    );
  }

  const edits: EditReplacement[] = [];
  for (let i = 0; i < findArray.length; i++) {
    edits.push({ f: String(findArray[i]), r: String(replaceArray[i]) });
  }

  const append = parsed.flags.append === true;
  const allOccurrences = parsed.flags["all-occurrences"] === true;

  const ops: FileOpInput[] = parsed.positionals.map((path) => {
    const op: FileOpInput = {
      o: "edit",
      p: path,
      e: edits,
    };
    if (append) {
      op.append = true;
    }
    if (allOccurrences) {
      op.allOccurrences = true;
    }
    return op;
  });

  const { contentText, results } = await executeOperations(
    ops,
    cwd,
    signal,
    {
      readOptions: { truncate: false, toolName: "batch" },
      includeLimitWarnings: false,
    },
  );

  return finalizeExec(contentText, results);
}

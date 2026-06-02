import { executeOperations } from "../../batch/execute.js";
import type { FileOpInput } from "../../batch/constants.js";
import { CliError } from "../parse.js";
import { finalizeExec, type ExecResult } from "./util.js";

export async function runDeleteSubcommand(
  parsed: { flags: Record<string, unknown>; positionals: string[] },
  cwd: string,
  signal?: AbortSignal,
): Promise<ExecResult> {
  if (parsed.positionals.length === 0) {
    throw new CliError("delete requires at least one path.", "Usage: batch delete <path> ...");
  }

  const ops: FileOpInput[] = parsed.positionals.map((path) => ({
    o: "delete",
    p: path,
  }));

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

import { executeOperations } from "../../batch/execute.js";
import type { FileOpInput } from "../../batch/constants.js";
import { CliError } from "../parse.js";
import { finalizeExec, type ExecResult } from "./util.js";

export async function runWriteSubcommand(
  parsed: { flags: Record<string, unknown>; positionals: string[] },
  cwd: string,
  signal?: AbortSignal,
): Promise<ExecResult> {
  if (parsed.positionals.length === 0) {
    throw new CliError("write requires at least one path.", "Usage: batch write [flags] <path> ...");
  }

  const content = typeof parsed.flags.content === "string" ? parsed.flags.content : undefined;
  if (content === undefined) {
    throw new CliError("write requires --content <text>.", "Usage: batch write -c <content> <path>");
  }

  const ops: FileOpInput[] = parsed.positionals.map((path) => ({
    o: "write",
    p: path,
    c: content,
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

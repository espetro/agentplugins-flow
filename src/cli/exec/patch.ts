import { executeOperations } from "../../batch/execute.js";
import type { FileOpInput } from "../../batch/constants.js";
import { CliError } from "../parse.js";

export async function runPatchSubcommand(
  parsed: { flags: Record<string, unknown>; positionals: string[] },
  cwd: string,
  signal?: AbortSignal,
): Promise<{ output: string; results: import("../../batch/constants.js").OpResult[]; error?: string; failed: boolean }> {
  const content = typeof parsed.flags.content === "string" ? parsed.flags.content : undefined;
  if (content === undefined) {
    throw new CliError("patch requires --content <patch text>.", "Usage: batch patch -c <patch_text>");
  }

  const ops: FileOpInput[] = [{
    o: "patch",
    p: "patch",
    c: content,
  }];

  const { contentText, results } = await executeOperations(
    ops,
    cwd,
    signal,
    {
      readOptions: { truncate: false, toolName: "batch" },
      includeLimitWarnings: false,
    },
  );

  const failed = results.some((r) => r.status === "error");
  const error = failed
    ? (results.find((r) => r.status === "error")?.error ?? "operation failed")
    : undefined;
  return { output: contentText, results, error, failed };
}

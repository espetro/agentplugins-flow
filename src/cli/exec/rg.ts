import { executeOperations } from "../../batch/execute.js";
import type { RgOpInput } from "../../batch/constants.js";
import { CliError } from "../parse.js";

export async function runRgSubcommand(
  parsed: { flags: Record<string, unknown>; positionals: string[] },
  cwd: string,
  signal?: AbortSignal,
  toolName: "batch" | "batch_read" = "batch",
): Promise<{ output: string; results: import("../../batch/constants.js").OpResult[]; error?: string; failed: boolean }> {
  const query = typeof parsed.flags.query === "string" ? parsed.flags.query : undefined;
  if (!query) {
    throw new CliError("rg requires -q <pattern>.", "Usage: batch rg -q <pattern> [flags] <path>");
  }

  if (parsed.positionals.length === 0) {
    throw new CliError("rg requires a search path.", "Usage: batch rg -q <pattern> [flags] <path>");
  }
  const searchPath = parsed.positionals[0];

  const op: RgOpInput = {
    o: "rg",
    p: searchPath,
    q: query,
    ...(parsed.flags["ignore-case"] === true ? { i: true } : {}),
    ...(parsed.flags["files-only"] === true ? { l: true } : {}),
    ...(typeof parsed.flags.type === "string" ? { t: parsed.flags.type } : {}),
    ...(typeof parsed.flags["max-count"] === "number" ? { n: parsed.flags["max-count"] } : {}),
    ...(typeof parsed.flags["ignore-level"] === "number" ? { u: parsed.flags["ignore-level"] } : {}),
  };

  const { contentText, results } = await executeOperations(
    [op],
    cwd,
    signal,
    {
      readOptions: { truncate: false, toolName },
      includeLimitWarnings: false,
    },
  );

  const failed = results.some((r) => r.status === "error");
  const error = failed
    ? (results.find((r) => r.status === "error")?.error ?? "operation failed")
    : undefined;
  return { output: contentText, results, error, failed };
}

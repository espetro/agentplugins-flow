import { executeOperations } from "../../batch/execute.js";
import type { FileOpInput } from "../../batch/constants.js";
import { CliError } from "../parse.js";

export async function runRgSubcommand(
  parsed: { flags: Record<string, unknown>; positionals: string[] },
  cwd: string,
  signal?: AbortSignal,
): Promise<{ output: string; results: import("../../batch/constants.js").OpResult[]; error?: string; failed: boolean }> {
  const query = typeof parsed.flags.query === "string" ? parsed.flags.query : undefined;
  if (!query) {
    throw new CliError("rg requires -q <pattern>.", "Usage: batch rg -q <pattern> [flags] <path>");
  }

  if (parsed.positionals.length === 0) {
    throw new CliError("rg requires a search path.", "Usage: batch rg -q <pattern> [flags] <path>");
  }
  const searchPath = parsed.positionals[0];

  const op = {
    o: "rg" as const,
    p: searchPath,
    q: query,
    i: parsed.flags["ignore-case"] === true ? true : undefined,
    l: parsed.flags["files-only"] === true ? true : undefined,
    t: typeof parsed.flags.type === "string" ? parsed.flags.type : undefined,
    n: typeof parsed.flags["max-count"] === "number" ? parsed.flags["max-count"] : undefined,
    u: typeof parsed.flags["ignore-level"] === "number" ? parsed.flags["ignore-level"] : undefined,
  } as unknown as FileOpInput;

  const { contentText, results } = await executeOperations(
    [op],
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

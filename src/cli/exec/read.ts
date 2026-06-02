import { executeOperations } from "../../batch/execute.js";
import type { FileOpInput } from "../../batch/constants.js";
import { CliError } from "../parse.js";

export async function runReadSubcommand(
  parsed: { flags: Record<string, unknown>; positionals: string[] },
  cwd: string,
  signal?: AbortSignal,
  toolName: "batch" | "batch_read" = "batch",
): Promise<{ output: string; results: import("../../batch/constants.js").OpResult[]; error?: string; failed: boolean }> {
  if (parsed.positionals.length === 0) {
    throw new CliError("read requires at least one path.", "Usage: batch read [flags] <path> ...");
  }

  const flagStart = typeof parsed.flags.start === "number" ? parsed.flags.start : undefined;
  const flagLimit = typeof parsed.flags.limit === "number" ? parsed.flags.limit : undefined;
  const flagEnd = typeof parsed.flags.end === "number" ? parsed.flags.end : undefined;

  const ops: FileOpInput[] = [];
  for (const spec of parsed.positionals) {
    const { path, start, end } = parsePathSpec(spec);
    const effectiveStart = start ?? flagStart;
    let effectiveLimit: number | undefined;
    if (end !== undefined && effectiveStart !== undefined) {
      effectiveLimit = end - effectiveStart + 1;
    } else if (end !== undefined) {
      effectiveLimit = end;
    } else {
      effectiveLimit = flagLimit;
    }
    if (flagEnd !== undefined && effectiveStart !== undefined && effectiveLimit === undefined) {
      effectiveLimit = flagEnd - effectiveStart + 1;
    }

    ops.push({
      o: "read",
      p: path,
      s: effectiveStart,
      l: effectiveLimit,
    });
  }

  const { contentText, results } = await executeOperations(
    ops,
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

export function parsePathSpec(spec: string): { path: string; start?: number; end?: number } {
  const match = spec.match(/^(.*):(\d+)(?:-(\d+))?$/);
  if (match) {
    const pathPart = match[1];
    const start = parseInt(match[2], 10);
    const end = match[3] ? parseInt(match[3], 10) : undefined;
    return { path: pathPart, start, end };
  }
  return { path: spec };
}

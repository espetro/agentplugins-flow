import type { OpResult } from "../../batch/constants.js";

export interface ExecResult {
  output: string;
  results: OpResult[];
  error?: string;
  failed: boolean;
}

export function finalizeExec(output: string, results: OpResult[]): ExecResult {
  const failed = results.some((r) => r.status === "error");
  const error = failed
    ? (results.find((r) => r.status === "error")?.error ?? "operation failed")
    : undefined;
  return { output, results, error, failed };
}

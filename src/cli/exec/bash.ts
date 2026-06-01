import { executeBatchBash, generateBashId } from "../../batch/batch-bash.js";
import type { BashProcessTracker } from "../../batch/batch-bash.js";
import { CliError } from "../parse.js";

export async function runBashSubcommand(
  parsed: { flags: Record<string, unknown>; positionals: string[] },
  cwd: string,
  bashTracker: BashProcessTracker | undefined,
  signal?: AbortSignal,
): Promise<{ output: string; results: import("../../batch/constants.js").OpResult[]; error?: string; failed: boolean }> {
  if (parsed.positionals.length === 0) {
    throw new CliError("bash requires a command string.", "Usage: batch bash [flags] <command>");
  }

  const command = parsed.positionals.join(" ");
  const id = typeof parsed.flags.id === "string" ? parsed.flags.id : generateBashId();
  const timeout = typeof parsed.flags.timeout === "number" ? parsed.flags.timeout : undefined;
  const workingDir = typeof parsed.flags.cwd === "string" ? parsed.flags.cwd : undefined;

  if (!bashTracker) {
    return {
      output: "Bash tracker not available.",
      results: [{
        op: "bash" as const,
        path: "bash",
        status: "error" as const,
        id,
        command,
        error: "Bash tracker not available.",
      }],
      error: "Bash tracker not available.",
      failed: true,
    };
  }

  const normalizedBashOps = [{
    i: id,
    c: command,
    t: timeout,
    h: workingDir,
  }];

  const bashOutput = await executeBatchBash(
    normalizedBashOps,
    cwd,
    bashTracker,
    signal,
  );

  const bashLines: string[] = [];
  const results: import("../../batch/constants.js").OpResult[] = bashOutput;
  for (const r of bashOutput) {
    if (r.status === "ok") {
      bashLines.push(`\n--- bash [${r.id}] exit ${r.exitCode} ---`);
      if (r.timingTier) bashLines.push(`[Execution time: ${r.timingTier}]`);
      if (r.stdout?.trim()) bashLines.push(r.stdout.trimEnd());
    } else if (r.status === "pending") {
      bashLines.push(`\n--- bash [${r.id}] pending ---`);
      if (r.stdout?.trim()) bashLines.push(`[partial output]\n${r.stdout.trimEnd()}`);
      bashLines.push(`[Use batch_bash_poll with i: ["${r.id}"] to check results]`);
    } else {
      bashLines.push(`\n--- bash [${r.id}] error ---`);
      if (r.timingTier) bashLines.push(`[Execution time: ${r.timingTier}]`);
      if (r.stdout?.trim()) bashLines.push(r.stdout.trimEnd());
      if (r.stderr?.trim()) bashLines.push(`[stderr]\n${r.stderr.trimEnd()}`);
    }
  }

  const output = bashLines.join("\n");
  const failed = bashOutput.some((r) => r.status === "error");
  return { output, results, failed };
}

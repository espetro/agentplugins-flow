import { pollBatchBashResults } from "../../batch/batch-bash.js";
import type { BashProcessTracker } from "../../batch/batch-bash.js";
import type { OpResult } from "../../batch/constants.js";
import { CliError } from "../parse.js";

export async function runPollSubcommand(
  parsed: { flags: Record<string, unknown>; positionals: string[] },
  _cwd: string,
  bashTracker: BashProcessTracker | undefined,
  _signal?: AbortSignal,
): Promise<{ output: string; results: OpResult[]; error?: string; failed: boolean }> {
  const id = parsed.flags.id;
  const idArray = Array.isArray(id) ? id : id !== undefined ? [id] : [];
  const ids = idArray.map(String);

  if (ids.length === 0) {
    throw new CliError("poll requires at least one --id <bash_id>.", "Usage: batch poll -i <id> [-i <id2> ...]");
  }

  if (!bashTracker) {
    return {
      output: "Bash tracker not available.",
      results: [{
        op: "bash" as const,
        path: "poll",
        status: "error" as const,
        error: "Bash tracker not available.",
      }],
      error: "Bash tracker not available.",
      failed: true,
    };
  }

  const pollResults = pollBatchBashResults(ids, bashTracker);
  const lines: string[] = [];
  const results: OpResult[] = [];

  for (const r of pollResults) {
    const opResult: OpResult = {
      op: "bash",
      status: r.status === "completed" ? "ok" : "pending",
      id: r.id,
      command: r.command,
      stdout: r.stdout,
      stderr: r.stderr,
      exitCode: r.exitCode,
    };
    results.push(opResult);

    if (r.status === "completed") {
      lines.push(`--- poll [${r.id}] completed ---`);
      if (r.stdout?.trim()) lines.push(r.stdout.trimEnd());
      if (r.stderr?.trim()) lines.push(`[stderr]\n${r.stderr.trimEnd()}`);
      lines.push(`exit code: ${r.exitCode ?? "unknown"}`);
    } else {
      lines.push(`--- poll [${r.id}] pending ---`);
      const tail = bashTracker.getRunningTail(r.id);
      if (tail) lines.push(`[last ${tail.split("\n").length} lines]\n${tail}`);
      const cmd = bashTracker.getRunningCommand(r.id);
      if (cmd) lines.push(`command: ${cmd}`);
    }
  }

  const output = lines.join("\n");
  const failed = false;
  return { output, results, failed };
}

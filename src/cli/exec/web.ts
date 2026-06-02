import { runWebSearch, runWebFetch } from "../../tools/web-ops.js";
import type { OpResult } from "../../batch/constants.js";
import { CliError } from "../parse.js";
import { finalizeExec, type ExecResult } from "./util.js";

export async function runWebSubcommand(
  parsed: { flags: Record<string, unknown>; positionals: string[] },
  cwd: string,
  sessionManager?: { getSessionDir(): string },
  signal?: AbortSignal,
): Promise<ExecResult> {
  if (parsed.positionals.length === 0) {
    throw new CliError("web requires a subcommand: search or fetch.", "Usage: batch web search -q <query> or batch web fetch -u <url>");
  }

  const subcommand = parsed.positionals[0];
  const remainingPositionals = parsed.positionals.slice(1);

  if (subcommand === "search") {
    const query = typeof parsed.flags.query === "string" ? parsed.flags.query : undefined;
    if (!query) {
      throw new CliError("web search requires -q <query>.", "Usage: batch web search -q <query>");
    }

    const result = await runWebSearch({ query }, signal);
    const output = result.content[0].text;
    const results: OpResult[] = [{
      op: "search",
      status: "ok",
      query,
      content: output,
    }];
    return finalizeExec(output, results);
  }

  if (subcommand === "fetch") {
    const url = typeof parsed.flags.url === "string" ? parsed.flags.url : undefined;
    if (!url) {
      throw new CliError("web fetch requires -u <url>.", "Usage: batch web fetch -u <url> [-f <format>]");
    }
    const format = typeof parsed.flags.format === "string" ? parsed.flags.format : undefined;

    if (!sessionManager) {
      throw new CliError(
        "web fetch requires a session manager.",
        "Session manager not available. Ensure this is running inside a pi session.",
      );
    }

    const result = await runWebFetch({ url, format }, { sessionManager }, signal);
    const output = result.content[0].text;
    const results: OpResult[] = [{
      op: "fetch",
      status: "ok",
      url,
      content: output,
      filePath: result.details.filePath,
      contentLength: result.details.contentLength,
    }];
    return finalizeExec(output, results);
  }

  throw new CliError(
    `Unknown web subcommand: ${subcommand}`,
    `Did you mean: search, fetch?`,
  );
}

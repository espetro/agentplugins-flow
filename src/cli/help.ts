/**
 * Man-page style help generator.
 */

import { type FlagSpec } from "./parse.js";

export interface SubcommandHelp {
  name: string;
  description: string;
  flags: Record<string, { short?: string; type: string; description: string }>;
}

export function flagSpecToHelp(flags: FlagSpec): SubcommandHelp["flags"] {
  const result: SubcommandHelp["flags"] = {};
  for (const [name, cfg] of Object.entries(flags)) {
    result[name] = {
      short: cfg.short,
      type: cfg.type,
      description: cfg.description ?? "",
    };
  }
  return result;
}

export function renderHelp(
  toolName: string,
  description: string,
  subcommands: SubcommandHelp[],
): string {
  const lines: string[] = [];
  lines.push(`USAGE: ${toolName} <subcommand> [flags] [args]`);
  lines.push("");
  lines.push(description);
  lines.push("");
  lines.push("SUBCOMMANDS:");
  for (const sub of subcommands) {
    lines.push(`  ${sub.name.padEnd(12)}  ${sub.description}`);
  }
  lines.push("");
  for (const sub of subcommands) {
    lines.push(`${sub.name.toUpperCase()} FLAGS:`);
    const entries = Object.entries(sub.flags);
    if (entries.length === 0) {
      lines.push("  (none)");
    } else {
      for (const [name, cfg] of entries) {
        const short = cfg.short ? `-${cfg.short}, ` : "";
        lines.push(`  ${short}--${name.padEnd(14)}  ${cfg.description}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

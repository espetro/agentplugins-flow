/**
 * CLI argument parser.
 *
 * Parses a token array into subcommand, flags, and positionals.
 */

export interface FlagSpec {
  [name: string]: {
    short?: string;
    type: "boolean" | "string" | "number";
    description?: string;
    multi?: boolean;
  };
}

export interface ParsedCommand {
  subcommand: string;
  flags: Record<string, string | number | boolean | Array<string | number | boolean>>;
  positionals: string[];
}

export class CliError extends Error {
  hint?: string;
  constructor(message: string, hint?: string) {
    super(message);
    this.name = "CliError";
    this.hint = hint;
  }
}

export function parseCommand(tokens: string[], spec: FlagSpec): ParsedCommand {
  if (tokens.length === 0) {
    throw new CliError("No command provided.");
  }

  const subcommand = tokens[0];
  const flags: Record<string, string | number | boolean | Array<string | number | boolean>> = {};
  const positionals: string[] = [];
  let endOfFlags = false;

  // Build reverse map: short char -> flag name
  const shortMap: Record<string, string> = {};
  for (const [name, cfg] of Object.entries(spec)) {
    if (cfg.short) {
      shortMap[cfg.short] = name;
    }
  }

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];

    if (token === "--") {
      endOfFlags = true;
      continue;
    }

    if (endOfFlags) {
      positionals.push(token);
      continue;
    }

    if (token.startsWith("--")) {
      const eqIdx = token.indexOf("=");
      let name: string;
      let value: string | undefined;
      if (eqIdx >= 0) {
        name = token.slice(2, eqIdx);
        value = token.slice(eqIdx + 1);
      } else {
        name = token.slice(2);
      }

      if (!spec[name]) {
        throw new CliError(`Unknown flag: --${name}`, `Run with --help for available flags.`);
      }

      const cfg = spec[name];
      if (cfg.type === "boolean") {
        if (cfg.multi) {
          const existing = flags[name];
          flags[name] = Array.isArray(existing) ? [...existing, true] : [true];
        } else {
          flags[name] = true;
        }
      } else {
        if (value === undefined) {
          if (i + 1 >= tokens.length) {
            throw new CliError(`Flag --${name} requires a value.`);
          }
          value = tokens[++i];
        }
        let parsedValue: string | number;
        if (cfg.type === "number") {
          if (value === "") {
            throw new CliError(`Flag --${name} requires a numeric value.`);
          } else {
            const num = Number(value);
            if (!Number.isFinite(num)) {
              throw new CliError(`Flag --${name} expects a number, got: ${value}`);
            }
            parsedValue = num;
          }
        } else {
          parsedValue = value;
        }
        if (cfg.multi) {
          const existing = flags[name];
          flags[name] = Array.isArray(existing) ? [...existing, parsedValue] : [parsedValue];
        } else {
          flags[name] = parsedValue;
        }
      }
      continue;
    }

    if (token.startsWith("-") && token.length > 1) {
      // Could be bundled booleans or a short flag with value
      const chars = token.slice(1);
      for (let j = 0; j < chars.length; j++) {
        const ch = chars[j];
        const name = shortMap[ch];
        if (!name) {
          throw new CliError(`Unknown flag: -${ch}`, `Run with --help for available flags.`);
        }
        const cfg = spec[name];
        if (cfg.type === "boolean") {
          if (cfg.multi) {
            const existing = flags[name];
            flags[name] = Array.isArray(existing) ? [...existing, true] : [true];
          } else {
            flags[name] = true;
          }
        } else {
          // Non-boolean short flag: if it's the last char in the bundle,
          // consume the next token as value. Otherwise, consume the rest of this token.
          let value: string;
          if (j === chars.length - 1) {
            if (i + 1 >= tokens.length) {
              throw new CliError(`Flag -${ch} (--${name}) requires a value.`);
            }
            value = tokens[++i];
          } else {
            value = chars.slice(j + 1);
            // Handle = separator in bundled short flags (e.g., -n=foo)
            if (value.startsWith("=")) {
              value = value.slice(1);
            }
            j = chars.length; // break out of inner loop
          }
          let parsedValue: string | number;
          if (cfg.type === "number") {
            if (value === "") {
              throw new CliError(`Flag -${ch} (--${name}) requires a numeric value.`);
            } else {
              const num = Number(value);
              if (!Number.isFinite(num)) {
                throw new CliError(`Flag -${ch} (--${name}) expects a number, got: ${value}`);
              }
              parsedValue = num;
            }
          } else {
            parsedValue = value;
          }
          if (cfg.multi) {
            const existing = flags[name];
            flags[name] = Array.isArray(existing) ? [...existing, parsedValue] : [parsedValue];
          } else {
            flags[name] = parsedValue;
          }
          break;
        }
      }
      continue;
    }

    positionals.push(token);
  }

  return { subcommand, flags, positionals };
}

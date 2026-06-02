import { type FlagSpec } from "../parse.js";

export const BASH_FLAGS: FlagSpec = {
  id: { short: "i", type: "string", description: "Unique ID for this bash operation (auto-generated if omitted)" },
  timeout: { short: "t", type: "number", description: "Timeout in ms" },
  cwd: { short: "w", type: "string", description: "Working directory override for this command" },
  help: { short: "h", type: "boolean", description: "Show help text" },
};

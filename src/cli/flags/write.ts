import { type FlagSpec } from "../parse.js";

export const WRITE_FLAGS: FlagSpec = {
  content: { short: "c", type: "string", description: "File content (required for write)" },
  help: { short: "h", type: "boolean", description: "Show help text" },
};

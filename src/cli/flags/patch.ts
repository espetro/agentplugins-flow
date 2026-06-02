import { type FlagSpec } from "../parse.js";

export const PATCH_FLAGS: FlagSpec = {
  content: { short: "c", type: "string", description: "Patch text (required for patch)" },
  help: { short: "h", type: "boolean", description: "Show help text" },
};

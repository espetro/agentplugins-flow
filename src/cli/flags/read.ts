import { type FlagSpec } from "../parse.js";

export const READ_FLAGS: FlagSpec = {
  start: { short: "s", type: "number", description: "1-indexed start line" },
  limit: { short: "l", type: "number", description: "Maximum lines to read" },
  end: { short: "e", type: "number", description: "End line (used with -s)" },
  help: { short: "h", type: "boolean", description: "Show help text" },
};

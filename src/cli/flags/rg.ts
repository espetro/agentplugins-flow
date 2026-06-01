import { type FlagSpec } from "../parse.js";

export const RG_FLAGS: FlagSpec = {
  query: { short: "q", type: "string", description: "Search pattern for rg" },
  "ignore-case": { short: "i", type: "boolean", description: "Ignore case for rg" },
  "files-only": { short: "l", type: "boolean", description: "Return filenames only for rg" },
  type: { short: "t", type: "string", description: "Type filter for rg (e.g., ts, js)" },
  "max-count": { short: "n", type: "number", description: "Max matches per file for rg" },
  "ignore-level": { short: "u", type: "number", description: "Ignore level for rg (0-3)" },
};

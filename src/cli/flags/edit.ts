import { type FlagSpec } from "../parse.js";

export const EDIT_FLAGS: FlagSpec = {
  find: { short: "f", type: "string", description: "Exact text to find (oldText)", multi: true },
  replace: { short: "r", type: "string", description: "Replacement text (newText)", multi: true },
  append: { short: "a", type: "boolean", description: "Append instead of replace (content goes at end of file)" },
  "all-occurrences": { short: "A", type: "boolean", description: "Replace all occurrences instead of requiring unique match" },
};

import { type FlagSpec } from "../parse.js";

export const POLL_FLAGS: FlagSpec = {
  id: { short: "i", type: "string", description: "Bash operation ID to poll (required, repeatable)", multi: true },
};

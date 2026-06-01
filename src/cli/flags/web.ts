import { type FlagSpec } from "../parse.js";

export const WEB_FLAGS: FlagSpec = {
  query: { short: "q", type: "string", description: "Search query (for web search)" },
  url: { short: "u", type: "string", description: "URL to fetch (for web fetch)" },
  format: { short: "f", type: "string", description: "Output format for fetch: markdown, text, html (default: markdown)" },
};

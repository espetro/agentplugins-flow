#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const distUtils = join(process.cwd(), "dist/tui/render-utils.js");
if (!existsSync(distUtils)) {
	console.error("ERROR: run npm run build first (missing dist/tui/render-utils.js)");
	process.exit(1);
}
const src = readFileSync(distUtils, "utf-8");
if (src.includes("-----/")) {
	console.error("ERROR: dist still contains legacy -----/ context placeholder");
	process.exit(1);
}
console.log("OK: dist context labels clean");

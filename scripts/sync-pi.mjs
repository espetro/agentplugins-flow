#!/usr/bin/env node
/**
 * Install local build into ~/.pi/agent/npm (what `pi` loads for npm:pi-agent-flow).
 */
import { cpSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target =
	process.env.PI_AGENT_FLOW_INSTALL
	|| join(homedir(), ".pi/agent/npm/node_modules/pi-agent-flow");

execSync("npm run build", { cwd: root, stdio: "inherit" });
execSync("node scripts/check-dist.mjs", { cwd: root, stdio: "inherit" });

mkdirSync(target, { recursive: true });
for (const name of ["dist", "agents"]) {
	cpSync(join(root, name), join(target, name), { recursive: true });
}
cpSync(join(root, "package.json"), join(target, "package.json"));
const readme = join(root, "README.md");
if (existsSync(readme)) {
	cpSync(readme, join(target, "README.md"));
}

const version = JSON.parse(readFileSync(join(target, "package.json"), "utf-8")).version;
console.log(`OK: local pi-agent-flow synced (${version})`);

/**
 * Spawn and temp-file helpers — extracted from runner.ts.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { logWarn } from "../config/log.js";

/**
 * Derive the spawn command from the current process context so child invocations
 * work on Unix and Windows without going through a shell wrapper.
 */
export function resolveFlowSpawn(): { command: string; prefixArgs: string[] } {
	const envOverride = process.env["PI_FLOW_SPAWN_COMMAND"];
	if (envOverride && envOverride.trim()) {
		return { command: envOverride.trim(), prefixArgs: [] };
	}
	const isNode = /[\\/]node(?:\.exe)?$/i.test(process.execPath);
	if (isNode && process.argv[1]) {
		return { command: process.execPath, prefixArgs: [process.argv[1]] };
	}
	return { command: process.execPath, prefixArgs: [] };
}

export function writeFlowSessionToTempFile(
	flowName: string,
	sessionJsonl: string,
): { dir: string; filePath: string } {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agent-flow-"));
	const safeName = flowName.replace(/[^\w.-]+/g, "_");
	const filePath = path.join(tmpDir, `flow-${safeName}.jsonl`);
	fs.writeFileSync(filePath, sessionJsonl, { encoding: "utf-8", mode: 0o600 });
	return { dir: tmpDir, filePath };
}

export function cleanupFlowTempDir(dir: string | null): void {
	if (!dir) return;
	try {
		fs.rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		logWarn(`[pi-agent-flow] cleanupFlowTempDir failed: ${err}`);
	}
}

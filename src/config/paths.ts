import path from "node:path";
import os from "node:os";

export function getAgentDir(): string {
	return process.env["PI_CODING_AGENT_DIR"]?.trim() || path.join(os.homedir(), ".pi", "agent");
}

export function hasAgentDirOverride(): boolean {
	return Boolean(process.env["PI_CODING_AGENT_DIR"]?.trim());
}

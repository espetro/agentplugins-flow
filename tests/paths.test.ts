import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getAgentDir } from "../src/config/paths.js";

describe("getAgentDir", () => {
	const originalEnv = process.env["PI_CODING_AGENT_DIR"];

	beforeEach(() => {
		delete process.env["PI_CODING_AGENT_DIR"];
	});

	afterEach(() => {
		if (originalEnv !== undefined) {
			process.env["PI_CODING_AGENT_DIR"] = originalEnv;
		} else {
			delete process.env["PI_CODING_AGENT_DIR"];
		}
	});

	it("returns default path when env is not set", () => {
		const dir = getAgentDir();
		expect(dir).toMatch(/\.pi\/agent$/);
	});

	it("returns env override when set", () => {
		process.env["PI_CODING_AGENT_DIR"] = "/custom/agent/dir";
		expect(getAgentDir()).toBe("/custom/agent/dir");
	});

	it("trims whitespace from env value", () => {
		process.env["PI_CODING_AGENT_DIR"] = "  /trimmed/path  ";
		expect(getAgentDir()).toBe("/trimmed/path");
	});

	it("returns default path for empty string after trim", () => {
		process.env["PI_CODING_AGENT_DIR"] = "   ";
		const dir = getAgentDir();
		expect(dir).toMatch(/\.pi\/agent$/);
	});
});

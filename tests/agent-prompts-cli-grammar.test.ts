import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const AGENTS_DIR = path.join(__dirname, "../agents");

function getAgentFiles(): string[] {
	return fs.readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md"));
}

describe("agent prompts CLI grammar", () => {
	for (const file of getAgentFiles()) {
		const fullPath = path.join(AGENTS_DIR, file);
		const content = fs.readFileSync(fullPath, "utf-8");

		describe(file, () => {
			it("does not use old JSON-style o: read s offset l limit grammar", () => {
				const forbidden = [
					/o:\s*read\s+s\s+offset\s+l\s+limit/,
					/o:\s*read\s+s\s+and\s+l/,
					/o read s offset l limit/,
					/o read s and l/,
				];
				for (const pattern of forbidden) {
					expect(content).not.toMatch(pattern);
				}
			});
		});
	}

	it("at least one agent uses new CLI-style read <path>[:N | :N-M] grammar", () => {
		const files = getAgentFiles();
		let found = false;
		for (const file of files) {
			const content = fs.readFileSync(path.join(AGENTS_DIR, file), "utf-8");
			if (/read\s+<path>\[:N\s*\|\s*:N-M\]/.test(content)) {
				found = true;
				break;
			}
		}
		expect(found).toBe(true);
	});
});

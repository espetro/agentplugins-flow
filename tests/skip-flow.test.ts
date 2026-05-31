import { describe, it, expect, vi } from "vitest";

const mockComplete = vi.fn().mockResolvedValue({
	content: [{ type: "text", text: "single" }],
});

vi.mock("@earendil-works/pi-ai", () => ({
	complete: (...args: any[]) => mockComplete(...args),
}));

import { classifyByRegex, classifyTask, getSkipFlowTools, needsFlow, clearClassificationCache } from "../src/tools/skip-flow.js";

// Mock model for testing
const mockModel: any = {
	id: "test-model",
	provider: "test",
	contextWindow: 128000,
	maxTokens: 4096,
};

describe("skip-flow", () => {
	describe("classifyByRegex", () => {
		it("classifies definite search commands as single-purpose", () => {
			expect(classifyByRegex("find all TODO comments").classification).toBe("single-purpose");
			expect(classifyByRegex("search for unused imports").classification).toBe("single-purpose");
			expect(classifyByRegex("locate the config file").classification).toBe("single-purpose");
		});

		it("classifies definite file reads as single-purpose", () => {
			expect(classifyByRegex("read package.json").classification).toBe("single-purpose");
			expect(classifyByRegex("show me the contents of src/index.ts").classification).toBe("single-purpose");
			expect(classifyByRegex("cat README.md").classification).toBe("single-purpose");
		});

		it("classifies definite check commands as single-purpose", () => {
			expect(classifyByRegex("check if all tests pass").classification).toBe("single-purpose");
			expect(classifyByRegex("verify the build succeeds").classification).toBe("single-purpose");
		});

		it("classifies definite count commands as single-purpose", () => {
			expect(classifyByRegex("count the number of files").classification).toBe("single-purpose");
			expect(classifyByRegex("how many lines in this file").classification).toBe("single-purpose");
		});

		it("classifies explicit sequences as orchestrated", () => {
			expect(classifyByRegex("first analyze the code, then fix bugs, finally run tests").classification).toBe("orchestrated");
		});

		it("classifies Chinese explicit sequences as orchestrated", () => {
			expect(classifyByRegex("第一步分析代码，第二步找出问题，第三步修复").classification).toBe("orchestrated");
		});

		it("classifies numbered lists as orchestrated", () => {
			const list = `1. Analyze the current code
2. Identify issues
3. Fix them`;
			expect(classifyByRegex(list).classification).toBe("orchestrated");
		});

		it("returns uncertain for ambiguous messages", () => {
			expect(classifyByRegex("help me with this code").classification).toBe("uncertain");
			expect(classifyByRegex("what should I do about this bug").classification).toBe("uncertain");
		});

		it("returns uncertain for search/read commands with sequence or action indicators", () => {
			expect(classifyByRegex("find all TODO comments and refactor them").classification).toBe("uncertain");
			expect(classifyByRegex("search for unused imports and delete them").classification).toBe("uncertain");
			expect(classifyByRegex("locate the config file and update it").classification).toBe("uncertain");
			expect(classifyByRegex("check if tests pass and fix them").classification).toBe("uncertain");
		});
	});

	describe("classifyTask", () => {
		it("uses regex fast path when confident", async () => {
			const result = await classifyTask("find all TODO comments", { enabled: true });
			expect(result.classification).toBe("single-purpose");
			expect(result.source).toBe("regex");
		});

		it("falls back to LLM when regex uncertain", async () => {
			mockComplete.mockClear();
			mockComplete.mockResolvedValueOnce({
				content: [{ type: "text", text: "single" }],
			});

			const result = await classifyTask("help me with this code", { enabled: true }, {
				model: mockModel,
				apiKey: "test-key",
			});

			expect(result.classification).toBe("single-purpose");
			expect(result.source).toBe("llm");
			expect(mockComplete).toHaveBeenCalledTimes(1);
		});

		it("defaults to orchestrated when no LLM available", async () => {
			const result = await classifyTask("ambiguous message", { enabled: true });
			expect(result.classification).toBe("orchestrated");
			expect(result.matches).toContain("no-llm-default");
		});

		it("caches classification results to avoid duplicate LLM calls", async () => {
			mockComplete.mockClear();
			mockComplete.mockResolvedValue({
				content: [{ type: "text", text: "single" }],
			});

			// Clear cache first to ensure a clean state
			clearClassificationCache();

			const testDeps = {
				model: mockModel,
				apiKey: "test-key",
			};

			const result1 = await classifyTask("complex ambiguous message to classify", { enabled: true }, testDeps);
			const result2 = await classifyTask("complex ambiguous message to classify", { enabled: true }, testDeps);

			expect(result1.classification).toBe("single-purpose");
			expect(result2.classification).toBe("single-purpose");
			
			// If cached, mockComplete should only be called once
			expect(mockComplete).toHaveBeenCalledTimes(1);
		});
	});

	describe("getSkipFlowTools", () => {
		const baseTools = ["read", "bash", "flow", "trace", "ask_user"];

		it("returns all tools when disabled", async () => {
			const result = await getSkipFlowTools(baseTools, "any message", { enabled: false });
			expect(result).toEqual(baseTools);
		});

		it("excludes flow for definite single-purpose tasks", async () => {
			const result = await getSkipFlowTools(baseTools, "find all TODO comments", { enabled: true });
			expect(result).not.toContain("flow");
			expect(result).toContain("read");
			expect(result).toContain("bash");
		});

		it("includes flow for definite orchestrated tasks", async () => {
			const result = await getSkipFlowTools(baseTools, "first analyze, then fix, finally test", { enabled: true });
			expect(result).toContain("flow");
		});

		it("preserves tool order", async () => {
			const result = await getSkipFlowTools(baseTools, "find all TODO comments", { enabled: true });
			expect(result).toEqual(["read", "bash", "trace", "ask_user"]);
		});
	});

	describe("needsFlow", () => {
		it("returns true when disabled", async () => {
			expect(await needsFlow("any message", { enabled: false })).toBe(true);
		});

		it("returns false for definite single-purpose tasks", async () => {
			expect(await needsFlow("find all TODO comments", { enabled: true })).toBe(false);
		});

		it("returns true for definite orchestrated tasks", async () => {
			expect(await needsFlow("first analyze, then fix, finally test", { enabled: true })).toBe(true);
		});
	});
});

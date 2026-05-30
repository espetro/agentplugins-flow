import { describe, it, expect, vi } from "vitest";
import { classifyByRegex, classifyTask, getSmartModeTools, needsFlow } from "../src/tools/smart-mode.js";
import type { Model } from "@earendil-works/pi-ai";

// Mock model for testing
const mockModel: Model = {
	id: "test-model",
	provider: "test",
	contextWindow: 128000,
	maxTokens: 4096,
} as any;

describe("smart-mode", () => {
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
	});

	describe("classifyTask", () => {
		it("uses regex fast path when confident", async () => {
			const result = await classifyTask("find all TODO comments", { enabled: true });
			expect(result.classification).toBe("single-purpose");
			expect(result.source).toBe("regex");
		});

		it("falls back to LLM when regex uncertain", async () => {
			const mockComplete = vi.fn().mockResolvedValue({
				content: [{ type: "text", text: "single" }],
			});

			// Mock the complete function
			vi.doMock("@earendil-works/pi-ai", () => ({
				complete: mockComplete,
			}));

			const result = await classifyTask("help me with this code", { enabled: true }, {
				model: mockModel,
				apiKey: "test-key",
			});

			// Since we're testing with mocked LLM, it should use LLM
			expect(result.source).toBe("llm");
		});

		it("defaults to orchestrated when no LLM available", async () => {
			const result = await classifyTask("ambiguous message", { enabled: true });
			expect(result.classification).toBe("orchestrated");
			expect(result.matches).toContain("no-llm-default");
		});
	});

	describe("getSmartModeTools", () => {
		const baseTools = ["read", "bash", "flow", "trace", "ask_user"];

		it("returns all tools when disabled", async () => {
			const result = await getSmartModeTools(baseTools, "any message", { enabled: false });
			expect(result).toEqual(baseTools);
		});

		it("excludes flow for definite single-purpose tasks", async () => {
			const result = await getSmartModeTools(baseTools, "find all TODO comments", { enabled: true });
			expect(result).not.toContain("flow");
			expect(result).toContain("read");
			expect(result).toContain("bash");
		});

		it("includes flow for definite orchestrated tasks", async () => {
			const result = await getSmartModeTools(baseTools, "first analyze, then fix, finally test", { enabled: true });
			expect(result).toContain("flow");
		});

		it("preserves tool order", async () => {
			const result = await getSmartModeTools(baseTools, "find all TODO comments", { enabled: true });
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

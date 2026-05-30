import { describe, it, expect } from "vitest";
import { classifyTask, needsFlow, getSmartModeTools } from "../src/tools/smart-mode.js";

describe("smart-mode", () => {
	describe("classifyTask", () => {
		it("classifies search tasks as single-purpose", () => {
			const result = classifyTask("Find all TODO comments in the codebase");
			expect(result.classification).toBe("single-purpose");
			expect(result.singlePurposeMatches).toContain("search");
		});

		it("classifies analysis tasks as single-purpose", () => {
			const result = classifyTask("Analyze this log file and summarize the errors");
			expect(result.classification).toBe("single-purpose");
			expect(result.singlePurposeMatches).toContain("analysis");
		});

		it("classifies read tasks as single-purpose", () => {
			const result = classifyTask("Show me the contents of package.json");
			expect(result.classification).toBe("single-purpose");
			expect(result.singlePurposeMatches).toContain("read");
		});

		it("classifies check tasks as single-purpose", () => {
			const result = classifyTask("Check if all tests pass");
			expect(result.classification).toBe("single-purpose");
			expect(result.singlePurposeMatches).toContain("check");
		});

		it("classifies sequential tasks as orchestrated", () => {
			const result = classifyTask("First analyze the code, then fix the bugs, finally run tests");
			expect(result.classification).toBe("orchestrated");
			expect(result.multiStepMatches).toContain("sequential");
		});

		it("classifies workflow tasks as orchestrated", () => {
			const result = classifyTask("Refactor the auth module to use JWT tokens");
			expect(result.classification).toBe("orchestrated");
			expect(result.multiStepMatches).toContain("workflow");
		});

		it("classifies Chinese sequential tasks as orchestrated", () => {
			const result = classifyTask("第一步分析代码，第二步找出问题，第三步修复");
			expect(result.classification).toBe("orchestrated");
			expect(result.multiStepMatches).toContain("sequential-zh");
		});

		it("classifies Chinese workflow tasks as orchestrated", () => {
			const result = classifyTask("重构认证模块以使用JWT令牌");
			expect(result.classification).toBe("orchestrated");
			expect(result.multiStepMatches).toContain("workflow-zh");
		});

		it("classifies list-structured messages as orchestrated", () => {
			const result = classifyTask(`Steps to complete:
1. Analyze the current code
2. Identify issues
3. Fix them`);
			expect(result.classification).toBe("orchestrated");
		});

		it("classifies short messages as single-purpose", () => {
			const result = classifyTask("fix this bug");
			expect(result.classification).toBe("single-purpose");
		});

		it("handles mixed indicators by prioritizing orchestrated", () => {
			const result = classifyTask("Find all bugs, then fix them");
			expect(result.classification).toBe("orchestrated");
			expect(result.multiStepMatches.length).toBeGreaterThan(0);
		});
	});

	describe("needsFlow", () => {
		const config = { enabled: true, debugMode: false };

		it("returns true when disabled", () => {
			expect(needsFlow("any message", { enabled: false })).toBe(true);
		});

		it("returns false for single-purpose tasks", () => {
			expect(needsFlow("Find all TODO comments", config)).toBe(false);
		});

		it("returns true for orchestrated tasks", () => {
			expect(needsFlow("Refactor module A, then update tests", config)).toBe(true);
		});
	});

	describe("getSmartModeTools", () => {
		const baseTools = ["read", "bash", "flow", "trace", "ask_user"];

		it("returns all tools when disabled", () => {
			const config = { enabled: false };
			expect(getSmartModeTools(baseTools, "any message", config)).toEqual(baseTools);
		});

		it("excludes flow for single-purpose tasks", () => {
			const config = { enabled: true };
			const result = getSmartModeTools(baseTools, "Find all TODO comments", config);
			expect(result).not.toContain("flow");
			expect(result).toContain("read");
			expect(result).toContain("bash");
			expect(result).toContain("trace");
		});

		it("includes flow for orchestrated tasks", () => {
			const config = { enabled: true };
			const result = getSmartModeTools(baseTools, "Refactor module A, then update tests", config);
			expect(result).toContain("flow");
		});

		it("preserves tool order", () => {
			const config = { enabled: true };
			const result = getSmartModeTools(baseTools, "Find all TODO comments", config);
			expect(result).toEqual(["read", "bash", "trace", "ask_user"]);
		});
	});
});

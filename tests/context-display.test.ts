import { describe, it, expect } from "vitest";
import {
	computeInitialContextTokens,
	resolveDisplayContextTokens,
	mergeStreamingContextTokens,
} from "../src/tui/context-display.js";

describe("context-display", () => {
	it("computeInitialContextTokens sums fork, intent, prompt, activation", () => {
		expect(computeInitialContextTokens({ totalTokens: 1000 }, "abcd", "prompt")).toBeGreaterThan(11_000);
	});

	it("resolveDisplayContextTokens prefers usage and shared context", () => {
		expect(resolveDisplayContextTokens({ contextTokens: 9000, input: 0, output: 0 }, { totalTokens: 10_000 })).toBe(10_000);
		expect(resolveDisplayContextTokens({ contextTokens: 0, input: 500, output: 600 })).toBe(1100);
	});

	it("mergeStreamingContextTokens takes max of estimates", () => {
		expect(mergeStreamingContextTokens({ contextTokens: 5000 }, 8000)).toBe(8000);
	});
});

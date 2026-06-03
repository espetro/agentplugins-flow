import { describe, it, expect, vi } from "vitest";
import { mapThinkingLevel, CANONICAL_THINKING_LEVELS, type CanonicalThinkingLevel } from "../src/config/thinking-level-map.js";

describe("mapThinkingLevel", () => {
	it("passes through canonical levels unchanged", () => {
		for (const level of CANONICAL_THINKING_LEVELS) {
			expect(mapThinkingLevel(level)).toBe(level);
		}
	});

	it("is case-insensitive for canonical levels", () => {
		expect(mapThinkingLevel("LOW")).toBe("low");
		expect(mapThinkingLevel("Medium")).toBe("medium");
		expect(mapThinkingLevel("High ")).toBe("high");
	});

	it("maps unsupported levels to nearest neighbour", () => {
		const cases: [string, CanonicalThinkingLevel][] = [
			["minimal", "low"],
			["none", "low"],
			["off", "low"],
			["light", "low"],
			["small", "low"],
			["basic", "low"],
			["moderate", "medium"],
			["standard", "medium"],
			["normal", "medium"],
			["heavy", "high"],
			["max", "high"],
			["maximum", "high"],
			["deep", "high"],
			["aggressive", "high"],
			["intense", "high"],
		];
		for (const [input, expected] of cases) {
			expect(mapThinkingLevel(input)).toBe(expected);
		}
	});

	it("returns null for completely unmappable values", () => {
		expect(mapThinkingLevel("foobar")).toBeNull();
		expect(mapThinkingLevel("123")).toBeNull();
		expect(mapThinkingLevel("")).toBeNull();
	});

	it("uses provider map when available", () => {
		const providerMap = {
			minimal: "low",
			none: "low",
			default: "medium",
		};
		expect(mapThinkingLevel("minimal", providerMap)).toBe("low");
		expect(mapThinkingLevel("none", providerMap)).toBe("low");
		expect(mapThinkingLevel("default", providerMap)).toBe("medium");
	});

	it("falls back to static map when provider map has no entry", () => {
		const providerMap = { custom: "high" };
		expect(mapThinkingLevel("minimal", providerMap)).toBe("low");
	});

	it("ignores invalid provider map entries and falls back to static", () => {
		const providerMap = { minimal: "invalid" };
		// "invalid" is not canonical, so it falls through to static map
		expect(mapThinkingLevel("minimal", providerMap)).toBe("low");
	});

	it("handles whitespace in input", () => {
		expect(mapThinkingLevel("  minimal  ")).toBe("low");
		expect(mapThinkingLevel(" HIGH ")).toBe("high");
	});
});

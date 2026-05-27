import { describe, it, expect } from "vitest";
import {
	reconstructHeader,
	sectionHeader,
	formatCollapsedFlowHeaderTypeName,
	HeaderSegment,
} from "../src/tui/header.js";

describe("sectionHeader", () => {
	it("centers a short label", () => {
		const result = sectionHeader("test");
		expect(result).toContain("test");
		expect(result.length).toBe(20);
	});

	it("centers a longer label", () => {
		const result = sectionHeader("intent");
		expect(result).toContain("intent");
		expect(result.length).toBe(20);
	});

	it("uses em-dashes", () => {
		expect(sectionHeader("x")).toContain("─");
	});

	it("has total width 20", () => {
		expect(sectionHeader("report").length).toBe(20);
	});

	it("handles empty-ish label", () => {
		expect(sectionHeader("").length).toBe(20);
	});
});

describe("reconstructHeader", () => {
	it("applies styles to segments", () => {
		const segments: HeaderSegment[] = [
			{ text: "abc", style: (s) => `[${s}]` },
		];
		expect(reconstructHeader("abc", segments)).toBe("[abc]");
	});

	it("handles multiple segments", () => {
		const segments: HeaderSegment[] = [
			{ text: "ab", style: (s) => `[${s}]` },
			{ text: "cd", style: (s) => `{${s}}` },
		];
		expect(reconstructHeader("abcd", segments)).toBe("[ab]{cd}");
	});

	it("handles leftover text", () => {
		const segments: HeaderSegment[] = [
			{ text: "ab", style: (s) => `[${s}]` },
		];
		expect(reconstructHeader("abcd", segments)).toBe("[ab]cd");
	});

	it("stops at end of content", () => {
		const segments: HeaderSegment[] = [
			{ text: "abc", style: (s) => `[${s}]` },
			{ text: "def", style: (s) => `{${s}}` },
		];
		expect(reconstructHeader("ab", segments)).toBe("[ab]");
	});

	it("works with ANSI-style wrappers", () => {
		const segments: HeaderSegment[] = [
			{ text: "● ", style: () => "X" },
			{ text: "scout", style: (s) => `>${s}<` },
		];
		expect(reconstructHeader("● scout", segments)).toBe("X>scout<");
	});
});

describe("formatCollapsedFlowHeaderTypeName", () => {
	it("lowercases the type name", () => {
		expect(formatCollapsedFlowHeaderTypeName("BUILD")).toBe("build");
	});

	it("leaves lowercase unchanged", () => {
		expect(formatCollapsedFlowHeaderTypeName("audit")).toBe("audit");
	});

	it("handles mixed case", () => {
		expect(formatCollapsedFlowHeaderTypeName("Trace")).toBe("trace");
	});
});

import { describe, it, expect } from "vitest";
import {
	truncateLineBytes,
	truncateOutput,
	truncateBashOutputText,
	truncateRgOutputText,
} from "../src/batch/truncate-output.js";

describe("truncateLineBytes", () => {
	it("returns short lines unchanged", () => {
		expect(truncateLineBytes("hello", 100)).toEqual({
			line: "hello",
			truncated: false,
			originalBytes: 5,
		});
	});

	it("truncates long lines with a marker", () => {
		const line = "x".repeat(5000);
		const { line: trimmed, truncated, originalBytes } = truncateLineBytes(line, 1024);
		expect(truncated).toBe(true);
		expect(originalBytes).toBe(5000);
		expect(trimmed).toContain("[… 5000 bytes, truncated to 1024 …]");
		expect(Buffer.byteLength(trimmed, "utf-8")).toBeLessThanOrEqual(1100);
	});

	it("handles multi-byte UTF-8 safely", () => {
		const line = "中".repeat(500);
		const { line: trimmed, truncated } = truncateLineBytes(line, 100);
		expect(truncated).toBe(true);
		expect(trimmed).not.toContain("\uFFFD");
	});
});

describe("truncateOutput", () => {
	it("applies per-line, line-count, and byte limits in order", () => {
		const lines = Array.from({ length: 20 }, (_, i) => `${i}:${"a".repeat(2000)}`);
		const text = lines.join("\n");
		const result = truncateOutput(text, {
			maxLines: 5,
			maxBytes: 10 * 1024,
			maxBytesPerLine: 256,
		});

		expect(result.longLinesTruncated).toBe(20);
		expect(result.truncated).toBe(true);
		expect(result.text).toContain("[... truncated at 5 lines, 20 total ...]");
		expect(Buffer.byteLength(result.text, "utf-8")).toBeLessThanOrEqual(12 * 1024);
	});
});

describe("truncateBashOutputText", () => {
	it("preserves existing bash truncation behavior", () => {
		const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
		const text = lines.join("\n");
		const result = truncateBashOutputText(text, 100 * 1024, 5);
		expect(result).toContain("line 5");
		expect(result).not.toContain("line 6");
		expect(result).toContain("[... truncated at 5 lines, 10 total ...]");
	});
});

describe("truncateRgOutputText", () => {
	it("caps rg output size", () => {
		const lines = Array.from({ length: 1000 }, (_, i) => `file.ts:${i}:match ${"z".repeat(500)}`);
		const result = truncateRgOutputText(lines.join("\n"));
		expect(result.truncated).toBe(true);
		expect(result.truncatedLines).toBe(true);
	});
});

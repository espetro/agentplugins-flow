import { describe, it, expect } from "vitest";
import { parseSharedContext } from "../src/index.js";

describe("parseSharedContext", () => {
	it("returns undefined for null input", () => {
		expect(parseSharedContext(null)).toBeUndefined();
	});

	it("returns undefined for empty string", () => {
		expect(parseSharedContext("")).toBeUndefined();
	});

	it("returns undefined when no messages exist", () => {
		const jsonl = JSON.stringify({ type: "setting", name: "model" });
		expect(parseSharedContext(jsonl)).toBeUndefined();
	});

	it("counts messages and captures first user text", () => {
		const lines = [
			JSON.stringify({ type: "message", message: { role: "system", content: "hello" } }),
			JSON.stringify({ type: "message", message: { role: "user", content: "do the thing" } }),
			JSON.stringify({ type: "message", message: { role: "assistant", content: "ok" } }),
		];
		const result = parseSharedContext(lines.join("\n"));
		expect(result).toEqual({
			messageCount: 3,
			preview: "3 messages · do the thing",
		});
	});

	it("truncates user text at 60 chars and adds ellipsis", () => {
		const longText = "a".repeat(80);
		const lines = [
			JSON.stringify({ type: "message", message: { role: "user", content: longText } }),
		];
		const result = parseSharedContext(lines.join("\n"));
		expect(result?.preview).toBe(`1 messages · ${"a".repeat(60)}...`);
	});

	it("skips invalid JSONL lines gracefully", () => {
		const lines = [
			"not json",
			JSON.stringify({ type: "message", message: { role: "user", content: "valid" } }),
			"",
			"{ bad json",
		];
		const result = parseSharedContext(lines.join("\n"));
		expect(result).toEqual({
			messageCount: 1,
			preview: "1 messages · valid",
		});
	});

	it("returns preview without user text when no user role present", () => {
		const lines = [
			JSON.stringify({ type: "message", message: { role: "system", content: "hello" } }),
			JSON.stringify({ type: "message", message: { role: "assistant", content: "ok" } }),
		];
		const result = parseSharedContext(lines.join("\n"));
		expect(result).toEqual({
			messageCount: 2,
			preview: "2 messages",
		});
	});

	it("handles CRLF line endings correctly", () => {
		const lines = [
			JSON.stringify({ type: "message", message: { role: "user", content: "crlf test" } }),
		];
		const result = parseSharedContext(lines.join("\r\n"));
		expect(result).toEqual({
			messageCount: 1,
			preview: "1 messages · crlf test",
		});
	});
});

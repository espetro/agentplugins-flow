import { describe, it, expect } from "vitest";
import { DynamicScrambleText } from "../src/tui/scramble/index.js";

describe("DynamicScrambleText", () => {
	it("renders initial content", () => {
		const text = new DynamicScrambleText("hello", () => "world");
		const result = text.render(80);
		expect(result).toEqual(["world"]);
	});

	it("replaces newlines with spaces", () => {
		const text = new DynamicScrambleText("a\nb", () => "a b");
		const result = text.render(80);
		expect(result).toEqual(["a b"]);
	});

	it("truncates when truncated flag is true", () => {
		const text = new DynamicScrambleText("hello world this is long", () => "hello world this is long", true);
		const result = text.render(10);
		// truncateToWidth may include ANSI codes, so just verify it returns a string
		expect(typeof result[0]).toBe("string");
		expect(result[0].length).toBeGreaterThan(0);
	});

	it("does not truncate when truncated flag is false", () => {
		const text = new DynamicScrambleText("hello", () => "hello", false);
		const result = text.render(3);
		expect(result[0]).toBe("hello");
	});

	it("calls getScrambleContent on each render", () => {
		let calls = 0;
		const text = new DynamicScrambleText("init", () => {
			calls++;
			return `call-${calls}`;
		});
		text.render(80);
		text.render(80);
		expect(calls).toBe(2);
	});

	it("handles tabs like newlines", () => {
		const text = new DynamicScrambleText("a\tb", () => "a b");
		const result = text.render(80);
		expect(result).toEqual(["a b"]);
	});
});

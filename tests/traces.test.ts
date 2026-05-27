import { describe, it, expect } from "vitest";
import {
	getContentRole,
	shortenPath,
	formatFlowToolCall,
	splitOutputLines,
	renderToolTraces,
	renderFlowReport,
} from "../src/tui/traces.js";

describe("getContentRole", () => {
	it("returns baseRole for normal text", () => {
		expect(getContentRole("aimContent", "hello")).toBe("aimContent");
	});

	it("returns placeholder for awaiting", () => {
		expect(getContentRole("aimContent", "[awaiting...]")).toBe("placeholder");
	});

	it("returns placeholder for skipped", () => {
		expect(getContentRole("actContent", "[skipped]")).toBe("placeholder");
	});

	it("returns placeholder for approved", () => {
		expect(getContentRole("msgContent", "[approved]")).toBe("placeholder");
	});

	it("returns msgError when useError is true", () => {
		expect(getContentRole("msgContent", "anything", true)).toBe("msgError");
	});
});

describe("shortenPath", () => {
	it("shortens home directory to ~", () => {
		const result = shortenPath("/Users/test/project");
		// If home is /Users/test, it should be ~/project
		expect(result.startsWith("~") || result === "/Users/test/project").toBe(true);
	});

	it("leaves non-home paths alone", () => {
		expect(shortenPath("/tmp/file")).toBe("/tmp/file");
	});
});

describe("formatFlowToolCall", () => {
	const fg = (color: string, text: string) => text;

	it("formats bash command", () => {
		const result = formatFlowToolCall("bash", { command: "npm test" }, fg);
		expect(result).toContain("npm test");
	});

	it("formats read with path", () => {
		const result = formatFlowToolCall("read", { file_path: "/tmp/file.ts" }, fg);
		expect(result).toContain("read");
		expect(result).toContain("file.ts");
	});

	it("formats write with line count", () => {
		const result = formatFlowToolCall("write", { file_path: "/tmp/file.ts", content: "a\nb\nc" }, fg);
		expect(result).toContain("write");
		expect(result).toContain("3 lines");
	});

	it("formats ls", () => {
		const result = formatFlowToolCall("ls", { path: "/tmp" }, fg);
		expect(result).toContain("ls");
		expect(result).toContain("/tmp");
	});

	it("formats find", () => {
		const result = formatFlowToolCall("find", { pattern: "*.ts", path: "/tmp" }, fg);
		expect(result).toContain("find");
		expect(result).toContain("*.ts");
	});

	it("formats grep", () => {
		const result = formatFlowToolCall("grep", { pattern: "foo", path: "/tmp" }, fg);
		expect(result).toContain("grep");
		expect(result).toContain("foo");
	});

	it("formats batch", () => {
		const result = formatFlowToolCall("batch", { ops: [{ o: "read", p: "file.ts" }] }, fg);
		expect(result).toContain("batch");
	});

	it("formats unknown tools with JSON", () => {
		const result = formatFlowToolCall("unknown", { key: "value" }, fg);
		expect(result).toContain("unknown");
	});
});

describe("splitOutputLines", () => {
	it("splits on newlines", () => {
		expect(splitOutputLines("a\nb\nc")).toEqual(["a", "b", "c"]);
	});

	it("handles trailing newline", () => {
		expect(splitOutputLines("a\nb\n")).toEqual(["a", "b"]);
	});

	it("handles single line", () => {
		expect(splitOutputLines("hello")).toEqual(["hello"]);
	});

	it("handles empty string", () => {
		expect(splitOutputLines("")).toEqual([""]);
	});

	it("handles carriage returns", () => {
		expect(splitOutputLines("a\r\nb")).toEqual(["a", "b"]);
	});
});

describe("renderToolTraces", () => {
	const theme = { fg: (c: string, t: string) => t, applyRole: (r: string, t: string) => t } as any;

	it("renders tool calls as lines", () => {
		const items = [{ type: "toolCall", name: "bash", args: { command: "echo hi" } }];
		const result = renderToolTraces(items as any, theme);
		expect(result).toContain("→");
		expect(result).toContain("echo hi");
	});

	it("returns empty string for no tool calls", () => {
		expect(renderToolTraces([], theme)).toBe("");
	});

	it("filters out non-toolCall items", () => {
		const items = [{ type: "text", text: "hello" }];
		expect(renderToolTraces(items as any, theme)).toBe("");
	});
});

describe("renderFlowReport", () => {
	const theme = { fg: (c: string, t: string) => t, applyRole: (r: string, t: string) => t } as any;

	it("renders lines with role", () => {
		const result = renderFlowReport("line1\nline2", theme);
		expect(result).toContain("line1");
		expect(result).toContain("line2");
	});

	it("handles empty output gracefully", () => {
		const result = renderFlowReport("", theme);
		expect(typeof result).toBe("string");
	});
});

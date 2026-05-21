import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderBatchCall, renderBatchResult, renderBatchReadResult, renderBatchReadCall } from "../src/batch/render.js";
import type { BatchTheme } from "../src/batch/constants.js";
import { Container } from "@earendil-works/pi-tui";
import { scrambleManager } from "../src/tui/scramble/index.js";
import { stripAnsi } from "../src/tui/render-utils.js";

function makeTheme(): BatchTheme {
	const colors: Record<string, string> = {
		accent: "\x1b[36m",
		success: "\x1b[32m",
		error: "\x1b[31m",
		warning: "\x1b[33m",
		muted: "\x1b[90m",
		reset: "\x1b[0m",
	};
	return {
		fg: (color: string, text: string) => `${colors[color] || ""}${text}${colors.reset || ""}`,
		bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
	};
}

function extractText(node: any): string {
	let raw: string;
	if ("text" in node && typeof node.text === "string") {
		raw = node.text;
	} else if ("children" in node && Array.isArray(node.children)) {
		raw = node.children.map((child: any) => extractText(child)).join("\n");
	} else {
		raw = String(node);
	}
	return stripAnsi(raw);
}

function extractRawText(node: any): string {
	if ("text" in node && typeof node.text === "string") return node.text;
	if ("children" in node && Array.isArray(node.children)) {
		return node.children.map((child: any) => extractRawText(child)).join("\n");
	}
	return String(node);
}

beforeEach(() => {
	scrambleManager.setAnimationConfig({ enabled: false, glitch: false });
	scrambleManager.clear();
});

describe("renderBatchCall", () => {
	it("returns an empty Container (invisible call frame)", () => {
		const rendered = renderBatchCall({}, makeTheme());
		expect(rendered).toBeInstanceOf(Container);
		expect(extractText(rendered)).toBe("");
	});
});

describe("renderBatchReadCall", () => {
	it("returns an empty Container (invisible call frame)", () => {
		const rendered = renderBatchReadCall({}, makeTheme());
		expect(rendered).toBeInstanceOf(Container);
		expect(extractText(rendered)).toBe("");
	});
});

describe("renderBatchResult — tree mode", () => {
	it("renders header with op count, status tallies, and type breakdown", () => {
		const result = {
			details: {
				results: [
					{ op: "read" as const, path: "src/index.ts", status: "ok" as const, content: "// entry\n" },
					{ op: "bash" as const, command: "npm test", status: "error" as const, exitCode: 1, stdout: "" },
					{ op: "write" as const, path: "out.txt", status: "ok" as const, bytes: 42 },
				],
			},
		};
		const rendered = renderBatchResult(result, false, makeTheme());
		const text = extractText(rendered);
		// Header should contain: 3 ops, 2 ok, 1 err, 2 file, 1 bash
		expect(text).toContain("batch");
		expect(text).toContain("3 ops");
		expect(text).toContain("2 ok");
		expect(text).toContain("1 err");
		expect(text).toContain("2 file");
		expect(text).toContain("1 bash");
	});

	it("renders per-op tree lines with correct icons", () => {
		const result = {
			details: {
				results: [
					{ op: "write" as const, path: "a.ts", status: "ok" as const },
					{ op: "bash" as const, command: "npm test", status: "error" as const, exitCode: 1, stdout: "" },
					{ op: "write" as const, path: "b.ts", status: "skipped" as const },
					{ op: "edit" as const, path: "c.ts", status: "pending" as const },
				],
			},
		};
		const rendered = renderBatchResult(result, false, makeTheme());
		const text = extractText(rendered);
		expect(text).toContain("✓");
		expect(text).toContain("✗");
		expect(text).toContain("⊘");
		expect(text).toContain("○");
	});

	it("status colors map correctly to theme colors", () => {
		const theme = makeTheme();
		const result = {
			details: {
				results: [
					{ op: "read" as const, path: "ok.ts", status: "ok" as const, content: "ok" },
					{ op: "read" as const, path: "err.ts", status: "error" as const, error: "fail" },
					{ op: "read" as const, path: "skip.ts", status: "skipped" as const },
					{ op: "read" as const, path: "pend.ts", status: "pending" as const },
				],
			},
		};
		const rendered = renderBatchResult(result, false, theme);
		const raw = extractRawText(rendered);
		// accent (ok), error, muted (skipped), warning (pending)
		expect(raw).toContain(theme.fg("accent", "●"));
		expect(raw).toContain(theme.fg("error", "✗"));
		expect(raw).toContain(theme.fg("muted", "⊘"));
		expect(raw).toContain(theme.fg("warning", "○"));
	});

	it("uses tree-branch characters ├─ and └─", () => {
		const result = {
			details: {
				results: [
					{ op: "read" as const, path: "a.ts", status: "ok" as const, content: "x" },
					{ op: "read" as const, path: "b.ts", status: "ok" as const, content: "y" },
				],
			},
		};
		const rendered = renderBatchResult(result, false, makeTheme());
		const text = extractText(rendered);
		expect(text).toContain("├─");
		expect(text).toContain("└─");
	});

	it("expanded mode shows content preview for ok ops", () => {
		const result = {
			details: {
				results: [
					{
						op: "read" as const,
						path: "src/a.ts",
						status: "ok" as const,
						content: "line1\nline2\nline3\nline4",
					},
				],
			},
		};
		const rendered = renderBatchResult(result, true, makeTheme());
		const text = extractText(rendered);
		expect(text).toContain("line1");
		expect(text).toContain("line2");
		expect(text).toContain("line3");
		// line4 should not appear (preview is max 3 lines)
		const lines = text.split("\n");
		const previewLines = lines.filter((l) => /line\d/.test(l));
		expect(previewLines.length).toBe(3);
	});

	it("expanded mode hides preview for non-ok status", () => {
		const result = {
			details: {
				results: [
					{
						op: "bash" as const,
						command: "npm test",
						status: "error" as const,
						exitCode: 1,
						stdout: "FAILED",
					},
				],
			},
		};
		const rendered = renderBatchResult(result, true, makeTheme());
		const text = extractText(rendered);
		// No content preview under the error op
		expect(text).not.toContain("FAILED");
	});

	it("collapsed mode hides content preview", () => {
		const result = {
			details: {
				results: [
					{
						op: "read" as const,
						path: "src/a.ts",
						status: "ok" as const,
						content: "line1\nline2",
					},
				],
			},
		};
		const rendered = renderBatchResult(result, false, makeTheme());
		const text = extractText(rendered);
		expect(text).not.toContain("line1");
		expect(text).not.toContain("line2");
	});

	it("bash op shows exit code and duration in metadata", () => {
		const result = {
			details: {
				results: [
					{
						op: "bash" as const,
						command: "npm run build",
						status: "ok" as const,
						exitCode: 0,
						duration: 3456,
						stdout: "ok",
					},
				],
			},
		};
		const rendered = renderBatchResult(result, false, makeTheme());
		const text = extractText(rendered);
		expect(text).toContain("exit 0");
		expect(text).toContain("3.5s");
	});

	it("shortens HOME prefix to ~", () => {
		const originalHome = process.env.HOME;
		process.env.HOME = "/home/dev";
		try {
			const result = {
				details: {
					results: [
						{
							op: "read" as const,
							path: "/home/dev/project/src/index.ts",
							status: "ok" as const,
							content: "x",
						},
					],
				},
			};
			const rendered = renderBatchResult(result, false, makeTheme());
			const text = extractText(rendered);
			expect(text).toContain("~/project/src/index.ts");
			expect(text).not.toContain("/home/dev/project/src/index.ts");
		} finally {
			process.env.HOME = originalHome;
		}
	});

	it("reuses __rootContainer state key (container caching)", () => {
		const state: Record<string, any> = {};
		const args = { state, invalidate: () => {} };
		const result = {
			details: {
				results: [
					{ op: "read" as const, path: "a.ts", status: "ok" as const, content: "x" },
				],
			},
		};
		const rendered1 = renderBatchResult(result, false, makeTheme(), args);
		expect(state.__rootContainer).toBeDefined();
		const root1 = state.__rootContainer;

		const rendered2 = renderBatchResult(result, false, makeTheme(), args);
		const root2 = state.__rootContainer;
		// Same root container object reused
		expect(root2).toBe(root1);
		// Same root object returned (content replaced inside)
		expect(rendered2).toBe(rendered1);
	});

	it("read op metadata shows line count", () => {
		const result = {
			details: {
				results: [
					{
						op: "read" as const,
						path: "a.ts",
						status: "ok" as const,
						content: "1\n2\n3\n4\n5",
					},
				],
			},
		};
		const rendered = renderBatchResult(result, false, makeTheme());
		const text = extractText(rendered);
		expect(text).toContain("5 lines");
	});

	it("header omits zero tallies", () => {
		const result = {
			details: {
				results: [
					{ op: "read" as const, path: "a.ts", status: "ok" as const, content: "x" },
					{ op: "read" as const, path: "b.ts", status: "ok" as const, content: "y" },
				],
			},
		};
		const rendered = renderBatchResult(result, false, makeTheme());
		const text = extractText(rendered);
		expect(text).toContain("2 ops");
		expect(text).toContain("2 ok");
		expect(text).not.toMatch(/\d+ err/);
		expect(text).not.toMatch(/\d+ skipped/);
		expect(text).not.toMatch(/\d+ pending/);
	});

	it("error op shows truncated error in metadata", () => {
		const result = {
			details: {
				results: [
					{
						op: "read" as const,
						path: "a.ts",
						status: "error" as const,
						error: "This is a very long error message that should be truncated",
					},
				],
			},
		};
		const rendered = renderBatchResult(result, false, makeTheme());
		const text = extractText(rendered);
		expect(text).toContain("This is a very long error message tha...");
	});

	it("complete state shows ● for read/rg and ✓ for other ok ops", () => {
		const result = {
			details: {
				results: [
					{ op: "read" as const, path: "a.ts", status: "ok" as const, content: "x" },
					{ op: "rg" as const, path: ".", status: "ok" as const, content: "match\n" },
					{ op: "write" as const, path: "b.ts", status: "ok" as const },
				],
			},
		};
		const rendered = renderBatchResult(result, { expanded: false, isPartial: false }, makeTheme());
		const text = extractText(rendered);
		expect(text).toContain("●");
		expect(text).toContain("✓");
	});

	it("partial state shows ● for ok ops", () => {
		const result = {
			details: {
				results: [
					{ op: "read" as const, path: "docs/a.md", status: "ok" as const, totalLines: 47, content: "line\n".repeat(46) + "line" },
					{ op: "rg" as const, path: ".", status: "ok" as const, content: "m\n".repeat(21) },
					{ op: "rg" as const, path: ".", status: "ok" as const, content: "x\n".repeat(3) },
				],
			},
		};
		const rendered = renderBatchResult(result, { expanded: false, isPartial: true }, makeTheme());
		const text = extractText(rendered);
		expect(text).toContain("●");
		expect(text).not.toContain("✓");
		expect(text).toContain("47 lines");
	});

	it("partial ok uses warning color; complete ok uses accent", () => {
		const theme = makeTheme();
		const result = {
			details: {
				results: [{ op: "read" as const, path: "a.ts", status: "ok" as const, content: "x" }],
			},
		};
		const partialRaw = extractRawText(renderBatchResult(result, { expanded: false, isPartial: true }, theme));
		const completeRaw = extractRawText(renderBatchResult(result, { expanded: false, isPartial: false }, theme));
		expect(partialRaw).toContain(theme.fg("warning", "●"));
		expect(completeRaw).toContain(theme.fg("accent", "●"));
	});

	it("partial update pads tree with planned ops from ctx.args", () => {
		const result = {
			details: {
				results: [
					{ op: "read" as const, path: "docs/a.md", status: "ok" as const, totalLines: 5, content: "a\nb\nc\nd\ne" },
				],
			},
		};
		const ctx = {
			args: {
				o: [
					{ o: "read", p: "docs/a.md" },
					{ o: "rg", p: ".", q: "foo" },
					{ o: "rg", p: ".", q: "bar" },
				],
			},
		};
		const rendered = renderBatchReadResult(result, { expanded: false, isPartial: true }, makeTheme(), ctx);
		const text = extractText(rendered);
		const treeLines = text.split("\n").filter((l) => l.includes("├─") || l.includes("└─"));
		expect(treeLines).toHaveLength(3);
		expect(treeLines[0]).toContain("read:");
		expect(treeLines[0]).toContain("5 lines");
		expect(treeLines[1]).toContain("●");
		expect(treeLines[1]).toContain("rg:");
		expect(treeLines[2]).toContain("●");
		expect(treeLines[2]).toContain("rg:");
		expect(text).toContain("3 ops");
	});
});

describe("renderBatchReadResult", () => {
	it("uses 'batch_read' label in header", () => {
		const result = {
			details: {
				results: [
					{ op: "read" as const, path: "a.ts", status: "ok" as const, content: "x" },
				],
			},
		};
		const rendered = renderBatchReadResult(result, false, makeTheme());
		const text = extractText(rendered);
		expect(text).toContain("batch_read");
		expect(text).not.toContain("batch  ·");
	});
});

describe("renderBatchResult — legacy fallback", () => {
	it("falls back to legacy text rendering when details.results is missing", () => {
		const result = {
			content: [{ type: "text", text: "Summary line\nDetail line 1\nDetail line 2" }],
		};
		const rendered = renderBatchResult(result, false, makeTheme());
		const text = extractText(rendered);
		expect(text).toContain("Summary line");
	});

	it("legacy fallback uses TruncatedText when collapsed", () => {
		const result = {
			content: [{ type: "text", text: "First line\nSecond line" }],
		};
		const rendered = renderBatchResult(result, false, makeTheme());
		const text = extractText(rendered);
		// Only first line shown when collapsed
		expect(text).toContain("First line");
		expect(text).not.toContain("Second line");
	});

	it("legacy fallback shows full text when expanded", () => {
		const result = {
			content: [{ type: "text", text: "First line\nSecond line" }],
		};
		const rendered = renderBatchResult(result, true, makeTheme());
		const text = extractText(rendered);
		expect(text).toContain("First line");
		expect(text).toContain("Second line");
	});
});

describe("renderBatchResult — mixed op types in header", () => {
	it("counts file, web, and bash types correctly", () => {
		const result = {
			details: {
				results: [
					{ op: "read" as const, path: "a.ts", status: "ok" as const, content: "x" },
					{ op: "write" as const, path: "b.txt", status: "ok" as const, bytes: 10 },
					{ op: "edit" as const, path: "c.ts", status: "ok" as const, blocksChanged: 2 },
					{ op: "delete" as const, path: "d.ts", status: "ok" as const },
					{ op: "rg" as const, path: "src", status: "ok" as const, content: "match" },
					{ op: "patch" as const, path: "e.ts", status: "ok" as const },
					{ op: "search" as const, q: "test", status: "ok" as const },
					{ op: "fetch" as const, url: "https://example.com", status: "ok" as const },
					{ op: "bash" as const, command: "echo hi", status: "ok" as const, exitCode: 0, stdout: "hi" },
				],
			},
		};
		const rendered = renderBatchResult(result, false, makeTheme());
		const text = extractText(rendered);
		// 6 file ops (read, write, edit, delete, rg, patch)
		expect(text).toContain("6 file");
		// 2 web ops (search, fetch)
		expect(text).toContain("2 web");
		// 1 bash op
		expect(text).toContain("1 bash");
		// Total
		expect(text).toContain("9 ops");
	});
});

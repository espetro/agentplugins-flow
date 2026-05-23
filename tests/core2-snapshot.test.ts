import { describe, it, expect } from "vitest";
import { buildCore2Snapshot } from "../src/core2/snapshot.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSource(entries: unknown[]) {
	return {
		getHeader: () => ({ version: 1, id: "test-session" }),
		getBranch: () => entries,
	};
}

function parseSnapshot(snapshot: string | null): unknown[] {
	if (!snapshot) return [];
	return snapshot
		.trimEnd()
		.split("\n")
		.filter((l) => l.length > 0)
		.map((l) => JSON.parse(l));
}

function makeSnapshot(entries: unknown[]): string {
	return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Retention tests — non-batch content preserved verbatim
// ---------------------------------------------------------------------------

describe("buildCore2Snapshot — retention", () => {
	it("returns null when header is null", () => {
		const source = { getHeader: () => null, getBranch: () => [] };
		expect(buildCore2Snapshot(source)).toBeNull();
	});

	it("preserves header and branch verbatim when no tool results", () => {
		const entries = [
			{ type: "message", message: { role: "user", content: "Hello" } },
			{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "Hi" }] } },
		];
		const snapshot = buildCore2Snapshot(makeSource(entries));
		const parsed = parseSnapshot(snapshot);
		expect(parsed).toHaveLength(3); // header + 2 messages
		expect(parsed[0]).toMatchObject({ version: 1, id: "test-session" });
		expect(parsed[1]).toMatchObject({ type: "message", message: { role: "user", content: "Hello" } });
		expect(parsed[2]).toMatchObject({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "Hi" }] } });
	});

	it("preserves non-batch tool results verbatim", () => {
		const entries = [
			{
				type: "message",
				message: {
					role: "toolResult",
					toolCallId: "bash-1",
					content: [{ type: "text", text: "hello\nworld" }],
				},
			},
		];
		const snapshot = buildCore2Snapshot(makeSource(entries));
		const parsed = parseSnapshot(snapshot);
		const toolMsg = parsed.find((e: any) => e.message?.role === "toolResult");
		expect(toolMsg.message.content[0].text).toBe("hello\nworld");
	});

	it("preserves system messages verbatim", () => {
		const entries = [
			{ type: "message", message: { role: "system", content: "<pi-flow-steering-hint>Steer</pi-flow-steering-hint>" } },
		];
		const snapshot = buildCore2Snapshot(makeSource(entries));
		expect(snapshot).toContain("<pi-flow-steering-hint>");
	});

	it("strips assistant reasoning and thinking", () => {
		const entries = [
			{
				type: "message",
				message: {
					role: "assistant",
					thinking: "SECRET_THINKING",
					reasoning: "SECRET_REASONING",
					content: [
						{ type: "thinking", text: "THINKING_PART" },
						{ type: "text", text: "Visible text" },
					],
				},
			},
		];
		const snapshot = buildCore2Snapshot(makeSource(entries));
		expect(snapshot).not.toContain("SECRET_THINKING");
		expect(snapshot).not.toContain("SECRET_REASONING");
		expect(snapshot).not.toContain("THINKING_PART");
		expect(snapshot).toContain("Visible text");
	});

	it("preserves flow tool calls and results verbatim", () => {
		const entries = [
			{
				type: "message",
				message: {
					role: "assistant",
					content: [
						{ type: "toolCall", name: "flow", toolCallId: "flow-1", arguments: { flow: [{ type: "scout" }] } },
					],
				},
			},
			{
				type: "message",
				message: {
					role: "toolResult",
					toolCallId: "flow-1",
					content: [{ type: "text", text: "Prior flow result should be inherited verbatim" }],
				},
			},
		];
		const snapshot = buildCore2Snapshot(makeSource(entries));
		expect(snapshot).toContain("Prior flow result should be inherited verbatim");
		expect(snapshot).toContain('"name":"flow"');
	});

	it("preserves batch bash and rg sections verbatim", () => {
		const batchText =
			"✔ 1 bash\n\n" +
			"--- bash [abc] exit 0 ---\n" +
			"[Execution time: 0.5s]\n" +
			"output line 1\n" +
			"output line 2\n\n" +
			"--- rg: pattern ---\n" +
			"src/a.ts:1:match\n" +
			"src/b.ts:2:match";
		const entries = [
			{
				type: "message",
				message: {
					role: "toolResult",
					toolCallId: "batch-1",
					content: [{ type: "text", text: batchText }],
				},
			},
		];
		const snapshot = buildCore2Snapshot(makeSource(entries));
		expect(snapshot).toContain("output line 1");
		expect(snapshot).toContain("output line 2");
		expect(snapshot).toContain("src/a.ts:1:match");
		expect(snapshot).toContain("src/b.ts:2:match");
	});
});

// ---------------------------------------------------------------------------
// Chronology tests — order maintained
// ---------------------------------------------------------------------------

describe("buildCore2Snapshot — chronology", () => {
	it("maintains exact chronological order of all messages", () => {
		const entries = [
			{ type: "message", message: { role: "user", content: "A", id: "1" } },
			{ type: "message", message: { role: "assistant", content: "B", id: "2" } },
			{ type: "message", message: { role: "toolResult", toolCallId: "tc1", content: "C", id: "3" } },
			{ type: "message", message: { role: "assistant", content: "D", id: "4" } },
			{ type: "message", message: { role: "user", content: "E", id: "5" } },
		];
		const snapshot = buildCore2Snapshot(makeSource(entries));
		const parsed = parseSnapshot(snapshot);
		expect(parsed.slice(1).map((e: any) => e.message?.id)).toEqual(["1", "2", "3", "4", "5"]);
	});

	it("does not drop or reorder messages", () => {
		const entries = [
			{ type: "message", message: { role: "system", content: "system" } },
			{ type: "message", message: { role: "user", content: "user" } },
			{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "assistant" }] } },
			{ type: "message", message: { role: "tool", toolCallId: "tc1", content: "tool" } },
		];
		const snapshot = buildCore2Snapshot(makeSource(entries));
		const parsed = parseSnapshot(snapshot);
		expect(parsed).toHaveLength(5);
		expect(parsed[1]).toMatchObject({ type: "message", message: { role: "system" } });
		expect(parsed[2]).toMatchObject({ type: "message", message: { role: "user" } });
		expect(parsed[3]).toMatchObject({ type: "message", message: { role: "assistant" } });
		expect(parsed[4]).toMatchObject({ type: "message", message: { role: "tool" } });
	});
});

// ---------------------------------------------------------------------------
// Nuance tests — batch body stripping
// ---------------------------------------------------------------------------

describe("buildCore2Snapshot — nuance (batch body stripping)", () => {
	it("strips read body keeping first 3 + last 3 lines", () => {
		const content =
			"line 1\n" +
			"line 2\n" +
			"line 3\n" +
			"line 4\n" +
			"line 5\n" +
			"line 6\n" +
			"line 7\n" +
			"line 8\n" +
			"line 9\n" +
			"line 10";
		const batchText = `✔ 1 read\n\n--- src/file.ts (10 lines) ---\n${content}`;
		const entries = [
			{
				type: "message",
				message: {
					role: "toolResult",
					toolCallId: "batch-1",
					content: [{ type: "text", text: batchText }],
				},
			},
		];
		const snapshot = buildCore2Snapshot(makeSource(entries));
		expect(snapshot).toContain("line 1");
		expect(snapshot).toContain("line 2");
		expect(snapshot).toContain("line 3");
		expect(snapshot).toContain("[...4 lines truncated...]");
		expect(snapshot).toContain("line 8");
		expect(snapshot).toContain("line 9");
		expect(snapshot).toContain("line 10");
		expect(snapshot).not.toContain("line 4\n");
		expect(snapshot).not.toContain("line 5\n");
		expect(snapshot).not.toContain("line 6\n");
		expect(snapshot).not.toContain("line 7\n");
	});

	it("strips write body keeping first 3 + last 3 lines", () => {
		const body = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj";
		const batchText = `✔ 1 write\n\n--- write: src/out.ts (20 bytes) ---\n${body}`;
		const entries = [
			{
				type: "message",
				message: {
					role: "toolResult",
					toolCallId: "batch-1",
					content: [{ type: "text", text: batchText }],
				},
			},
		];
		const snapshot = buildCore2Snapshot(makeSource(entries));
		expect(snapshot).toContain("--- write: src/out.ts (20 bytes) ---");
		expect(snapshot).toContain("a");
		expect(snapshot).toContain("b");
		expect(snapshot).toContain("c");
		expect(snapshot).toContain("[...4 lines truncated...]");
		expect(snapshot).toContain("h");
		expect(snapshot).toContain("i");
		expect(snapshot).toContain("j");
	});

	it("strips edit body keeping first 3 + last 3 lines", () => {
		const body = "x\ny\nz\n1\n2\n3\n4\n5\n6\n7";
		const batchText = `✔ 1 edit\n\n--- edit: src/file.ts (2 blocks) ---\n${body}`;
		const entries = [
			{
				type: "message",
				message: {
					role: "toolResult",
					toolCallId: "batch-1",
					content: [{ type: "text", text: batchText }],
				},
			},
		];
		const snapshot = buildCore2Snapshot(makeSource(entries));
		expect(snapshot).toContain("--- edit: src/file.ts (2 blocks) ---");
		expect(snapshot).toContain("x");
		expect(snapshot).toContain("y");
		expect(snapshot).toContain("z");
		expect(snapshot).toContain("[...4 lines truncated...]");
		expect(snapshot).toContain("5");
		expect(snapshot).toContain("6");
		expect(snapshot).toContain("7");
	});

	it("keeps small bodies intact (<= 6 lines)", () => {
		const body = "a\nb\nc\nd\ne\nf";
		const batchText = `✔ 1 read\n\n--- src/short.ts (6 lines) ---\n${body}`;
		const entries = [
			{
				type: "message",
				message: {
					role: "toolResult",
					toolCallId: "batch-1",
					content: [{ type: "text", text: batchText }],
				},
			},
		];
		const snapshot = buildCore2Snapshot(makeSource(entries));
		expect(snapshot).toContain("a");
		expect(snapshot).toContain("b");
		expect(snapshot).toContain("c");
		expect(snapshot).toContain("d");
		expect(snapshot).toContain("e");
		expect(snapshot).toContain("f");
		expect(snapshot).not.toContain("truncated");
	});

	it("strips context map / file summary bodies", () => {
		const body = "Total lines: 100\nLanguage: ts\n\nContext map:\n- class Foo 1-10\n- class Bar 11-20\n- class Baz 21-30\n- class Qux 31-40\n- class Quux 41-50";
		const batchText = `✔ 1 read\n\n--- src/large.ts context map ---\n${body}`;
		const entries = [
			{
				type: "message",
				message: {
					role: "toolResult",
					toolCallId: "batch-1",
					content: [{ type: "text", text: batchText }],
				},
			},
		];
		const snapshot = buildCore2Snapshot(makeSource(entries));
		expect(snapshot).toContain("--- src/large.ts context map ---");
		expect(snapshot).toContain("Total lines: 100");
		expect(snapshot).toContain("Language: ts");
		expect(snapshot).toContain("[...3 lines truncated...]");
		expect(snapshot).toContain("class Quux 41-50");
		expect(snapshot).not.toContain("Context map:");
	});

	it("strips multiple batch sections in a single result", () => {
		const text =
			"✔ 2 reads\n\n" +
			"--- src/a.ts (10 lines) ---\n" +
			"a1\na2\na3\na4\na5\na6\na7\na8\na9\na10\n\n" +
			"--- src/b.ts (8 lines) ---\n" +
			"b1\nb2\nb3\nb4\nb5\nb6\nb7\nb8";
		const entries = [
			{
				type: "message",
				message: {
					role: "toolResult",
					toolCallId: "batch-1",
					content: [{ type: "text", text }],
				},
			},
		];
		const snapshot = buildCore2Snapshot(makeSource(entries));
		const parsed = parseSnapshot(snapshot);
		const toolMsg = parsed.find((e: any) => e.message?.role === "toolResult") as any;
		const textContent = toolMsg.message.content[0].text;
		// a.ts body has 11 lines (including trailing empty before next header)
		expect(textContent).toContain("a1");
		expect(textContent).toContain("a2");
		expect(textContent).toContain("a3");
		expect(textContent).toContain("[...5 lines truncated...]");
		expect(textContent).toContain("a9");
		expect(textContent).toContain("a10");
		// b.ts: 8 lines -> 3 + trunc + 2 (8-6=2)
		expect(textContent).toContain("b1");
		expect(textContent).toContain("b2");
		expect(textContent).toContain("b3");
		expect(textContent).toContain("[...2 lines truncated...]");
		expect(textContent).toContain("b7");
		expect(textContent).toContain("b8");
	});

	it("preserves user messages that happen to contain --- headers", () => {
		const entries = [
			{
				type: "message",
				message: {
					role: "user",
					content: "Here is a markdown block:\n--- file.ts (10 lines) ---\nline 1\nline 2",
				},
			},
		];
		const snapshot = buildCore2Snapshot(makeSource(entries));
		expect(snapshot).toContain("line 1");
		expect(snapshot).toContain("line 2");
		expect(snapshot).not.toContain("truncated");
	});

	it("handles string content in tool results", () => {
		const batchText = "✔ 1 read\n\n--- src/file.ts (8 lines) ---\nl1\nl2\nl3\nl4\nl5\nl6\nl7\nl8";
		const entries = [
			{
				type: "message",
				message: {
					role: "tool",
					toolCallId: "batch-1",
					content: batchText,
				},
			},
		];
		const snapshot = buildCore2Snapshot(makeSource(entries));
		expect(snapshot).toContain("l1");
		expect(snapshot).toContain("l2");
		expect(snapshot).toContain("l3");
		expect(snapshot).toContain("[...2 lines truncated...]");
		expect(snapshot).toContain("l7");
		expect(snapshot).toContain("l8");
	});

	it("compresses cwd in header to relative path", () => {
		const source = {
			getHeader: () => ({ version: 1, cwd: process.cwd() + "/subdir" }),
			getBranch: () => [],
		};
		const snapshot = buildCore2Snapshot(source);
		expect(snapshot).toContain('"cwd":"subdir"');
	});

	it("skips header injection when branch already starts with identical header", () => {
		const header = { version: 1, id: "session-1", type: "session" };
		const source = {
			getHeader: () => header,
			getBranch: () => [header, { type: "message", message: { role: "user", content: "Hi" } }],
		};
		const snapshot = buildCore2Snapshot(source);
		const parsed = parseSnapshot(snapshot);
		expect(parsed).toHaveLength(2);
		expect(parsed[0]).toMatchObject({ version: 1, id: "session-1", type: "session" });
	});

	it("strips activeToolCallId matching tool call and omits empty assistant message", () => {
		const entries = [
			{ type: "message", message: { role: "user", content: "Hi" } },
			{
				type: "message",
				message: {
					role: "assistant",
					content: [
						{ type: "toolCall", id: "active-call-1", name: "trace" }
					]
				}
			}
		];
		const snapshot = buildCore2Snapshot(makeSource(entries), { activeToolCallId: "active-call-1" });
		const parsed = parseSnapshot(snapshot);
		expect(parsed).toHaveLength(2); // header + 1 message (user)
		expect(parsed[1]).toMatchObject({ type: "message", message: { role: "user", content: "Hi" } });
	});

	it("keeps assistant message when it contains other substance/tool calls after filtering", () => {
		const entries = [
			{
				type: "message",
				message: {
					role: "assistant",
					content: [
						{ type: "text", text: "some text" },
						{ type: "toolCall", id: "active-call-1", name: "trace" }
					]
				}
			}
		];
		const snapshot = buildCore2Snapshot(makeSource(entries), { activeToolCallId: "active-call-1" });
		const parsed = parseSnapshot(snapshot);
		expect(parsed).toHaveLength(2); // header + assistant message
		expect(parsed[1].message.content).toHaveLength(1);
		expect(parsed[1].message.content[0]).toMatchObject({ type: "text", text: "some text" });
	});
});

// ---------------------------------------------------------------------------
// Compaction filtering tests
// ---------------------------------------------------------------------------

describe("buildCore2Snapshot — compaction filtering", () => {
	it("strips compaction_trigger entries entirely", () => {
		const entries = [
			{ type: "compaction_trigger", trigger: "manual" },
			{ type: "message", message: { role: "user", content: "Keep" } },
		];
		const snapshot = buildCore2Snapshot(makeSource(entries));
		const parsed = parseSnapshot(snapshot);
		expect(parsed).toHaveLength(2); // header + 1 message
		expect(parsed[1]).toMatchObject({ type: "message", message: { content: "Keep" } });
		expect(snapshot).not.toContain("compaction_trigger");
	});

	it("summarizes compaction entries", () => {
		const entries = [
			{
				type: "compaction",
				summary: "Everything so far.",
				tokensBefore: 1000,
				encrypted_content: "HUGE_ENCRYPTED_BLOB",
			},
		];
		const snapshot = buildCore2Snapshot(makeSource(entries));
		const parsed = parseSnapshot(snapshot);
		expect(parsed).toHaveLength(2); // header + 1 message
		expect(parsed[1]).toMatchObject({
			type: "message",
			message: {
				role: "system",
				content: "[Context Compacted] Everything so far. (1000 tokens summarized)",
			},
		});
		expect(snapshot).not.toContain("HUGE_ENCRYPTED_BLOB");
	});

	it("summarizes context_compaction entries with fallback summary", () => {
		const entries = [
			{
				type: "context_compaction",
				tokensBefore: 500,
			},
		];
		const snapshot = buildCore2Snapshot(makeSource(entries));
		const parsed = parseSnapshot(snapshot);
		expect(parsed[1]).toMatchObject({
			type: "message",
			message: {
				content: "[Context Compacted] Parent context was compacted. (500 tokens summarized)",
			},
		});
	});
});

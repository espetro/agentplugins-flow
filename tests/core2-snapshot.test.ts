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
		expect(parsed).toHaveLength(4); // header + context map + 2 messages
		expect(parsed[0]).toMatchObject({ version: 1, id: "test-session" });
		expect(parsed[1]).toMatchObject({ type: "message", message: { role: "system", content: expect.stringContaining("[SHARED CONTEXT]") } });
		expect(parsed[2]).toMatchObject({ type: "message", message: { role: "user", content: "Hello" } });
		expect(parsed[3]).toMatchObject({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "Hi" }] } });
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

	it("preserves id and strips parentId from entries", () => {
		const entry = { type: "message", id: "msg-1", parentId: "parent-abc", message: { role: "user", content: "hi" } };
		const snapshot = buildCore2Snapshot(makeSource([entry]));
		expect(snapshot).toContain('"id":"msg-1"');
		expect(snapshot).not.toContain("parentId");
	});

	it("strips toolCallId from tool and toolResult messages", () => {
		const entry = {
			type: "message",
			message: { role: "toolResult", toolCallId: "tc-1", content: [{ type: "text", text: "output" }] },
		};
		const snapshot = buildCore2Snapshot(makeSource([entry]));
		expect(snapshot).not.toContain("tc-1");
		expect(snapshot).not.toContain("toolCallId");
		expect(snapshot).toContain("output");
	});

	it("strips directive blocks from tool result text", () => {
		const text =
			"✔ 1 read\n--- src/file.ts (3 lines) ---\na\nb\nc\n\n[Directive: Close what you start. Dispatch a [build] or [scout] flow to verify before advancing.]";
		const entry = {
			type: "message",
			message: { role: "toolResult", content: [{ type: "text", text }] },
		};
		const snapshot = buildCore2Snapshot(makeSource([entry]));
		expect(snapshot).not.toContain("[Directive:");
		expect(snapshot).toContain("--- src/file.ts (3 lines) ---");
		expect(snapshot).toContain("a");
	});

	it("strips directive blocks from non-batch tool result text", () => {
		const text =
			"exit 0\n\n[Directive: Close what you start. Dispatch a [build] or [scout] flow to verify before advancing.]";
		const entry = {
			type: "message",
			message: { role: "toolResult", content: [{ type: "text", text }] },
		};
		const snapshot = buildCore2Snapshot(makeSource([entry]));
		expect(snapshot).not.toContain("[Directive:");
		expect(snapshot).not.toContain("Dispatch a [build]");
		expect(snapshot).toContain("exit 0");
	});

	it("strips legacy [Hint:] blocks from tool result text", () => {
		const text = "hello world\n\n[Hint: Do something useful.]";
		const entry = {
			type: "message",
			message: { role: "toolResult", content: [{ type: "text", text }] },
		};
		const snapshot = buildCore2Snapshot(makeSource([entry]));
		expect(snapshot).not.toContain("[Hint:");
		expect(snapshot).not.toContain("Do something useful");
		expect(snapshot).toContain("hello world");
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
		expect(parsed.slice(2).map((e: any) => e.message?.id)).toEqual(["1", "2", "3", "4", "5"]);
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
		expect(parsed).toHaveLength(6);
		expect(parsed[1]).toMatchObject({ type: "message", message: { role: "system", content: expect.stringContaining("[SHARED CONTEXT]") } });
		expect(parsed[2]).toMatchObject({ type: "message", message: { role: "system" } });
		expect(parsed[3]).toMatchObject({ type: "message", message: { role: "user" } });
		expect(parsed[4]).toMatchObject({ type: "message", message: { role: "assistant" } });
		expect(parsed[5]).toMatchObject({ type: "message", message: { role: "tool" } });
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
		expect(parsed).toHaveLength(3);
		expect(parsed[0]).toMatchObject({ version: 1, type: "session" });
		expect(parsed[0]).toHaveProperty("id", "session-1");
		expect(parsed[1]).toMatchObject({ type: "message", message: { role: "system", content: expect.stringContaining("[SHARED CONTEXT]") } });
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
		expect(parsed).toHaveLength(3); // header + context map + 1 message (user)
		expect(parsed[1]).toMatchObject({ type: "message", message: { role: "system", content: expect.stringContaining("[SHARED CONTEXT]") } });
		expect(parsed[2]).toMatchObject({ type: "message", message: { role: "user", content: "Hi" } });
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
		expect(parsed).toHaveLength(3); // header + context map + assistant message
		expect(parsed[1]).toMatchObject({ type: "message", message: { role: "system", content: expect.stringContaining("[SHARED CONTEXT]") } });
		expect(parsed[2].message.content).toHaveLength(1);
		expect(parsed[2].message.content[0]).toMatchObject({ type: "text", text: "some text" });
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
		expect(parsed).toHaveLength(3); // header + context map + 1 message
		expect(parsed[1]).toMatchObject({ type: "message", message: { role: "system", content: expect.stringContaining("[SHARED CONTEXT]") } });
		expect(parsed[2]).toMatchObject({ type: "message", message: { content: "Keep" } });
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
		expect(parsed).toHaveLength(3); // header + context map + 1 message
		expect(parsed[1]).toMatchObject({ type: "message", message: { role: "system", content: expect.stringContaining("[SHARED CONTEXT]") } });
		expect(parsed[2]).toMatchObject({
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
		expect(parsed[1]).toMatchObject({ type: "message", message: { role: "system", content: expect.stringContaining("[SHARED CONTEXT]") } });
		expect(parsed[2]).toMatchObject({
			type: "message",
			message: {
				content: "[Context Compacted] Parent context was compacted. (500 tokens summarized)",
			},
		});
	});

	it("strips API metadata and slims usage to context fields only", () => {
		const entries = [
			{
				type: "message",
				id: "msg-1",
				timestamp: "2026-05-23T15:35:19.588Z",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "Hello" }],
					api: "openai-completions",
					provider: "fireworks.ai",
					model: "kimi-k2p6-turbo",
					usage: { input: 100, output: 200, totalTokens: 300 },
					cost: { input: 0.001, output: 0.002, total: 0.003 },
					stopReason: "stop",
					responseId: "resp-123",
					responseModel: "kimi-k2p6",
					timestamp: 1779550519587,
				},
			},
			{
				type: "message",
				id: "msg-2",
				timestamp: "2026-05-23T15:35:21.164Z",
				message: {
					role: "toolResult",
					toolCallId: "bash-1",
					toolName: "bash",
					content: [{ type: "text", text: "exit 0" }],
					details: { results: [{ op: "run", status: "success" }] },
					isError: false,
					timestamp: 1779550521164,
				},
			},
		];
		const snapshot = buildCore2Snapshot(makeSource(entries));
		const parsed = parseSnapshot(snapshot);
		
		// Header (first entry) should not contain timestamp
		expect(parsed[0]).not.toHaveProperty("timestamp");

		// Context map
		expect(parsed[1]).toMatchObject({ type: "message", message: { role: "system", content: expect.stringContaining("[SHARED CONTEXT]") } });

		// Message 1 checks
		const msg1 = parsed[2] as any;
		expect(msg1).not.toHaveProperty("timestamp");
		expect(msg1.message).not.toHaveProperty("api");
		expect(msg1.message).not.toHaveProperty("provider");
		expect(msg1.message).not.toHaveProperty("model");
		expect(msg1.message.usage).toEqual({
			input: 100,
			output: 200,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 300,
		});
		expect(msg1.message).not.toHaveProperty("cost");
		expect(msg1.message).toHaveProperty("stopReason", "stop");
		expect(msg1.message).not.toHaveProperty("responseId");
		expect(msg1.message).not.toHaveProperty("responseModel");
		expect(msg1.message).not.toHaveProperty("timestamp");
		expect(msg1.message.content[0].text).toBe("Hello");

		// Message 2 checks
		const msg2 = parsed[3] as any;
		expect(msg2).not.toHaveProperty("timestamp");
		expect(msg2.message).not.toHaveProperty("details");
		expect(msg2.message).not.toHaveProperty("isError");
		expect(msg2.message).not.toHaveProperty("timestamp");
		expect(msg2.message.content[0].text).toBe("exit 0");
	});
});

// ---------------------------------------------------------------------------
// Tier-based compression tests
// ---------------------------------------------------------------------------

describe("buildCore2Snapshot — tier compression", () => {
	it("all tiers preserve toolResult content and optimize it (no placeholders)", () => {
		const entries = [
			{
				type: "message",
				message: {
					role: "toolResult",
					name: "trace",
					content: [{ type: "text", text: "verbatim output preserved" }],
				},
			},
		];
		const snapshot = buildCore2Snapshot(makeSource(entries), { tier: "lite" });
		expect(snapshot).toContain("verbatim output preserved");
		expect(snapshot).not.toContain("[toolResult: trace]");
	});

	it("verbose standalone bash output (> 50 lines) is truncated to 30 head and 20 tail lines", () => {
		const body = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n");
		const entries = [
			{
				type: "message",
				message: {
					role: "toolResult",
					name: "bash",
					content: [{ type: "text", text: body }],
				},
			},
		];
		const snapshot = buildCore2Snapshot(makeSource(entries));
		const parsed = parseSnapshot(snapshot);
		const toolMsg = parsed.find((e: any) => e.message?.role === "toolResult") as any;
		const textContent = toolMsg.message.content[0].text;
		expect(textContent).toContain("line 1\nline 2\nline 3");
		expect(textContent).toContain("line 30");
		expect(textContent).toContain("[...10 lines of bash output truncated...]");
		expect(textContent).toContain("line 41");
		expect(textContent).toContain("line 60");
		expect(textContent).not.toContain("line 31\n");
	});

	it("verbose batched bash section output (> 50 lines) is truncated to 30 head and 20 tail lines", () => {
		const body = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n");
		const batchText = `✔ 1 bash\n\n--- bash [abc] exit 0 ---\n${body}`;
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
		const parsed = parseSnapshot(snapshot);
		const toolMsg = parsed.find((e: any) => e.message?.role === "toolResult") as any;
		const textContent = toolMsg.message.content[0].text;
		expect(textContent).toContain("line 1\nline 2\nline 3");
		expect(textContent).toContain("line 30");
		expect(textContent).toContain("[...10 lines of bash output truncated...]");
		expect(textContent).toContain("line 41");
		expect(textContent).toContain("line 60");
		expect(textContent).not.toContain("line 31\n");
	});

	it("message limit is always applied (defaults to 80) regardless of tier option", () => {
		const entries = Array.from({ length: 100 }, (_, i) => ({
			type: "message",
			message: { role: "user" as const, content: `msg-${i}` },
		}));
		const snapshot = buildCore2Snapshot(makeSource(entries));
		const parsed = parseSnapshot(snapshot);
		// header + context map + 80 messages = 82 total
		expect(parsed).toHaveLength(82);
		expect(snapshot).toContain("msg-99");
		expect(snapshot).toContain("msg-20");
		expect(snapshot).not.toContain("msg-19");
	});

	it("all tiers respect PI_FLOW_MAX_MESSAGES env override", () => {
		const previous = process.env.PI_FLOW_MAX_MESSAGES;
		process.env.PI_FLOW_MAX_MESSAGES = "5";
		try {
			const entries = Array.from({ length: 10 }, (_, i) => ({
				type: "message",
				message: { role: "user" as const, content: `msg-${i}` },
			}));
			const snapshot = buildCore2Snapshot(makeSource(entries));
			const parsed = parseSnapshot(snapshot);
			expect(parsed).toHaveLength(7); // header + context map + 5
		} finally {
			if (previous === undefined) {
				delete process.env.PI_FLOW_MAX_MESSAGES;
			} else {
				process.env.PI_FLOW_MAX_MESSAGES = previous;
			}
		}
	});

	it("message limit preserves session header inside branchEntries", () => {
		const entries: unknown[] = [
			{ type: "session", id: "test-session", version: 1 },
			...Array.from({ length: 100 }, (_, i) => ({
				type: "message" as const,
				message: { role: "user" as const, content: `msg-${i}` },
			})),
		];
		const source = {
			getHeader: () => ({ version: 1, id: "test-session" }),
			getBranch: () => entries,
		};
		const snapshot = buildCore2Snapshot(source);
		const parsed = parseSnapshot(snapshot);
		// Header inside branch + context map + 80 messages = 82 total
		expect(parsed).toHaveLength(82);
		expect(parsed[0]).toMatchObject({ type: "session", id: "test-session" });
		expect(snapshot).toContain("msg-99");
		expect(snapshot).toContain("msg-20");
		expect(snapshot).not.toContain("msg-19");
	});

	it("deduplicates repeated identical bash commands, keeping only the latest run's output", () => {
		const entries = [
			// Turn 1
			{
				type: "message",
				message: {
					role: "assistant",
					content: [
						{ type: "toolCall", id: "bash-1", name: "bash", arguments: { command: "npm run build" } }
					]
				}
			},
			{
				type: "message",
				message: {
					role: "toolResult",
					toolCallId: "bash-1",
					content: [{ type: "text", text: "first build failed" }]
				}
			},
			// Turn 2
			{
				type: "message",
				message: {
					role: "assistant",
					content: [
						{ type: "toolCall", id: "bash-2", name: "bash", arguments: { command: "npm run build" } }
					]
				}
			},
			{
				type: "message",
				message: {
					role: "toolResult",
					toolCallId: "bash-2",
					content: [{ type: "text", text: "second build passed" }]
				}
			}
		];
		const snapshot = buildCore2Snapshot(makeSource(entries));
		const parsed = parseSnapshot(snapshot);
		
		// First toolResult should be omitted/replaced with placeholder
		const firstResult = parsed.find((e: any) => e.message?.content?.[0]?.text && e.message.content[0].text.includes("Bash output omitted")) as any;
		expect(firstResult).toBeDefined();
		expect(firstResult.message.content[0].text).toBe("[Bash output omitted; command was re-run later]");

		// Second toolResult should be preserved verbatim
		const secondResult = parsed.find((e: any) => e.message?.content?.[0]?.text && e.message.content[0].text.includes("second build passed")) as any;
		expect(secondResult).toBeDefined();
	});

	it("deduplicates repeated read/write/edit operations on the same file path", () => {
		const entries = [
			// Turn 1
			{
				type: "message",
				message: {
					role: "assistant",
					content: [
						{ type: "toolCall", id: "batch-1", name: "batch_read", arguments: { o: [{ o: "read", p: "src/a.ts" }] } }
					]
				}
			},
			{
				type: "message",
				message: {
					role: "toolResult",
					toolCallId: "batch-1",
					content: [{ type: "text", text: "file a content old" }]
				}
			},
			// Turn 2
			{
				type: "message",
				message: {
					role: "assistant",
					content: [
						{ type: "toolCall", id: "batch-2", name: "batch_read", arguments: { o: [{ o: "read", p: "src/a.ts" }] } }
					]
				}
			},
			{
				type: "message",
				message: {
					role: "toolResult",
					toolCallId: "batch-2",
					content: [{ type: "text", text: "file a content new" }]
				}
			}
		];
		const snapshot = buildCore2Snapshot(makeSource(entries));
		const parsed = parseSnapshot(snapshot);

		// First toolResult should be omitted/replaced with placeholder
		const firstResult = parsed.find((e: any) => e.message?.content?.[0]?.text && e.message.content[0].text.includes("File read output omitted")) as any;
		expect(firstResult).toBeDefined();
		expect(firstResult.message.content[0].text).toBe("[File read output omitted; file was accessed/modified later]");

		// Second toolResult should be preserved verbatim
		const secondResult = parsed.find((e: any) => e.message?.content?.[0]?.text && e.message.content[0].text.includes("file a content new")) as any;
		expect(secondResult).toBeDefined();
	});
});

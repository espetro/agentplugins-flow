import { describe, it, expect } from "vitest";

/**
 * Test helpers extracted from src/core2/snapshot.ts to verify
 * naming normalization behavior.
 */
function normalizeToolCalls(msg: unknown): unknown[] {
	if (!msg || typeof msg !== "object") return [];
	const m = msg as Record<string, unknown>;
	const tcs = m.toolCalls ?? m.tool_calls;
	if (Array.isArray(tcs)) return tcs;
	return [];
}

function normalizeToolCallId(tc: unknown): string | undefined {
	if (!tc || typeof tc !== "object") return undefined;
	const t = tc as Record<string, unknown>;
	return (t.id as string | undefined) || (t.toolCallId as string | undefined) || (t.tool_call_id as string | undefined);
}

describe("normalizeToolCalls", () => {
	it("returns empty array for null message", () => {
		expect(normalizeToolCalls(null)).toEqual([]);
	});

	it("returns empty array for primitive message", () => {
		expect(normalizeToolCalls("string")).toEqual([]);
		expect(normalizeToolCalls(42)).toEqual([]);
	});

	it("reads camelCase toolCalls", () => {
		const msg = { toolCalls: [{ id: "tc1" }, { id: "tc2" }] };
		expect(normalizeToolCalls(msg)).toHaveLength(2);
	});

	it("reads snake_case tool_calls", () => {
		const msg = { tool_calls: [{ id: "tc1" }, { id: "tc2" }] };
		expect(normalizeToolCalls(msg)).toHaveLength(2);
	});

	it("prefers camelCase over snake_case", () => {
		const msg = { toolCalls: [{ id: "a" }], tool_calls: [{ id: "b" }] };
		const result = normalizeToolCalls(msg);
		expect(result).toHaveLength(1);
		expect(normalizeToolCallId(result[0])).toBe("a");
	});

	it("returns empty array when both fields are missing", () => {
		const msg = { role: "assistant" };
		expect(normalizeToolCalls(msg)).toEqual([]);
	});

	it("returns empty array when toolCalls is not an array", () => {
		const msg = { toolCalls: "not-array" };
		expect(normalizeToolCalls(msg)).toEqual([]);
	});
});

describe("normalizeToolCallId", () => {
	it("prefers id over toolCallId over tool_call_id", () => {
		const tc = { id: "first", toolCallId: "second", tool_call_id: "third" };
		expect(normalizeToolCallId(tc)).toBe("first");
	});

	it("falls back to toolCallId when id is missing", () => {
		const tc = { toolCallId: "second", tool_call_id: "third" };
		expect(normalizeToolCallId(tc)).toBe("second");
	});

	it("falls back to tool_call_id when others are missing", () => {
		const tc = { tool_call_id: "third" };
		expect(normalizeToolCallId(tc)).toBe("third");
	});

	it("returns undefined for null", () => {
		expect(normalizeToolCallId(null)).toBeUndefined();
	});

	it("returns undefined for primitive", () => {
		expect(normalizeToolCallId("string")).toBeUndefined();
	});
});

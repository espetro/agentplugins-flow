import { describe, it, expect } from "vitest";
import { prepareFlowArguments } from "../src/flow/flow-args-prep.js";

describe("prepareFlowArguments", () => {
	it("returns non-object input unchanged", () => {
		expect(prepareFlowArguments("string")).toBe("string");
		expect(prepareFlowArguments(null)).toBe(null);
		expect(prepareFlowArguments(42)).toBe(42);
	});

	it("wraps a top-level bare array in flow object", () => {
		const input = [
			{ type: "scout", intent: "test intent" }
		];
		const result = prepareFlowArguments(input) as Record<string, unknown>;
		expect(Array.isArray(result.flow)).toBe(true);
		expect((result.flow as unknown[]).length).toBe(1);
		expect((result.flow as unknown[])[0]).toEqual({ type: "scout", intent: "test intent" });
	});

	it("returns input unchanged when no flow key", () => {
		const input = { other: "value" };
		expect(prepareFlowArguments(input)).toBe(input);
	});

	it("wraps single flow object in array", () => {
		const input = {
			flow: { type: "trace", intent: "test" },
		};
		const result = prepareFlowArguments(input) as Record<string, unknown>;
		expect(Array.isArray(result.flow)).toBe(true);
		expect((result.flow as unknown[]).length).toBe(1);
		expect((result.flow as unknown[])[0]).toEqual({ type: "trace", intent: "test" });
	});

	it("wraps single dispatch object in array within flow item", () => {
		const input = {
			flow: [
				{
					type: "trace",
					intent: "test",
					dispatch: { tool: "bash", ops: [{ c: "ls" }] },
				},
			],
		};
		const result = prepareFlowArguments(input) as Record<string, unknown>;
		const flowItem = (result.flow as unknown[])[0] as Record<string, unknown>;
		expect(Array.isArray(flowItem.dispatch)).toBe(true);
		expect(flowItem.dispatch).toEqual([{ tool: "bash", ops: [{ c: "ls" }] }]);
	});

	it("unwraps dispatch { item: {...} } wrapper", () => {
		const input = {
			flow: [
				{
					type: "trace",
					intent: "test",
					dispatch: { item: { tool: "bash", ops: [{ c: "ls" }] } },
				},
			],
		};
		const result = prepareFlowArguments(input) as Record<string, unknown>;
		const flowItem = (result.flow as unknown[])[0] as Record<string, unknown>;
		expect(Array.isArray(flowItem.dispatch)).toBe(true);
		expect(flowItem.dispatch).toEqual([{ tool: "bash", ops: [{ c: "ls" }] }]);
	});

	it("handles both single flow object and nested dispatch wrapper", () => {
		const input = {
			flow: {
				type: "trace",
				intent: "test",
				dispatch: { item: { tool: "batch", ops: { item: { p: "src/index.ts" } } } },
			},
		};
		const result = prepareFlowArguments(input) as Record<string, unknown>;
		expect(Array.isArray(result.flow)).toBe(true);
		const flowItem = (result.flow as unknown[])[0] as Record<string, unknown>;
		expect(Array.isArray(flowItem.dispatch)).toBe(true);
		// After dispatch prep, the nested item inside ops should also be flattened
		expect(flowItem.dispatch).toEqual([
			{ tool: "batch", ops: [{ p: "src/index.ts", o: "read" }] },
		]);
		expect(flowItem._dispatchNotes).toEqual([
			"flattened nested dispatcher",
			"inferred o=read",
		]);
	});

	it("passes canonical input unchanged", () => {
		const input = {
			flow: [
				{
					type: "trace",
					intent: "test",
					dispatch: [{ tool: "bash", ops: [{ c: "ls" }] }],
				},
			],
		};
		expect(prepareFlowArguments(input)).toBe(input);
	});

	it("leaves array dispatch unchanged even when flow is wrapped", () => {
		const input = {
			flow: {
				type: "trace",
				intent: "test",
				dispatch: [{ tool: "bash", ops: [{ c: "ls" }] }],
			},
		};
		const result = prepareFlowArguments(input) as Record<string, unknown>;
		expect(Array.isArray(result.flow)).toBe(true);
		const flowItem = (result.flow as unknown[])[0] as Record<string, unknown>;
		expect(flowItem.dispatch).toEqual([{ tool: "bash", ops: [{ c: "ls" }] }]);
	});

	it("handles mixed flow array with some bare dispatch objects", () => {
		const input = {
			flow: [
				{
					type: "trace",
					intent: "a",
					dispatch: [{ tool: "bash", ops: [{ c: "ls" }] }],
				},
				{
					type: "scout",
					intent: "b",
					dispatch: { tool: "bash", ops: [{ c: "pwd" }] },
				},
			],
		};
		const result = prepareFlowArguments(input) as Record<string, unknown>;
		const flow0 = (result.flow as unknown[])[0] as Record<string, unknown>;
		const flow1 = (result.flow as unknown[])[1] as Record<string, unknown>;
		expect(flow0.dispatch).toEqual([{ tool: "bash", ops: [{ c: "ls" }] }]);
		expect(flow1.dispatch).toEqual([{ tool: "bash", ops: [{ c: "pwd" }] }]);
	});

	// --- New: bare FlowItem at the top level (the original failure case) ---

	it("wraps bare FlowItem at the top level (no flow key)", () => {
		const input = {
			type: "scout",
			intent: "Inspect trace toolResult messages",
			aim: "Verify trace toolResult shape and TUI impact",
			acceptance: "Have sample entries",
			concern: "Need to confirm separation",
			cwd: "/Users/__blitzzz/Documents/GitHub/pi-agent-flow",
			complexity: "moderate",
		};
		const result = prepareFlowArguments(input) as Record<string, unknown>;
		expect(Array.isArray(result.flow)).toBe(true);
		expect((result.flow as unknown[]).length).toBe(1);
		const flowItem = (result.flow as unknown[])[0] as Record<string, unknown>;
		expect(flowItem.type).toBe("scout");
		expect(flowItem.intent).toBe("Inspect trace toolResult messages");
		expect(flowItem.complexity).toBe("moderate");
	});

	it("normalizes the exact failure case from the bug report (bare item + nested dispatch)", () => {
		const input = {
			type: "scout",
			intent: "Inspect 3-4 actual trace toolResult messages",
			aim: "Verify trace toolResult shape and TUI impact",
			acceptance: "Have samples",
			concern: "If parent TUI reads the snapshot rather than the session",
			cwd: "/Users/__blitzzz/Documents/GitHub/pi-agent-flow",
			complexity: "moderate",
			dispatch: {
				item: {
					tool: "bash",
					ops: {
						item: [
							{ c: "echo hi" },
						],
					},
				},
			},
		};
		const result = prepareFlowArguments(input) as Record<string, unknown>;
		expect(Array.isArray(result.flow)).toBe(true);
		const flowItem = (result.flow as unknown[])[0] as Record<string, unknown>;
		expect(Array.isArray(flowItem.dispatch)).toBe(true);
		// dispatch should now be a single-element array containing the bash op
		expect(flowItem.dispatch).toEqual([
			{ tool: "bash", ops: [{ c: "echo hi" }] },
		]);
	});

	it("does not wrap when type is missing (input is not a FlowItem)", () => {
		const input = { confirmProjectFlows: false };
		expect(prepareFlowArguments(input)).toBe(input);
	});

	it("does not wrap when type is not a known flow name", () => {
		const input = { type: "unknown", intent: "test", flow: [] };
		expect(prepareFlowArguments(input)).toBe(input);
	});

	it("does not wrap when intent is missing", () => {
		const input = { type: "scout" };
		expect(prepareFlowArguments(input)).toBe(input);
	});

	it("unwraps flow wrapped as { item: {...} }", () => {
		const input = {
			flow: {
				item: {
					type: "trace",
					intent: "test",
				},
			},
		};
		const result = prepareFlowArguments(input) as Record<string, unknown>;
		expect(Array.isArray(result.flow)).toBe(true);
		expect((result.flow as unknown[]).length).toBe(1);
	});
});

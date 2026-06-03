import { describe, it, expect } from "vitest";
import { prepareFlowArguments } from "../src/flow/flow-args-prep.js";

describe("alias system", () => {
	// 1. dispatch wrapper aliases
	describe("dispatch wrapper aliases", () => {
		it("t → tool rewrite", () => {
			const input = {
				flow: [{ type: "trace", intent: "test", dispatch: [{ t: "bash", ops: [{ c: "ls" }] }] }],
			};
			const result = prepareFlowArguments(input) as Record<string, unknown>;
			const flowItem = (result.flow as unknown[])[0] as Record<string, unknown>;
			expect(flowItem.dispatch).toEqual([{ tool: "bash", ops: [{ c: "ls" }] }]);
			expect(flowItem._dispatchNotes).toEqual(expect.arrayContaining(["aliased dispatch wrapper"]));
		});

		it("o → ops rewrite", () => {
			const input = {
				flow: [{ type: "trace", intent: "test", dispatch: [{ tool: "bash", o: [{ c: "ls" }] }] }],
			};
			const result = prepareFlowArguments(input) as Record<string, unknown>;
			const flowItem = (result.flow as unknown[])[0] as Record<string, unknown>;
			expect(flowItem.dispatch).toEqual([{ tool: "bash", ops: [{ c: "ls" }] }]);
			expect(flowItem._dispatchNotes).toEqual(expect.arrayContaining(["aliased dispatch wrapper"]));
		});

		it("canonical wins (both tool and t present, tool used)", () => {
			const input = {
				flow: [{ type: "trace", intent: "test", dispatch: [{ tool: "bash", t: "batch", ops: [{ c: "ls" }] }] }],
			};
			const result = prepareFlowArguments(input) as Record<string, unknown>;
			const flowItem = (result.flow as unknown[])[0] as Record<string, unknown>;
			expect(flowItem.dispatch).toEqual([{ tool: "bash", ops: [{ c: "ls" }] }]);
			expect(flowItem._dispatchNotes).toEqual([]);
		});

		it("unknown wrapper keys preserved", () => {
			const input = {
				flow: [{ type: "trace", intent: "test", dispatch: [{ tool: "bash", ops: [{ c: "ls" }], extra: "value" }] }],
			};
			const result = prepareFlowArguments(input) as Record<string, unknown>;
			const flowItem = (result.flow as unknown[])[0] as Record<string, unknown>;
			expect(flowItem.dispatch).toEqual([{ tool: "bash", ops: [{ c: "ls" }], extra: "value" }]);
		});
	});

	// 2. bash op aliases
	describe("bash op aliases", () => {
		it("cmd → c", () => {
			const input = {
				flow: [{ type: "trace", intent: "test", dispatch: [{ tool: "bash", ops: [{ cmd: "ls" }] }] }],
			};
			const result = prepareFlowArguments(input) as Record<string, unknown>;
			const flowItem = (result.flow as unknown[])[0] as Record<string, unknown>;
			expect(flowItem.dispatch).toEqual([{ tool: "bash", ops: [{ c: "ls" }] }]);
			expect(flowItem._dispatchNotes).toEqual(expect.arrayContaining(["aliased op"]));
		});

		it("command → c (regression — existing behavior)", () => {
			const input = {
				flow: [{ type: "trace", intent: "test", dispatch: [{ tool: "bash", ops: [{ command: "ls" }] }] }],
			};
			const result = prepareFlowArguments(input) as Record<string, unknown>;
			const flowItem = (result.flow as unknown[])[0] as Record<string, unknown>;
			expect(flowItem.dispatch).toEqual([{ tool: "bash", ops: [{ c: "ls" }] }]);
			expect(flowItem._dispatchNotes).toEqual(expect.arrayContaining(["aliased op"]));
		});

		it("timeout → t", () => {
			const input = {
				flow: [{ type: "trace", intent: "test", dispatch: [{ tool: "bash", ops: [{ c: "ls", timeout: 5000 }] }] }],
			};
			const result = prepareFlowArguments(input) as Record<string, unknown>;
			const flowItem = (result.flow as unknown[])[0] as Record<string, unknown>;
			expect(flowItem.dispatch).toEqual([{ tool: "bash", ops: [{ c: "ls", t: 5000 }] }]);
			expect(flowItem._dispatchNotes).toEqual(expect.arrayContaining(["aliased op"]));
		});

		it("id → i", () => {
			const input = {
				flow: [{ type: "trace", intent: "test", dispatch: [{ tool: "bash", ops: [{ c: "ls", id: "abc123" }] }] }],
			};
			const result = prepareFlowArguments(input) as Record<string, unknown>;
			const flowItem = (result.flow as unknown[])[0] as Record<string, unknown>;
			expect(flowItem.dispatch).toEqual([{ tool: "bash", ops: [{ c: "ls", i: "abc123" }] }]);
			expect(flowItem._dispatchNotes).toEqual(expect.arrayContaining(["aliased op"]));
		});

		it("cwd → h", () => {
			const input = {
				flow: [{ type: "trace", intent: "test", dispatch: [{ tool: "bash", ops: [{ c: "ls", cwd: "/tmp" }] }] }],
			};
			const result = prepareFlowArguments(input) as Record<string, unknown>;
			const flowItem = (result.flow as unknown[])[0] as Record<string, unknown>;
			expect(flowItem.dispatch).toEqual([{ tool: "bash", ops: [{ c: "ls", h: "/tmp" }] }]);
			expect(flowItem._dispatchNotes).toEqual(expect.arrayContaining(["aliased op"]));
		});
	});

	// 3. batch op aliases
	describe("batch op aliases", () => {
		it("path → p", () => {
			const input = {
				flow: [{ type: "trace", intent: "test", dispatch: [{ tool: "batch", ops: [{ path: "src/index.ts" }] }] }],
			};
			const result = prepareFlowArguments(input) as Record<string, unknown>;
			const flowItem = (result.flow as unknown[])[0] as Record<string, unknown>;
			expect(flowItem.dispatch).toEqual([{ tool: "batch", ops: [{ p: "src/index.ts", o: "read" }] }]);
			expect(flowItem._dispatchNotes).toEqual(expect.arrayContaining(["aliased op"]));
		});

		it("content → c (write)", () => {
			const input = {
				flow: [{ type: "trace", intent: "test", dispatch: [{ tool: "batch", ops: [{ p: "src/index.ts", content: "code" }] }] }],
			};
			const result = prepareFlowArguments(input) as Record<string, unknown>;
			const flowItem = (result.flow as unknown[])[0] as Record<string, unknown>;
			expect(flowItem.dispatch).toEqual([{ tool: "batch", ops: [{ p: "src/index.ts", c: "code", o: "write" }] }]);
			expect(flowItem._dispatchNotes).toEqual(expect.arrayContaining(["aliased op"]));
		});

		it("edits → e", () => {
			const input = {
				flow: [{ type: "trace", intent: "test", dispatch: [{ tool: "batch", ops: [{ p: "src/index.ts", edits: [{ f: "old", r: "new" }] }] }] }],
			};
			const result = prepareFlowArguments(input) as Record<string, unknown>;
			const flowItem = (result.flow as unknown[])[0] as Record<string, unknown>;
			expect(flowItem.dispatch).toEqual([{ tool: "batch", ops: [{ p: "src/index.ts", e: [{ f: "old", r: "new" }], o: "edit" }] }]);
			expect(flowItem._dispatchNotes).toEqual(expect.arrayContaining(["aliased op"]));
		});

		it("offset → s", () => {
			const input = {
				flow: [{ type: "trace", intent: "test", dispatch: [{ tool: "batch", ops: [{ p: "src/index.ts", offset: 10 }] }] }],
			};
			const result = prepareFlowArguments(input) as Record<string, unknown>;
			const flowItem = (result.flow as unknown[])[0] as Record<string, unknown>;
			expect(flowItem.dispatch).toEqual([{ tool: "batch", ops: [{ p: "src/index.ts", s: 10, o: "read" }] }]);
			expect(flowItem._dispatchNotes).toEqual(expect.arrayContaining(["aliased op"]));
		});

		it("limit → l", () => {
			const input = {
				flow: [{ type: "trace", intent: "test", dispatch: [{ tool: "batch", ops: [{ p: "src/index.ts", limit: 20 }] }] }],
			};
			const result = prepareFlowArguments(input) as Record<string, unknown>;
			const flowItem = (result.flow as unknown[])[0] as Record<string, unknown>;
			expect(flowItem.dispatch).toEqual([{ tool: "batch", ops: [{ p: "src/index.ts", l: 20, o: "read" }] }]);
			expect(flowItem._dispatchNotes).toEqual(expect.arrayContaining(["aliased op"]));
		});

		it("ignoreCase → i", () => {
			const input = {
				flow: [{ type: "trace", intent: "test", dispatch: [{ tool: "batch", ops: [{ p: ".", q: "test", ignoreCase: true }] }] }],
			};
			const result = prepareFlowArguments(input) as Record<string, unknown>;
			const flowItem = (result.flow as unknown[])[0] as Record<string, unknown>;
			expect(flowItem.dispatch).toEqual([{ tool: "batch", ops: [{ p: ".", q: "test", i: true, o: "read" }] }]);
			expect(flowItem._dispatchNotes).toEqual(expect.arrayContaining(["aliased op"]));
		});

		it("query → q", () => {
			const input = {
				flow: [{ type: "trace", intent: "test", dispatch: [{ tool: "batch", ops: [{ p: ".", query: "test" }] }] }],
			};
			const result = prepareFlowArguments(input) as Record<string, unknown>;
			const flowItem = (result.flow as unknown[])[0] as Record<string, unknown>;
			expect(flowItem.dispatch).toEqual([{ tool: "batch", ops: [{ p: ".", q: "test", o: "read" }] }]);
			expect(flowItem._dispatchNotes).toEqual(expect.arrayContaining(["aliased op"]));
		});

		it("maxCount → n", () => {
			const input = {
				flow: [{ type: "trace", intent: "test", dispatch: [{ tool: "batch", ops: [{ p: ".", q: "test", maxCount: 10 }] }] }],
			};
			const result = prepareFlowArguments(input) as Record<string, unknown>;
			const flowItem = (result.flow as unknown[])[0] as Record<string, unknown>;
			expect(flowItem.dispatch).toEqual([{ tool: "batch", ops: [{ p: ".", q: "test", n: 10, o: "read" }] }]);
			expect(flowItem._dispatchNotes).toEqual(expect.arrayContaining(["aliased op"]));
		});
	});

	// 4. edit aliases
	describe("edit aliases", () => {
		it("find → f, replace → r", () => {
			const input = {
				flow: [{ type: "trace", intent: "test", dispatch: [{ tool: "batch", ops: [{ p: "src/index.ts", edits: [{ find: "old", replace: "new" }] }] }] }],
			};
			const result = prepareFlowArguments(input) as Record<string, unknown>;
			const flowItem = (result.flow as unknown[])[0] as Record<string, unknown>;
			expect(flowItem.dispatch).toEqual([{ tool: "batch", ops: [{ p: "src/index.ts", e: [{ f: "old", r: "new" }], o: "edit" }] }]);
			expect(flowItem._dispatchNotes).toEqual(expect.arrayContaining(["aliased op"]));
		});
	});

	// 5. structural regression
	describe("structural regression", () => {
		it("string op → bash[1]", () => {
			const input = {
				flow: [{ type: "trace", intent: "test", dispatch: [{ tool: "bash", ops: ["ls -la"] }] }],
			};
			const result = prepareFlowArguments(input) as Record<string, unknown>;
			const flowItem = (result.flow as unknown[])[0] as Record<string, unknown>;
			expect(flowItem.dispatch).toEqual([{ tool: "bash", ops: [{ c: "ls -la" }] }]);
			expect(flowItem._dispatchNotes).toEqual(expect.arrayContaining(["string → bash[1]"]));
		});

		it("single object op → array[1]", () => {
			const input = {
				flow: [{ type: "trace", intent: "test", dispatch: [{ tool: "bash", ops: { c: "ls" } }] }],
			};
			const result = prepareFlowArguments(input) as Record<string, unknown>;
			const flowItem = (result.flow as unknown[])[0] as Record<string, unknown>;
			expect(flowItem.dispatch).toEqual([{ tool: "bash", ops: [{ c: "ls" }] }]);
			expect(flowItem._dispatchNotes).toEqual(expect.arrayContaining(["single obj → array[1]"]));
		});

		it("nested dispatcher flattened", () => {
			const input = {
				flow: [{ type: "trace", intent: "test", dispatch: [{ tool: "bash", ops: { item: { c: "ls" } } }] }],
			};
			const result = prepareFlowArguments(input) as Record<string, unknown>;
			const flowItem = (result.flow as unknown[])[0] as Record<string, unknown>;
			expect(flowItem.dispatch).toEqual([{ tool: "bash", ops: [{ c: "ls" }] }]);
			expect(flowItem._dispatchNotes).toEqual(expect.arrayContaining(["flattened nested dispatcher"]));
		});

		it("{item:...} wrapper unwrapped", () => {
			const input = {
				flow: [{ type: "trace", intent: "test", dispatch: { item: { tool: "bash", ops: [{ c: "ls" }] } } }],
			};
			const result = prepareFlowArguments(input) as Record<string, unknown>;
			const flowItem = (result.flow as unknown[])[0] as Record<string, unknown>;
			expect(flowItem.dispatch).toEqual([{ tool: "bash", ops: [{ c: "ls" }] }]);
		});
	});

	// 6. forward-compat
	describe("forward-compat", () => {
		it("unknown keys preserved on wrapper", () => {
			const input = {
				flow: [{ type: "trace", intent: "test", dispatch: [{ t: "bash", o: [{ c: "ls" }], extra: "wrapper" }] }],
			};
			const result = prepareFlowArguments(input) as Record<string, unknown>;
			const flowItem = (result.flow as unknown[])[0] as Record<string, unknown>;
			expect(flowItem.dispatch).toEqual([{ tool: "bash", ops: [{ c: "ls" }], extra: "wrapper" }]);
			expect(flowItem._dispatchNotes).toEqual(expect.arrayContaining(["aliased dispatch wrapper"]));
		});

		it("unknown keys preserved on op", () => {
			const input = {
				flow: [{ type: "trace", intent: "test", dispatch: [{ tool: "bash", ops: [{ c: "ls", extra: "op" }] }] }],
			};
			const result = prepareFlowArguments(input) as Record<string, unknown>;
			const flowItem = (result.flow as unknown[])[0] as Record<string, unknown>;
			expect(flowItem.dispatch).toEqual([{ tool: "bash", ops: [{ c: "ls", extra: "op" }] }]);
			expect(flowItem._dispatchNotes).toBeUndefined();
		});

		it("mixed canonical + alias resolves to canonical", () => {
			const input = {
				flow: [{ type: "trace", intent: "test", dispatch: [{ tool: "bash", ops: [{ c: "ls", cmd: "pwd" }] }] }],
			};
			const result = prepareFlowArguments(input) as Record<string, unknown>;
			const flowItem = (result.flow as unknown[])[0] as Record<string, unknown>;
			expect(flowItem.dispatch).toEqual([{ tool: "bash", ops: [{ c: "ls" }] }]);
			expect(flowItem._dispatchNotes).toEqual([]);
		});

		it("context-sensitive: cmd works in bash, is NOT applied to write ops", () => {
			const input = {
				flow: [{ type: "trace", intent: "test", dispatch: [{ tool: "batch", ops: [{ p: "src/index.ts", c: "code", o: "write", cmd: "ls" }] }] }],
			};
			const result = prepareFlowArguments(input) as Record<string, unknown>;
			const flowItem = (result.flow as unknown[])[0] as Record<string, unknown>;
			expect(flowItem.dispatch).toEqual([{ tool: "batch", ops: [{ p: "src/index.ts", c: "code", o: "write", cmd: "ls" }] }]);
			expect(flowItem._dispatchNotes).toBeUndefined();
		});

		it("context-sensitive: timeout works in bash, is NOT applied to rg ops", () => {
			const input = {
				flow: [{ type: "trace", intent: "test", dispatch: [{ tool: "batch", ops: [{ p: ".", q: "test", o: "rg", timeout: 5000 }] }] }],
			};
			const result = prepareFlowArguments(input) as Record<string, unknown>;
			const flowItem = (result.flow as unknown[])[0] as Record<string, unknown>;
			expect(flowItem.dispatch).toEqual([{ tool: "batch", ops: [{ p: ".", q: "test", o: "rg", timeout: 5000 }] }]);
			expect(flowItem._dispatchNotes).toBeUndefined();
		});
	});
});

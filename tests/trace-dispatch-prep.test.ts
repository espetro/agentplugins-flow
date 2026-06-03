import { describe, it, expect } from "vitest";
import { prepareTraceDispatchArguments } from "../src/tools/trace-dispatch-prep.js";

describe("prepareTraceDispatchArguments", () => {
	it("returns empty for non-object input", () => {
		const result = prepareTraceDispatchArguments("string");
		expect(result.dispatch).toEqual([]);
		expect(result.notes).toEqual([]);
	});

	it("returns empty for missing dispatch", () => {
		const result = prepareTraceDispatchArguments({ intent: "test" });
		expect(result.dispatch).toEqual([]);
		expect(result.notes).toEqual([]);
	});

	it("wraps bare string dispatch as bash", () => {
		const result = prepareTraceDispatchArguments({ dispatch: "git status" });
		expect(result.dispatch).toEqual([{ tool: "bash", ops: [{ c: "git status" }] }]);
		expect(result.notes).toEqual(["string → bash[1]"]);
	});

	it("wraps string inside ops array as bash", () => {
		const result = prepareTraceDispatchArguments({ dispatch: [{ tool: "bash", ops: "git status" }] });
		expect(result.dispatch).toEqual([{ tool: "bash", ops: [{ c: "git status" }] }]);
		expect(result.notes).toEqual(["string → bash[1]"]);
	});

	it("wraps single object ops in array", () => {
		const result = prepareTraceDispatchArguments({ dispatch: [{ tool: "bash", ops: { c: "ls" } }] });
		expect(result.dispatch).toEqual([{ tool: "bash", ops: [{ c: "ls" }] }]);
		expect(result.notes).toEqual(["single obj → array[1]"]);
	});

	it("infers batch read from p only", () => {
		const result = prepareTraceDispatchArguments({ dispatch: [{ tool: "batch", ops: [{ p: "src/index.ts" }] }] });
		expect(result.dispatch).toEqual([{ tool: "batch", ops: [{ p: "src/index.ts", o: "read" }] }]);
		expect(result.notes).toEqual(["inferred o=read"]);
	});

	it("infers batch write from p and c", () => {
		const result = prepareTraceDispatchArguments({ dispatch: [{ tool: "batch", ops: [{ p: "x", c: "code" }] }] });
		expect(result.dispatch).toEqual([{ tool: "batch", ops: [{ p: "x", c: "code", o: "write" }] }]);
		expect(result.notes).toEqual(["inferred o=write"]);
	});

	it("infers batch edit from p and e", () => {
		const result = prepareTraceDispatchArguments({ dispatch: [{ tool: "batch", ops: [{ p: "x", e: [{ f: "old", r: "new" }] }] }] });
		expect(result.dispatch).toEqual([{ tool: "batch", ops: [{ p: "x", e: [{ f: "old", r: "new" }], o: "edit" }] }]);
		expect(result.notes).toEqual(["inferred o=edit"]);
	});

	it("infers batch bash from c only (no p)", () => {
		const result = prepareTraceDispatchArguments({ dispatch: [{ tool: "batch", ops: [{ c: "ls" }] }] });
		expect(result.dispatch).toEqual([{ tool: "batch", ops: [{ c: "ls", o: "bash", p: "ls" }] }]);
		expect(result.notes).toEqual(["inferred o=bash"]);
	});

	it("strips stray tool key from bash ops", () => {
		const result = prepareTraceDispatchArguments({ dispatch: [{ tool: "bash", ops: [{ c: "ls", tool: "bash" }] }] });
		expect(result.dispatch).toEqual([{ tool: "bash", ops: [{ c: "ls" }] }]);
		expect(result.notes).toEqual(["stripped stray tool"]);
	});

	it("infers web search from q", () => {
		const result = prepareTraceDispatchArguments({ dispatch: [{ tool: "web", ops: [{ q: "test" }] }] });
		expect(result.dispatch).toEqual([{ tool: "web", ops: [{ q: "test", o: "search" }] }]);
		expect(result.notes).toEqual(["inferred o=search"]);
	});

	it("infers web fetch from u", () => {
		const result = prepareTraceDispatchArguments({ dispatch: [{ tool: "web", ops: [{ u: "https://example.com" }] }] });
		expect(result.dispatch).toEqual([{ tool: "web", ops: [{ u: "https://example.com", o: "fetch" }] }]);
		expect(result.notes).toEqual(["inferred o=fetch"]);
	});

	it("flattens nested dispatcher inside ops", () => {
		const result = prepareTraceDispatchArguments({
			dispatch: [{ tool: "bash", ops: [{ tool: "bash", ops: { item: { c: "ls", t: 5000 } } }] }],
		});
		expect(result.dispatch).toEqual([{ tool: "bash", ops: [{ c: "ls", t: 5000 }] }]);
		expect(result.notes).toEqual(["flattened nested dispatcher"]);
	});

	it("flattens nested dispatcher at ops level", () => {
		const result = prepareTraceDispatchArguments({
			dispatch: [{ tool: "bash", ops: { item: { c: "ls" } } }],
		});
		expect(result.dispatch).toEqual([{ tool: "bash", ops: [{ c: "ls" }] }]);
		expect(result.notes).toEqual(["flattened nested dispatcher"]);
	});

	it("passes canonical flat array unchanged with no notes and no changed flag", () => {
		const input = {
			dispatch: [
				{ tool: "batch", ops: [{ o: "read", p: "src/main.ts" }] },
				{ tool: "bash", ops: [{ c: "git status" }] },
			],
		};
		const result = prepareTraceDispatchArguments(input);
		expect(result.dispatch).toEqual(input.dispatch);
		expect(result.notes).toEqual([]);
		expect(result.changed).toBe(false);
	});

		it("returns changed: false for non-object input", () => {
		const result = prepareTraceDispatchArguments("string");
		expect(result.changed).toBe(false);
	});

	it("returns changed: false for missing dispatch", () => {
		const result = prepareTraceDispatchArguments({ intent: "test" });
		expect(result.changed).toBe(false);
	});

	it("handles the exact bug report nested dispatcher case", () => {
		const result = prepareTraceDispatchArguments({
			dispatch: [
				{
					tool: "bash",
					ops: [
						{ c: "echo hello" },
						{ tool: "bash", ops: { item: { c: "ls", t: 5000 } } },
					],
				},
			],
		});
		expect(result.dispatch).toEqual([
			{
				tool: "bash",
				ops: [
					{ c: "echo hello" },
					{ c: "ls", t: 5000 },
				],
			},
		]);
		expect(result.notes).toEqual(["flattened nested dispatcher"]);
	});


	// --- changed flag for silent-drop cases ---
	// The normalizer transforms input without adding notes in these cases.
	// The changed flag is the canonical signal that the prep layer relies on.

	it("REGRESSION: changed: true for group with no valid tool (silent drop)", () => {
		const result = prepareTraceDispatchArguments({ dispatch: [{}] });
		expect(result.dispatch).toEqual([]);
		expect(result.notes).toEqual([]);
		expect(result.changed).toBe(true);
	});

	it("REGRESSION: changed: true for null/undefined/false/0 ops (silent drop)", () => {
		const result = prepareTraceDispatchArguments({
			dispatch: [{ tool: "bash", ops: [null, undefined, false, 0] }],
		});
		expect(result.dispatch).toEqual([{ tool: "bash", ops: [] }]);
		expect(result.notes).toEqual([]);
		expect(result.changed).toBe(true);
	});

	it("REGRESSION: changed: true for missing ops field (silent drop)", () => {
		const result = prepareTraceDispatchArguments({ dispatch: [{ tool: "bash" }] });
		expect(result.dispatch).toEqual([{ tool: "bash", ops: [] }]);
		expect(result.notes).toEqual([]);
		expect(result.changed).toBe(true);
	});

	it("REGRESSION: changed: true for non-string-non-object ops (silent drop)", () => {
		const result = prepareTraceDispatchArguments({
			dispatch: [{ tool: "bash", ops: 42 }],
		});
		expect(result.dispatch).toEqual([{ tool: "bash", ops: [] }]);
		expect(result.notes).toEqual([]);
		expect(result.changed).toBe(true);
	});

	it("REGRESSION: changed: true for non-object op inside ops array (silent drop)", () => {
		const result = prepareTraceDispatchArguments({
			dispatch: [{ tool: "bash", ops: [42, true] }],
		});
		expect(result.dispatch).toEqual([{ tool: "bash", ops: [] }]);
		expect(result.notes).toEqual([]);
		expect(result.changed).toBe(true);
	});
});

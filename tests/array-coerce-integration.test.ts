import { describe, it, expect } from "vitest";
import { prepareFlowDispatchArguments } from "../src/flow/flow-dispatch-prep.js";
import { prepareTraceDispatchArguments } from "../src/tools/trace-dispatch-prep.js";
import { prepareBatchArguments } from "../src/batch/index.js";

const prepareBatchArgumentsTyped = prepareBatchArguments as (input: unknown) => unknown;

describe("array-coerce integration", () => {
  it("prepareFlowDispatchArguments drops non-object flow elements and adds _flowNotes", () => {
    const result = prepareFlowDispatchArguments({
      flow: [
        { type: "scout", intent: "test", aim: "test", complexity: "simple", concern: "test" },
        "\n",
      ],
    }) as Record<string, unknown>;
    const flow = result.flow as unknown[];
    expect(flow.length).toBe(1);
    expect(flow[0]).toEqual({
      type: "scout",
      intent: "test",
      aim: "test",
      complexity: "simple",
      concern: "test",
    });
    const notes = result._flowNotes as string[];
    expect(notes.length).toBe(1);
    expect(notes[0]).toContain("dropped non-object");
  });

  it("prepareFlowDispatchArguments handles all-bad flow array", () => {
    const result = prepareFlowDispatchArguments({ flow: ["\n"] }) as Record<string, unknown>;
    const flow = result.flow as unknown[];
    expect(flow.length).toBe(0);
    const notes = result._flowNotes as string[];
    expect(notes.length).toBe(1);
  });

  it("prepareTraceDispatchArguments drops non-object dispatch groups and notes them", () => {
    const result = prepareTraceDispatchArguments({
      dispatch: [{ tool: "bash", ops: [{ c: "ls" }] }, "commentary text"],
    });
    expect(result.dispatch.length).toBe(1);
    expect(result.notes.length).toBe(1);
    expect(result.notes[0]).toContain("dropped non-object");
    expect(result.notes[0]).toContain("string");
    expect(result.changed).toBe(true);
  });

  it("prepareArguments drops non-object batch ops", () => {
    const result = prepareBatchArgumentsTyped({
      o: [{ o: "read", p: "src/index.ts" }, "\n"],
    }) as Record<string, unknown>;
    const ops = result.o as unknown[];
    expect(ops.length).toBe(1);
    expect((ops[0] as Record<string, unknown>).o).toBe("read");
  });

  it("prepareTraceDispatchArguments drops null with clear note", () => {
    const result = prepareTraceDispatchArguments({
      dispatch: [null, { tool: "bash", ops: [{ c: "ls" }] }],
    });
    expect(result.dispatch.length).toBe(1);
    expect(result.notes.length).toBe(1);
    expect(result.notes[0]).toBe("dispatch[0]: dropped null/undefined");
    expect(result.changed).toBe(true);
  });

  it("prepareTraceDispatchArguments drops undefined with clear note", () => {
    const result = prepareTraceDispatchArguments({
      dispatch: [undefined],
    });
    expect(result.dispatch.length).toBe(0);
    expect(result.notes.length).toBe(1);
    expect(result.notes[0]).toBe("dispatch[0]: dropped null/undefined");
    expect(result.changed).toBe(true);
  });

  it("prepareTraceDispatchArguments drops nested array with array label", () => {
    const result = prepareTraceDispatchArguments({
      dispatch: [[{ o: "search", q: "x" }]],
    });
    expect(result.dispatch.length).toBe(0);
    expect(result.notes.length).toBe(1);
    expect(result.notes[0]).toContain("array");
    expect(result.changed).toBe(true);
  });

  it("prepareArguments sanitizes web ops and keeps valid ones", () => {
    const result = prepareBatchArgumentsTyped({
      o: [{ o: "read", p: "x" }],
      w: [{ o: "search", q: "x" }, "\n"],
    }) as Record<string, unknown>;
    const w = result.w as unknown[];
    expect(w.length).toBe(1);
    expect((w[0] as Record<string, unknown>).o).toBe("search");
  });

  it("prepareArguments sets empty w array when all web ops are dropped", () => {
    const result = prepareBatchArgumentsTyped({
      o: [{ o: "read", p: "x" }],
      w: ["\n", null],
    }) as Record<string, unknown>;
    const w = result.w as unknown[];
    expect(w).toEqual([]);
  });

  it("prepareArguments leaves w undefined when not provided", () => {
    const result = prepareBatchArgumentsTyped({
      o: [{ o: "read", p: "x" }],
    }) as Record<string, unknown>;
    expect(result.w).toBeUndefined();
  });
});

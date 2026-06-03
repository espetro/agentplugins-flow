import { describe, it, expect, vi } from "vitest";
import { coerceArrayOfObjects } from "../src/tools/array-coerce.js";
import * as log from "../src/config/log.js";

describe("coerceArrayOfObjects", () => {
  it("empty array → value=[], notes=[], dropped=0", () => {
    const result = coerceArrayOfObjects<Record<string, unknown>>([]);
    expect(result.value).toEqual([]);
    expect(result.notes).toEqual([]);
    expect(result.dropped).toBe(0);
  });

  it("array of plain objects → all kept, no notes, dropped=0", () => {
    const input = [{ a: 1 }, { b: 2 }];
    const result = coerceArrayOfObjects<Record<string, unknown>>(input);
    expect(result.value).toEqual(input);
    expect(result.notes).toEqual([]);
    expect(result.dropped).toBe(0);
  });

  it("drops null and undefined", () => {
    const result = coerceArrayOfObjects<Record<string, unknown>>([
      null,
      undefined,
      { a: 1 },
    ]);
    expect(result.value).toEqual([{ a: 1 }]);
    expect(result.notes).toEqual([
      "array[0]: dropped null/undefined",
      "array[1]: dropped null/undefined",
    ]);
    expect(result.dropped).toBe(2);
  });

  it('drops string "\\n" (the exact bug)', () => {
    const result = coerceArrayOfObjects<Record<string, unknown>>([
      { a: 1 },
      "\n",
    ]);
    expect(result.value).toEqual([{ a: 1 }]);
    expect(result.notes).toEqual([
      'array[1]: dropped non-object (string: "\\n")',
    ]);
    expect(result.dropped).toBe(1);
  });

  it("truncates long strings to 40 chars", () => {
    const long = "a".repeat(50);
    const result = coerceArrayOfObjects<Record<string, unknown>>([long]);
    expect(result.notes[0]).toContain("string:");
    expect(result.notes[0].length).toBeLessThan(long.length + 32);
  });

  it("drops number and boolean", () => {
    const result = coerceArrayOfObjects<Record<string, unknown>>([
      42,
      true,
      { a: 1 },
    ]);
    expect(result.value).toEqual([{ a: 1 }]);
    expect(result.notes).toEqual([
      "array[0]: dropped non-object (number: 42)",
      "array[1]: dropped non-object (boolean: true)",
    ]);
    expect(result.dropped).toBe(2);
  });

  it("drops nested array", () => {
    const result = coerceArrayOfObjects<Record<string, unknown>>([
      [{ a: 1 }],
      { b: 2 },
    ]);
    expect(result.value).toEqual([{ b: 2 }]);
    expect(result.notes).toEqual(["array[0]: dropped nested array"]);
    expect(result.dropped).toBe(1);
  });

  it("mixed valid + invalid → only valid kept, correct dropped count", () => {
    const result = coerceArrayOfObjects<Record<string, unknown>>([
      { a: 1 },
      "\n",
      null,
      42,
      { b: 2 },
    ]);
    expect(result.value).toEqual([{ a: 1 }, { b: 2 }]);
    expect(result.dropped).toBe(3);
  });

  it("non-array input → empty value, single note naming actual type", () => {
    expect(coerceArrayOfObjects<Record<string, unknown>>("not array")).toEqual({
      value: [],
      notes: ["array: not an array, got string"],
      dropped: 0,
    });
    expect(coerceArrayOfObjects<Record<string, unknown>>(42)).toEqual({
      value: [],
      notes: ["array: not an array, got number"],
      dropped: 0,
    });
    expect(coerceArrayOfObjects<Record<string, unknown>>({ a: 1 })).toEqual({
      value: [],
      notes: ["array: not an array, got object"],
      dropped: 0,
    });
    expect(coerceArrayOfObjects<Record<string, unknown>>(null)).toEqual({
      value: [],
      notes: ["array: not an array, got object"],
      dropped: 0,
    });
  });

  it("uses custom label in note text", () => {
    const result = coerceArrayOfObjects<Record<string, unknown>>(["x"], {
      label: "batch",
    });
    expect(result.notes[0]).toContain("batch[0]: dropped non-object");
  });

  it("calls logWarn when elements are dropped", () => {
    const spy = vi.spyOn(log, "logWarn").mockImplementation(() => {});
    coerceArrayOfObjects<Record<string, unknown>>(["bad"]);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("dropped 1 non-object element(s) from array"),
    );
    spy.mockRestore();
  });

  it("does not call logWarn when nothing is dropped", () => {
    const spy = vi.spyOn(log, "logWarn").mockImplementation(() => {});
    coerceArrayOfObjects<Record<string, unknown>>([{ a: 1 }]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

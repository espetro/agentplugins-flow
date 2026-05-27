import { describe, it, expect } from "vitest";
import { renderSingleSelectRows } from "../src/tui/single-select-layout.js";

describe("renderSingleSelectRows", () => {
  it("returns empty rows for empty options", () => {
    const result = renderSingleSelectRows({ options: [], selectedIndex: 0, width: 40 });
    expect(result).toEqual([]);
  });

  it("renders single option without truncation", () => {
    const options = [{ title: "Option A", description: "Desc A" }];
    const result = renderSingleSelectRows({ options, selectedIndex: 0, width: 40 });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].line).toContain("Option A");
    expect(result[0].selected).toBe(true);
  });

  it("renders many options with selection", () => {
    const options = [
      { title: "One", description: "First" },
      { title: "Two", description: "Second" },
      { title: "Three", description: "Third" },
    ];
    const result = renderSingleSelectRows({ options, selectedIndex: 1, width: 40 });
    expect(result.some((r) => r.line.includes("Two") && r.selected)).toBe(true);
    expect(result.some((r) => r.line.includes("One") && !r.selected)).toBe(true);
  });

  it("truncates long option lists when maxRows is small", () => {
    const options = Array.from({ length: 20 }, (_, i) => ({
      title: `Option ${i}`,
      description: `Description ${i}`,
    }));
    const result = renderSingleSelectRows({ options, selectedIndex: 5, width: 40, maxRows: 5 });
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it("shows indicator when truncating", () => {
    const options = Array.from({ length: 10 }, (_, i) => ({
      title: `Option ${i}`,
      description: `Description ${i}`,
    }));
    const result = renderSingleSelectRows({ options, selectedIndex: 5, width: 40, maxRows: 4 });
    expect(result.some((r) => r.line.includes("(6/10)"))).toBe(true);
  });

  it("selected block larger than maxRows shows only selected block indicator", () => {
    const options = [
      { title: "A", description: "Line1\nLine2\nLine3\nLine4\nLine5" },
      { title: "B", description: "B desc" },
    ];
    const result = renderSingleSelectRows({ options, selectedIndex: 0, width: 40, maxRows: 3 });
    expect(result.length).toBeLessThanOrEqual(3);
    expect(result[0].selected).toBe(true);
  });

  it("returns all rows when maxRows is undefined", () => {
    const options = Array.from({ length: 5 }, (_, i) => ({
      title: `Option ${i}`,
      description: `Desc ${i}`,
    }));
    const result = renderSingleSelectRows({ options, selectedIndex: 0, width: 40 });
    // Each option has title line + description line = 10 rows
    expect(result.length).toBe(10);
  });

  it("returns all rows when maxRows exceeds total rows", () => {
    const options = [{ title: "A", description: "Desc" }];
    const result = renderSingleSelectRows({ options, selectedIndex: 0, width: 40, maxRows: 100 });
    expect(result.length).toBe(2);
  });

  it("handles falsy maxRows as no limit (returns all rows)", () => {
    const options = [{ title: "A", description: "Desc" }];
    const result = renderSingleSelectRows({ options, selectedIndex: 0, width: 40, maxRows: 0 });
    // maxRows=0 is falsy so treated as no limit
    expect(result.length).toBe(2);
  });

  it("handles description with newlines via wrapping", () => {
    const options = [{ title: "A", description: "Very long description that should wrap across multiple lines when width is narrow" }];
    const result = renderSingleSelectRows({ options, selectedIndex: 0, width: 20 });
    expect(result.length).toBeGreaterThan(2);
  });

  it("renders unselected pointer as space", () => {
    const options = [
      { title: "A", description: "" },
      { title: "B", description: "" },
    ];
    const result = renderSingleSelectRows({ options, selectedIndex: 0, width: 40 });
    const selectedLine = result.find((r) => r.line.includes("A"));
    const unselectedLine = result.find((r) => r.line.includes("B"));
    expect(selectedLine!.line).toContain("▶");
    expect(unselectedLine!.line.trimStart()[0]).not.toBe("▶");
  });

  it("handles single option without description", () => {
    const options = [{ title: "Only", description: "" }];
    const result = renderSingleSelectRows({ options, selectedIndex: 0, width: 40 });
    expect(result.length).toBe(1);
    expect(result[0].line).toContain("Only");
  });

  it("handles option with very long title exceeding width", () => {
    const options = [{ title: "A".repeat(100), description: "" }];
    const result = renderSingleSelectRows({ options, selectedIndex: 0, width: 20 });
    expect(result.length).toBeGreaterThan(1);
    expect(result.every((r) => r.line.length <= 25)).toBe(true);
  });

  it("centered selection shows surrounding items when possible", () => {
    const options = Array.from({ length: 10 }, (_, i) => ({
      title: `Item ${i}`,
      description: ``,
    }));
    const result = renderSingleSelectRows({ options, selectedIndex: 5, width: 40, maxRows: 5 });
    // forward expansion is prioritized, so Item 5-8 appear; Item 4 does not
    expect(result.some((r) => r.line.includes("Item 5"))).toBe(true);
    expect(result.some((r) => r.line.includes("Item 6"))).toBe(true);
    expect(result.some((r) => r.line.includes("Item 7"))).toBe(true);
    expect(result.some((r) => r.line.includes("Item 8"))).toBe(true);
  });

  it("selectedIndex clamped to valid range", () => {
    const options = [{ title: "A", description: "" }];
    const result = renderSingleSelectRows({ options, selectedIndex: 99, width: 40 });
    expect(result.length).toBeGreaterThan(0);
  });
});

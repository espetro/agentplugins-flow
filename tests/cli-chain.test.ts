import { describe, it, expect } from "vitest";
import { splitChain } from "../src/cli/chain.js";

describe("splitChain", () => {
  it("returns a single run op when no separator", () => {
    expect(splitChain("echo hello")).toEqual([{ kind: "run", cmd: "echo hello" }]);
  });

  it("splits on semicolon", () => {
    expect(splitChain("echo a; echo b")).toEqual([
      { kind: "run", cmd: "echo a" },
      { kind: "run", cmd: "echo b" },
    ]);
  });

  it("splits on &&", () => {
    expect(splitChain("echo a && echo b")).toEqual([
      { kind: "run", cmd: "echo a" },
      { kind: "and", cmd: "echo b" },
    ]);
  });

  it("handles mixed ; and &&", () => {
    expect(splitChain("a; b && c; d")).toEqual([
      { kind: "run", cmd: "a" },
      { kind: "run", cmd: "b" },
      { kind: "and", cmd: "c" },
      { kind: "run", cmd: "d" },
    ]);
  });

  it("ignores quoted semicolons", () => {
    expect(splitChain('echo "a;b"')).toEqual([{ kind: "run", cmd: 'echo "a;b"' }]);
  });

  it("ignores quoted &&", () => {
    expect(splitChain('echo "a&&b"')).toEqual([{ kind: "run", cmd: 'echo "a&&b"' }]);
  });

  it("ignores escaped semicolons", () => {
    expect(splitChain("echo a\\;b")).toEqual([{ kind: "run", cmd: "echo a;b" }]);
  });

  it("ignores escaped &&", () => {
    expect(splitChain("echo a\\&\\&b")).toEqual([{ kind: "run", cmd: "echo a&&b" }]);
  });

  it("handles trailing separator", () => {
    expect(splitChain("echo a;")).toEqual([{ kind: "run", cmd: "echo a" }]);
  });

  it("handles leading separator", () => {
    expect(splitChain("; echo a")).toEqual([{ kind: "run", cmd: "echo a" }]);
  });

  it("handles empty ops between separators", () => {
    expect(splitChain("a; ; b")).toEqual([
      { kind: "run", cmd: "a" },
      { kind: "run", cmd: "b" },
    ]);
  });

  it("treats leading && as no-op (first op is run)", () => {
    expect(splitChain("&& echo a")).toEqual([{ kind: "run", cmd: "echo a" }]);
  });

  it("treats leading ; as no-op (first op is run)", () => {
    expect(splitChain("; echo a")).toEqual([{ kind: "run", cmd: "echo a" }]);
  });

  it("treats leading ; && as no-op (first op is run)", () => {
    expect(splitChain("; && echo a")).toEqual([{ kind: "run", cmd: "echo a" }]);
  });
});

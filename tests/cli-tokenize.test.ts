import { describe, it, expect } from "vitest";
import { tokenize } from "../src/cli/tokenize.js";

describe("tokenize", () => {
  it("splits simple words", () => {
    expect(tokenize("hello world")).toEqual(["hello", "world"]);
  });

  it("handles multiple spaces", () => {
    expect(tokenize("hello   world")).toEqual(["hello", "world"]);
  });

  it("handles tabs", () => {
    expect(tokenize("hello\tworld")).toEqual(["hello", "world"]);
  });

  it("preserves single-quoted strings", () => {
    expect(tokenize("echo 'hello world'")).toEqual(["echo", "hello world"]);
  });

  it("preserves double-quoted strings", () => {
    expect(tokenize('echo "hello world"')).toEqual(["echo", "hello world"]);
  });

  it("handles escaped quotes inside double quotes", () => {
    expect(tokenize('echo "say \\"hi\\""')).toEqual(["echo", 'say "hi"']);
  });

  it("handles escaped backslash inside double quotes", () => {
    expect(tokenize('echo "path\\\\to\\"file\\""')).toEqual(["echo", 'path\\to"file"']);
  });

  it("treats backslash inside single quotes as literal", () => {
    expect(tokenize("echo 'hello\\world'")).toEqual(["echo", "hello\\world"]);
  });

  it("handles backslash escapes outside quotes", () => {
    expect(tokenize("echo hello\\ world")).toEqual(["echo", "hello world"]);
  });

  it("handles mixed quotes and bare words", () => {
    expect(tokenize("foo 'a b' c \"d e\"")).toEqual(["foo", "a b", "c", "d e"]);
  });

  it("returns empty array for empty input", () => {
    expect(tokenize("")).toEqual([]);
  });

  it("returns empty array for whitespace-only input", () => {
    expect(tokenize("   \t\n  ")).toEqual([]);
  });

  it("handles trailing backslash", () => {
    expect(tokenize("hello \\")).toEqual(["hello", "\\"]);
  });

  it("does not split on semicolon", () => {
    expect(tokenize("a; b")).toEqual(["a;", "b"]);
  });

  it("does not split on ampersand", () => {
    expect(tokenize("a && b")).toEqual(["a", "&&", "b"]);
  });
});

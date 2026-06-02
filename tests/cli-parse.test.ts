import { describe, it, expect } from "vitest";
import { parseCommand, CliError } from "../src/cli/parse.js";

const TEST_SPEC = {
  verbose: { short: "v", type: "boolean" as const },
  count: { short: "c", type: "number" as const },
  name: { short: "n", type: "string" as const },
  output: { type: "string" as const },
  force: { short: "f", type: "boolean" as const },
};

describe("parseCommand", () => {
  it("parses subcommand and positionals", () => {
    const result = parseCommand(["read", "a.txt", "b.txt"], TEST_SPEC);
    expect(result.subcommand).toBe("read");
    expect(result.positionals).toEqual(["a.txt", "b.txt"]);
    expect(result.flags).toEqual({});
  });

  it("parses long boolean flags", () => {
    const result = parseCommand(["cmd", "--verbose"], TEST_SPEC);
    expect(result.flags.verbose).toBe(true);
  });

  it("parses short boolean flags", () => {
    const result = parseCommand(["cmd", "-v"], TEST_SPEC);
    expect(result.flags.verbose).toBe(true);
  });

  it("parses long string flags with value", () => {
    const result = parseCommand(["cmd", "--name", "foo"], TEST_SPEC);
    expect(result.flags.name).toBe("foo");
  });

  it("parses short string flags with value", () => {
    const result = parseCommand(["cmd", "-n", "foo"], TEST_SPEC);
    expect(result.flags.name).toBe("foo");
  });

  it("parses --flag=value syntax", () => {
    const result = parseCommand(["cmd", "--name=foo"], TEST_SPEC);
    expect(result.flags.name).toBe("foo");
  });

  it("parses bundled booleans", () => {
    const result = parseCommand(["cmd", "-vf"], TEST_SPEC);
    expect(result.flags.verbose).toBe(true);
    expect(result.flags.force).toBe(true);
  });

  it("parses short flag with inline value", () => {
    const result = parseCommand(["cmd", "-nfoo"], TEST_SPEC);
    expect(result.flags.name).toBe("foo");
  });

  it("parses number flags", () => {
    const result = parseCommand(["cmd", "--count", "42"], TEST_SPEC);
    expect(result.flags.count).toBe(42);
  });

  it("parses short number flags", () => {
    const result = parseCommand(["cmd", "-c", "7"], TEST_SPEC);
    expect(result.flags.count).toBe(7);
  });

  it("throws on unknown long flag", () => {
    expect(() => parseCommand(["cmd", "--unknown"], TEST_SPEC)).toThrow(CliError);
  });

  it("throws on unknown short flag", () => {
    expect(() => parseCommand(["cmd", "-x"], TEST_SPEC)).toThrow(CliError);
  });

  it("throws on missing value for string flag", () => {
    expect(() => parseCommand(["cmd", "--name"], TEST_SPEC)).toThrow(CliError);
  });

  it("throws on missing value for short flag", () => {
    expect(() => parseCommand(["cmd", "-n"], TEST_SPEC)).toThrow(CliError);
  });

  it("stops parsing flags after --", () => {
    const result = parseCommand(["cmd", "-v", "--", "--name", "foo"], TEST_SPEC);
    expect(result.flags.verbose).toBe(true);
    expect(result.positionals).toEqual(["--name", "foo"]);
  });

  it("handles no positionals", () => {
    const result = parseCommand(["cmd", "-v"], TEST_SPEC);
    expect(result.positionals).toEqual([]);
  });

  it("handles mixed flags and positionals", () => {
    const result = parseCommand(["read", "-v", "a.txt", "-f", "b.txt"], TEST_SPEC);
    expect(result.flags.verbose).toBe(true);
    expect(result.flags.force).toBe(true);
    expect(result.positionals).toEqual(["a.txt", "b.txt"]);
  });

  it("throws for empty tokens", () => {
    expect(() => parseCommand([], TEST_SPEC)).toThrow(CliError);
  });

  it("parses empty value for long flag as empty string", () => {
    const result = parseCommand(["cmd", "--name="], TEST_SPEC);
    expect(result.flags.name).toBe("");
  });

  it("throws for empty value on long number flag", () => {
    expect(() => parseCommand(["cmd", "--count="], TEST_SPEC)).toThrow(
      new CliError("Flag --count requires a numeric value."),
    );
  });

  it("throws for empty value on short number flag", () => {
    expect(() => parseCommand(["cmd", "-c", ""], TEST_SPEC)).toThrow(
      new CliError("Flag -c (--count) requires a numeric value."),
    );
  });

  it("parses short flag with = separator", () => {
    const result = parseCommand(["cmd", "-n=foo"], TEST_SPEC);
    expect(result.flags.name).toBe("foo");
  });

  it("parses short number flag with = separator", () => {
    const result = parseCommand(["cmd", "-c=7"], TEST_SPEC);
    expect(result.flags.count).toBe(7);
  });

  it("parses repeated string flags into array when multi: true", () => {
    const multiSpec = {
      find: { short: "f", type: "string" as const, multi: true },
      replace: { short: "r", type: "string" as const, multi: true },
    };
    const result = parseCommand(["edit", "-f", "foo", "-f", "bar", "-r", "baz", "path"], multiSpec);
    expect(result.flags.find).toEqual(["foo", "bar"]);
    expect(result.flags.replace).toEqual(["baz"]);
    expect(result.positionals).toEqual(["path"]);
  });

  it("parses repeated boolean flags into array when multi: true", () => {
    const multiSpec = {
      flag: { short: "f", type: "boolean" as const, multi: true },
    };
    const result = parseCommand(["cmd", "-f", "-f", "-f"], multiSpec);
    expect(result.flags.flag).toEqual([true, true, true]);
  });

  it("parses repeated number flags into array when multi: true", () => {
    const multiSpec = {
      count: { short: "c", type: "number" as const, multi: true },
    };
    const result = parseCommand(["cmd", "-c", "1", "--count", "2"], multiSpec);
    expect(result.flags.count).toEqual([1, 2]);
  });
});

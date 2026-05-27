import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseBoolean,
  parseNonNegativeInt,
  parseFlowStack,
  resolveFlowDepthConfig,
  DEFAULT_MAX_TRANSITION_DEPTH,
  FLOW_DEPTH_ENV,
  FLOW_MAX_DEPTH_ENV,
  FLOW_STACK_ENV,
  FLOW_PREVENT_CYCLES_ENV,
} from "../src/flow/depth.js";

describe("parseBoolean", () => {
  it("returns true for '1'", () => expect(parseBoolean("1")).toBe(true));
  it("returns true for 'true'", () => expect(parseBoolean("true")).toBe(true));
  it("returns true for 'yes'", () => expect(parseBoolean("yes")).toBe(true));
  it("returns true for 'on'", () => expect(parseBoolean("on")).toBe(true));
  it("returns false for '0'", () => expect(parseBoolean("0")).toBe(false));
  it("returns false for 'false'", () => expect(parseBoolean("false")).toBe(false));
  it("returns false for 'no'", () => expect(parseBoolean("no")).toBe(false));
  it("returns false for 'off'", () => expect(parseBoolean("off")).toBe(false));
  it("returns null for random string", () => expect(parseBoolean("maybe")).toBeNull());
  it("returns null for empty string", () => expect(parseBoolean("")).toBeNull());
  it("passes through boolean true", () => expect(parseBoolean(true)).toBe(true));
  it("passes through boolean false", () => expect(parseBoolean(false)).toBe(false));
  it("returns null for number", () => expect(parseBoolean(1)).toBeNull());
  it("returns null for null", () => expect(parseBoolean(null)).toBeNull());
  it("is case-insensitive", () => expect(parseBoolean("TRUE")).toBe(true));
});

describe("parseNonNegativeInt", () => {
  it("parses '0'", () => expect(parseNonNegativeInt("0")).toBe(0));
  it("parses '3'", () => expect(parseNonNegativeInt("3")).toBe(3));
  it("returns null for negative", () => expect(parseNonNegativeInt("-1")).toBeNull());
  it("returns null for float", () => expect(parseNonNegativeInt("3.5")).toBeNull());
  it("returns null for text", () => expect(parseNonNegativeInt("abc")).toBeNull());
  it("returns null for empty", () => expect(parseNonNegativeInt("")).toBeNull());
  it("returns null for non-string", () => expect(parseNonNegativeInt(5)).toBeNull());
  it("returns null for huge number", () => expect(parseNonNegativeInt("99999999999999999999")).toBeNull());
});

describe("parseFlowStack", () => {
  it("returns empty array for undefined", () => expect(parseFlowStack(undefined)).toEqual([]));
  it("returns empty array for empty string", () => expect(parseFlowStack("")).toEqual([]));
  it("parses valid JSON array", () =>
    expect(parseFlowStack('["scout", "build"]')).toEqual(["scout", "build"]));
  it("trims and lowercases entries", () =>
    expect(parseFlowStack('["  Scout ", "BUILD"]')).toEqual(["scout", "build"]));
  it("filters empty strings", () =>
    expect(parseFlowStack('["scout", "", "build"]')).toEqual(["scout", "build"]));
  it("returns null for invalid JSON", () => expect(parseFlowStack("not json")).toBeNull());
  it("returns null for non-array JSON", () => expect(parseFlowStack('{"a":1}')).toBeNull());
  it("returns null for array with non-strings", () =>
    expect(parseFlowStack('["a", 1, "b"]')).toBeNull());
  it("returns null for non-string input", () => expect(parseFlowStack(123)).toBeNull());
});

describe("resolveFlowDepthConfig", () => {
  let originalEnv: Record<string, string | undefined> = {};
  let originalArgv: string[] = [];

  beforeEach(() => {
    originalEnv = {
      [FLOW_DEPTH_ENV]: process.env[FLOW_DEPTH_ENV],
      [FLOW_MAX_DEPTH_ENV]: process.env[FLOW_MAX_DEPTH_ENV],
      [FLOW_STACK_ENV]: process.env[FLOW_STACK_ENV],
      [FLOW_PREVENT_CYCLES_ENV]: process.env[FLOW_PREVENT_CYCLES_ENV],
    };
    originalArgv = process.argv;
    delete process.env[FLOW_DEPTH_ENV];
    delete process.env[FLOW_MAX_DEPTH_ENV];
    delete process.env[FLOW_STACK_ENV];
    delete process.env[FLOW_PREVENT_CYCLES_ENV];
  });

  afterEach(() => {
    Object.entries(originalEnv).forEach(([k, v]) => {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    });
    process.argv = originalArgv;
  });

  function makeMockPi(flags: Record<string, string | undefined> = {}) {
    return {
      getFlag: vi.fn((name: string) => flags[name]),
    };
  }

  it("returns defaults when no env/flags set", () => {
    const config = resolveFlowDepthConfig(makeMockPi() as any);
    expect(config.currentDepth).toBe(0);
    expect(config.maxDepth).toBe(DEFAULT_MAX_TRANSITION_DEPTH);
    expect(config.canTransition).toBe(true);
    expect(config.ancestorFlowStack).toEqual([]);
    expect(config.preventCycles).toBe(true);
  });

  it("reads current depth from env", () => {
    process.env[FLOW_DEPTH_ENV] = "2";
    const config = resolveFlowDepthConfig(makeMockPi() as any);
    expect(config.currentDepth).toBe(2);
    expect(config.canTransition).toBe(true);
  });

  it("reads max depth from env", () => {
    process.env[FLOW_MAX_DEPTH_ENV] = "5";
    const config = resolveFlowDepthConfig(makeMockPi() as any);
    expect(config.maxDepth).toBe(5);
  });

  it("env max depth overrides default", () => {
    process.env[FLOW_MAX_DEPTH_ENV] = "1";
    const config = resolveFlowDepthConfig(makeMockPi() as any);
    expect(config.maxDepth).toBe(1);
    expect(config.canTransition).toBe(true); // currentDepth defaults 0
  });

  it("respects depth limit when currentDepth >= maxDepth", () => {
    process.env[FLOW_DEPTH_ENV] = "3";
    process.env[FLOW_MAX_DEPTH_ENV] = "3";
    const config = resolveFlowDepthConfig(makeMockPi() as any);
    expect(config.canTransition).toBe(false);
  });

  it("reads flow stack from env", () => {
    process.env[FLOW_STACK_ENV] = '["scout", "build"]';
    const config = resolveFlowDepthConfig(makeMockPi() as any);
    expect(config.ancestorFlowStack).toEqual(["scout", "build"]);
  });

  it("reads preventCycles from env", () => {
    process.env[FLOW_PREVENT_CYCLES_ENV] = "false";
    const config = resolveFlowDepthConfig(makeMockPi() as any);
    expect(config.preventCycles).toBe(false);
  });

  it("runtime flag overrides env max depth", () => {
    process.env[FLOW_MAX_DEPTH_ENV] = "5";
    const mockPi = makeMockPi({ "flow-max-depth": "2" });
    const config = resolveFlowDepthConfig(mockPi as any);
    expect(config.maxDepth).toBe(2);
  });

  it("argv flag overrides env max depth", () => {
    process.env[FLOW_MAX_DEPTH_ENV] = "5";
    process.argv = ["node", "script", "--flow-max-depth", "2"];
    const config = resolveFlowDepthConfig(makeMockPi() as any);
    expect(config.maxDepth).toBe(2);
  });

  it("ignores invalid depth env with warning", () => {
    process.env[FLOW_DEPTH_ENV] = "abc";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = resolveFlowDepthConfig(makeMockPi() as any);
    expect(config.currentDepth).toBe(0);
    warnSpy.mockRestore();
  });

  it("ignores invalid maxDepth env with warning", () => {
    process.env[FLOW_MAX_DEPTH_ENV] = "xyz";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = resolveFlowDepthConfig(makeMockPi() as any);
    expect(config.maxDepth).toBe(DEFAULT_MAX_TRANSITION_DEPTH);
    warnSpy.mockRestore();
  });

  it("argv prevent-cycles flag overrides env", () => {
    process.env[FLOW_PREVENT_CYCLES_ENV] = "true";
    process.argv = ["node", "script", "--no-flow-prevent-cycles"];
    const config = resolveFlowDepthConfig(makeMockPi() as any);
    expect(config.preventCycles).toBe(false);
  });

  it("runtime prevent-cycles flag respected when argv absent", () => {
    const mockPi = makeMockPi({ "flow-prevent-cycles": "false" });
    const config = resolveFlowDepthConfig(mockPi as any);
    expect(config.preventCycles).toBe(false);
  });

  it("invalid stack env returns empty array with warning", () => {
    process.env[FLOW_STACK_ENV] = "not-json";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = resolveFlowDepthConfig(makeMockPi() as any);
    expect(config.ancestorFlowStack).toEqual([]);
    warnSpy.mockRestore();
  });
});

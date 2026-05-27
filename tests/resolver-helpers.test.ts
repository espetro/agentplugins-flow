import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveBoolean, resolveString, resolveNumber, type ResolveContext } from "../src/config/resolver-helpers.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function createMockPi(flags: Record<string, unknown> = {}): ExtensionAPI {
	return {
		getFlag: (name: string) => flags[name],
	} as unknown as ExtensionAPI;
}

describe("resolveBoolean", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		delete process.env.TEST_BOOL;
		delete process.env.TEST_BOOL_INVERT;
	});

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	it("returns default when nothing is set", () => {
		const ctx: ResolveContext = { pi: createMockPi(), settings: {} };
		expect(resolveBoolean(ctx, { envVar: "TEST_BOOL", defaultValue: true })).toBe(true);
		expect(resolveBoolean(ctx, { envVar: "TEST_BOOL", defaultValue: false })).toBe(false);
	});

	it("settings.json overrides default", () => {
		const ctx: ResolveContext = { pi: createMockPi(), settings: { flag: false } };
		expect(resolveBoolean(ctx, { settingsPath: ["flag"], defaultValue: true })).toBe(false);
	});

	it("env var overrides settings.json", () => {
		process.env.TEST_BOOL = "0";
		const ctx: ResolveContext = { pi: createMockPi(), settings: { flag: true } };
		expect(resolveBoolean(ctx, { envVar: "TEST_BOOL", settingsPath: ["flag"], defaultValue: true })).toBe(false);
	});

	it("CLI flag overrides env var", () => {
		process.env.TEST_BOOL = "0";
		const pi = createMockPi({ "my-flag": true });
		const ctx: ResolveContext = { pi, settings: { flag: false } };
		expect(resolveBoolean(ctx, { cliFlag: "my-flag", envVar: "TEST_BOOL", settingsPath: ["flag"], defaultValue: false })).toBe(true);
	});

	it("full priority chain: CLI > env > settings > default", () => {
		process.env.TEST_BOOL = "1";
		const pi = createMockPi({ "my-flag": false });
		const ctx: ResolveContext = { pi, settings: { a: { b: true } } };
		expect(resolveBoolean(ctx, { cliFlag: "my-flag", envVar: "TEST_BOOL", settingsPath: ["a", "b"], defaultValue: true })).toBe(false);
	});

	it("parses boolean env strings: 1/true/yes/on → true", () => {
		for (const val of ["1", "true", "yes", "on"]) {
			process.env.TEST_BOOL = val;
			const ctx: ResolveContext = { pi: createMockPi(), settings: {} };
			expect(resolveBoolean(ctx, { envVar: "TEST_BOOL", defaultValue: false })).toBe(true);
		}
	});

	it("parses boolean env strings: 0/false/no/off → false", () => {
		for (const val of ["0", "false", "no", "off"]) {
			process.env.TEST_BOOL = val;
			const ctx: ResolveContext = { pi: createMockPi(), settings: {} };
			expect(resolveBoolean(ctx, { envVar: "TEST_BOOL", defaultValue: true })).toBe(false);
		}
	});

	it("ignores invalid env strings and falls through", () => {
		process.env.TEST_BOOL = "maybe";
		const ctx: ResolveContext = { pi: createMockPi(), settings: { flag: true } };
		expect(resolveBoolean(ctx, { envVar: "TEST_BOOL", settingsPath: ["flag"], defaultValue: false })).toBe(true);
	});

	it("inverts when invert=true (NO_* pattern)", () => {
		process.env.TEST_BOOL_INVERT = "1";
		const ctx: ResolveContext = { pi: createMockPi(), settings: {} };
		expect(resolveBoolean(ctx, { envVar: "TEST_BOOL_INVERT", defaultValue: true, invert: true })).toBe(false);
	});

	it("inverted CLI flag: --no-thing=true disables the thing", () => {
		const pi = createMockPi({ "no-thing": true });
		const ctx: ResolveContext = { pi, settings: {} };
		expect(resolveBoolean(ctx, { cliFlag: "no-thing", defaultValue: true, invert: true })).toBe(false);
	});

	it("inverted CLI string flag parsed correctly", () => {
		const pi = createMockPi({ "no-thing": "true" });
		const ctx: ResolveContext = { pi, settings: {} };
		expect(resolveBoolean(ctx, { cliFlag: "no-thing", defaultValue: true, invert: true })).toBe(false);
	});

	it("missing settingsPath skips settings layer", () => {
		const ctx: ResolveContext = { pi: createMockPi(), settings: { flag: false } };
		expect(resolveBoolean(ctx, { defaultValue: true })).toBe(true);
	});

	it("missing envVar skips env layer", () => {
		const ctx: ResolveContext = { pi: createMockPi(), settings: { flag: false } };
		expect(resolveBoolean(ctx, { settingsPath: ["flag"], defaultValue: true })).toBe(false);
	});

	it("missing cliFlag skips CLI layer", () => {
		const pi = createMockPi({ "my-flag": false });
		const ctx: ResolveContext = { pi, settings: {} };
		expect(resolveBoolean(ctx, { defaultValue: true })).toBe(true);
	});
});

describe("resolveString", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		delete process.env.TEST_STR;
	});

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	it("returns default when nothing is set", () => {
		const ctx: ResolveContext = { pi: createMockPi(), settings: {} };
		expect(resolveString(ctx, { envVar: "TEST_STR", defaultValue: "default" })).toBe("default");
	});

	it("settings.json overrides default", () => {
		const ctx: ResolveContext = { pi: createMockPi(), settings: { mode: "complex" } };
		expect(resolveString(ctx, { settingsPath: ["mode"], defaultValue: "simple" })).toBe("complex");
	});

	it("env var overrides settings.json", () => {
		process.env.TEST_STR = "env-value";
		const ctx: ResolveContext = { pi: createMockPi(), settings: { mode: "settings-value" } };
		expect(resolveString(ctx, { envVar: "TEST_STR", settingsPath: ["mode"], defaultValue: "default" })).toBe("env-value");
	});

	it("CLI flag overrides env var", () => {
		process.env.TEST_STR = "env-value";
		const pi = createMockPi({ "my-flag": "cli-value" });
		const ctx: ResolveContext = { pi, settings: { mode: "settings-value" } };
		expect(resolveString(ctx, { cliFlag: "my-flag", envVar: "TEST_STR", settingsPath: ["mode"], defaultValue: "default" })).toBe("cli-value");
	});

	it("full priority chain: CLI > env > settings > default", () => {
		process.env.TEST_STR = "env";
		const pi = createMockPi({ "my-flag": "cli" });
		const ctx: ResolveContext = { pi, settings: { a: { b: "settings" } } };
		expect(resolveString(ctx, { cliFlag: "my-flag", envVar: "TEST_STR", settingsPath: ["a", "b"], defaultValue: "default" })).toBe("cli");
	});

	it("validator rejects invalid values and falls through", () => {
		process.env.TEST_STR = "bad";
		const ctx: ResolveContext = { pi: createMockPi(), settings: { mode: "good" } };
		expect(
			resolveString(ctx, {
				envVar: "TEST_STR",
				settingsPath: ["mode"],
				defaultValue: "default",
				validator: (v) => v === "good" || v === "default",
			}),
		).toBe("good");
	});

	it("validator accepts valid values", () => {
		process.env.TEST_STR = "good";
		const ctx: ResolveContext = { pi: createMockPi(), settings: {} };
		expect(
			resolveString(ctx, {
				envVar: "TEST_STR",
				defaultValue: "default",
				validator: (v) => v === "good" || v === "default",
			}),
		).toBe("good");
	});

	it("trims env var values", () => {
		process.env.TEST_STR = "  spaced  ";
		const ctx: ResolveContext = { pi: createMockPi(), settings: {} };
		expect(resolveString(ctx, { envVar: "TEST_STR", defaultValue: "default" })).toBe("spaced");
	});

	it("empty env var falls through", () => {
		process.env.TEST_STR = "   ";
		const ctx: ResolveContext = { pi: createMockPi(), settings: { mode: "settings" } };
		expect(resolveString(ctx, { envVar: "TEST_STR", settingsPath: ["mode"], defaultValue: "default" })).toBe("settings");
	});

	it("missing settingsPath skips settings layer", () => {
		const ctx: ResolveContext = { pi: createMockPi(), settings: { mode: "settings" } };
		expect(resolveString(ctx, { defaultValue: "default" })).toBe("default");
	});
});

describe("resolveNumber", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		delete process.env.TEST_NUM;
	});

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	it("returns default when nothing is set", () => {
		const ctx: ResolveContext = { pi: createMockPi(), settings: {} };
		expect(resolveNumber(ctx, { envVar: "TEST_NUM", defaultValue: 4 })).toBe(4);
	});

	it("settings.json overrides default", () => {
		const ctx: ResolveContext = { pi: createMockPi(), settings: { count: 8 } };
		expect(resolveNumber(ctx, { settingsPath: ["count"], defaultValue: 4 })).toBe(8);
	});

	it("env var overrides settings.json", () => {
		process.env.TEST_NUM = "16";
		const ctx: ResolveContext = { pi: createMockPi(), settings: { count: 8 } };
		expect(resolveNumber(ctx, { envVar: "TEST_NUM", settingsPath: ["count"], defaultValue: 4 })).toBe(16);
	});

	it("CLI flag overrides env var", () => {
		process.env.TEST_NUM = "16";
		const pi = createMockPi({ "my-flag": 32 });
		const ctx: ResolveContext = { pi, settings: { count: 8 } };
		expect(resolveNumber(ctx, { cliFlag: "my-flag", envVar: "TEST_NUM", settingsPath: ["count"], defaultValue: 4 })).toBe(32);
	});

	it("CLI string flag parsed to number", () => {
		const pi = createMockPi({ "my-flag": "64" });
		const ctx: ResolveContext = { pi, settings: {} };
		expect(resolveNumber(ctx, { cliFlag: "my-flag", defaultValue: 4 })).toBe(64);
	});

	it("full priority chain: CLI > env > settings > default", () => {
		process.env.TEST_NUM = "16";
		const pi = createMockPi({ "my-flag": 32 });
		const ctx: ResolveContext = { pi, settings: { a: { b: 8 } } };
		expect(resolveNumber(ctx, { cliFlag: "my-flag", envVar: "TEST_NUM", settingsPath: ["a", "b"], defaultValue: 4 })).toBe(32);
	});

	it("clamps to min", () => {
		const pi = createMockPi({ "my-flag": 0 });
		const ctx: ResolveContext = { pi, settings: {} };
		expect(resolveNumber(ctx, { cliFlag: "my-flag", defaultValue: 4, min: 1 })).toBe(1);
	});

	it("clamps to max", () => {
		const pi = createMockPi({ "my-flag": 100 });
		const ctx: ResolveContext = { pi, settings: {} };
		expect(resolveNumber(ctx, { cliFlag: "my-flag", defaultValue: 4, max: 8 })).toBe(8);
	});

	it("clamps both min and max", () => {
		const ctx: ResolveContext = { pi: createMockPi(), settings: {} };
		expect(resolveNumber(ctx, { defaultValue: 10, min: 2, max: 5 })).toBe(5);
	});

	it("rejects non-integer env var and falls through", () => {
		process.env.TEST_NUM = "2.5";
		const ctx: ResolveContext = { pi: createMockPi(), settings: { count: 8 } };
		expect(resolveNumber(ctx, { envVar: "TEST_NUM", settingsPath: ["count"], defaultValue: 4 })).toBe(8);
	});

	it("rejects NaN env var and falls through", () => {
		process.env.TEST_NUM = "abc";
		const ctx: ResolveContext = { pi: createMockPi(), settings: { count: 8 } };
		expect(resolveNumber(ctx, { envVar: "TEST_NUM", settingsPath: ["count"], defaultValue: 4 })).toBe(8);
	});

	it("rejects non-integer CLI string and falls through", () => {
		const pi = createMockPi({ "my-flag": "abc" });
		const ctx: ResolveContext = { pi, settings: { count: 8 } };
		expect(resolveNumber(ctx, { cliFlag: "my-flag", settingsPath: ["count"], defaultValue: 4 })).toBe(8);
	});

	it("missing settingsPath skips settings layer", () => {
		const ctx: ResolveContext = { pi: createMockPi(), settings: { count: 8 } };
		expect(resolveNumber(ctx, { defaultValue: 4 })).toBe(4);
	});

	it("missing envVar skips env layer", () => {
		const ctx: ResolveContext = { pi: createMockPi(), settings: { count: 8 } };
		expect(resolveNumber(ctx, { settingsPath: ["count"], defaultValue: 4 })).toBe(8);
	});

	it("missing cliFlag skips CLI layer", () => {
		const pi = createMockPi({ "my-flag": 100 });
		const ctx: ResolveContext = { pi, settings: {} };
		expect(resolveNumber(ctx, { defaultValue: 4 })).toBe(4);
	});
});

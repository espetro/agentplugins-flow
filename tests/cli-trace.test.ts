import { describe, it, expect } from "vitest";
import { parseTraceCmd } from "../src/tools/trace.js";
import { splitOnDoubleDash } from "../src/cli/chain.js";

describe("splitOnDoubleDash", () => {
	it("splits on the first standalone --", () => {
		const result = splitOnDoubleDash("trace --intent verify -- batch read foo.txt");
		expect(result.pre).toBe("trace --intent verify");
		expect(result.post).toBe("batch read foo.txt");
	});

	it("returns empty post when no -- is present", () => {
		const result = splitOnDoubleDash("trace --intent verify");
		expect(result.pre).toBe("trace --intent verify");
		expect(result.post).toBe("");
	});

	it("returns empty pre when -- is at the start", () => {
		const result = splitOnDoubleDash("-- batch read foo.txt");
		expect(result.pre).toBe("");
		expect(result.post).toBe("batch read foo.txt");
	});

	it("does not split on flag-like --intent", () => {
		const result = splitOnDoubleDash("trace --intent verify batch read foo.txt");
		expect(result.pre).toBe("trace --intent verify batch read foo.txt");
		expect(result.post).toBe("");
	});

	it("respects double quotes", () => {
		const result = splitOnDoubleDash('trace --intent "verify auth" -- batch read foo.txt');
		expect(result.pre).toBe('trace --intent "verify auth"');
		expect(result.post).toBe("batch read foo.txt");
	});

	it("respects single quotes", () => {
		const result = splitOnDoubleDash("trace --intent 'verify auth' -- batch read foo.txt");
		expect(result.pre).toBe("trace --intent 'verify auth'");
		expect(result.post).toBe("batch read foo.txt");
	});

	it("does not split on -- inside quotes", () => {
		const result = splitOnDoubleDash('trace --intent "foo -- bar" -- batch read foo.txt');
		expect(result.pre).toBe('trace --intent "foo -- bar"');
		expect(result.post).toBe("batch read foo.txt");
	});

	it("ignores trailing --", () => {
		const result = splitOnDoubleDash("trace --intent verify --");
		expect(result.pre).toBe("trace --intent verify");
		expect(result.post).toBe("");
	});
});

describe("parseTraceCmd", () => {
	it("empty string returns help", () => {
		const result = parseTraceCmd("");
		expect(result.help).toBe(true);
		expect(result.flags).toEqual({});
		expect(result.dispatch).toBe("");
	});

	it("'help' returns help", () => {
		const result = parseTraceCmd("help");
		expect(result.help).toBe(true);
	});

	it("'--help' returns help", () => {
		const result = parseTraceCmd("--help");
		expect(result.help).toBe(true);
	});

	it("'-h' returns help", () => {
		const result = parseTraceCmd("-h");
		expect(result.help).toBe(true);
	});

	it("'trace help' returns help (strips leading trace)", () => {
		const result = parseTraceCmd("trace help");
		expect(result.help).toBe(true);
	});

	it("'trace --help' returns help", () => {
		const result = parseTraceCmd("trace --help");
		expect(result.help).toBe(true);
	});

	it("'trace -h' returns help", () => {
		const result = parseTraceCmd("trace -h");
		expect(result.help).toBe(true);
	});

	it("bare 'trace' returns no flags, no dispatch", () => {
		const result = parseTraceCmd("trace");
		expect(result.help).toBe(false);
		expect(result.flags).toEqual({});
		expect(result.dispatch).toBe("");
	});

	it("parses --intent", () => {
		const result = parseTraceCmd("trace --intent verify");
		expect(result.flags.intent).toBe("verify");
		expect(result.dispatch).toBe("");
	});

	it("parses -i as intent short flag", () => {
		const result = parseTraceCmd("trace -i verify");
		expect(result.flags.intent).toBe("verify");
	});

	it("parses --cwd", () => {
		const result = parseTraceCmd("trace --cwd /tmp");
		expect(result.flags.cwd).toBe("/tmp");
	});

	it("parses --complexity", () => {
		const result = parseTraceCmd("trace --complexity moderate");
		expect(result.flags.complexity).toBe("moderate");
	});

	it("parses -c as complexity short flag", () => {
		const result = parseTraceCmd("trace -c moderate");
		expect(result.flags.complexity).toBe("moderate");
	});

	it("parses dispatch after --", () => {
		const result = parseTraceCmd("trace -- batch read foo.txt");
		expect(result.dispatch).toBe("batch read foo.txt");
		expect(result.flags).toEqual({});
	});

	it("parses combined flags and dispatch", () => {
		const result = parseTraceCmd("trace --intent verify -- batch read foo.txt");
		expect(result.flags.intent).toBe("verify");
		expect(result.dispatch).toBe("batch read foo.txt");
	});

	it("preserves chained dispatch with ;", () => {
		const result = parseTraceCmd("trace -- batch read foo.txt; batch bash ls");
		expect(result.dispatch).toBe("batch read foo.txt; batch bash ls");
	});

	it("preserves quoted && inside bash command", () => {
		const result = parseTraceCmd('trace -- batch bash "echo a && b"');
		expect(result.dispatch).toBe('batch bash "echo a && b"');
	});

	it("throws CliError for invalid complexity", () => {
		expect(() => parseTraceCmd("trace --complexity invalid")).toThrow(
			"Invalid complexity: invalid",
		);
	});

	it("throws CliError for unknown flag", () => {
		expect(() => parseTraceCmd("trace --unknown-flag")).toThrow("Unknown flag: --unknown-flag");
	});

	it("last --intent wins when multiple are provided", () => {
		const result = parseTraceCmd("trace --intent first --intent second");
		expect(result.flags.intent).toBe("second");
	});

	it("parses quoted intent value", () => {
		const result = parseTraceCmd('trace --intent "verify auth"');
		expect(result.flags.intent).toBe("verify auth");
	});

	it("parses intent with = syntax", () => {
		const result = parseTraceCmd("trace --intent=verify");
		expect(result.flags.intent).toBe("verify");
	});
});

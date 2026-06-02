import { describe, it, expect } from "vitest";
import { createBatchCliTool } from "../src/cli/register.js";
import { BatchCliParams } from "../src/cli/batch.js";
import { createBatchReadCliTool } from "../src/cli/register.js";
import { BatchReadCliParams } from "../src/cli/batch-read.js";
import { createTraceTool, TraceCliParams } from "../src/tools/trace.js";
import { FLOW_CLI_DESCRIPTION, FlowCliParams } from "../src/index.js";

// ---------------------------------------------------------------------------
// TypeBox schema walker
//
// Walks a TypeBox schema (or the project's mock at
// tests/__mocks__/@sinclair/typebox.ts) and collects every property name and
// literal/union value reachable from the top level. These are the only
// keywords that are valid inside `[]` in a tool's description.
// ---------------------------------------------------------------------------

function collectTokens(schema: unknown, out: Set<string> = new Set()): Set<string> {
	if (!schema || typeof schema !== "object") return out;
	const s = schema as Record<string, unknown>;
	const kind = s.kind;

	if (kind === "object") {
		const props = s.properties as Record<string, unknown> | undefined;
		if (props && typeof props === "object") {
			for (const [key, value] of Object.entries(props)) {
				out.add(key);
				collectTokens(value, out);
			}
		}
	} else if (kind === "array") {
		const items = s.items;
		if (Array.isArray(items)) {
			for (const item of items) collectTokens(item, out);
		} else if (items) {
			collectTokens(items, out);
		}
	} else if (kind === "union") {
		const variants = s.variants;
		if (Array.isArray(variants)) {
			for (const variant of variants) collectTokens(variant, out);
		}
	} else if (kind === "literal") {
		const value = s.value;
		if (typeof value === "string" || typeof value === "number") {
			out.add(String(value));
		}
	} else if (kind === "optional") {
		const inner = s.schema;
		if (inner) collectTokens(inner, out);
	}
	// Other kinds (string, number, boolean, unsafe) are leaves — no tokens to add.

	return out;
}

function extractBracketTokens(text: string): string[] {
	return Array.from(text.matchAll(/\[([^\[\]]+)\]/g), (m) => m[1]);
}

// ---------------------------------------------------------------------------
// Tool description tests
// ---------------------------------------------------------------------------

const tools = [
	{ name: "batch_read", description: createBatchReadCliTool().description, schema: BatchReadCliParams },
	{ name: "batch", description: createBatchCliTool().description, schema: BatchCliParams },
	{ name: "trace", description: createTraceTool().description, schema: TraceCliParams },
	{ name: "flow", description: FLOW_CLI_DESCRIPTION, schema: FlowCliParams },
];

describe("tool description hint hygiene", () => {
	for (const { name, description, schema } of tools) {
		describe(name, () => {
			const validTokens = collectTokens(schema);
			const mentioned = extractBracketTokens(description);

			it("uses [] for at least one keyword (sanity check)", () => {
				expect(mentioned.length).toBeGreaterThan(0);
			});

			it("does not mention any [token] that is not a real arg/field/value", () => {
				const invalid = mentioned.filter((t) => !validTokens.has(t));
				const sortedValid = [...validTokens].sort();
				expect(
					invalid,
					`[${invalid.join("] [")}] in ${name} description are not in the schema.\n` +
						`Valid tokens (sample): ${sortedValid.slice(0, 30).join(", ")}${sortedValid.length > 30 ? "..." : ""}`,
				).toEqual([]);
			});
		});
	}
});

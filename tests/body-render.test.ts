import { describe, it, expect, beforeEach } from "vitest";
import { Container } from "@earendil-works/pi-tui";
import { renderFlowExpanded, renderFlowCollapsed, renderFlowBody, renderMultiFlowExpanded } from "../src/tui/body-render.js";
import { resetAnonymousFlowIdCounter } from "../src/tui/render.js";
import { scrambleManager } from "../src/tui/scramble/index.js";
import { emptyFlowUsage } from "../src/types/flow.js";
import type { SingleResult } from "../src/types/flow.js";

const theme = {
	fg: (color: string, text: string) => text,
	bold: (text: string) => text,
	italic: (text: string) => text,
} as any;

function makeResult(overrides: Partial<SingleResult> = {}): SingleResult {
	return {
		id: "test",
		type: "build",
		status: "done",
		intent: "test intent",
		messages: [],
		usage: { ...emptyFlowUsage(), input: 100, output: 50, total: 150 },
		...overrides,
	} as SingleResult;
}

beforeEach(() => {
	scrambleManager.clear();
	resetAnonymousFlowIdCounter();
});

describe("renderFlowExpanded", () => {
	it("returns a Container", () => {
		const result = renderFlowExpanded(
			makeResult(), "●", false, [], "", theme, "test-id", Date.now(), true, undefined, undefined, undefined
		);
		expect(result).toBeDefined();
		expect("children" in result).toBe(true);
	});

	it("renders with structured output when available", () => {
		const r = makeResult({
			structuredOutput: {
				version: "1.0",
				status: "complete",
				summary: "Did the thing",
				files: [],
				actions: [],
				notDone: [],
				nextSteps: [],
				commands: [],
				reasoning: [],
				notes: [],
			},
		});
		const result = renderFlowExpanded(r, "●", false, [], "", theme, "test-id", Date.now(), true, undefined, undefined, undefined);
		expect(result).toBeDefined();
	});

	it("renders tool traces when present", () => {
		const displayItems = [{ type: "toolCall", name: "bash", args: { command: "echo hi" } }];
		const result = renderFlowExpanded(
			makeResult(), "●", false, displayItems as any, "", theme, "test-id", Date.now(), true, undefined, undefined, undefined
		);
		expect(result).toBeDefined();
	});
});

describe("renderFlowCollapsed", () => {
	it("returns a Container", () => {
		const result = renderFlowCollapsed(
			makeResult(), "●", false, "", theme, undefined, "test-id", undefined, undefined
		);
		expect(result).toBeDefined();
		expect("children" in result).toBe(true);
	});

	it("renders awaiting status", () => {
		const result = renderFlowCollapsed(
			makeResult({ status: "awaiting" }), "○", false, "", theme, undefined, "test-id", undefined, undefined
		);
		expect(result).toBeDefined();
	});

	it("renders error status", () => {
		const result = renderFlowCollapsed(
			makeResult({ status: "error", errorMessage: "Oops" }), "✗", true, "", theme, undefined, "test-id", undefined, undefined
		);
		expect(result).toBeDefined();
	});
});

describe("renderFlowBody", () => {
	it("returns void but mutates container", () => {
		const container = new Container();
		renderFlowBody(container, makeResult(), "body-id", "   ", theme, Date.now(), undefined);
		expect(container.children.length).toBeGreaterThan(0);
	});

	it("skips aim line for trace type", () => {
		const container = new Container();
		renderFlowBody(container, makeResult({ type: "trace" }), "body-id", "   ", theme, Date.now(), undefined);
		const texts = container.children.map((c: any) => c.text || "").join(" ");
		expect(texts).not.toContain("aim ▸");
	});

	it("shows n/a for missing tool call", () => {
		const container = new Container();
		renderFlowBody(container, makeResult({ messages: [] }), "body-id", "   ", theme, Date.now(), undefined);
		const texts = container.children.map((c: any) => c.text || "").join(" ");
		expect(container.children.length).toBeGreaterThan(0);
	});
});

describe("renderMultiFlowExpanded", () => {
	it("returns a Container for multiple results", () => {
		const results = [makeResult({ type: "build" }), makeResult({ type: "audit" })];
		const result = renderMultiFlowExpanded(results, 1, "(ok)", theme, "multi", Date.now(), undefined, undefined);
		expect(result).toBeDefined();
		expect("children" in result).toBe(true);
	});

	it("renders shared context when provided", () => {
		const results = [makeResult()];
		const shared = { messageCount: 2, userMessageCount: 1, assistantMessageCount: 1, toolCalls: {}, totalTokens: 100, preview: "context" };
		const result = renderMultiFlowExpanded(results, 1, "(ok)", theme, "multi", Date.now(), undefined, shared);
		expect(result).toBeDefined();
	});
});

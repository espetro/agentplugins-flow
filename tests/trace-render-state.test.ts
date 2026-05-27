/**
 * TD-8: renderFlowResult with the same args.state must reuse one root container
 * (guards against duplicate trace/flow headers when the host passes stable state).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderFlowResult } from "../src/tui/render.js";
import { scrambleManager } from "../src/tui/scramble/index.js";
import { stripAnsi } from "../src/tui/render-utils.js";
import { emptyFlowUsage } from "../src/types/flow.js";
import type { FlowDetails } from "../src/types/flow.js";

function extractHeader(rendered: unknown): string {
	const container = rendered as { children?: Array<{ render?: (w: number) => string[] }> };
	const first = container.children?.[0];
	if (first && typeof first.render === "function") {
		return stripAnsi(first.render(120).join("\n").split("\n")[0]);
	}
	return "";
}

describe("trace/flow render state machine (TD-8)", () => {
	const theme = { fg: (_c: string, t: string) => t, bg: (_c: string, t: string) => t, bold: (t: string) => t };

	beforeEach(() => {
		scrambleManager.setAnimationConfig({ enabled: false, glitch: false });
		scrambleManager.clear();
	});

	it("reuses __rootContainer across two partial renders with the same state", () => {
		const state: Record<string, unknown> = {};
		const makePartial = (contextTokens: number) => {
			const details: FlowDetails = {
				mode: "flow",
				flowStyle: "fork",
				results: [{
					type: "trace",
					agentSource: "project",
					intent: "read",
					aim: "",
					exitCode: -1,
					messages: [],
					stderr: "",
					usage: { ...emptyFlowUsage(), contextTokens, tps: contextTokens > 5000 ? 42 : 0 },
					model: "fireworks/kimi-k2p6-turbo",
					maxContextTokens: 260_000,
				}],
			};
			return {
				content: [{ type: "text" as const, text: "(running...)" }],
				details,
				_toolCallId: "call-state",
			};
		};

		renderFlowResult(makePartial(10_000), false, theme, {
			toolCallId: "call-state",
			state,
		});
		const rootAfterFirst = state.__rootContainer;
		const second = renderFlowResult(makePartial(10_900), false, theme, {
			toolCallId: "call-state",
			state,
		});

		expect(rootAfterFirst).toBeDefined();
		expect(second).toBe(rootAfterFirst);
		expect(extractHeader(second)).toMatch(/10\.9k/);
	});
});

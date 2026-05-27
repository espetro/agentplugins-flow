/**
 * End-to-end render pipeline tests for flow/trace context display.
 * Exercises onUpdate → renderFlowResult without manual TUI sessions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { renderFlowResult } from "../src/tui/render.js";
import { scrambleManager } from "../src/tui/scramble/index.js";
import { emptyFlowUsage, type FlowDetails, type SingleResult } from "../src/types/flow.js";
import { runFlow, type RunFlowOptions } from "../src/flow/runner.js";
import { parseSharedContext } from "../src/core2/snapshot.js";
import { beginFlowLiveSession } from "../src/tui/flow-live-state.js";
import { stripAnsi } from "../src/tui/render-utils.js";
import type { FlowConfig } from "../src/flow/agents.js";

vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof childProcess>();
	return {
		...actual,
		spawn: vi.fn(),
	};
});

function extractHeader(rendered: unknown): string {
	const container = rendered as { children?: Array<{ text?: string; render?: (w: number) => string[] }> };
	const first = container.children?.[0];
	if (first && typeof first.render === "function") {
		return stripAnsi(first.render(120).join("\n").split("\n")[0]);
	}
	if (first && typeof first.text === "string") {
		return stripAnsi(first.text.split("\n")[0]);
	}
	return "";
}

const mockFlow: FlowConfig = {
	name: "trace",
	description: "trace agent",
	systemPrompt: "You are trace.",
	source: "bundled",
	filePath: "/agents/trace.md",
	tier: "lite",
};

function makeMockProcess() {
	const proc = new EventEmitter() as childProcess.ChildProcess & {
		stdin: EventEmitter & { end: ReturnType<typeof vi.fn> };
		stdout: EventEmitter;
		stderr: EventEmitter;
		pid: number;
		kill: ReturnType<typeof vi.fn>;
	};
	proc.stdin = new EventEmitter() as typeof proc.stdin;
	proc.stdin.end = vi.fn();
	proc.stdout = new EventEmitter();
	proc.stderr = new EventEmitter();
	proc.pid = 12345;
	proc.kill = vi.fn();
	return proc;
}

describe("render context pipeline", () => {
	it("first paint with live boot state shows context ratio not dashes", () => {
		const model = "fireworks/kimi-k2p6-turbo";
		const maxContextTokens = 260_000;
		beginFlowLiveSession("call-bootstrap", {
			sharedContext: { totalTokens: 2000 },
			intent: "read files",
			model,
			maxContextTokens,
			flowType: "trace",
		});
		const rendered = renderFlowResult(
			{ content: [{ type: "text", text: "(starting...)" }], _toolCallId: "call-bootstrap" } as any,
			false,
			{ fg: (_c, t) => t, bg: (_c, t) => t, bold: (t) => t },
			{
				flow: [{ type: "trace", intent: "read files", aim: "", model, maxContextTokens }],
				toolCallId: "call-bootstrap",
			},
		);
		const header = extractHeader(rendered);
		expect(header).toContain("12.0k/0.26M");
		expect(header).not.toContain("-----");
	});

	beforeEach(() => {
		scrambleManager.setAnimationConfig({ enabled: false, glitch: false });
		scrambleManager.clear();
		vi.clearAllMocks();
	});

	it("renderFlowResult shows forked shared context when live contextTokens is still zero", () => {
		const result: SingleResult = {
			type: "trace",
			agentSource: "user",
			intent: "read files",
			aim: "",
			exitCode: -1,
			messages: [],
			stderr: "",
			usage: { ...emptyFlowUsage(), smoothedTps: 2.6, turns: 1 },
			model: "fireworks/kimi-k2p6-turbo",
			maxContextTokens: 260000,
		};
		const details: FlowDetails = {
			mode: "flow",
			flowStyle: "fork",
			projectAgentsDir: null,
			results: [result],
			sharedContext: {
				messageCount: 12,
				userMessageCount: 4,
				assistantMessageCount: 8,
				toolCalls: { read: 3 },
				totalTokens: 48200,
				preview: "prior conversation",
			},
		};
		const header = extractHeader(
			renderFlowResult({ content: [{ type: "text", text: "streaming" }], details }, false, {
				fg: (_c, t) => t,
				bg: (_c, t) => t,
				bold: (t) => t,
			}),
		);
		expect(header).toContain("48.2k/0.26M");
		expect(header).not.toContain("-----");
	});

	it("onUpdate partial renders with non-zero context via sharedContext + prompt baseline", async () => {
		const mockProc = makeMockProcess();
		vi.mocked(childProcess.spawn).mockReturnValue(mockProc);

		const snapshotLines = [
			JSON.stringify({
				type: "message",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "prior" }],
					usage: { input: 40000, output: 8200, totalTokens: 48200 },
				},
			}),
		];
		const sharedContext = parseSharedContext(snapshotLines.join("\n"));
		let lastPartial: FlowDetails | undefined;

		const opts: RunFlowOptions = {
			cwd: "/tmp",
			complexity: "simple",
			flows: [mockFlow],
			flowName: "trace",
			intent: "trace read",
			aim: "",
			forkSessionSnapshotJsonl: snapshotLines.join("\n"),
			parentDepth: 0,
			parentFlowStack: [],
			maxDepth: 0,
			preventCycles: true,
			maxContextTokens: 260000,
			model: "fireworks/kimi-k2p6-turbo",
			onUpdate: (partial) => {
				lastPartial = partial.details;
			},
			makeDetails: (results) => ({
				mode: "flow",
				flowStyle: "fork",
				projectAgentsDir: null,
				results,
				sharedContext,
			}),
		};

		const promise = runFlow(opts);
		mockProc.emit("close", 0);
		await promise;

		expect(lastPartial?.sharedContext?.totalTokens).toBe(48200);
		expect(lastPartial?.results[0]?.usage.contextTokens).toBeGreaterThan(48200);

		const header = extractHeader(
			renderFlowResult(
				{ content: [{ type: "text", text: "done" }], details: lastPartial },
				false,
				{ fg: (_c, t) => t, bg: (_c, t) => t, bold: (t) => t },
				{
					flow: [{ type: "trace", intent: "trace read", model: "fireworks/kimi-k2p6-turbo", maxContextTokens: 260000 }],
					sharedContext,
				},
			),
		);
		expect(header).toMatch(/58\.\dk\/0\.26M/);
		expect(header).not.toContain("-----");
	});
});

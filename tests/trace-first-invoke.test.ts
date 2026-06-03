/**
 * First vs second trace invocation — header context must never show legacy -----/max.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readFileSync } from "node:fs";
import registerExtension from "../src/index.js";
import { createTraceTool } from "../src/tools/trace.js";
import { runFlow } from "../src/flow/runner.js";
import { renderFlowResult } from "../src/tui/render.js";
import { scrambleManager } from "../src/tui/scramble/index.js";
import { stripAnsi } from "../src/tui/render-utils.js";
import { emptyFlowUsage } from "../src/types/flow.js";
import { formatContextLabel } from "../src/tui/render-utils.js";
import { beginFlowLiveSession, getFlowLiveState } from "../src/tui/flow-live-state.js";

vi.mock("../src/flow/runner.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/flow/runner.js")>();
	return { ...actual, runFlow: vi.fn() };
});

function extractHeader(rendered: unknown): string {
	const container = rendered as { children?: Array<{ render?: (w: number) => string[] }> };
	const first = container.children?.[0];
	if (first && typeof first.render === "function") {
		return stripAnsi(first.render(120).join("\n").split("\n")[0]);
	}
	return "";
}

function createMockPi() {
	const handlers: Record<string, Function[]> = {};
	const tools: any[] = [];
	return {
		registerFlag: vi.fn(),
		on: vi.fn((event, handler) => {
			if (!handlers[event]) handlers[event] = [];
			handlers[event].push(handler);
		}),
		registerTool: vi.fn((tool) => tools.push(tool)),
		setActiveTools: vi.fn(),
		getActiveTools: vi.fn(() => ["trace"]),
		getFlag: vi.fn(),
		emit: vi.fn(),
		registerCommand: vi.fn(),
		sendUserMessage: vi.fn(),
		trigger: (event: string, ...args: any[]) =>
			Promise.all((handlers[event] || []).map((h) => h(...args))),
		getTool: (name: string) => tools.find((t) => t.name === name),
	};
}

function makeMockCtx(cwd: string, branch: unknown[] = []) {
	return {
		cwd,
		sessionManager: {
			getHeader: () => ({ type: "session", id: "s1", cwd }),
			getBranch: () => branch,
			getSessionId: () => "test-session",
		},
		hasUI: false,
		ui: { confirm: vi.fn() },
	};
}

function setupTraceAgent(cwd: string) {
	const agentsDir = path.join(cwd, ".pi", "agents");
	fs.mkdirSync(agentsDir, { recursive: true });
	fs.writeFileSync(
		path.join(agentsDir, "trace.md"),
		`---
name: trace
description: Verbatim trace mode
tier: lite
---
Prompt`,
		"utf-8",
	);
}

describe("trace first invoke context header", () => {
	let tmpDir: string;
	let originalCwd: string;

	beforeAll(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-trace-first-"));
		originalCwd = process.cwd();
		process.chdir(tmpDir);
		setupTraceAgent(tmpDir);
	});

	afterAll(() => {
		process.chdir(originalCwd);
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	beforeEach(() => {
		vi.clearAllMocks();
		scrambleManager.setAnimationConfig({ enabled: false, glitch: false });
		scrambleManager.clear();
	});

	it("dist must not ship legacy -----/ placeholder", () => {
		const distPath = path.join(import.meta.dirname, "../dist/tui/render-utils.js");
		const src = readFileSync(distPath, "utf-8");
		expect(src).not.toContain("-----/");
		expect(formatContextLabel(0, 260_000)).toBe("0/0.26M");
	});

	it("renderCall is minimal so host does not show a duplicate trace dashboard", () => {
		const tool = createTraceTool({
			getSettings: () => ({ toolOptimize: false, structuredOutput: false, bodyVerbosity: "lite" }),
			getDepthConfig: () => ({ currentDepth: 0, maxDepth: 3, ancestorFlowStack: [], preventCycles: true }),
			fallbackModel: "fireworks/kimi-k2p6-turbo",
		});
		const theme = { fg: (_c: string, t: string) => t, bg: (_c: string, t: string) => t, bold: (t: string) => t };
		const rendered = tool.renderCall({ intent: "read src/main.ts", toolCallId: "call-first" }, theme);
		const text = extractHeader(rendered);
		expect(text).not.toContain("trace");
		expect(text).not.toContain("-----/");
	});

	it("does not emit onUpdate before pre-dispatch (avoids duplicate trace headers)", async () => {
		const updates: unknown[] = [];
		let dispatchStarted = false;

		const pi = createMockPi();
		registerExtension(pi as any);
		await pi.trigger("session_start", {}, makeMockCtx(tmpDir));

		const tool = pi.getTool("trace");
		const theme = { fg: (_c: string, t: string) => t, bg: (_c: string, t: string) => t, bold: (t: string) => t };

		vi.mocked(runFlow).mockImplementation(async (opts) => {
			dispatchStarted = true;
			opts.onUpdate?.({
				content: [{ type: "text", text: "(running...)" }],
				details: {
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
						usage: { ...emptyFlowUsage(), contextTokens: 12_000 },
						model: "fireworks/kimi-k2p6-turbo",
						maxContextTokens: 260_000,
					}],
				},
			});
			return {
				type: "trace",
				agentSource: "project",
				intent: "read",
				aim: "",
				exitCode: 0,
				messages: [],
				stderr: "",
				usage: emptyFlowUsage(),
			};
		});

		const executePromise = tool.execute(
			"call-first",
			{
				intent: "read src/main.ts",
				dispatch: [{ tool: "batch", ops: [{ o: "read", p: "package.json" }] }],
			},
			new AbortController().signal,
			(partial: any) => updates.push(partial),
			makeMockCtx(tmpDir),
		);

		expect(updates.length).toBe(0);
		expect(dispatchStarted).toBe(false);

		await executePromise;
		expect(dispatchStarted).toBe(true);
		expect(updates.length).toBe(1);
	});

	it("bootstrap ghost render shows positive context without ----- before runFlow onUpdate", () => {
		const theme = { fg: (_c: string, t: string) => t, bg: (_c: string, t: string) => t, bold: (t: string) => t };
		beginFlowLiveSession("call-ghost", {
			sharedContext: { totalTokens: 10_000 },
			intent: "read",
			model: "fireworks/kimi-k2p6-turbo",
			maxContextTokens: 260_000,
			flowType: "trace",
		});
		const rendered = renderFlowResult(
			{ content: [{ type: "text", text: "" }] },
			false,
			theme,
			{
				toolCallId: "call-ghost",
				flow: [{ type: "trace", intent: "read", model: "fireworks/kimi-k2p6-turbo", maxContextTokens: 260_000 }],
			},
		);
		const header = extractHeader(rendered);
		expect(header).toMatch(/20\.0k/);
		expect(header).not.toContain("-----/");
		expect(getFlowLiveState("call-ghost")?.contextTokens).toBeGreaterThan(10_000);
	});

	it("second invoke uses forked sharedContext totalTokens in header", async () => {
		const branch = [
			{
				type: "message",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "prior" }],
					usage: { input: 9000, output: 1200, totalTokens: 10_300 },
				},
			},
		];
		const ctx = makeMockCtx(tmpDir, branch);
		const tool = createTraceTool({
			getSettings: () => ({ toolOptimize: false, structuredOutput: false, bodyVerbosity: "lite" }),
			getDepthConfig: () => ({ currentDepth: 0, maxDepth: 3, ancestorFlowStack: [], preventCycles: true }),
			fallbackModel: "fireworks/kimi-k2p6-turbo",
		});
		const theme = { fg: (_c: string, t: string) => t, bg: (_c: string, t: string) => t, bold: (t: string) => t };

		vi.mocked(runFlow).mockImplementation(async (opts) => {
			const seed = getFlowLiveState("call-second")?.contextTokens ?? 0;
			opts.onUpdate?.({
				content: [{ type: "text", text: "(running...)" }],
				details: {
					mode: "flow",
					flowStyle: "fork",
					results: [{
						type: "trace",
						agentSource: "project",
						intent: "read again",
						aim: "",
						exitCode: -1,
						messages: [],
						stderr: "",
						usage: { ...emptyFlowUsage(), contextTokens: seed },
						model: "fireworks/kimi-k2p6-turbo",
						maxContextTokens: 260_000,
					}],
				},
			});
			return {
				type: "trace",
				agentSource: "project",
				intent: "read again",
				aim: "",
				exitCode: 0,
				messages: [],
				stderr: "",
				usage: { ...emptyFlowUsage(), contextTokens: 10_500 },
				model: "fireworks/kimi-k2p6-turbo",
				maxContextTokens: 260_000,
			};
		});

		let lastHeader = "";
		await tool.execute(
			"call-second",
			{ intent: "read again" },
			new AbortController().signal,
			(partial: any) => {
				const r = partial.details?.results?.[0];
				if (!r) return;
				const rendered = renderFlowResult(
					{ ...partial, _toolCallId: "call-second" },
					false,
					theme,
					{ toolCallId: "call-second", state: {} },
				);
				lastHeader = extractHeader(rendered);
			},
			ctx,
		);

		// Forked session (~10.3k) plus activation estimate → ~20k displayed.
		expect(lastHeader).toMatch(/20\.\dk/);
		expect(lastHeader).not.toContain("-----/");
	});
});

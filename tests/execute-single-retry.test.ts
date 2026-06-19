import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { executeSingleFlow } from "../src/flow/execute-single.js";
import { runFlow } from "../src/flow/runner.js";
import { emptyFlowUsage } from "../src/types/flow.js";
import type { FlowExecutorDeps, ExecuteFlowParams } from "../src/flow/executor.js";
import type { SingleResult } from "../src/types/flow.js";

vi.mock("../src/flow/runner.js", () => ({
	runFlow: vi.fn(),
}));

function makeDeps(overrides: Partial<FlowExecutorDeps> = {}): FlowExecutorDeps {
	return {
		flows: [{
			name: "scout",
			description: "Explore",
			systemPrompt: "scout",
			source: "bundled",
			filePath: "/agents/scout.md",
			tier: "lite",
		}],
		currentDepth: 0,
		maxDepth: 3,
		ancestorFlowStack: [],
		preventCycles: true,
		toolOptimize: true,
		structuredOutput: false,
		cwd: "/tmp",
		loadedFlowModelConfigs: {
			selectedName: "balance",
			configs: {},
			strategy: { lite: { primary: "model-a", failover: ["model-b"] } },
		},
		maxConcurrency: 4,
		defaultComplexity: "snap",
		signal: undefined,
		onUpdate: undefined,
		makeDetails: (results) => ({ mode: "flow", flowStyle: "fork", projectAgentsDir: null, results }),
		getFlag: () => undefined,
		tierOverrideResolver: () => undefined,
		fallbackModel: undefined,
		forkSessionSnapshotJsonl: null,
		projectFlowsDir: null,
		sessionManager: { getHeader: () => null, getBranch: () => [], getSessionId: () => "s1" },
		hasUI: false,
		uiConfirm: async () => true,
		debugMode: false,
		subAgentMaxRetries: 2,
		subAgentBaseDelayMs: 10,
		...overrides,
	};
}

function failedConnectionResult(model?: string): SingleResult {
	return {
		type: "scout",
		agentSource: "bundled",
		intent: "test",
		aim: "test aim",
		exitCode: 1,
		messages: [],
		stderr: "Error: ECONNRESET",
		errorMessage: "Error: ECONNRESET",
		usage: emptyFlowUsage(),
		model,
	};
}

function successResult(model?: string): SingleResult {
	return {
		type: "scout",
		agentSource: "bundled",
		intent: "test",
		aim: "test aim",
		exitCode: 0,
		messages: [{ role: "assistant", content: [{ type: "text", text: "done" }] }],
		stderr: "",
		usage: emptyFlowUsage(),
		model,
	};
}

describe("executeSingleFlow connection retries", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("retries after model failover exhaustion on connection errors", async () => {
		const runFlowMock = vi.mocked(runFlow);
		runFlowMock
			.mockResolvedValueOnce(failedConnectionResult("model-a"))
			.mockResolvedValueOnce(failedConnectionResult("model-b"))
			.mockResolvedValueOnce(successResult("model-a"));

		const allResults: SingleResult[] = [{
			type: "scout",
			agentSource: "bundled",
			intent: "test",
			aim: "test aim",
			exitCode: -1,
			messages: [],
			stderr: "",
			usage: emptyFlowUsage(),
		}];
		const item: ExecuteFlowParams = {
			type: "scout",
			intent: "test",
			aim: "test aim",
			complexity: "snap",
		};

		const promise = executeSingleFlow(makeDeps(), item, allResults, 0, "call-1", () => {}, makeDeps().loadedFlowModelConfigs);
		await vi.runAllTimersAsync();
		const result = await promise;

		expect(runFlowMock).toHaveBeenCalledTimes(3);
		expect(result.exitCode).toBe(0);
	});

	it("does not retry non-connection failures", async () => {
		const runFlowMock = vi.mocked(runFlow);
		runFlowMock.mockResolvedValue({
			...failedConnectionResult("model-a"),
			stderr: "permission denied",
			errorMessage: "permission denied",
		});

		const allResults: SingleResult[] = [{
			type: "scout",
			agentSource: "bundled",
			intent: "test",
			aim: "test aim",
			exitCode: -1,
			messages: [],
			stderr: "",
			usage: emptyFlowUsage(),
		}];
		const item: ExecuteFlowParams = {
			type: "scout",
			intent: "test",
			aim: "test aim",
			complexity: "snap",
		};

		const result = await executeSingleFlow(makeDeps({ subAgentMaxRetries: 3 }), item, allResults, 0, "call-1", () => {}, makeDeps().loadedFlowModelConfigs);

		expect(runFlowMock).toHaveBeenCalledTimes(1);
		expect(result.exitCode).toBe(1);
	});

	it("stops retrying when aborted during backoff", async () => {
		const runFlowMock = vi.mocked(runFlow);
		runFlowMock.mockResolvedValue(failedConnectionResult("model-a"));

		const controller = new AbortController();
		const allResults: SingleResult[] = [{
			type: "scout",
			agentSource: "bundled",
			intent: "test",
			aim: "test aim",
			exitCode: -1,
			messages: [],
			stderr: "",
			usage: emptyFlowUsage(),
		}];
		const item: ExecuteFlowParams = {
			type: "scout",
			intent: "test",
			aim: "test aim",
			complexity: "snap",
		};

		const promise = executeSingleFlow(
			makeDeps({ signal: controller.signal, subAgentMaxRetries: 3, subAgentBaseDelayMs: 1000 }),
			item,
			allResults,
			0,
			"call-1",
			() => {},
			makeDeps().loadedFlowModelConfigs,
		);

		await Promise.resolve();
		controller.abort();
		await vi.runAllTimersAsync();
		const result = await promise;

		expect(runFlowMock).toHaveBeenCalledTimes(2);
		expect(result.exitCode).toBe(1);
	});
});

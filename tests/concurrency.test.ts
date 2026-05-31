import { describe, it, expect, vi } from "vitest";
import { executeFlows } from "../src/flow/executor.js";
import { executeSingleFlow } from "../src/flow/execute-single.js";
import { emptyFlowUsage } from "../src/types/flow.js";

vi.mock("../src/flow/execute-single.js", () => {
	return {
		executeSingleFlow: vi.fn(),
	};
});

describe("executeFlows concurrency limiting", () => {
	it("should limit concurrency of flows to maxConcurrency", async () => {
		let activeCount = 0;
		let peakCount = 0;

		vi.mocked(executeSingleFlow).mockImplementation(async () => {
			activeCount++;
			peakCount = Math.max(peakCount, activeCount);
			// Wait 50ms to simulate active flow execution
			await new Promise((resolve) => setTimeout(resolve, 50));
			activeCount--;
			return {
				type: "build",
				agentSource: "bundled",
				intent: "test",
				aim: "test",
				exitCode: 0,
				messages: [],
				stderr: "",
				usage: emptyFlowUsage(),
			} as any;
		});

		const mockDeps = {
			flows: [{ name: "build", maxDepth: 2, tier: "flash", source: "bundled" }],
			currentDepth: 0,
			maxDepth: 5,
			ancestorFlowStack: [],
			preventCycles: false,
			toolOptimize: false,
			structuredOutput: false,
			cwd: "/mock",
			loadedFlowModelConfigs: {
				configs: {},
				selectedName: "test",
				strategy: {
					model: "mock-model",
					maxContextTokens: 1000,
				} as any,
			},
			maxConcurrency: 2, // Set a low limit to check if it's respected
			defaultComplexity: "moderate",
			onUpdate: vi.fn(),
			makeDetails: vi.fn((results) => ({ mode: "flow", flowStyle: "fork", results } as any)),
			getFlag: vi.fn(),
			tierOverrideResolver: vi.fn(),
			forkSessionSnapshotJsonl: null,
			projectFlowsDir: null,
			sessionManager: {
				getHeader: () => ({}),
				getBranch: () => [],
				getSessionId: () => "session-1",
			},
			hasUI: false,
			uiConfirm: vi.fn(),
			debugMode: false,
		} as any;

		const params = [
			{ type: "build", intent: "task 1", aim: "aim 1", complexity: "moderate" },
			{ type: "build", intent: "task 2", aim: "aim 2", complexity: "moderate" },
			{ type: "build", intent: "task 3", aim: "aim 3", complexity: "moderate" },
			{ type: "build", intent: "task 4", aim: "aim 4", complexity: "simple" },
			{ type: "build", intent: "task 5", aim: "aim 5", complexity: "simple" },
		] as any[];

		// Task 1, 2, 3 have complexity moderate -> PingPongGroup
		// Task 4, 5 have complexity simple -> regular flows
		const result = await executeFlows(mockDeps, params, "call-1", 1);

		expect(result.failed).toBeFalsy();
		// Verify executeSingleFlow was called for all items + 1 audit flow
		// Total: 3 grouped builds + 1 audit + 2 regular builds = 6 calls
		expect(executeSingleFlow).toHaveBeenCalledTimes(6);
		// Verify that at any given time, at most 2 executions were active
		expect(peakCount).toBeLessThanOrEqual(2);
	});
});

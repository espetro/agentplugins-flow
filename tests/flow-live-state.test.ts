import { describe, it, expect, afterEach } from "vitest";
import {
	beginFlowLiveSession,
	endFlowLiveSession,
	getFlowLiveState,
	buildBootPhaseSingleResult,
} from "../src/tui/flow-live-state.js";
import { computeInitialContextTokens } from "../src/tui/context-display.js";

describe("flow-live-state", () => {
	afterEach(() => {
		endFlowLiveSession("call-1");
		endFlowLiveSession("call-2");
	});

	it("computeInitialContextTokens includes fork, intent, and activation overhead", () => {
		const seed = computeInitialContextTokens({ totalTokens: 5000 }, "read file", undefined, 10_000);
		expect(seed).toBeGreaterThan(14_000);
	});

	it("beginFlowLiveSession stores boot metadata for render", () => {
		beginFlowLiveSession("call-1", {
			sharedContext: { totalTokens: 5000 },
			intent: "read",
			model: "test/model",
			maxContextTokens: 260_000,
			flowType: "trace",
		});
		expect(getFlowLiveState("call-1")?.phase).toBe("boot");
		expect(getFlowLiveState("call-1")?.contextTokens).toBeGreaterThan(14_000);
		expect(getFlowLiveState("call-2")).toBeUndefined();
		endFlowLiveSession("call-1");
		expect(getFlowLiveState("call-1")).toBeUndefined();
	});

	it("buildBootPhaseSingleResult only during boot phase", () => {
		beginFlowLiveSession("call-1", {
			sharedContext: { totalTokens: 10_000 },
			intent: "read",
			flowType: "trace",
			model: "m",
			maxContextTokens: 260_000,
		});
		const boot = buildBootPhaseSingleResult(getFlowLiveState("call-1"), {
			type: "trace",
			intent: "read",
		});
		expect(boot?.exitCode).toBe(-1);
		expect(boot?.usage.contextTokens).toBeGreaterThan(10_000);
		endFlowLiveSession("call-1");
		expect(buildBootPhaseSingleResult(getFlowLiveState("call-1"))).toBeUndefined();
	});
});

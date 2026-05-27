import { describe, it, expect } from "vitest";
import {
	getFlowStatus,
	isFlowStatusComplete,
	isFlowRunning,
	isFlowAwaiting,
	detectGroups,
	flowStatusIcon,
	hashStrToSeed,
	getScintillatingStatusDot,
} from "../src/tui/grouping.js";
import type { SingleResult } from "../src/types/flow.js";

function makeResult(overrides: Partial<SingleResult> = {}): SingleResult {
	return {
		id: "test",
		type: "build",
		status: "done",
		intent: "test intent",
		messages: [],
		usage: { input: 0, output: 0, total: 0 },
		...overrides,
	} as SingleResult;
}

const theme = { fg: (color: string, text: string) => text };

describe("getFlowStatus", () => {
	it("returns status when present", () => {
		expect(getFlowStatus(makeResult({ status: "running" }))).toBe("running");
	});

	it("infers running from exitCode -1", () => {
		expect(getFlowStatus(makeResult({ status: undefined, exitCode: -1 }))).toBe("running");
	});

	it("infers done from exitCode 0", () => {
		expect(getFlowStatus(makeResult({ status: undefined, exitCode: 0 }))).toBe("done");
	});

	it("infers error from exitCode 1", () => {
		expect(getFlowStatus(makeResult({ status: undefined, exitCode: 1 }))).toBe("error");
	});
});

describe("isFlowStatusComplete", () => {
	it("returns true for done", () => {
		expect(isFlowStatusComplete(makeResult({ status: "done" }))).toBe(true);
	});

	it("returns true for error", () => {
		expect(isFlowStatusComplete(makeResult({ status: "error" }))).toBe(true);
	});

	it("returns true for skipped", () => {
		expect(isFlowStatusComplete(makeResult({ status: "skipped" }))).toBe(true);
	});

	it("returns false for running", () => {
		expect(isFlowStatusComplete(makeResult({ status: "running" }))).toBe(false);
	});

	it("returns false for pending", () => {
		expect(isFlowStatusComplete(makeResult({ status: "pending" }))).toBe(false);
	});
});

describe("isFlowRunning", () => {
	it("returns true for running", () => {
		expect(isFlowRunning(makeResult({ status: "running" }))).toBe(true);
	});

	it("returns true for pending", () => {
		expect(isFlowRunning(makeResult({ status: "pending" }))).toBe(true);
	});

	it("returns false for done", () => {
		expect(isFlowRunning(makeResult({ status: "done" }))).toBe(false);
	});
});

describe("isFlowAwaiting", () => {
	it("returns true for awaiting", () => {
		expect(isFlowAwaiting(makeResult({ status: "awaiting" }))).toBe(true);
	});

	it("returns false for running", () => {
		expect(isFlowAwaiting(makeResult({ status: "running" }))).toBe(false);
	});
});

describe("detectGroups", () => {
	it("returns empty for no results", () => {
		const { groups, rootIndices } = detectGroups([]);
		expect(groups).toEqual([]);
		expect(rootIndices).toEqual([]);
	});

	it("puts standalone flows in rootIndices", () => {
		const results = [makeResult({ type: "build" }), makeResult({ type: "audit" })];
		const { groups, rootIndices } = detectGroups(results);
		expect(groups).toEqual([]);
		expect(rootIndices).toEqual([0, 1]);
	});

	it("detects explicit audit-loop groups", () => {
		const results = [
			makeResult({ type: "build", auditLoopGroupId: 1, pingPongMeta: { iteration: 1 } as any }),
			makeResult({ type: "audit", auditLoopGroupId: 1, auditParentType: "build" }),
		];
		const { groups, rootIndices } = detectGroups(results);
		expect(groups).toHaveLength(1);
		expect(groups[0].buildIndices).toEqual([0]);
		expect(groups[0].auditIndex).toBe(1);
		expect(rootIndices).toEqual([]);
	});

	it("handles multiple explicit groups", () => {
		const results = [
			makeResult({ type: "build", auditLoopGroupId: 1, pingPongMeta: { iteration: 1 } as any }),
			makeResult({ type: "audit", auditLoopGroupId: 1, auditParentType: "build" }),
			makeResult({ type: "build", auditLoopGroupId: 2, pingPongMeta: { iteration: 1 } as any }),
			makeResult({ type: "audit", auditLoopGroupId: 2, auditParentType: "build" }),
		];
		const { groups } = detectGroups(results);
		expect(groups).toHaveLength(2);
	});

	it("orphans builds without audit capstone", () => {
		const results = [
			makeResult({ type: "build", auditLoopGroupId: 1, pingPongMeta: { iteration: 1 } as any }),
		];
		const { groups, rootIndices } = detectGroups(results);
		expect(groups).toEqual([]);
		expect(rootIndices).toEqual([0]);
	});
});

describe("flowStatusIcon", () => {
	it("returns ● for running", () => {
		expect(flowStatusIcon(makeResult({ status: "running" }), theme)).toBe("●");
	});

	it("returns ○ for awaiting", () => {
		expect(flowStatusIcon(makeResult({ status: "awaiting" }), theme)).toBe("○");
	});

	it("returns ● for done", () => {
		expect(flowStatusIcon(makeResult({ status: "done" }), theme)).toBe("●");
	});

	it("returns ✗ for error", () => {
		expect(flowStatusIcon(makeResult({ status: "error" }), theme)).toBe("✗");
	});

	it("returns ⊘ for skipped", () => {
		expect(flowStatusIcon(makeResult({ status: "skipped" }), theme)).toBe("⊘");
	});
});

describe("hashStrToSeed", () => {
	it("returns consistent hash for same string", () => {
		expect(hashStrToSeed("hello")).toBe(hashStrToSeed("hello"));
	});

	it("returns different hashes for different strings", () => {
		expect(hashStrToSeed("hello")).not.toBe(hashStrToSeed("world"));
	});

	it("returns a non-negative number", () => {
		expect(hashStrToSeed("anything")).toBeGreaterThanOrEqual(0);
	});
});

describe("getScintillatingStatusDot", () => {
	it("returns ● for done", () => {
		expect(getScintillatingStatusDot(makeResult({ status: "done" }), theme, 0)).toBe("●");
	});

	it("returns ✗ for error", () => {
		expect(getScintillatingStatusDot(makeResult({ status: "error" }), theme, 0)).toBe("✗");
	});

	it("returns ○ for awaiting", () => {
		expect(getScintillatingStatusDot(makeResult({ status: "awaiting" }), theme, 0)).toBe("○");
	});

	it("returns ⊘ for skipped", () => {
		expect(getScintillatingStatusDot(makeResult({ status: "skipped" }), theme, 0)).toBe("⊘");
	});

	it("returns a string for running/pending", () => {
		const dot = getScintillatingStatusDot(makeResult({ status: "running" }), theme, 1000);
		expect(typeof dot).toBe("string");
		expect(dot.length).toBeGreaterThan(0);
	});
});

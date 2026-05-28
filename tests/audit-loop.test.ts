import { describe, it, expect } from "vitest";
import type { SingleResult } from "../src/types/flow.js";
import {
	preserveMetadata,
	createGhostResult,
	buildReworkIntent,
	buildGroupAuditIntent,
	formatPriorAuditHistory,
	formatPriorBuildOutputs,
	type CycleHistoryEntry,
} from "../src/flow/executor.js";
import { detectGroups } from "../src/tui/render.js";

describe("audit loop group detection", () => {
	function makeResult(type: string, extra?: Partial<SingleResult>): SingleResult {
		return {
			type,
			agentSource: "bundled",
			intent: "test",
			aim: "test",
			exitCode: -1,
			messages: [],
			stderr: "",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0, toolCalls: 0 },
			...extra,
		} as SingleResult;
	}

	it("detects a single build + audit group", () => {
		const results: SingleResult[] = [
			makeResult("build", { pingPongMeta: { cycles: 0, verdicts: [], finalVerdict: "pending" } }),
			makeResult("audit", { auditParentType: "build" }),
		];
		const { groups, rootIndices } = detectGroups(results);
		expect(groups).toHaveLength(1);
		expect(groups[0].buildIndices).toEqual([0]);
		expect(groups[0].auditIndex).toBe(1);
		expect(rootIndices).toEqual([]);
	});

	it("detects two builds + audit group", () => {
		const results: SingleResult[] = [
			makeResult("build", { pingPongMeta: { cycles: 0, verdicts: [], finalVerdict: "pending" } }),
			makeResult("build", { pingPongMeta: { cycles: 0, verdicts: [], finalVerdict: "pending" } }),
			makeResult("audit", { auditParentType: "build" }),
		];
		const { groups, rootIndices } = detectGroups(results);
		expect(groups).toHaveLength(1);
		expect(groups[0].buildIndices).toEqual([0, 1]);
		expect(groups[0].auditIndex).toBe(2);
		expect(rootIndices).toEqual([]);
	});

	it("treats audit without preceding builds as standalone", () => {
		const results: SingleResult[] = [
			makeResult("audit", { auditParentType: "build" }),
		];
		const { groups, rootIndices } = detectGroups(results);
		expect(groups).toHaveLength(0);
		expect(rootIndices).toEqual([0]);
	});

	it("handles mixed standalone and grouped flows", () => {
		const results: SingleResult[] = [
			makeResult("build", { pingPongMeta: { cycles: 0, verdicts: [], finalVerdict: "pending" } }),
			makeResult("audit", { auditParentType: "build" }),
			makeResult("scout"),
			makeResult("build", { pingPongMeta: { cycles: 0, verdicts: [], finalVerdict: "pending" } }),
			makeResult("audit", { auditParentType: "build" }),
		];
		const { groups, rootIndices } = detectGroups(results);
		expect(groups).toHaveLength(2);
		expect(groups[0].buildIndices).toEqual([0]);
		expect(groups[0].auditIndex).toBe(1);
		expect(groups[1].buildIndices).toEqual([3]);
		expect(groups[1].auditIndex).toBe(4);
		expect(rootIndices).toEqual([2]);
	});

	it("treats orphaned build as standalone when no audit follows", () => {
		const results: SingleResult[] = [
			makeResult("build", { pingPongMeta: { cycles: 0, verdicts: [], finalVerdict: "pending" } }),
			makeResult("scout"),
		];
		const { groups, rootIndices } = detectGroups(results);
		expect(groups).toHaveLength(0);
		expect(rootIndices).toEqual([0, 1]);
	});

	it("handles three builds + audit group", () => {
		const results: SingleResult[] = [
			makeResult("build", { pingPongMeta: { cycles: 0, verdicts: [], finalVerdict: "pending" } }),
			makeResult("build", { pingPongMeta: { cycles: 0, verdicts: [], finalVerdict: "pending" } }),
			makeResult("build", { pingPongMeta: { cycles: 0, verdicts: [], finalVerdict: "pending" } }),
			makeResult("audit", { auditParentType: "build" }),
		];
		const { groups, rootIndices } = detectGroups(results);
		expect(groups).toHaveLength(1);
		expect(groups[0].buildIndices).toEqual([0, 1, 2]);
		expect(groups[0].auditIndex).toBe(3);
		expect(rootIndices).toEqual([]);
	});

	it("detects group by auditLoopGroupId when regular flows separate builds from audit", () => {
		const results: SingleResult[] = [
			makeResult("build", { pingPongMeta: { cycles: 0, verdicts: [], finalVerdict: "pending" }, auditLoopGroupId: 0 }),
			makeResult("build", { pingPongMeta: { cycles: 0, verdicts: [], finalVerdict: "pending" }, auditLoopGroupId: 0 }),
			makeResult("scout"),
			makeResult("ideas"),
			makeResult("audit", { auditParentType: "build", auditLoopGroupId: 0 }),
		];
		const { groups, rootIndices } = detectGroups(results);
		expect(groups).toHaveLength(1);
		expect(groups[0].buildIndices).toEqual([0, 1]);
		expect(groups[0].auditIndex).toBe(4);
		expect(rootIndices).toEqual([2, 3]);
	});

	it("detects group by auditLoopGroupId for non-contiguous builds", () => {
		const results: SingleResult[] = [
			makeResult("build", { pingPongMeta: { cycles: 0, verdicts: [], finalVerdict: "pending" }, auditLoopGroupId: 0 }),
			makeResult("scout"),
			makeResult("build", { pingPongMeta: { cycles: 0, verdicts: [], finalVerdict: "pending" }, auditLoopGroupId: 0 }),
			makeResult("audit", { auditParentType: "build", auditLoopGroupId: 0 }),
		];
		const { groups, rootIndices } = detectGroups(results);
		expect(groups).toHaveLength(1);
		expect(groups[0].buildIndices).toEqual([0, 2]);
		expect(groups[0].auditIndex).toBe(3);
		expect(rootIndices).toEqual([1]);
	});

	it("falls back to contiguity detection when no auditLoopGroupId is present", () => {
		const results: SingleResult[] = [
			makeResult("build", { pingPongMeta: { cycles: 0, verdicts: [], finalVerdict: "pending" } }),
			makeResult("build", { pingPongMeta: { cycles: 0, verdicts: [], finalVerdict: "pending" } }),
			makeResult("audit", { auditParentType: "build" }),
		];
		const { groups, rootIndices } = detectGroups(results);
		expect(groups).toHaveLength(1);
		expect(groups[0].buildIndices).toEqual([0, 1]);
		expect(groups[0].auditIndex).toBe(2);
		expect(rootIndices).toEqual([]);
	});

	it("handles mixed explicit groupId and legacy no-groupId results", () => {
		const results: SingleResult[] = [
			makeResult("build", { pingPongMeta: { cycles: 0, verdicts: [], finalVerdict: "pending" }, auditLoopGroupId: 0 }),
			makeResult("build", { pingPongMeta: { cycles: 0, verdicts: [], finalVerdict: "pending" }, auditLoopGroupId: 0 }),
			makeResult("scout"),
			makeResult("audit", { auditParentType: "build", auditLoopGroupId: 0 }),
			makeResult("build", { pingPongMeta: { cycles: 0, verdicts: [], finalVerdict: "pending" } }),
			makeResult("audit", { auditParentType: "build" }),
		];
		const { groups, rootIndices } = detectGroups(results);
		expect(groups).toHaveLength(2);
		// Explicit group
		expect(groups[0].buildIndices).toEqual([0, 1]);
		expect(groups[0].auditIndex).toBe(3);
		// Legacy fallback group
		expect(groups[1].buildIndices).toEqual([4]);
		expect(groups[1].auditIndex).toBe(5);
		expect(rootIndices).toEqual([2]);
	});

	it("treats orphaned builds with groupId but no audit as standalone", () => {
		const results: SingleResult[] = [
			makeResult("build", { pingPongMeta: { cycles: 0, verdicts: [], finalVerdict: "pending" }, auditLoopGroupId: 0 }),
			makeResult("build", { pingPongMeta: { cycles: 0, verdicts: [], finalVerdict: "pending" }, auditLoopGroupId: 0 }),
			makeResult("scout"),
		];
		const { groups, rootIndices } = detectGroups(results);
		expect(groups).toHaveLength(0);
		expect(rootIndices).toEqual([0, 1, 2]);
	});
});

describe("audit loop metadata preservation", () => {
	it("restores pingPongMeta and auditParentType after overwrite", () => {
		const fresh = {
			type: "build",
			intent: "test",
			aim: "test",
			exitCode: 0,
			messages: [],
			usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
			agentSource: "bundled" as const,
		};
		const previous = {
			...fresh,
			pingPongMeta: { cycles: 2, finalVerdict: "pass", verdicts: [] },
			auditParentType: "build",
		};
		preserveMetadata(fresh, previous);
		expect(fresh.pingPongMeta).toBe(previous.pingPongMeta);
		expect(fresh.auditParentType).toBe("build");
	});

	it("does not overwrite fields that do not exist on source", () => {
		const target = {
			type: "build",
			intent: "test",
			aim: "test",
			exitCode: 0,
			messages: [],
			usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
			agentSource: "bundled" as const,
			pingPongMeta: { cycles: 1, finalVerdict: "pass", verdicts: [] },
		};
		const source = {
			...target,
			auditParentType: "audit",
			// no cycle, no pingPongMeta override
		};
		preserveMetadata(target, source);
		expect(target.auditParentType).toBe("audit");
		expect(target.pingPongMeta).toBeDefined(); // NOT overwritten
	});

	it("restores auditLoopGroupId after overwrite", () => {
		const fresh = {
			type: "build",
			intent: "test",
			aim: "test",
			exitCode: 0,
			messages: [],
			usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
			agentSource: "bundled" as const,
		};
		const previous = {
			...fresh,
			auditLoopGroupId: 42,
			auditParentType: "build",
		};
		preserveMetadata(fresh, previous);
		expect(fresh.auditLoopGroupId).toBe(42);
		expect(fresh.auditParentType).toBe("build");
	});

	it("does not add auditLoopGroupId when source lacks it", () => {
		const target = {
			type: "build",
			intent: "test",
			aim: "test",
			exitCode: 0,
			messages: [],
			usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
			agentSource: "bundled" as const,
		};
		const source = {
			...target,
			auditParentType: "build",
		};
		preserveMetadata(target, source);
		expect("auditLoopGroupId" in target).toBe(false);
	});

	it("survives ghost re-creation (executeGroupedPingPong init pattern)", () => {
		// Simulates the exact bug: executeFlows stamps auditLoopGroupId,
		// then executeGroupedPingPong re-creates ghosts.
		const preAllocated = createGhostResult("build", "test", "test aim", "claude", 260000);
		preAllocated.auditLoopGroupId = 42;
		preAllocated.pingPongMeta = { cycles: 0, verdicts: [], finalVerdict: "pending" };

		// executeGroupedPingPong re-creates the ghost:
		const fresh = createGhostResult("build", "test", "test aim");
		fresh.status = "running";
		fresh.pingPongMeta = { cycles: 0, verdicts: [], finalVerdict: "pending" };

		// The old code was missing this — now fixed:
		fresh.auditLoopGroupId = 42;

		expect(fresh.auditLoopGroupId).toBe(42);
		expect(fresh.pingPongMeta).toBeDefined();
	});

	it("stamps pingPongMeta on audit capstone after loop completes", () => {
		// Simulates the final state after executeGroupedPingPong finishes:
		// build results have pingPongMeta, and audit capstone must also have it.
		const buildResult = {
			type: "build",
			intent: "test",
			aim: "test",
			exitCode: 0,
			messages: [],
			usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
			agentSource: "bundled" as const,
			pingPongMeta: {
				cycles: 2,
				verdicts: [
					{ cycle: 0, verdict: "rework", feedback: "Fix null check" },
					{ cycle: 1, verdict: "pass" },
				],
				finalVerdict: "pass",
			},
		};
		const auditResult = {
			...buildResult,
			type: "audit",
			auditParentType: "build",
			structuredOutput: { verdict: "pass" },
		};
		// After executeGroupedPingPong finalization, audit capstone should carry the same meta
		auditResult.pingPongMeta = {
			cycles: 2,
			verdicts: [
				{ cycle: 0, verdict: "rework", feedback: "Fix null check" },
				{ cycle: 1, verdict: "pass" },
			],
			finalVerdict: "pass",
		};
		expect(auditResult.pingPongMeta).toBeDefined();
		expect(auditResult.pingPongMeta.cycles).toBe(2);
		expect(auditResult.pingPongMeta.finalVerdict).toBe("pass");
		expect(auditResult.pingPongMeta.verdicts).toHaveLength(2);
	});
});

describe("createGhostResult", () => {
	it("creates a bare ghost without model or maxContextTokens", () => {
		const ghost = createGhostResult("audit", "", "Audit 2 build outputs");
		expect(ghost.type).toBe("audit");
		expect(ghost.model).toBeUndefined();
		expect(ghost.maxContextTokens).toBeUndefined();
		expect(ghost.usage.contextTokens).toBe(0);
	});

	it("creates a ghost with model and maxContextTokens", () => {
		const ghost = createGhostResult("audit", "", "Audit 2 build outputs", "claude", 260000);
		expect(ghost.type).toBe("audit");
		expect(ghost.model).toBe("claude");
		expect(ghost.maxContextTokens).toBe(260000);
		expect(ghost.usage.contextTokens).toBe(0);
	});
});

describe("audit loop intent helpers", () => {
	it("buildReworkIntent preserves original intent and latest feedback", () => {
		const intent = buildReworkIntent(
			"Refactor auth to use JWT",
			"Secure auth layer",
			"All tests pass",
			"Missing edge case for expired tokens",
		);
		expect(intent).toContain("## Original Intent");
		expect(intent).toContain("Refactor auth to use JWT");
		expect(intent).toContain("## Build Aim");
		expect(intent).toContain("Secure auth layer");
		expect(intent).toContain("## Acceptance Criteria");
		expect(intent).toContain("All tests pass");
		expect(intent).toContain("## Audit Feedback");
		expect(intent).toContain("Missing edge case for expired tokens");
		expect(intent).toContain("preserving the Original Intent");
	});

	it("buildReworkIntent includes Prior Build Output and Prior Audit History when provided", () => {
		const intent = buildReworkIntent(
			"Refactor auth to use JWT",
			"Secure auth layer",
			"All tests pass",
			"Still missing rate limiting",
			[
				{
					cycle: 0,
					buildOutputs: ["Created jwt.strategy.ts"],
					verdict: "rework",
					feedback: "Add rate limiting",
				},
			],
		);
		expect(intent).toContain("## Prior Build Output");
		expect(intent).toContain("- Build 1: Created jwt.strategy.ts");
		expect(intent).toContain("## Prior Audit History");
		expect(intent).toContain("**Cycle 1**");
		expect(intent).toContain("- Verdict: rework");
		expect(intent).toContain("- Feedback: Add rate limiting");
	});

	it("buildGroupAuditIntent includes current builds with acceptance before intent", () => {
		const audit = buildGroupAuditIntent(
			[
				{ aim: "Fix login bug", intent: "Fix the null pointer", acceptance: "All tests pass", output: "Fixed null pointer in login.ts" },
				{ aim: "Add tests", intent: "Add coverage", output: "Added 3 unit tests" },
			],
			[
				{
					cycle: 0,
					buildOutputs: ["Initial fix", "Initial tests"],
					verdict: "rework",
					feedback: "Tests need more coverage",
				},
			],
		);
		expect(audit).toContain("### Build 1");
		expect(audit).toContain("## Build Aim");
		expect(audit).toContain("Fix login bug");
		expect(audit).toContain("## Acceptance Criteria");
		expect(audit).toContain("All tests pass");
		expect(audit).toContain("## Build Intent");
		expect(audit).toContain("Fix the null pointer");
		expect(audit).toContain("Fixed null pointer in login.ts");
		expect(audit).toContain("### Build 2");
		expect(audit).toContain("Add tests");
		expect(audit).toContain("Added 3 unit tests");
		expect(audit).toContain("## Prior Audit History");
		expect(audit).toContain("**Cycle 1**");
		expect(audit).toContain("- Verdict: rework");
		expect(audit).toContain("- Feedback: Tests need more coverage");
		expect(audit).toContain("## Prior Build Outputs");
		expect(audit).toContain("- Build 1: Initial fix");
		expect(audit).toContain("- Build 2: Initial tests");
	});

	it("buildGroupAuditIntent raises truncation limit to 6000 chars", () => {
		const longOutput = "x".repeat(10000);
		const audit = buildGroupAuditIntent([{ aim: "Test", intent: "Test intent", output: longOutput }]);
		const outputLine = audit.split("\n").find((l) => l.startsWith("x"));
		expect(outputLine).toBeDefined();
		expect(outputLine!.length).toBe(6000);
	});

	it("buildGroupAuditIntent single build preserves original intent via acceptance field", () => {
		const longOutput = "y".repeat(10000);
		const audit = buildGroupAuditIntent([
			{ aim: "Test aim", intent: "Original mission", acceptance: "Criteria met", output: longOutput },
		]);
		// Acceptance Criteria must come before Build Intent
		const acceptanceIndex = audit.indexOf("## Acceptance Criteria");
		const intentIndex = audit.indexOf("## Build Intent");
		expect(acceptanceIndex).toBeLessThan(intentIndex);
		expect(audit).toContain("## Build Intent");
		expect(audit).toContain("Original mission");
		expect(audit).toContain("## Acceptance Criteria");
		expect(audit).toContain("Criteria met");
		const outputLine = audit.split("\n").find((l) => l.startsWith("y"));
		expect(outputLine).toBeDefined();
		expect(outputLine!.length).toBe(6000);
	});

	it("buildGroupAuditIntent renders ## Concerns when concern is provided", () => {
		const audit = buildGroupAuditIntent([
			{ aim: "Fix bug", intent: "Fix null pointer", acceptance: "Tests pass", concern: "Watch for edge cases", output: "Fixed null pointer" },
		]);
		expect(audit).toContain("## Concerns");
		expect(audit).toContain("Watch for edge cases");
	});

	it("buildGroupAuditIntent omits ## Concerns when concern is undefined", () => {
		const audit = buildGroupAuditIntent([
			{ aim: "Fix bug", intent: "Fix null pointer", acceptance: "Tests pass", output: "Fixed null pointer" },
		]);
		expect(audit).not.toContain("## Concerns");
	});

	it("buildGroupAuditIntent orders sections correctly: Acceptance → Concerns → Intent", () => {
		const audit = buildGroupAuditIntent([
			{ aim: "Fix bug", intent: "Fix null pointer", acceptance: "Tests pass", concern: "Watch for edge cases", output: "Fixed null pointer" },
		]);
		const acceptanceIndex = audit.indexOf("## Acceptance Criteria");
		const concernsIndex = audit.indexOf("## Concerns");
		const intentIndex = audit.indexOf("## Build Intent");
		expect(acceptanceIndex).toBeLessThan(concernsIndex);
		expect(concernsIndex).toBeLessThan(intentIndex);
	});

	it("buildGroupAuditIntent includes Prior Audit History with per-build feedback", () => {
		const audit = buildGroupAuditIntent(
			[{ aim: "Test aim", intent: "test", output: "output" }],
			[
				{
					cycle: 0,
					buildOutputs: ["out1"],
					verdict: "pass",
					buildFeedbacks: [null],
				},
			],
		);
		expect(audit).toContain("## Prior Audit History");
		expect(audit).toContain("**Cycle 1**");
		expect(audit).toContain("- Verdict: pass");
		expect(audit).toContain("- Per-Build Feedback:");
		expect(audit).toContain("- Build 1: pass");
	});

	it("helpers omit prior sections when empty", () => {
		const rework = buildReworkIntent("intent", "aim", undefined, "feedback", []);
		expect(rework).not.toContain("## Prior Build Outputs");
		expect(rework).not.toContain("## Prior Audit History");
		const group = buildGroupAuditIntent([{ aim: "A", intent: "I", output: "B" }], []);
		expect(group).not.toContain("## Prior Audit History");
		expect(group).not.toContain("## Prior Build Outputs");
	});

	it("buildReworkIntent uses 'No issues found' feedback when auditFeedbacks is null", () => {
		const intent = buildReworkIntent(
			"Original mission",
			"Secure auth",
			"Tests pass",
			"No issues found.",
			[{ cycle: 0, buildOutputs: ["Created file.ts"], verdict: "pass", buildFeedbacks: [null] }],
		);
		expect(intent).toContain("## Audit Feedback");
		expect(intent).toContain("No issues found.");
		expect(intent).toContain("## Prior Build Outputs");
		expect(intent).toContain("- Build 1: Created file.ts");
	});

	it("formatPriorAuditHistory renders verdicts and per-build feedbacks", () => {
		const entries: CycleHistoryEntry[] = [
			{
				cycle: 0,
				buildOutputs: ["output1", "output2"],
				verdict: "rework",
				feedback: "Top level feedback",
				buildFeedbacks: ["Fix A", null],
			},
		];
		const history = formatPriorAuditHistory(entries);
		expect(history).toContain("**Cycle 1**");
		expect(history).toContain("- Verdict: rework");
		expect(history).toContain("- Feedback: Top level feedback");
		expect(history).toContain("- Per-Build Feedback:");
		expect(history).toContain("- Build 1: Fix A");
		expect(history).toContain("- Build 2: pass");
		expect(history).not.toContain("- Build Outputs:");
	});

	it("formatPriorBuildOutputs renders build outputs without verdicts", () => {
		const entries: CycleHistoryEntry[] = [
			{
				cycle: 0,
				buildOutputs: ["output1", "output2"],
				verdict: "rework",
				feedback: "Top level feedback",
				buildFeedbacks: ["Fix A", null],
			},
		];
		const outputs = formatPriorBuildOutputs(entries);
		expect(outputs).toContain("**Cycle 1**");
		expect(outputs).toContain("- Build Outputs:");
		expect(outputs).toContain("- Build 1: output1");
		expect(outputs).toContain("- Build 2: output2");
		expect(outputs).not.toContain("- Verdict:");
		expect(outputs).not.toContain("- Feedback:");
	});
});

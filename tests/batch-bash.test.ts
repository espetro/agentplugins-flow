import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { BashProcessTracker, generateBashId, pollBatchBashResults, executeBatchBash, truncateBashOutput, createBatchBashPollTool } from "../src/batch/batch-bash.js";
import { createBatchCliTool } from "../src/cli/register.js";

describe("generateBashId", () => {
	it("generates an 8-char alphanumeric string", () => {
		const id = generateBashId();
		expect(id).toMatch(/^[a-z0-9]{8}$/);
	});

	it("generates unique ids", () => {
		const ids = new Set(Array.from({ length: 100 }, () => generateBashId()));
		expect(ids.size).toBe(100);
	});
});

describe("truncateBashOutput", () => {
	it("returns empty string for empty input", () => {
		expect(truncateBashOutput("")).toBe("");
	});

	it("returns short text unchanged", () => {
		const text = "hello world\nline 2";
		expect(truncateBashOutput(text)).toBe(text);
	});

	it("truncates by line count", () => {
		const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
		const text = lines.join("\n");
		const result = truncateBashOutput(text, 100 * 1024, 5);
		expect(result).toContain("line 1");
		expect(result).toContain("line 5");
		expect(result).not.toContain("line 6");
		expect(result).toContain("[... truncated at 5 lines, 10 total ...]");
	});

	it("truncates by byte size", () => {
		const text = "a".repeat(200 * 1024);
		const result = truncateBashOutput(text, 100 * 1024, 10000);
		const totalBytes = Buffer.byteLength(text, "utf-8");
		expect(result).toContain(`[… ${totalBytes} bytes, truncated to 1024 …]`);
		expect(Buffer.byteLength(result, "utf-8")).toBeLessThanOrEqual(110 * 1024);
	});

	it("applies both line and byte limits", () => {
		const lines = Array.from({ length: 5000 }, (_, i) => `line ${i + 1}`);
		const text = lines.join("\n");
		const result = truncateBashOutput(text, 10 * 1024, 100);
		expect(result).toContain("[... truncated at 100 lines, 5000 total ...]");
		expect(Buffer.byteLength(result, "utf-8")).toBeLessThanOrEqual(12 * 1024);
	});

	it("truncates long single lines before line/byte caps", () => {
		const longLine = "a".repeat(5000);
		const text = `header\n${longLine}\nfooter`;
		const result = truncateBashOutput(text, 100 * 1024, 100);
		expect(result).toContain("[… 5000 bytes, truncated to");
		expect(result).toContain("footer");
	});

	it("truncates multi-byte UTF-8 safely without mojibake", () => {
		const prefix = "a".repeat(98);
		const cjk = "中";
		const emoji = "😀";
		const text = prefix + cjk + emoji + " trailing text";
		const maxBytes = 100;

		const result = truncateBashOutput(text, maxBytes, 10000);
		expect(result).not.toContain("\uFFFD");
		expect(result).toContain("[... truncated at");
	});
});

describe("BashProcessTracker", () => {
	let tracker: BashProcessTracker;

	beforeEach(() => {
		tracker = new BashProcessTracker();
	});

	afterEach(() => {
		tracker.abortAll();
	});

	it("launches and completes a simple command", async () => {
		tracker.launch("t1", "echo hello", process.cwd());

		await waitFor(tracker, "t1", 5000);

		expect(tracker.isRunning("t1")).toBe(false);
		expect(tracker.hasCompleted("t1")).toBe(true);

		const result = tracker.popCompleted("t1")!;
		expect(result.status).toBe("ok");
		expect(result.stdout.trim()).toBe("hello");
		expect(result.exitCode).toBe(0);
		expect(result.duration).toBeGreaterThanOrEqual(0);
		expect(result.timingTier).toBeTruthy();
	});

	it("captures stderr", async () => {
		tracker.launch("t2", "echo err >&2", process.cwd());

		await waitFor(tracker, "t2", 5000);

		const result = tracker.popCompleted("t2")!;
		expect(result.status).toBe("ok");
		expect(result.stderr.trim()).toBe("err");
	});

	it("reports error for nonzero exit", async () => {
		tracker.launch("t3", "exit 1", process.cwd());

		await waitFor(tracker, "t3", 5000);

		const result = tracker.popCompleted("t3")!;
		expect(result.status).toBe("error");
		expect(result.exitCode).toBe(1);
	});

	it("tracks running state", () => {
		tracker.launch("t4", "sleep 30", process.cwd());
		expect(tracker.isRunning("t4")).toBe(true);
		expect(tracker.hasCompleted("t4")).toBe(false);

		tracker.abortAll();
	});

	it("abortAll stops running processes", async () => {
		tracker.launch("t5", "sleep 30", process.cwd());
		tracker.abortAll();

		await new Promise((r) => setTimeout(r, 500));

		expect(tracker.isRunning("t5")).toBe(false);
	});

	it("popCompleted removes from cache", async () => {
		tracker.launch("t6", "echo done", process.cwd());
		await waitFor(tracker, "t6", 5000);

		expect(tracker.hasCompleted("t6")).toBe(true);
		tracker.popCompleted("t6");
		expect(tracker.hasCompleted("t6")).toBe(false);
	});

	it("peekCompleted does not remove from cache", async () => {
		tracker.launch("t7", "echo peek", process.cwd());
		await waitFor(tracker, "t7", 5000);

		tracker.peekCompleted("t7");
		expect(tracker.hasCompleted("t7")).toBe(true);
		tracker.popCompleted("t7");
	});

	it("getRunningTail returns partial output", async () => {
		tracker.launch("t8", "echo line1; sleep 30", process.cwd());

		await new Promise((r) => setTimeout(r, 500));

		const tail = tracker.getRunningTail("t8");
		expect(tail).toContain("line1");

		tracker.abortAll();
	});

	it("re-launch replaces existing process with same id", async () => {
		tracker.launch("t9", "echo first", process.cwd());
		await waitFor(tracker, "t9", 5000);

		tracker.launch("t9", "echo second", process.cwd());
		await waitFor(tracker, "t9", 5000);

		const result = tracker.popCompleted("t9")!;
		expect(result.stdout.trim()).toBe("second");
	});

	it("handles command not found", async () => {
		tracker.launch("t10", "nonexistent_command_xyz_12345", process.cwd());

		await new Promise((r) => setTimeout(r, 2000));
		expect(tracker.isRunning("t10")).toBe(false);
	});

	it("truncates oversized stdout", async () => {
		tracker.launch("t11", `node -e "process.stdout.write('a'.repeat(200000))"`, process.cwd());
		await waitFor(tracker, "t11", 5000);

		const result = tracker.popCompleted("t11")!;
		expect(result.status).toBe("ok");
		expect(result.stdout).toContain("[… 200000 bytes, truncated to 1024 …]");
		expect(Buffer.byteLength(result.stdout, "utf-8")).toBeLessThanOrEqual(4 * 1024);
	});

	it("truncates oversized stderr", async () => {
		tracker.launch("t12", `node -e "process.stderr.write('e'.repeat(200000)); process.exitCode = 1"`, process.cwd());
		await waitFor(tracker, "t12", 5000);

		const result = tracker.popCompleted("t12")!;
		expect(result.status).toBe("error");
		expect(result.stderr).toContain("[… 200000 bytes, truncated to 1024 …]");
		expect(Buffer.byteLength(result.stderr, "utf-8")).toBeLessThanOrEqual(4 * 1024);
	});
});

describe("pollBatchBashResults", () => {
	let tracker: BashProcessTracker;

	beforeEach(() => {
		tracker = new BashProcessTracker();
	});

	afterEach(() => {
		tracker.abortAll();
	});

	it("returns completed results for finished commands", async () => {
		tracker.launch("p1", "echo poll-test", process.cwd());
		await waitFor(tracker, "p1", 5000);

		const results = pollBatchBashResults(["p1"], tracker);
		expect(results).toHaveLength(1);
		expect(results[0].status).toBe("completed");
		expect(results[0].stdout?.trim()).toBe("poll-test");
	});

	it("returns pending for running commands", () => {
		tracker.launch("p2", "sleep 30", process.cwd());

		const results = pollBatchBashResults(["p2"], tracker);
		expect(results).toHaveLength(1);
		expect(results[0].status).toBe("pending");

		tracker.abortAll();
	});

	it("returns pending for unknown IDs", () => {
		const results = pollBatchBashResults(["unknown-id"], tracker);
		expect(results).toHaveLength(1);
		expect(results[0].status).toBe("pending");
	});

	it("handles multiple IDs", async () => {
		tracker.launch("p3", "echo three", process.cwd());
		tracker.launch("p4", "sleep 30", process.cwd());

		await waitFor(tracker, "p3", 5000);

		const results = pollBatchBashResults(["p3", "p4", "nope"], tracker);
		expect(results).toHaveLength(3);
		expect(results[0].status).toBe("completed");
		expect(results[1].status).toBe("pending");
		expect(results[2].status).toBe("pending");
	});
});

describe("executeBatchBash", () => {
	let tracker: BashProcessTracker;

	beforeEach(() => {
		tracker = new BashProcessTracker();
	});

	afterEach(() => {
		tracker.abortAll();
	});

	it("runs multiple commands in parallel", async () => {
		const ops = [
			{ i: "eb1", c: "echo alpha" },
			{ i: "eb2", c: "echo beta" },
			{ i: "eb3", c: "echo gamma" },
		];

		const results = await executeBatchBash(ops, process.cwd(), tracker);
		expect(results).toHaveLength(3);

		const ids = results.map((r) => r.id).sort();
		expect(ids).toEqual(["eb1", "eb2", "eb3"]);

		for (const r of results) {
			expect(r.status).toBe("ok");
			expect(r.stdout).toBeTruthy();
		}
	});

	it("returns pending for commands exceeding soft timeout", async () => {
		const ops = [
			{ i: "eb-fast", c: "echo fast" },
			{ i: "eb-slow", c: "sleep 30" },
		];

		const results = await executeBatchBash(ops, process.cwd(), tracker, undefined, 500);
		expect(results).toHaveLength(2);

		const fast = results.find((r) => r.id === "eb-fast");
		const slow = results.find((r) => r.id === "eb-slow");

		expect(fast?.status).toBe("ok");
		expect(slow?.status).toBe("pending");

		tracker.abortAll();
	});
});

describe("batch CLI bash integration", () => {
	let tmpDir: string;
	let tracker: BashProcessTracker;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agent-flow-batch-cli-bash-test-"));
		tracker = new BashProcessTracker();
	});

	afterEach(() => {
		tracker.abortAll();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function makeCtx(cwd: string) {
		return { cwd };
	}

	it("runs a single bash command", async () => {
		const tool = createBatchCliTool(tracker);
		const result = await tool.execute(
			"call-1",
			{ cmd: "bash -i b1 'echo hello-batch'" },
			undefined,
			undefined,
			makeCtx(tmpDir),
		);

		expect(result.content[0].text).toContain("hello-batch");
		expect(result.details.results).toHaveLength(1);
		expect(result.details.results[0]).toMatchObject({
			op: "bash",
			id: "b1",
			status: "ok",
		});
	});

	it("runs bash with auto-generated id", async () => {
		const tool = createBatchCliTool(tracker);
		const result = await tool.execute(
			"call-1",
			{ cmd: "bash echo auto-id" },
			undefined,
			undefined,
			makeCtx(tmpDir),
		);

		expect(result.content[0].text).toContain("auto-id");
		expect(result.details.results[0].id).toBeTruthy();
	});

	it("mixes file ops and bash ops", async () => {
		fs.writeFileSync(path.join(tmpDir, "mix.txt"), "file-content\n", "utf-8");

		const tool = createBatchCliTool(tracker);
		const result = await tool.execute(
			"call-1",
			{ cmd: "read mix.txt; bash -i mix-b1 'echo bash-content'" },
			undefined,
			undefined,
			makeCtx(tmpDir),
		);

		const texts = result.content[0].text;
		expect(texts).toContain("file-content");
		expect(texts).toContain("bash-content");
		expect(result.details.results).toHaveLength(2);
	});

	it("runs multiple bash commands in parallel", async () => {
		const tool = createBatchCliTool(tracker);
		const result = await tool.execute(
			"call-1",
			{ cmd: "bash -i par1 'echo par1'; bash -i par2 'echo par2'; bash -i par3 'echo par3'" },
			undefined,
			undefined,
			makeCtx(tmpDir),
		);

		expect(result.details.results).toHaveLength(3);
		for (const r of result.details.results) {
			expect(r.status).toBe("ok");
		}
	});

	it("returns pending for commands exceeding timeout", { timeout: 10000 }, async () => {
		const tool = createBatchCliTool(tracker);
		const result = await tool.execute(
			"call-1",
			{ cmd: "bash -i q1 'echo quick'; bash -i s1 -t 500 'sleep 60'" },
			undefined,
			undefined,
			makeCtx(tmpDir),
		);

		const quick = result.details.results.find((r: any) => r.id === "q1");
		expect(quick?.status).toBe("ok");

		const slow = result.details.results.find((r: any) => r.id === "s1");
		expect(slow?.status).toBe("pending");
		expect(result.content[0].text).toContain("batch_bash_poll");

		tracker.abortAll();
	});

	it("file op failure does not skip bash ops", async () => {
		const tool = createBatchCliTool(tracker);
		const result = await tool.execute(
			"call-1",
			{ cmd: "read nonexistent.txt; bash -i still1 'echo still-runs'" },
			undefined,
			undefined,
			makeCtx(tmpDir),
		);

		expect(result.details.results[0].status).toBe("error");
		expect(result.details.results[1]).toMatchObject({
			status: "ok",
			stdout: expect.stringContaining("still-runs"),
		});
	});

	it("bash failure does not skip other bash ops", async () => {
		const tool = createBatchCliTool(tracker);
		const result = await tool.execute(
			"call-1",
			{ cmd: "bash -i fail1 'exit 1'; bash -i ok1 'echo still-runs'" },
			undefined,
			undefined,
			makeCtx(tmpDir),
		);

		const fail = result.details.results.find((r: any) => r.id === "fail1");
		expect(fail?.status).toBe("error");

		const ok = result.details.results.find((r: any) => r.id === "ok1");
		expect(ok?.status).toBe("ok");
		expect(ok?.stdout?.trim()).toBe("still-runs");
	});

	it("respects cwd for bash commands", async () => {
		const realTmp = fs.realpathSync("/tmp");
		const tool = createBatchCliTool(tracker);
		const result = await tool.execute(
			"call-1",
			{ cmd: `bash -i cwd1 -h ${realTmp} pwd` },
			undefined,
			undefined,
			makeCtx(tmpDir),
		);

		expect(result.details.results[0].stdout?.trim()).toBe(realTmp);
	});

	it("captures stderr from bash commands", async () => {
		const tool = createBatchCliTool(tracker);
		const result = await tool.execute(
			"call-1",
			{ cmd: "bash -i stderr1 'echo err-msg >&2'" },
			undefined,
			undefined,
			makeCtx(tmpDir),
		);

		expect(result.details.results[0].stderr?.trim()).toBe("err-msg");
	});

	it("reports nonzero exit as error", async () => {
		const tool = createBatchCliTool(tracker);
		const result = await tool.execute(
			"call-1",
			{ cmd: "bash -i exit99 'exit 99'" },
			undefined,
			undefined,
			makeCtx(tmpDir),
		);

		expect(result.details.results[0]).toMatchObject({
			status: "error",
			exitCode: 99,
		});
	});
});

describe("batch_bash_poll tool", () => {
	let tracker: BashProcessTracker;
	let pollTool: ReturnType<typeof createBatchBashPollTool>;

	beforeEach(() => {
		tracker = new BashProcessTracker();
		pollTool = createBatchBashPollTool(tracker);
	});

	afterEach(() => {
		tracker.abortAll();
	});

	it("returns completed result for finished command", async () => {
		tracker.launch("poll1", "echo polled", process.cwd());
		await waitFor(tracker, "poll1", 5000);

		const result = await pollTool.execute(
			"call-1",
			{ i: ["poll1"] },
			undefined,
			undefined,
			{},
		);

		expect(result.content[0].text).toContain("polled");
		expect(result.content[0].text).toContain("[poll1]");
	});

	it("returns pending for running command", async () => {
		tracker.launch("poll2", "sleep 30", process.cwd());

		const result = await pollTool.execute(
			"call-1",
			{ i: ["poll2"] },
			undefined,
			undefined,
			{},
		);

		expect(result.content[0].text).toContain("still running");
		expect(result.content[0].text).toContain("[poll2]");

		tracker.abortAll();
	});

	it("throws for empty ids", async () => {
		await expect(
			pollTool.execute("call-1", { i: [] }, undefined, undefined, {}),
		).rejects.toThrow("Error: i (ids) array is required and must not be empty.");
	});

	it("handles multiple poll ids", async () => {
		tracker.launch("mp1", "echo a", process.cwd());
		tracker.launch("mp2", "sleep 30", process.cwd());

		await waitFor(tracker, "mp1", 5000);

		const result = await pollTool.execute(
			"call-1",
			{ i: ["mp1", "mp2"] },
			undefined,
			undefined,
			{},
		);

		const text = result.content[0].text;
		expect(text).toContain("[mp1]");
		expect(text).toContain("[mp2]");
		expect(text).toContain("still running");

		tracker.abortAll();
	});

	it("uses ids alias for i parameter", async () => {
		tracker.launch("alias1", "echo alias", process.cwd());
		await waitFor(tracker, "alias1", 5000);

		const result = await pollTool.execute(
			"call-1",
			{ ids: ["alias1"] },
			undefined,
			undefined,
			{},
		);

		expect(result.content[0].text).toContain("alias");
	});
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function waitFor(tracker: BashProcessTracker, id: string, timeoutMs: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const deadline = Date.now() + timeoutMs;
		const check = () => {
			if (!tracker.isRunning(id)) {
				resolve();
				return;
			}
			if (Date.now() > deadline) {
				reject(new Error(`Timed out waiting for ${id}`));
				return;
			}
			setTimeout(check, 50);
		};
		check();
	});
}

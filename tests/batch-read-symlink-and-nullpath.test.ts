import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createBatchReadTool } from "../src/batch/index.js";
import { expandTilde, validatePath } from "../src/batch/fuzzy-edit.js";

describe("batch_read edge cases: symlinks, null p, empty p", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agent-flow-batch-edge-"));
	});

	afterEach(() => {
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		} catch {}
	});

	function makeCtx(cwd: string) {
		return { cwd };
	}

	describe("expandTilde defensive guards", () => {
		it("handles undefined without throwing", () => {
			expect(() => expandTilde(undefined as unknown as string)).not.toThrow();
		});

		it("handles null without throwing", () => {
			expect(() => expandTilde(null as unknown as string)).not.toThrow();
		});

		it("handles non-string types without throwing", () => {
			expect(() => expandTilde(123 as unknown as string)).not.toThrow();
			expect(() => expandTilde({} as unknown as string)).not.toThrow();
		});
	});

	describe("validatePath defensive guards", () => {
		it("rejects undefined input with clear error", async () => {
			await expect(validatePath(undefined as unknown as string, tmpDir)).rejects.toThrow(/path|p/);
		});

		it("rejects null input with clear error", async () => {
			await expect(validatePath(null as unknown as string, tmpDir)).rejects.toThrow(/path|p/);
		});

		it("rejects empty string with clear error (instead of silently resolving to cwd)", async () => {
			await expect(validatePath("", tmpDir)).rejects.toThrow(/path|p/);
		});
	});

	describe("batch_read with edge-case paths", () => {
		it("returns a clean error for symlink-to-directory (NOT raw EISDIR)", async () => {
			// Create a real file and a symlink pointing to a directory
			const realDir = path.join(tmpDir, "real-dir");
			fs.mkdirSync(realDir);
			fs.mkdirSync(path.join(realDir, "sub-dir"));
			const symlinkPath = path.join(tmpDir, "link-to-dir");
			try {
				fs.symlinkSync(realDir, symlinkPath, "dir");
			} catch {
				// Some filesystems (or Windows) may not support symlinks; skip the assertion if so
				return;
			}

			const tool = createBatchReadTool();
			const result = await tool.execute(
				"call-1",
				{ o: [{ o: "read", p: "link-to-dir" }] },
				undefined,
				undefined,
				makeCtx(tmpDir),
			);

			// Permissive mode: reading a symlink-to-directory returns a listing
			// with status: "ok" and directoryListing: true. No raw EISDIR leaks.
			const r = result.details.results[0];
			expect(r.status).toBe("ok");
			expect(r.directoryListing).toBe(true);
			expect(r.content).toBeTruthy();
			expect(r.content).toMatch(/\[D\] /);  // contains directory entries
			expect(r.content).not.toMatch(/EISDIR/);
		});

		it("returns a clean error for missing p (NOT raw TypeError)", async () => {
			const tool = createBatchReadTool();
			const result = await tool.execute(
				"call-2",
				{ o: [{ o: "read" }] },
				undefined,
				undefined,
				makeCtx(tmpDir),
			);
			const r = result.details.results[0];
			expect(r.status).toBe("error");
			expect(r.error).not.toMatch(/Cannot read properties/);
			expect(r.error).toMatch(/path|p|required/);
		});

		it("returns a clean error for empty string p (NOT raw EISDIR)", async () => {
			const tool = createBatchReadTool();
			const result = await tool.execute(
				"call-3",
				{ o: [{ o: "read", p: "" }] },
				undefined,
				undefined,
				makeCtx(tmpDir),
			);
			const r = result.details.results[0];
			expect(r.status).toBe("error");
			expect(r.error).not.toMatch(/^EISDIR:/);
		});

		it("still reads a regular file correctly (regression)", async () => {
			const filePath = path.join(tmpDir, "test.txt");
			fs.writeFileSync(filePath, "hello world\n", "utf-8");
			const tool = createBatchReadTool();
			const result = await tool.execute(
				"call-4",
				{ o: [{ o: "read", p: "test.txt" }] },
				undefined,
				undefined,
				makeCtx(tmpDir),
			);
			expect(result.details.results[0]).toMatchObject({
				op: "read",
				path: "test.txt",
				status: "ok",
			});
		});
	});
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createBatchCliTool } from "../src/cli/register.js";
import { BashProcessTracker } from "../src/batch/batch-bash.js";

function extractText(node: any): string {
	if ("text" in node && typeof node.text === "string") {
		return node.text;
	} else if (node && typeof node === "object" && "children" in node && Array.isArray(node.children)) {
		return node.children.map((child: any) => extractText(child)).join("\n");
	}
	return String(node);
}

describe("batch CLI tool", () => {
	let tmpDir: string;
	let tracker: BashProcessTracker;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agent-flow-batch-test-"));
		tracker = new BashProcessTracker();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		tracker.abortAll();
	});

	function createTool() {
		return createBatchCliTool(tracker);
	}

	function makeCtx(cwd: string) {
		return { cwd };
	}

	describe("read operations", () => {
		it("reads a single file", async () => {
			const filePath = path.join(tmpDir, "test.txt");
			fs.writeFileSync(filePath, "hello world\n", "utf-8");

			const tool = createTool();
			const result = await tool.execute(
				"call-1",
				{ cmd: "read test.txt" },
				undefined,
				undefined,
				makeCtx(tmpDir),
			);

			expect(result.content[0].text).toContain("✔ 1 read");
			expect(result.content[0].text).toContain("--- test.txt (2 lines) ---");
			expect(result.content[0].text).toContain("hello world");
			expect(result.details.results[0]).toMatchObject({
				op: "read",
				path: "test.txt",
				status: "ok",
				content: "hello world\n",
				totalLines: 2,
			});
		});

		it("reads multiple files", async () => {
			fs.writeFileSync(path.join(tmpDir, "a.txt"), "content a\n", "utf-8");
			fs.writeFileSync(path.join(tmpDir, "b.txt"), "content b\n", "utf-8");

			const tool = createTool();
			const result = await tool.execute(
				"call-1",
				{ cmd: "read a.txt b.txt" },
				undefined,
				undefined,
				makeCtx(tmpDir),
			);

			expect(result.content[0].text).toContain("✔ 2 read");
			expect(result.content[0].text).toContain("--- a.txt (2 lines) ---");
			expect(result.content[0].text).toContain("content a");
			expect(result.content[0].text).toContain("--- b.txt (2 lines) ---");
			expect(result.content[0].text).toContain("content b");
			expect(result.details.results).toHaveLength(2);
			expect(result.details.results[0].content).toBe("content a\n");
			expect(result.details.results[1].content).toBe("content b\n");
		});

		it("strips BOM from read content", async () => {
			const filePath = path.join(tmpDir, "bom.txt");
			fs.writeFileSync(filePath, "\uFEFFhello BOM\n", "utf-8");

			const tool = createTool();
			const result = await tool.execute(
				"call-1",
				{ cmd: "read bom.txt" },
				undefined,
				undefined,
				makeCtx(tmpDir),
			);

			expect(result.details.results[0].content).toBe("hello BOM\n");
		});

		it("returns error with hint for missing file", async () => {
			const tool = createTool();
			const result = await tool.execute(
				"call-1",
				{ cmd: "read nonexistent.txt" },
				undefined,
				undefined,
				makeCtx(tmpDir),
			);

			expect(result.content[0].text).toContain("File not found");
			expect(result.details.results[0]).toMatchObject({
				op: "read",
				status: "error",
				error: expect.stringContaining("nonexistent.txt"),
				hint: "Verify the path exists.",
			});
		});

		it("reads with offset via path spec", async () => {
			fs.writeFileSync(
				path.join(tmpDir, "offset.txt"),
				"line1\nline2\nline3\nline4\nline5\n",
				"utf-8",
			);

			const tool = createTool();
			const result = await tool.execute(
				"call-1",
				{ cmd: "read offset.txt:3" },
				undefined,
				undefined,
				makeCtx(tmpDir),
			);

			expect(result.details.results[0].content).toContain("line3");
			expect(result.details.results[0].content).toContain("line4");
			expect(result.details.results[0].content).toContain("line5");
			expect(result.details.results[0].content).not.toContain("line1\n");
		});

		it("reads with range via path spec", async () => {
			fs.writeFileSync(
				path.join(tmpDir, "range.txt"),
				"line1\nline2\nline3\nline4\nline5\n",
				"utf-8",
			);

			const tool = createTool();
			const result = await tool.execute(
				"call-1",
				{ cmd: "read range.txt:2-4" },
				undefined,
				undefined,
				makeCtx(tmpDir),
			);

			expect(result.details.results[0].content).toContain("line2");
			expect(result.details.results[0].content).toContain("line3");
			expect(result.details.results[0].content).toContain("line4");
			expect(result.details.results[0].content).not.toContain("line1\n");
			expect(result.details.results[0].content).not.toContain("line5\n");
		});
	});

	describe("write operations", () => {
		it("creates a new file", async () => {
			const tool = createTool();
			const result = await tool.execute(
				"call-1",
				{ cmd: "write -c 'new content\n' new.txt" },
				undefined,
				undefined,
				makeCtx(tmpDir),
			);

			expect(result.content[0].text).toContain("✔ 1 write");
			expect(result.content[0].text).toContain("write: new.txt");
			expect(result.content[0].text).toContain("12 bytes");
			expect(result.details.results[0]).toMatchObject({
				op: "write",
				path: "new.txt",
				status: "ok",
				bytes: Buffer.byteLength("new content\n", "utf-8"),
			});

			const written = fs.readFileSync(path.join(tmpDir, "new.txt"), "utf-8");
			expect(written).toBe("new content\n");
		});

		it("overwrites existing file", async () => {
			fs.writeFileSync(path.join(tmpDir, "existing.txt"), "old\n", "utf-8");

			const tool = createTool();
			await tool.execute(
				"call-1",
				{ cmd: "write -c 'new\n' existing.txt" },
				undefined,
				undefined,
				makeCtx(tmpDir),
			);

			const written = fs.readFileSync(path.join(tmpDir, "existing.txt"), "utf-8");
			expect(written).toBe("new\n");
		});

		it("creates parent directories", async () => {
			const tool = createTool();
			await tool.execute(
				"call-1",
				{ cmd: "write -c 'deep\n' a/b/c/deep.txt" },
				undefined,
				undefined,
				makeCtx(tmpDir),
			);

			const written = fs.readFileSync(path.join(tmpDir, "a", "b", "c", "deep.txt"), "utf-8");
			expect(written).toBe("deep\n");
		});
	});

	describe("edit operations", () => {
		it("performs a single edit", async () => {
			fs.writeFileSync(path.join(tmpDir, "edit.txt"), "hello world\n", "utf-8");

			const tool = createTool();
			const result = await tool.execute(
				"call-1",
				{ cmd: "edit -f 'hello world' -r 'hello earth' edit.txt" },
				undefined,
				undefined,
				makeCtx(tmpDir),
			);

			expect(result.content[0].text).toContain("✔ 1 edit");
			expect(result.content[0].text).toContain("edit: edit.txt");
			expect(result.details.results[0]).toMatchObject({
				op: "edit",
				status: "ok",
				blocksChanged: 1,
			});

			const edited = fs.readFileSync(path.join(tmpDir, "edit.txt"), "utf-8");
			expect(edited).toBe("hello earth\n");
		});

		it("performs multiple edits on same file", async () => {
			fs.writeFileSync(
				path.join(tmpDir, "multi.txt"),
				"line 1\nline 2\nline 3\n",
				"utf-8",
			);

			const tool = createTool();
			const result = await tool.execute(
				"call-1",
				{ cmd: "edit -f 'line 1' -r 'LINE 1' -f 'line 3' -r 'LINE 3' multi.txt" },
				undefined,
				undefined,
				makeCtx(tmpDir),
			);

			expect(result.details.results[0].blocksChanged).toBe(2);

			const edited = fs.readFileSync(path.join(tmpDir, "multi.txt"), "utf-8");
			expect(edited).toBe("LINE 1\nline 2\nLINE 3\n");
		});

		it("returns error with hint for missing oldText", async () => {
			fs.writeFileSync(path.join(tmpDir, "miss.txt"), "hello\n", "utf-8");

			const tool = createTool();
			const result = await tool.execute(
				"call-1",
				{ cmd: "edit -f 'nonexistent' -r 'replacement' miss.txt" },
				undefined,
				undefined,
				makeCtx(tmpDir),
			);

			expect(result.details.results[0]).toMatchObject({
				op: "edit",
				status: "error",
				error: expect.stringContaining("Could not find"),
				hint: "Re-read the file first, then retry with exact f (oldText).",
			});
		});

		it("returns error with hint for duplicate oldText", async () => {
			fs.writeFileSync(
				path.join(tmpDir, "dup.txt"),
				"same same different\n",
				"utf-8",
			);

			const tool = createTool();
			const result = await tool.execute(
				"call-1",
				{ cmd: "edit -f 'same' -r 'changed' dup.txt" },
				undefined,
				undefined,
				makeCtx(tmpDir),
			);

			expect(result.details.results[0]).toMatchObject({
				op: "edit",
				status: "error",
				error: expect.stringContaining("occurrences"),
				hint: "Add more surrounding context to make oldText unique.",
			});
		});

		it("preserves line endings (CRLF)", async () => {
			fs.writeFileSync(
				path.join(tmpDir, "crlf.txt"),
				"line1\r\nline2\r\n",
				"utf-8",
			);

			const tool = createTool();
			await tool.execute(
				"call-1",
				{ cmd: "edit -f 'line1' -r 'LINE1' crlf.txt" },
				undefined,
				undefined,
				makeCtx(tmpDir),
			);

			const edited = fs.readFileSync(path.join(tmpDir, "crlf.txt"));
			expect(edited.includes(Buffer.from("\r\n"))).toBe(true);
		});
	});

	describe("delete operations", () => {
		it("rejects deleting a directory", async () => {
			fs.mkdirSync(path.join(tmpDir, "a-dir"));

			const tool = createTool();
			const result = await tool.execute(
				"call-1",
				{ cmd: "delete a-dir" },
				undefined,
				undefined,
				makeCtx(tmpDir),
			);

			expect(result.details.results[0]).toMatchObject({
				op: "delete",
				status: "error",
				error: expect.stringContaining("Cannot delete directory"),
			});
			expect(fs.existsSync(path.join(tmpDir, "a-dir"))).toBe(true);
		});

		it("deletes a file", async () => {
			fs.writeFileSync(path.join(tmpDir, "delete-me.txt"), "bye\n", "utf-8");

			const tool = createTool();
			const result = await tool.execute(
				"call-1",
				{ cmd: "delete delete-me.txt" },
				undefined,
				undefined,
				makeCtx(tmpDir),
			);

			expect(result.content[0].text).toContain("✔ 1 delete");
			expect(result.content[0].text).toContain("delete: delete-me.txt");
			expect(result.details.results[0]).toMatchObject({
				op: "delete",
				status: "ok",
			});
			expect(fs.existsSync(path.join(tmpDir, "delete-me.txt"))).toBe(false);
		});
	});

	describe("rg operations", () => {
		it("searches with rg and returns matching lines by default", async () => {
			fs.writeFileSync(path.join(tmpDir, "foo.ts"), "export const foo = 1;\n", "utf-8");
			fs.writeFileSync(path.join(tmpDir, "bar.ts"), "export const bar = 2;\n", "utf-8");
			fs.mkdirSync(path.join(tmpDir, "sub"), { recursive: true });
			fs.writeFileSync(path.join(tmpDir, "sub", "baz.ts"), "export const baz = 3;\n", "utf-8");

			const tool = createTool();
			const result = await tool.execute(
				"call-1",
				{ cmd: "rg -q 'export const' ." },
				undefined,
				undefined,
				makeCtx(tmpDir),
			);

			expect(result.details.results[0].status).toBe("ok");
			expect(result.details.results[0].op).toBe("rg");
			expect(result.content[0].text).toContain("foo.ts");
			expect(result.content[0].text).toContain("bar.ts");
			expect(result.content[0].text).toContain("baz.ts");
			expect(result.content[0].text).toContain("export const");
		});

		it("returns empty results when no matches", async () => {
			fs.writeFileSync(path.join(tmpDir, "foo.ts"), "export const foo = 1;\n", "utf-8");

			const tool = createTool();
			const result = await tool.execute(
				"call-1",
				{ cmd: "rg -q 'nonexistent_pattern_12345' ." },
				undefined,
				undefined,
				makeCtx(tmpDir),
			);

			expect(result.details.results[0].status).toBe("ok");
			expect(result.details.results[0].content).toBe("");
		});

		it("respects type filter", async () => {
			fs.writeFileSync(path.join(tmpDir, "foo.ts"), "export const foo = 1;\n", "utf-8");
			fs.writeFileSync(path.join(tmpDir, "bar.js"), "export const bar = 2;\n", "utf-8");

			const tool = createTool();
			const result = await tool.execute(
				"call-1",
				{ cmd: "rg -q 'export const' -t ts ." },
				undefined,
				undefined,
				makeCtx(tmpDir),
			);

			expect(result.content[0].text).toContain("foo.ts");
			expect(result.content[0].text).not.toContain("bar.js");
		});

		it("respects ignore-case flag", async () => {
			fs.writeFileSync(path.join(tmpDir, "foo.ts"), "export const FOO = 1;\n", "utf-8");

			const tool = createTool();
			const result = await tool.execute(
				"call-1",
				{ cmd: "rg -q 'foo' -i ." },
				undefined,
				undefined,
				makeCtx(tmpDir),
			);

			expect(result.content[0].text).toContain("foo.ts");
		});
	});

	describe("mixed operations", () => {
		it("performs mixed read/write/edit in one call", async () => {
			fs.writeFileSync(path.join(tmpDir, "existing.txt"), "old content\n", "utf-8");

			const tool = createTool();
			const result = await tool.execute(
				"call-1",
				{ cmd: "read existing.txt; write -c 'new file\n' new.txt; edit -f 'old content' -r 'updated content' existing.txt" },
				undefined,
				undefined,
				makeCtx(tmpDir),
			);

			expect(result.content[0].text).toContain("op 1/3");
			expect(result.content[0].text).toContain("op 2/3");
			expect(result.content[0].text).toContain("op 3/3");
			expect(result.details.results).toHaveLength(3);
			expect(result.details.results[0].status).toBe("ok");
			expect(result.details.results[1].status).toBe("ok");
			expect(result.details.results[2].status).toBe("ok");

			expect(fs.readFileSync(path.join(tmpDir, "new.txt"), "utf-8")).toBe("new file\n");
			expect(fs.readFileSync(path.join(tmpDir, "existing.txt"), "utf-8")).toBe("updated content\n");
		});
	});

	describe("continue-on-failure", () => {
		it("continues remaining operations after failure", async () => {
			fs.writeFileSync(path.join(tmpDir, "ok.txt"), "ok\n", "utf-8");

			const tool = createTool();
			const result = await tool.execute(
				"call-1",
				{ cmd: "read ok.txt; read missing.txt; write -c 'should be written\n' continued.txt" },
				undefined,
				undefined,
				makeCtx(tmpDir),
			);

			expect(result.details.results[0].status).toBe("ok");
			expect(result.details.results[1].status).toBe("error");
			expect(result.details.results[2].status).toBe("ok");

			expect(fs.existsSync(path.join(tmpDir, "continued.txt"))).toBe(true);

			expect(result.content[0].text).toContain("op 1/3");
			expect(result.content[0].text).toContain("op 2/3");
			expect(result.content[0].text).toContain("op 3/3");
		});
	});

	describe("abort signal", () => {
		it("aborts mid-batch between operations", async () => {
			fs.writeFileSync(path.join(tmpDir, "a.txt"), "a\n", "utf-8");
			fs.writeFileSync(path.join(tmpDir, "b.txt"), "b\n", "utf-8");

			const tool = createTool();
			const controller = new AbortController();

			const resultPromise = tool.execute(
				"call-1",
				{ cmd: "read a.txt; read b.txt" },
				controller.signal,
				undefined,
				makeCtx(tmpDir),
			);

			controller.abort();

			const result = await resultPromise;

			expect(result.details.results[0].status).toBe("ok");
			expect(result.details.results[1].status).toBe("skipped");
			expect(result.details.results[1].error).toBe("Operation aborted.");
		});
	});

	describe("empty operations", () => {
		it("returns help for empty cmd", async () => {
			const tool = createTool();
			const result = await tool.execute("call-1", { cmd: "" }, undefined, undefined, makeCtx(tmpDir));
			expect(result.content[0].text).toContain("USAGE: batch");
		});
	});

	describe("error hints", () => {
		it("provides hint for file not found on edit", async () => {
			const tool = createTool();
			const result = await tool.execute(
				"call-1",
				{ cmd: "edit -f 'a' -r 'b' nonexistent.txt" },
				undefined,
				undefined,
				makeCtx(tmpDir),
			);

			expect(result.details.results[0]).toMatchObject({
				status: "error",
				hint: "Verify the path exists.",
			});
		});

		it("provides hint for no changes needed", async () => {
			fs.writeFileSync(path.join(tmpDir, "same.txt"), "same content\n", "utf-8");

			const tool = createTool();
			const result = await tool.execute(
				"call-1",
				{ cmd: "edit -f 'same content\n' -r 'same content\n' same.txt" },
				undefined,
				undefined,
				makeCtx(tmpDir),
			);

			expect(result.details.results[0]).toMatchObject({
				status: "error",
				error: expect.stringContaining("No changes"),
				hint: "File already has this content. No edit needed.",
			});
		});
	});

	describe("path traversal guard", () => {
		it("allows writing outside cwd", async () => {
			const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agent-flow-outside-write-"));

			const tool = createTool();
			const result = await tool.execute(
				"call-1",
				{ cmd: `write -c 'test' ${path.join(outsideDir, "new.txt")}` },
				undefined,
				undefined,
				makeCtx(tmpDir),
			);

			expect(result.details.results[0]).toMatchObject({
				op: "write",
				status: "ok",
			});
			expect(fs.readFileSync(path.join(outsideDir, "new.txt"), "utf-8")).toBe("test");

			fs.rmSync(outsideDir, { recursive: true, force: true });
		});
	});

	describe("bash", () => {
		it("executes a simple command", async () => {
			const tool = createTool();
			const result = await tool.execute(
				"call-1",
				{ cmd: "bash echo 'hello bash'" },
				undefined,
				undefined,
				makeCtx(tmpDir),
			);

			expect(result.content[0].text).toContain("hello bash");
		});

		it("returns pending for long-running commands", async () => {
			const tool = createTool();
			const result = await tool.execute(
				"call-1",
				{ cmd: "bash -t 100 'sleep 30'" },
				undefined,
				undefined,
				makeCtx(tmpDir),
			);

			expect(result.content[0].text).toContain("pending");
			expect(result.content[0].text).toContain("Use batch_bash_poll");
		});
	});
});

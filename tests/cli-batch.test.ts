import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createBatchCliTool } from "../src/cli/register.js";
import { BashProcessTracker } from "../src/batch/batch-bash.js";
import * as webOps from "../src/tools/web-ops.js";

describe("batch CLI tool", () => {
  let tmpDir: string;
  let tracker: BashProcessTracker;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agent-flow-batch-cli-test-"));
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
    return {
      cwd,
      sessionManager: {
        getSessionDir: () => cwd,
      },
    };
  }

  describe("read", () => {
    it("reads a single file", async () => {
      fs.writeFileSync(path.join(tmpDir, "test.txt"), "hello world\n", "utf-8");
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "read test.txt" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.content[0].text).toContain("hello world");
      expect(result.content[0].text).toContain("✔ 1 read");
    });

    it("reads multiple files", async () => {
      fs.writeFileSync(path.join(tmpDir, "a.txt"), "content a\n", "utf-8");
      fs.writeFileSync(path.join(tmpDir, "b.txt"), "content b\n", "utf-8");
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "read a.txt b.txt" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.content[0].text).toContain("content a");
      expect(result.content[0].text).toContain("content b");
    });

    it("reads with offset via path spec", async () => {
      fs.writeFileSync(path.join(tmpDir, "test.txt"), "a\nb\nc\nd\ne\n", "utf-8");
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "read test.txt:3" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.details.results[0].content).toContain("c");
      expect(result.details.results[0].content).toContain("d");
      expect(result.details.results[0].content).toContain("e");
    });
  });

  describe("write", () => {
    it("writes a file", async () => {
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "write -c 'hello' test.txt" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.content[0].text).toContain("✔ 1 write");
      expect(fs.readFileSync(path.join(tmpDir, "test.txt"), "utf-8")).toBe("hello");
    });
  });

  describe("edit", () => {
    it("performs a single edit", async () => {
      fs.writeFileSync(path.join(tmpDir, "edit.txt"), "hello world\n", "utf-8");
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "edit -f 'hello world' -r 'hello earth' edit.txt" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.content[0].text).toContain("✔ 1 edit");
      expect(fs.readFileSync(path.join(tmpDir, "edit.txt"), "utf-8")).toBe("hello earth\n");
    });

    it("performs multi-edit with repeated flags", async () => {
      fs.writeFileSync(path.join(tmpDir, "multi.txt"), "line 1\nline 2\nline 3\n", "utf-8");
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "edit -f 'line 1' -r 'LINE 1' -f 'line 3' -r 'LINE 3' multi.txt" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.content[0].text).toContain("✔ 1 edit");
      const content = fs.readFileSync(path.join(tmpDir, "multi.txt"), "utf-8");
      expect(content).toBe("LINE 1\nline 2\nLINE 3\n");
    });

    it("errors when find/replace count mismatch", async () => {
      fs.writeFileSync(path.join(tmpDir, "bad.txt"), "hello\n", "utf-8");
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "edit -f 'hello' -r 'world' -f 'extra' bad.txt" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Mismatched");
    });
  });

  describe("delete", () => {
    it("deletes a file", async () => {
      fs.writeFileSync(path.join(tmpDir, "del.txt"), "bye\n", "utf-8");
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "delete del.txt" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.content[0].text).toContain("✔ 1 delete");
      expect(fs.existsSync(path.join(tmpDir, "del.txt"))).toBe(false);
    });
  });

  describe("rg", () => {
    it("searches with pattern", async () => {
      fs.writeFileSync(path.join(tmpDir, "foo.ts"), "export const foo = 1;\n", "utf-8");
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "rg -q export foo.ts" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.content[0].text).toContain("foo.ts");
      expect(result.content[0].text).toContain("export");
    });
  });

  describe("bash", () => {
    it("executes a shell command", async () => {
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "bash echo hello" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.content[0].text).toContain("hello");
    });
  });

  describe("chaining", () => {
    it("runs multiple ops with semicolon", async () => {
      fs.writeFileSync(path.join(tmpDir, "a.txt"), "A\n", "utf-8");
      fs.writeFileSync(path.join(tmpDir, "b.txt"), "B\n", "utf-8");
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "read a.txt; read b.txt" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.content[0].text).toContain("A");
      expect(result.content[0].text).toContain("B");
      expect(result.content[0].text).toContain("op 1/2");
      expect(result.content[0].text).toContain("op 2/2");
    });

    it("short-circuits on && failure", async () => {
      fs.writeFileSync(path.join(tmpDir, "a.txt"), "A\n", "utf-8");
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "read missing.txt && read a.txt" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.content[0].text).toContain("SKIPPED");
      expect(result.content[0].text).not.toContain("A");
    });

    it("resets previousFailed on success after ;", async () => {
      fs.writeFileSync(path.join(tmpDir, "a.txt"), "A\n", "utf-8");
      fs.writeFileSync(path.join(tmpDir, "b.txt"), "B\n", "utf-8");
      fs.writeFileSync(path.join(tmpDir, "c.txt"), "C\n", "utf-8");
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "read a.txt && read missing.txt; read b.txt && read c.txt" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.content[0].text).toContain("A");
      expect(result.content[0].text).toContain("B");
      expect(result.content[0].text).toContain("C");
      expect(result.content[0].text).not.toContain("SKIPPED");
    });
  });

  describe("web", () => {
    it("searches via web search", async () => {
      const spy = vi.spyOn(webOps, "runWebSearch").mockResolvedValue({
        content: [{ type: "text" as const, text: "1. Result\n   https://example.com" }],
        details: { query: "test", results: [], errors: undefined },
      });
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "web search -q test" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.content[0].text).toContain("Result");
      expect(result.content[0].text).toContain("https://example.com");
      spy.mockRestore();
    });

    it("fetches via web fetch", async () => {
      const spy = vi.spyOn(webOps, "runWebFetch").mockResolvedValue({
        content: [{ type: "text" as const, text: "Fetched content" }],
        details: { filePath: "/tmp/fetch.md", contentLength: 100 },
      });
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "web fetch -u https://example.com" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.content[0].text).toContain("Fetched content");
      spy.mockRestore();
    });
  });

  describe("poll", () => {
    it("polls pending bash by id", async () => {
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "bash echo hello" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.content[0].text).toContain("hello");
    });
  });

  describe("help", () => {
    it("returns help for empty cmd", async () => {
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.content[0].text).toContain("USAGE: batch");
    });

    it("returns help for 'help'", async () => {
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "help" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.content[0].text).toContain("USAGE: batch");
    });

    it("returns help for --help", async () => {
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "--help" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.content[0].text).toContain("USAGE: batch");
    });
  });
});

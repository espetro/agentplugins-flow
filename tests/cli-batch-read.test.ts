import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createBatchReadCliTool } from "../src/cli/register.js";

describe("batch_read CLI tool", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agent-flow-batch-read-cli-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createTool() {
    return createBatchReadCliTool();
  }

  function makeCtx(cwd: string) {
    return { cwd };
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
      expect(result.details.results[0].content).not.toContain("a\n");
    });

    it("reads with range via path spec", async () => {
      fs.writeFileSync(path.join(tmpDir, "test.txt"), "a\nb\nc\nd\ne\n", "utf-8");
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "read test.txt:2-4" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.details.results[0].content).toContain("b");
      expect(result.details.results[0].content).toContain("c");
      expect(result.details.results[0].content).toContain("d");
      expect(result.details.results[0].content).not.toContain("a\n");
      expect(result.details.results[0].content).not.toContain("e\n");
    });

    it("reads with flag-level start", async () => {
      fs.writeFileSync(path.join(tmpDir, "test.txt"), "a\nb\nc\nd\ne\n", "utf-8");
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "read -s 3 test.txt" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.details.results[0].content).toContain("c");
      expect(result.details.results[0].content).not.toContain("a\n");
    });

    it("reads with flag-level limit", async () => {
      fs.writeFileSync(path.join(tmpDir, "test.txt"), "a\nb\nc\nd\ne\n", "utf-8");
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "read -l 2 test.txt" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.details.results[0].content).toContain("a");
      expect(result.details.results[0].content).toContain("b");
      expect(result.details.results[0].content).not.toContain("c\n");
    });

    it("reads with --end", async () => {
      fs.writeFileSync(path.join(tmpDir, "test.txt"), "a\nb\nc\nd\ne\n", "utf-8");
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "read -s 2 -e 4 test.txt" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.details.results[0].content).toContain("b");
      expect(result.details.results[0].content).toContain("c");
      expect(result.details.results[0].content).toContain("d");
      expect(result.details.results[0].content).not.toContain("a\n");
      expect(result.details.results[0].content).not.toContain("e\n");
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

    it("searches case-insensitive", async () => {
      fs.writeFileSync(path.join(tmpDir, "foo.ts"), "export const FOO = 1;\n", "utf-8");
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "rg -q foo -i foo.ts" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.content[0].text).toContain("foo.ts");
    });

    it("returns files-only", async () => {
      fs.writeFileSync(path.join(tmpDir, "foo.ts"), "export const foo = 1;\n", "utf-8");
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "rg -q export -l ." }, undefined, undefined, makeCtx(tmpDir));
      expect(result.content[0].text).toContain("foo.ts");
    });

    it("throws when query is missing", async () => {
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "rg foo.ts" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("requires -q");
    });

    it("throws when path is missing for rg", async () => {
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "rg -q pattern" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("path");
    });
  });

  describe("help and edge cases", () => {
    it("returns help for empty cmd", async () => {
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.content[0].text).toContain("USAGE: batch_read");
    });

    it("returns help for 'help'", async () => {
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "help" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.content[0].text).toContain("USAGE: batch_read");
    });

    it("returns help for --help", async () => {
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "--help" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.content[0].text).toContain("USAGE: batch_read");
    });

    it("returns help for 'batch_read help'", async () => {
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "batch_read help" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.content[0].text).toContain("USAGE: batch_read");
    });

    it("returns help for 'batch_read --help'", async () => {
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "batch_read --help" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.content[0].text).toContain("USAGE: batch_read");
    });

    it("errors on unknown subcommand", async () => {
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "unknown" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Unknown subcommand");
      expect(result.content[0].text).toContain("Did you mean");
    });

    it("returns error for nonexistent file with isError", async () => {
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "read nonexistent.txt" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("ERROR");
    });

    it("includes TIP on nonexistent file error", async () => {
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "read nonexistent.txt" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("TIP: This is not a shell");
      expect(result.content[0].text).toContain("Valid subcommands: read, rg");
    });

    it("includes TIP on rg missing -q error", async () => {
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "rg foo.ts" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("requires -q");
      expect(result.content[0].text).toContain("TIP: This is not a shell");
    });

    it("unknown subcommand returns original error without flag-list hint", async () => {
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "unknown" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Unknown subcommand");
      expect(result.content[0].text).toContain("Did you mean");
      expect(result.content[0].text).not.toContain("supports:");
    });

    it("continues chain after read error with semicolon", async () => {
      fs.writeFileSync(path.join(tmpDir, "a.txt"), "A\n", "utf-8");
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "read missing.txt; read a.txt" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("A");
      expect(result.content[0].text).toContain("op 1/2");
      expect(result.content[0].text).toContain("op 2/2");
    });

    it("continues chain after parse error with semicolon", async () => {
      fs.writeFileSync(path.join(tmpDir, "a.txt"), "A\n", "utf-8");
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "read --badflag; read a.txt" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("A");
      expect(result.content[0].text).toContain("op 1/2");
      expect(result.content[0].text).toContain("op 2/2");
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

    it("continues on ; even if first fails", async () => {
      fs.writeFileSync(path.join(tmpDir, "a.txt"), "A\n", "utf-8");
      const tool = createTool();
      const result = await tool.execute("call-1", { cmd: "read missing.txt; read a.txt" }, undefined, undefined, makeCtx(tmpDir));
      expect(result.content[0].text).toContain("A");
      expect(result.content[0].text).toContain("op 1/2");
      expect(result.content[0].text).toContain("op 2/2");
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
});

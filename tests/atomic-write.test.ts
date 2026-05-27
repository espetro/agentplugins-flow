import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { atomicWriteFileSync, atomicWriteJsonSync } from "../src/io/atomic-write.js";

describe("atomicWriteFileSync", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-write-test-"));
	});

	afterEach(() => {
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		} catch { /* ignore */ }
	});

	it("writes file atomically via rename", () => {
		const target = path.join(tmpDir, "test.txt");
		atomicWriteFileSync(target, "hello world");
		expect(fs.readFileSync(target, "utf-8")).toBe("hello world");
	});

	it("sets default mode 0o600", () => {
		const target = path.join(tmpDir, "mode-test.txt");
		atomicWriteFileSync(target, "secret");
		const stats = fs.statSync(target);
		// eslint-disable-next-line no-bitwise
		expect(stats.mode & 0o777).toBe(0o600);
	});

	it("accepts custom mode", () => {
		const target = path.join(tmpDir, "mode-custom.txt");
		atomicWriteFileSync(target, "public", { mode: 0o644 });
		const stats = fs.statSync(target);
		// eslint-disable-next-line no-bitwise
		expect(stats.mode & 0o777).toBe(0o644);
	});

	it("cleans up temp file on rename failure", () => {
		// Create target as a non-empty directory so rename fails with EISDIR
		// after the temp file has already been written, verifying the unlink
		// cleanup path runs on an existing temp file.
		const target = path.join(tmpDir, "test.txt");
		fs.mkdirSync(target, { recursive: true });
		fs.writeFileSync(path.join(target, "dummy.txt"), "x");

		let thrown = false;
		try {
			atomicWriteFileSync(target, "data");
		} catch {
			thrown = true;
		}
		expect(thrown).toBe(true);

		// Should not leave temp files behind
		const files = fs.readdirSync(tmpDir);
		expect(files.filter((f) => f.startsWith(".tmp-")).length).toBe(0);
	});

	it("writes Buffer data", () => {
		const target = path.join(tmpDir, "buffer.bin");
		atomicWriteFileSync(target, Buffer.from("binary data"));
		expect(fs.readFileSync(target, "utf-8")).toBe("binary data");
	});
});

describe("atomicWriteJsonSync", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-json-test-"));
	});

	afterEach(() => {
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		} catch { /* ignore */ }
	});

	it("serializes JSON with trailing newline", () => {
		const target = path.join(tmpDir, "data.json");
		atomicWriteJsonSync(target, { foo: "bar", num: 42 });
		const content = fs.readFileSync(target, "utf-8");
		expect(JSON.parse(content)).toEqual({ foo: "bar", num: 42 });
		expect(content.endsWith("\n")).toBe(true);
	});

	it("creates parent directories if needed", () => {
		const target = path.join(tmpDir, "nested", "deep", "data.json");
		atomicWriteJsonSync(target, { ok: true });
		expect(fs.existsSync(target)).toBe(true);
	});
});

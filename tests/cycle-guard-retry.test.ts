import { describe, it, expect } from "vitest";
import { isRetryableConnectionError, CONNECTION_ERROR_PATTERNS } from "../src/flow/cycle-guard.js";

describe("isRetryableConnectionError", () => {
	it("matches common transient connection errors", () => {
		expect(isRetryableConnectionError("Error: ECONNRESET")).toBe(true);
		expect(isRetryableConnectionError("", "fetch failed: network unreachable")).toBe(true);
		expect(isRetryableConnectionError("HTTP 503 Service Unavailable")).toBe(true);
		expect(isRetryableConnectionError("socket hang up")).toBe(true);
	});

	it("rejects empty input", () => {
		expect(isRetryableConnectionError("", "")).toBe(false);
		expect(isRetryableConnectionError("   ", undefined)).toBe(false);
	});

	it("rejects non-retryable auth and validation failures", () => {
		expect(isRetryableConnectionError("permission denied for tool bash")).toBe(false);
		expect(isRetryableConnectionError("invalid tool call")).toBe(false);
		expect(isRetryableConnectionError("HTTP 401 Unauthorized")).toBe(false);
		expect(isRetryableConnectionError("HTTP 400 Param Incorrect")).toBe(false);
		expect(isRetryableConnectionError("400 tool_call_id mismatch")).toBe(false);
	});

	it("does not retry rate limits or generic 500s", () => {
		expect(isRetryableConnectionError("HTTP 429 Too Many Requests")).toBe(false);
		expect(isRetryableConnectionError("rate limit exceeded")).toBe(false);
		expect(isRetryableConnectionError("HTTP 500 internal validation error")).toBe(false);
		expect(isRetryableConnectionError("request failed: invalid schema")).toBe(false);
	});

	it("exports a stable pattern list", () => {
		expect(CONNECTION_ERROR_PATTERNS.length).toBeGreaterThanOrEqual(20);
	});
});

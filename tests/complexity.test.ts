import { describe, it, expect } from "vitest";
import {
	COMPLEXITY_MAP,
	DEFAULT_COMPLEXITY,
	getComplexityTimeoutMs,
	getImpliedAuditLoop,
	parseComplexity,
	resolveComplexity,
} from "../src/flow/complexity.js";

describe("complexity system", () => {
	it("defines snap/simple/moderate/complex/intricate budgets with moderate as default", () => {
		expect(DEFAULT_COMPLEXITY).toBe("moderate");
		expect(COMPLEXITY_MAP).toEqual({
			snap: { timeoutMs: 120_000, impliedAuditLoop: 0 },
			simple: { timeoutMs: 300_000, impliedAuditLoop: 0 },
			moderate: { timeoutMs: 600_000, impliedAuditLoop: 1 },
			complex: { timeoutMs: 900_000, impliedAuditLoop: 2 },
			intricate: { timeoutMs: 1_200_000, impliedAuditLoop: 3 },
		});
		expect(getComplexityTimeoutMs("snap")).toBe(120_000);
		expect(getComplexityTimeoutMs("intricate")).toBe(1_200_000);
		expect(getImpliedAuditLoop("snap")).toBe(0);
		expect(getImpliedAuditLoop("moderate")).toBe(1);
		expect(getImpliedAuditLoop("intricate")).toBe(3);
	});

	it("parses complexity case-insensitively and rejects invalid values", () => {
		expect(parseComplexity("SIMPLE")).toBe("simple");
		expect(parseComplexity(" moderate ")).toBe("moderate");
		expect(parseComplexity("900")).toBeUndefined();
		expect(parseComplexity("snap")).toBe("snap");
		expect(parseComplexity("intricate")).toBe("intricate");
		expect(parseComplexity("extra-long")).toBeUndefined();
	});

	it("falls back to the provided default for invalid values", () => {
		expect(resolveComplexity("bad", "simple")).toBe("simple");
		expect(resolveComplexity(undefined)).toBe("moderate");
	});
});

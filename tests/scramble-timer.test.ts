import { describe, it, expect, vi, beforeEach } from "vitest";
import { runScrambleTimer, setAnimationConfig } from "../src/tui/scramble/index.js";
import { scrambleManager } from "../src/tui/scramble/index.js";

describe("runScrambleTimer", () => {
	beforeEach(() => {
		scrambleManager.clear();
		scrambleManager.setAnimationConfig({ enabled: true, glitch: true });
	});

	it("does nothing when args is undefined", () => {
		expect(() => runScrambleTimer(undefined, "test")).not.toThrow();
	});

	it("does nothing when invalidate is missing", () => {
		expect(() => runScrambleTimer({ state: {} }, "test")).not.toThrow();
	});

	it("sets a timer when animations are active", () => {
		scrambleManager.updateText("test", "header", "hello", Date.now(), false, true);
		const invalidate = vi.fn();
		const state: Record<string, unknown> = {};
		runScrambleTimer({ state, invalidate }, "test");
		expect(state.__scramble).toBeDefined();
		expect(state.__scramble?.animTimer).toBeDefined();
	});

	it("clears timer when animations complete", () => {
		scrambleManager.updateText("test", "header", "hello", Date.now(), true, true);
		const invalidate = vi.fn();
		const state: Record<string, unknown> = {};
		runScrambleTimer({ state, invalidate }, "test");
		expect(state.__scramble?.animTimer).toBeUndefined();
	});

	it("reuses existing timer state", () => {
		scrambleManager.updateText("test", "header", "hello", Date.now(), false, true);
		const invalidate = vi.fn();
		const state: Record<string, unknown> = { __scramble: { animTimer: undefined } };
		runScrambleTimer({ state, invalidate }, "test");
		expect(state.__scramble?.animTimer).toBeDefined();
	});
});

describe("setAnimationConfig", () => {
	it("updates animation config", () => {
		setAnimationConfig({ enabled: false, glitch: false });
		const result = scrambleManager.updateText("x", "h", "hello", 0, false, true);
		expect(result.isAnimating).toBe(false);
		expect(result.content).toBe("hello");
		setAnimationConfig({ enabled: true, glitch: true });
	});
});

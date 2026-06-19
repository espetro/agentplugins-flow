import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  getGoal,
  setGoal,
  clearGoal,
  addTokens,
  recordFlowCompletion,
  readState,
  writeState,
  _clearStoreCache,
} from "../src/flow/store.js";
import type { GoalState, LoopState } from "../src/flow/types.js";

describe("store loop integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-store-loop-test-"));
  });

  afterEach(() => {
    _clearStoreCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeLoop(status: LoopState["status"]): LoopState {
    return {
      objective: "test loop",
      status,
      sessionCount: 2,
      totalTokensAcrossSessions: 100,
      totalFlowsAcrossSessions: 5,
    };
  }

  it("(1) setGoal archives as 'warped' when loop active", () => {
    const state: GoalState = {
      current: {
        id: "goal-1",
        objective: "old",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        status: "active",
        completedFlows: [],
        totalTokens: 0,
      },
      history: [],
      loop: makeLoop("active"),
    };
    writeState(tmpDir, state);

    setGoal(tmpDir, "new goal");
    const updated = readState(tmpDir);
    expect(updated.history).toHaveLength(1);
    expect(updated.history[0].status).toBe("warped");
  });

  it("(2) setGoal archives as 'abandoned' when loop inactive", () => {
    const state: GoalState = {
      current: {
        id: "goal-1",
        objective: "old",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        status: "active",
        completedFlows: [],
        totalTokens: 0,
      },
      history: [],
      loop: makeLoop("paused"),
    };
    writeState(tmpDir, state);

    setGoal(tmpDir, "new goal");
    const updated = readState(tmpDir);
    expect(updated.history).toHaveLength(1);
    expect(updated.history[0].status).toBe("abandoned");
  });

  it("(3) addTokens increments both goal.totalTokens and loop.totalTokensAcrossSessions when loop active", () => {
    const state: GoalState = {
      current: {
        id: "goal-1",
        objective: "test",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        status: "active",
        completedFlows: [],
        totalTokens: 10,
      },
      history: [],
      loop: makeLoop("active"),
    };
    writeState(tmpDir, state);

    addTokens(tmpDir, 50);
    const updated = readState(tmpDir);
    expect(updated.current?.totalTokens).toBe(60);
    expect(updated.loop?.totalTokensAcrossSessions).toBe(150);
  });

  it("(4) addTokens only increments goal.totalTokens when loop inactive", () => {
    const state: GoalState = {
      current: {
        id: "goal-1",
        objective: "test",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        status: "active",
        completedFlows: [],
        totalTokens: 10,
      },
      history: [],
      loop: makeLoop("paused"),
    };
    writeState(tmpDir, state);

    addTokens(tmpDir, 50);
    const updated = readState(tmpDir);
    expect(updated.current?.totalTokens).toBe(60);
    expect(updated.loop?.totalTokensAcrossSessions).toBe(100);
  });

  it("(5) addTokens does not crash when no goal", () => {
    writeState(tmpDir, { history: [] });
    const result = addTokens(tmpDir, 50);
    expect(result).toBeUndefined();
  });

  it("(6) setGoal preserves existing loop state", () => {
    const state: GoalState = {
      current: {
        id: "goal-1",
        objective: "old",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        status: "active",
        completedFlows: [],
        totalTokens: 0,
      },
      history: [],
      loop: makeLoop("active"),
    };
    writeState(tmpDir, state);

    setGoal(tmpDir, "new goal");
    const updated = readState(tmpDir);
    expect(updated.loop?.objective).toBe("test loop");
    expect(updated.loop?.status).toBe("active");
    expect(updated.loop?.sessionCount).toBe(2);
  });

  it("(7) clearGoal archives as 'warped' when loop active", () => {
    const state: GoalState = {
      current: {
        id: "goal-1",
        objective: "test",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        status: "active",
        completedFlows: [],
        totalTokens: 0,
      },
      history: [],
      loop: makeLoop("active"),
    };
    writeState(tmpDir, state);

    clearGoal(tmpDir);
    const updated = readState(tmpDir);
    expect(updated.history).toHaveLength(1);
    expect(updated.history[0].status).toBe("warped");
  });

  it("(8) recordFlowCompletion increments loop.totalFlowsAcrossSessions when loop active", () => {
    const state: GoalState = {
      current: {
        id: "goal-1",
        objective: "test",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        status: "active",
        completedFlows: [],
        totalTokens: 0,
      },
      history: [],
      loop: makeLoop("active"),
    };
    writeState(tmpDir, state);

    recordFlowCompletion(tmpDir, { type: "build", intent: "do it", aim: "aim" });
    const updated = readState(tmpDir);
    expect(updated.loop?.totalFlowsAcrossSessions).toBe(6);
  });

  it("(9) readState / readFromDisk sanitizes corrupted/incomplete goal state", () => {
    const rawState = {
      current: {
        id: "goal-1",
        objective: "test",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        status: "active",
        totalTokens: "not-a-number",
      },
      history: [
        {
          id: "goal-old",
          objective: "old",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          status: "completed",
          completedFlows: null,
        }
      ],
    };
    fs.mkdirSync(path.join(tmpDir, ".pi"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".pi", "flow.json"), JSON.stringify(rawState), "utf-8");

    const parsed = getGoal(tmpDir); // triggers readState/readFromDisk
    expect(parsed).toBeDefined();
    expect(parsed?.completedFlows).toEqual([]);
    expect(parsed?.totalTokens).toBe(0);

    const fullState = readState(tmpDir);
    expect(fullState.history[0].completedFlows).toEqual([]);
    expect(fullState.history[0].totalTokens).toBe(0);
  });

  it("(10) recordFlowCompletion sanitizes and initializes completedFlows if missing", () => {
    const rawState = {
      current: {
        id: "goal-1",
        objective: "test",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        status: "active",
      },
      history: [],
    };
    fs.mkdirSync(path.join(tmpDir, ".pi"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".pi", "flow.json"), JSON.stringify(rawState), "utf-8");

    recordFlowCompletion(tmpDir, { type: "scout", intent: "do it", aim: "aim" });
    const parsed = getGoal(tmpDir);
    expect(parsed?.completedFlows).toHaveLength(1);
    expect(parsed?.completedFlows[0].type).toBe("scout");
  });

  it("(11) addTokens sanitizes and initializes totalTokens if missing", () => {
    const rawState = {
      current: {
        id: "goal-1",
        objective: "test",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        status: "active",
      },
      history: [],
    };
    fs.mkdirSync(path.join(tmpDir, ".pi"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".pi", "flow.json"), JSON.stringify(rawState), "utf-8");

    addTokens(tmpDir, 100);
    const parsed = getGoal(tmpDir);
    expect(parsed?.totalTokens).toBe(100);
  });
});


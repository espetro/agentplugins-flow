/**
 * Child process lifecycle management — extracted from runner.ts.
 *
 * Process group registration, signal propagation, and
 * single-child termination helpers.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { logWarn } from "../config/log.js";

export const isWindows = process.platform === "win32";
export const SIGKILL_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Global child process group tracking for signal propagation
// ---------------------------------------------------------------------------

/** Track child process groups so we can kill them on parent exit / signal. */
const runningChildGroups = new Map<number, { groupPid: number; name: string }>();

/** Register a child process group for cleanup on shutdown. */
export function registerChildGroup(pid: number, name: string): void {
	if (pid > 0 && !isWindows) {
		runningChildGroups.set(pid, { groupPid: pid, name });
	}
}

/** Unregister a completed/stopped child process group. */
export function unregisterChildGroup(pid: number): void {
	runningChildGroups.delete(pid);
}

/**
 * Terminate all registered child process groups via SIGTERM (then SIGKILL after timeout).
 * Called on parent exit, SIGINT, SIGTERM, or pi-agent-flow:shutdown.
 */
export function terminateAllChildGroups(): void {
	if (runningChildGroups.size === 0) return;
	const pids = Array.from(runningChildGroups.keys());
	for (const pid of pids) {
		try {
			process.kill(-pid, "SIGTERM");
		} catch (e) {
			logWarn(`[pi-agent-flow] process.kill(-pid, SIGTERM) failed: ${e}`);
			try { process.kill(pid, "SIGTERM"); } catch (e2) { logWarn(`[pi-agent-flow] SIGTERM failed for child group ${pid}: ${e2}`); }
		}
	}
	const sigkillTimer = setTimeout(() => {
		for (const pid of pids) {
			try {
				process.kill(-pid, "SIGKILL");
			} catch (e) {
				logWarn(`[pi-agent-flow] process.kill(-pid, SIGKILL) failed: ${e}`);
				try { process.kill(pid, "SIGKILL"); } catch (e2) { logWarn(`[pi-agent-flow] SIGKILL failed for child group ${pid}: ${e2}`); }
			}
		}
		runningChildGroups.clear();
	}, SIGKILL_TIMEOUT_MS);
	sigkillTimer.unref();
}

/**
 * Terminate a single child process with SIGTERM then SIGKILL fallback.
 * Handles both Windows (taskkill) and Unix (process group) semantics.
 */
export function terminateChildProcess(
	proc: ChildProcess,
	options?: { endStdin?: () => void; timeoutMs?: number; skipIfClosed?: () => boolean },
): void {
	const timeoutMs = options?.timeoutMs ?? SIGKILL_TIMEOUT_MS;
	if (options?.endStdin) options.endStdin();
	if (isWindows) {
		if (proc.pid !== undefined) {
			const killer = spawn("taskkill", ["/T", "/F", "/PID", String(proc.pid)], {
				stdio: "ignore",
			});
			killer.unref();
		}
		return;
	}
	if (proc.pid === undefined) {
		proc.kill("SIGTERM");
	} else {
		try {
			process.kill(-proc.pid, "SIGTERM");
		} catch (e) {
			logWarn(`[pi-agent-flow] process.kill(-proc.pid, SIGTERM) failed: ${e}`);
			proc.kill("SIGTERM");
		}
	}
	const sigkillTimer = setTimeout(() => {
		if (options?.skipIfClosed?.()) return;
		if (proc.pid === undefined) {
			proc.kill("SIGKILL");
		} else {
			try {
				process.kill(-proc.pid, "SIGKILL");
			} catch (e) {
				logWarn(`[pi-agent-flow] process.kill(-proc.pid, SIGKILL) failed: ${e}`);
				proc.kill("SIGKILL");
			}
		}
	}, timeoutMs);
	sigkillTimer.unref();
}

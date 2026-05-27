/**
 * Lightweight loop guard: detects when the same tool is called
 * with the exact same arguments 3+ times in a row.
 */

interface CallRecord {
	tool: string;
	argsHash: string;
}

const history: CallRecord[] = [];
const MAX_HISTORY = 20;
const LOOP_THRESHOLD = 3;

/**
 * Check if this tool call is a repeat of the exact same call.
 * Returns a warning string to inject, or undefined if no loop.
 */
export function checkLoopGuard(tool: string, args: unknown): string | undefined {
	const argsHash = stableHash(args);

	// Count consecutive identical calls from the end
	let consecutive = 0;
	for (let i = history.length - 1; i >= 0; i--) {
		if (history[i].tool === tool && history[i].argsHash === argsHash) {
			consecutive++;
		} else {
			break;
		}
	}

	history.push({ tool, argsHash });
	if (history.length > MAX_HISTORY) history.shift();

	if (consecutive >= LOOP_THRESHOLD - 1) {
		return `\n\n[Loop guard: This exact ${tool} call has been made ${consecutive + 1} times. Synthesize what you have and move forward instead of re-executing.]`;
	}
	return undefined;
}

export function resetLoopGuard(): void {
	history.length = 0;
}

function stableHash(obj: unknown): string {
	return JSON.stringify(obj, (_, v) =>
		v && typeof v === "object" && !Array.isArray(v)
			? Object.fromEntries(Object.entries(v).sort())
			: v
	);
}

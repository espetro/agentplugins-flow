import { GLITCH_FRAME_MS } from './constants.js';
import { scrambleManager } from './singleton.js';

interface ScrambleTimerState {
	animTimer?: ReturnType<typeof setTimeout>;
}

export function runScrambleTimer(args: Record<string, unknown> | undefined, id?: string): void {
	if (!args?.invalidate || !args?.state || typeof args.state !== "object") return;
	const state = args.state as Record<string, unknown>;
	const scrambleState = (state.__scramble as ScrambleTimerState | undefined) || {} as ScrambleTimerState;
	state.__scramble = scrambleState;
	const invalidate = (args as { invalidate: () => void }).invalidate;
	const now = Date.now();
	const hasActive = id ? scrambleManager.hasActiveAnimations(id, now) : scrambleManager.hasAnyActiveAnimations(now);

	if (hasActive) {
		if (!scrambleState.animTimer) {
			scrambleState.animTimer = setTimeout(() => {
				scrambleState.animTimer = undefined;
				invalidate();
			}, GLITCH_FRAME_MS);
		}
	} else if (scrambleState.animTimer) {
		clearTimeout(scrambleState.animTimer);
		scrambleState.animTimer = undefined;
	}
}

export function setAnimationConfig(config: { enabled: boolean; glitch: boolean }): void {
	scrambleManager.setAnimationConfig(config);
}

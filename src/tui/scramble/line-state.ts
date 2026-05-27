import {
	LineState,
	LineKey,
	ValueFlashState,
	GLITCH_FRAME_MS,
	GLITCH_MAX_START,
	GLITCH_MAX_LENGTH,
	GLITCH_SHORT_MAX_START,
	GLITCH_SHORT_MAX_LENGTH,
	GLITCH_COOLDOWN_MS,
	MIN_GLITCH_INTERVAL,
	TPS_FLASH_COOLDOWN_MS,
} from './constants.js';
import {
	computeOverlapLen,
	isMinorStaticMutation,
} from './utils.js';
import {
	buildGlitchQueue,
	buildMsgGlitchQueue,
	isGlitchComplete,
	detectDirection,
} from './algorithm.js';

export function createLineState(): LineState {
	return {
		lastText: '',
		displayedText: '',
		targetText: '',
		startTime: 0,
		lastAnimTime: 0,
		initialized: false,
		completed: false,
		lastAccessTime: Date.now(),
		glitchQueue: [],
		glitchFrame: 0,
		lastGlitchTime: Number.NEGATIVE_INFINITY,
		pendingGlitch: null,
		pendingOldDisplayed: '',
		pendingNewDisplayed: '',
		pendingStartTime: 0,
	};
}

export function createValueFlashState(): ValueFlashState {
	return {
		prev: '',
		startTime: 0,
		lastValueChangeTime: 0,
		lastFlashTime: 0,
		completed: false,
		glitchQueue: [],
		glitchFrame: 0,
		lastGlitchTime: 0,
	};
}

export function processLine(state: LineState, newText: string, now: number, lineKey?: LineKey, glitchEnabled: boolean = true): void {
	if (state.completed) return;
	if (!state.initialized) {
		state.lastText = newText;
		state.displayedText = newText;
		state.initialized = true;
		state.lastAnimTime = now;
		return;
	}
	const textChanged = state.lastText !== newText;
	if (!textChanged) return;

	const oldText = state.lastText;
	state.lastText = newText;

	const overlap = computeOverlapLen(oldText, newText);
	const minLen = Math.min(oldText.length, newText.length);
	const isExtension = newText.startsWith(oldText);
	if (!isExtension && overlap > 0 && overlap >= minLen * 0.5) {
		state.displayedText = newText;
		return;
	}

	const cooldownMs = lineKey === 'msg' ? GLITCH_COOLDOWN_MS : MIN_GLITCH_INTERVAL;
	const cooledDown = now - state.lastGlitchTime >= cooldownMs;
	if (!cooledDown) {
		if (lineKey !== 'msg') {
			state.displayedText = newText;
		}
		return;
	}

	const oldDisplayed = state.displayedText || oldText;
	const direction = detectDirection(oldDisplayed, newText);
	if (lineKey === 'msg') {
		state.targetText = newText;
	} else {
		state.displayedText = newText;
	}
	state.lastAnimTime = now;

	if (glitchEnabled) {
		if (state.glitchQueue.length > 0) {
			const frame = Math.floor((now - state.startTime) / GLITCH_FRAME_MS);
			if (!isGlitchComplete(state.glitchQueue, frame)) {
				state.pendingGlitch = lineKey === 'msg'
					? buildMsgGlitchQueue(oldDisplayed, newText, direction)
					: buildGlitchQueue(oldDisplayed, newText, GLITCH_MAX_START, GLITCH_MAX_LENGTH, direction);
				state.pendingOldDisplayed = oldDisplayed;
				state.pendingNewDisplayed = newText;
				state.pendingStartTime = now;
				return;
			}
		}
		state.glitchQueue = lineKey === 'msg'
			? buildMsgGlitchQueue(oldDisplayed, newText, direction)
			: buildGlitchQueue(oldDisplayed, newText, GLITCH_MAX_START, GLITCH_MAX_LENGTH, direction);
		state.targetText = newText;
		state.startTime = now;
		state.glitchFrame = 0;
		state.lastGlitchTime = now;
	} else if (lineKey === 'msg') {
		state.displayedText = newText;
	}
}

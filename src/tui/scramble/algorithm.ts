// Auto-generated from src/tui/scramble.ts split
import {
	GlitchQueueItem,
	LineState,
	LineKey,
	GLITCH_FRAME_MS,
	GLITCH_FADE_OUT_FRAMES,
	GLITCH_SHRINK_FADE_OUT_FRAMES,
	GLITCH_MAX_START,
	GLITCH_MAX_LENGTH,
	GLITCH_SHORT_MAX_START,
	GLITCH_SHORT_MAX_LENGTH,
	GLITCH_OVERLAP_MAX_START,
	GLITCH_OVERLAP_MAX_LENGTH,
	GLITCH_RERANDOMIZE,
	MSG_GLITCH_MIN_FRAMES,
	poolRandomChar,
	DIM_ON,
	DIM_OFF,
} from './constants.js';
import {
	stripDecorativeIcons,
	hashNoise,
	smoothstep,
	selectSparkChar,
} from './utils.js';

// ---------------------------------------------------------------------------
// Pure algorithm: GLITCH (TextScramble faithful port with Unicode braille)
// ---------------------------------------------------------------------------

export type TransitionDirection = 'expand' | 'shrink' | 'neutral';

export function detectDirection(oldText: string, newText: string): TransitionDirection {
	const cleanOld = stripDecorativeIcons(oldText);
	const cleanNew = stripDecorativeIcons(newText);
	const oldLen = cleanOld.length;
	const newLen = cleanNew.length;
	if (newLen > oldLen + 2) return 'expand';
	if (newLen < oldLen - 2) return 'shrink';
	return 'neutral';
}

export function buildGlitchQueue(
	oldText: string,
	newText: string,
	maxStart: number = GLITCH_MAX_START,
	maxLength: number = GLITCH_MAX_LENGTH,
	direction: TransitionDirection = 'neutral',
): GlitchQueueItem[] {
	const queue: GlitchQueueItem[] = [];
	const oldLen = oldText.length;
	const newLen = newText.length;
	const length = Math.max(oldLen, newLen);
	const overlapLen = Math.min(oldLen, newLen);
	for (let i = 0; i < length; i++) {
		const from = oldText[i] || '';
		const to = newText[i] || '';

		if (direction !== 'neutral' && i < overlapLen) {
			if (from === to) {
				queue.push({ from, to, start: 0, end: 0, fadeOutEnd: undefined, char: null });
				continue;
			}
			const start = Math.floor(Math.random() * GLITCH_OVERLAP_MAX_START);
			const end = start + Math.floor(Math.random() * GLITCH_OVERLAP_MAX_LENGTH);
			const fadeOutEnd = to === '' ? end + GLITCH_FADE_OUT_FRAMES : undefined;
			queue.push({ from, to, start, end, fadeOutEnd, char: null });
			continue;
		}

		const isShrinkTail = direction === 'shrink' && i >= overlapLen;
		const start = isShrinkTail ? 0 : Math.floor(Math.random() * maxStart);
		const end = start + Math.floor(Math.random() * (isShrinkTail ? GLITCH_SHORT_MAX_LENGTH : maxLength));
		const fadeOutEnd = to === '' ? end + (isShrinkTail ? GLITCH_SHRINK_FADE_OUT_FRAMES : GLITCH_FADE_OUT_FRAMES) : undefined;
		queue.push({ from, to, start, end, fadeOutEnd, char: null });
	}
	let deletedCount = 0;
	for (const item of queue) {
		if (item.to === '' && item.from !== '') {
			deletedCount++;
		}
	}
	const bonusFrames = Math.min(8, Math.floor(deletedCount / 2));
	if (bonusFrames > 0) {
		for (const item of queue) {
			if (item.fadeOutEnd !== undefined) {
				item.fadeOutEnd += bonusFrames;
			}
		}
	}
	return queue;
}

export function buildMsgGlitchQueue(oldText: string, newText: string, direction: TransitionDirection = 'neutral'): GlitchQueueItem[] {
	const queue = buildGlitchQueue(oldText, newText, GLITCH_MAX_START, GLITCH_MAX_LENGTH, direction);
	if (queue.length === 0) return queue;
	const maxEnd = queue.reduce((max, item) => Math.max(max, item.fadeOutEnd ?? item.end), 0);
	const scaledMinFrames = Math.min(MSG_GLITCH_MIN_FRAMES, Math.max(55, Math.ceil(queue.length * 3.5)));
	const extension = scaledMinFrames - maxEnd;
	if (extension <= 0) {
		for (const item of queue) {
			if (item.to !== '') {
				item.settleEnd = item.end + 14 + Math.floor(Math.random() * 10);
			}
		}
		return queue;
	}
	for (const item of queue) {
		// Already-resolved identical chars should not have their scramble window
		// extended — that would force them back into the scramble branch.
		// Give them a brief sparkle window instead.
		if (item.start === 0 && item.end === 0) {
			if (item.to !== '') {
				item.settleEnd = item.end + 14 + Math.floor(Math.random() * 10);
			}
			continue;
		}
		item.end += extension;
		if (item.fadeOutEnd !== undefined) {
			item.fadeOutEnd += extension;
		}
		if (item.to !== '') {
			item.settleEnd = item.end + 14 + Math.floor(Math.random() * 10);
		}
	}
	return queue;
}

export function computeGlitchFrame(
	queue: GlitchQueueItem[],
	frame: number,
	rng: () => string,
	currentText?: string,
	seed: number = 0,
): string {
	let output = '';
	let inDim = false;

	const sparkleCount = 2 + Math.floor(hashNoise(seed, 0xBEEF, frame, 55) * 2);
	const sparkleIndices = new Set<number>();
	for (let s = 0; s < sparkleCount; s++) {
		const idx = Math.floor(hashNoise(seed, 0xCAFE + s, frame, 66) * queue.length);
		if (idx >= 0 && idx < queue.length) sparkleIndices.add(idx);
	}

	for (let i = 0; i < queue.length; i++) {
		const entry = queue[i];
		const fadeOutEnd = entry.fadeOutEnd;
		const settleEnd = entry.settleEnd;
		const resolvedChar = currentText?.[i] ?? entry.to;
		const isOrphan = currentText != null && i >= currentText.length;

		if (fadeOutEnd !== undefined && frame >= entry.end && frame < fadeOutEnd) {
			if (!inDim) { output += DIM_ON; inDim = true; }
			const rollFade = hashNoise(seed, i, frame, 77);
			if (!entry.char || rollFade < GLITCH_RERANDOMIZE) {
				entry.char = rng();
			}
			if (isOrphan) {
				const fadeProgress = (frame - entry.end) / (fadeOutEnd - entry.end);
				if (fadeProgress < 0.5) {
					output += entry.char;
				} else {
					const dissolveThreshold = 1 - (fadeProgress - 0.5) * 2;
					if (hashNoise(seed, i, frame, 123) < dissolveThreshold) {
						output += entry.char;
					}
				}
			} else {
				output += entry.char;
			}
		} else if (settleEnd !== undefined && frame >= entry.end && frame < settleEnd) {
			if (inDim) { output += DIM_OFF; inDim = false; }
			if (isOrphan) {
				// Position beyond current text — skip
			} else {
				if (sparkleIndices.has(i)) {
					output += selectSparkChar(seed, i, frame);
				} else {
					output += resolvedChar;
				}
			}
		} else if (frame >= (settleEnd ?? fadeOutEnd ?? entry.end)) {
			if (inDim) { output += DIM_OFF; inDim = false; }
			if (isOrphan) {
				// Position beyond current text — skip
			} else {
				output += resolvedChar;
			}
		} else if (frame >= entry.start) {
			if (inDim) { output += DIM_OFF; inDim = false; }
			const rollScramble = hashNoise(seed, i, frame, 88);
			if (!entry.char || rollScramble < GLITCH_RERANDOMIZE) {
				entry.char = rng();
			}
			let outChar = entry.char;
			const window = entry.end - entry.start;
			if (window > 0 && entry.from === '' && entry.to !== '' && frame < entry.start + window * 0.25) {
				outChar = selectSparkChar(seed, i, frame);
			} else if (window > 0 && entry.to !== '' && !isOrphan && frame >= entry.start + window * 0.6) {
				const t = (frame - (entry.start + window * 0.6)) / (window * 0.4);
				const peekEase = smoothstep(0, 1, t);
				const roll = hashNoise(seed, i, frame, 99);
				if (roll < peekEase) {
					outChar = resolvedChar;
				}
			}
			if (isOrphan) {
				if (!inDim) { output += DIM_ON; inDim = true; }
				output += outChar;
			} else {
				output += outChar;
			}
		} else {
			if (inDim) { output += DIM_OFF; inDim = false; }
			if (isOrphan) {
				// Position beyond current text — skip
			} else {
				output += currentText?.[i] ?? entry.from;
			}
		}
	}
	if (currentText && currentText.length > queue.length) {
		if (inDim) { output += DIM_OFF; inDim = false; }
		output += currentText.slice(queue.length);
	}
	if (inDim) output += DIM_OFF;
	return output;
}

export function isGlitchComplete(queue: GlitchQueueItem[], frame: number): boolean {
	if (queue.length === 0) return true;
	return frame >= Math.max(...queue.map(e => e.settleEnd ?? e.fadeOutEnd ?? e.end));
}

export function applyScramble(text: string, state: LineState, now: number, lineKey?: LineKey, rng?: () => string, glitchEnabled: boolean = true): string {
	if (state.glitchQueue.length > 0 && glitchEnabled) {
		const frame = Math.floor((now - state.startTime) / GLITCH_FRAME_MS);
		if (isGlitchComplete(state.glitchQueue, frame)) {
			state.glitchQueue = [];
			state.glitchFrame = 0;
			if (state.pendingGlitch && state.pendingGlitch.length > 0) {
				state.glitchQueue = state.pendingGlitch;
				state.startTime = now;
				state.glitchFrame = 0;
				state.lastGlitchTime = now;
				state.targetText = state.pendingNewDisplayed;
				state.displayedText = text;
				state.pendingGlitch = null;
				state.pendingOldDisplayed = '';
				state.pendingNewDisplayed = '';
				state.pendingStartTime = 0;
				const pendingText = lineKey === 'msg' ? state.targetText : text;
				return computeGlitchFrame(state.glitchQueue, 0, rng ?? poolRandomChar, pendingText);
			}
			const resolvedTarget = lineKey === 'msg' ? text : (state.targetText || text);
			state.displayedText = resolvedTarget;
			state.targetText = '';
			return resolvedTarget;
		}
		const glitchText = lineKey === 'msg'
			? (state.targetText && state.targetText.length > text.length ? text : (state.targetText || text))
			: text;
		return computeGlitchFrame(state.glitchQueue, frame, rng ?? poolRandomChar, glitchText);
	}
	return text;
}

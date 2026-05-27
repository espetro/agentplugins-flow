import { LineState, LineKey, ValueFlashState, GLITCH_FRAME_MS } from './constants.js';
import { isGlitchComplete } from './algorithm.js';

export function isLineAnimating(state: LineState, now: number): boolean {
	if (state.completed) return false;
	if (state.glitchQueue.length > 0) {
		const frame = Math.floor((now - state.startTime) / GLITCH_FRAME_MS);
		if (!isGlitchComplete(state.glitchQueue, frame)) return true;
	}
	if (state.pendingGlitch && state.pendingGlitch.length > 0) return true;
	return false;
}

export function hasActiveAnimations(
	id: string,
	now: number,
	cache: Map<string, Record<LineKey, LineState>>,
	genericCache: Map<string, LineState>,
	tpsState: Map<string, ValueFlashState>,
	ctxState: Map<string, ValueFlashState>,
): boolean {
	const prefix = `${id}#`;
	const record = cache.get(id);
	if (record) {
		for (const key of ['aim', 'act', 'msg'] as LineKey[]) {
			if (isLineAnimating(record[key], now)) return true;
		}
	}
	for (const [key, rec] of cache) {
		if (key.startsWith(prefix)) {
			for (const lineKey of ['aim', 'act', 'msg'] as LineKey[]) {
				if (isLineAnimating(rec[lineKey], now)) return true;
			}
		}
	}
	for (const [key, state] of genericCache) {
		if (key.startsWith(prefix) && isLineAnimating(state, now)) return true;
	}
	const checkValueState = (map: Map<string, ValueFlashState>): boolean => {
		const exact = map.get(id);
		if (exact && !exact.completed) {
			if (exact.glitchQueue.length > 0) {
				const frame = Math.floor((now - exact.startTime) / GLITCH_FRAME_MS);
				if (!isGlitchComplete(exact.glitchQueue, frame)) return true;
			}
		}
		for (const [key, state] of map) {
			if (key.startsWith(prefix) && !state.completed) {
				if (state.glitchQueue.length > 0) {
					const frame = Math.floor((now - state.startTime) / GLITCH_FRAME_MS);
					if (!isGlitchComplete(state.glitchQueue, frame)) return true;
				}
			}
		}
		return false;
	};
	if (checkValueState(tpsState)) return true;
	if (checkValueState(ctxState)) return true;
	return false;
}

export function hasAnyActiveAnimations(
	now: number,
	cache: Map<string, Record<LineKey, LineState>>,
	genericCache: Map<string, LineState>,
	tpsState: Map<string, ValueFlashState>,
	ctxState: Map<string, ValueFlashState>,
): boolean {
	for (const record of cache.values()) {
		for (const key of ['aim', 'act', 'msg'] as LineKey[]) {
			if (isLineAnimating(record[key], now)) return true;
		}
	}
	for (const state of tpsState.values()) {
		if (state.completed) continue;
		if (state.glitchQueue.length > 0) {
			const frame = Math.floor((now - state.startTime) / GLITCH_FRAME_MS);
			if (!isGlitchComplete(state.glitchQueue, frame)) return true;
		}
	}
	for (const state of ctxState.values()) {
		if (state.completed) continue;
		if (state.glitchQueue.length > 0) {
			const frame = Math.floor((now - state.startTime) / GLITCH_FRAME_MS);
			if (!isGlitchComplete(state.glitchQueue, frame)) return true;
		}
	}
	for (const state of genericCache.values()) {
		if (isLineAnimating(state, now)) return true;
	}
	return false;
}

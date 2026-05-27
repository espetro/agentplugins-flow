import { LineState, LineKey, ValueFlashState, MAX_FLOW_ENTRIES, MAX_CACHE_AGE_MS } from './constants.js';
import { clearLiveText } from './constants.js';

export function sweepCompletedEntries(
	cache: Map<string, Record<LineKey, LineState>>,
	tpsState: Map<string, ValueFlashState>,
	ctxState: Map<string, ValueFlashState>,
	genericCache: Map<string, LineState>,
): void {
	if (cache.size <= MAX_FLOW_ENTRIES && tpsState.size <= MAX_FLOW_ENTRIES && genericCache.size <= MAX_FLOW_ENTRIES * 2) {
		return;
	}
	for (const [id, record] of cache) {
		if (record.aim.completed && record.act.completed && record.msg.completed) {
			cache.delete(id);
		}
	}
	for (const [id, state] of tpsState) {
		if (state.completed) {
			tpsState.delete(id);
		}
	}
	for (const [id, state] of ctxState) {
		if (state.completed) {
			ctxState.delete(id);
		}
	}
	for (const [key, state] of genericCache) {
		if (state.completed) {
			genericCache.delete(key);
		}
	}
	const now = Date.now();
	for (const [key, state] of genericCache) {
		if (now - state.lastAccessTime > MAX_CACHE_AGE_MS) {
			genericCache.delete(key);
		}
	}
}

export function completeFlowImpl(
	id: string,
	cache: Map<string, Record<LineKey, LineState>>,
	tpsState: Map<string, ValueFlashState>,
	ctxState: Map<string, ValueFlashState>,
	genericCache: Map<string, LineState>,
): void {
	clearLiveText(id);
	const record = cache.get(id);
	if (record) {
		for (const key of ['aim', 'act', 'msg'] as LineKey[]) {
			record[key].completed = true;
			record[key].glitchQueue = [];
			record[key].glitchFrame = 0;
			record[key].pendingGlitch = null;
			record[key].pendingOldDisplayed = '';
			record[key].pendingNewDisplayed = '';
			record[key].pendingStartTime = 0;
			record[key].targetText = '';
		}
	}
	const tpsStateEntry = tpsState.get(id);
	if (tpsStateEntry) {
		tpsStateEntry.completed = true;
		tpsStateEntry.glitchQueue = [];
		tpsStateEntry.glitchFrame = 0;
	}
	const ctxFlash = ctxState.get(id);
	if (ctxFlash) {
		ctxFlash.completed = true;
		ctxFlash.glitchQueue = [];
		ctxFlash.glitchFrame = 0;
	}
	const prefix = `${id}#`;
	for (const [key, state] of genericCache) {
		if (key.startsWith(prefix)) {
			state.completed = true;
			state.glitchQueue = [];
			state.glitchFrame = 0;
			state.pendingGlitch = null;
			state.pendingOldDisplayed = '';
			state.pendingNewDisplayed = '';
			state.pendingStartTime = 0;
			state.targetText = '';
		}
	}
}

import {
	ValueFlashState,
	GLITCH_FRAME_MS,
	GLITCH_SHORT_MAX_START,
	GLITCH_SHORT_MAX_LENGTH,
	TPS_HYSTERESIS_PCT,
	TPS_HYSTERESIS_MS,
	TPS_FLASH_COOLDOWN_MS,
} from './constants.js';
import { buildGlitchQueue, computeGlitchFrame, isGlitchComplete } from './algorithm.js';
import { createValueFlashState } from './line-state.js';

export function setupValueFlash(state: ValueFlashState, value: string, now: number): void {
	state.glitchQueue = buildGlitchQueue(state.prev, value, GLITCH_SHORT_MAX_START, GLITCH_SHORT_MAX_LENGTH);
	state.startTime = now;
	state.lastGlitchTime = now;
	state.glitchFrame = 0;
}

export function renderValueFlash(state: ValueFlashState, value: string, now: number, getRandomChar: () => string): string {
	if (state.glitchQueue.length > 0) {
		const frame = Math.floor((now - state.startTime) / GLITCH_FRAME_MS);
		if (isGlitchComplete(state.glitchQueue, frame)) {
			state.glitchQueue = [];
			state.prev = value;
			return value;
		}
		return computeGlitchFrame(state.glitchQueue, frame, getRandomChar, value);
	}
	state.prev = value;
	return value;
}

export function updateValueKpi(
	map: Map<string, ValueFlashState>,
	id: string,
	value: string,
	now: number,
	isComplete: boolean,
	staticLine: boolean,
): ValueFlashState {
	if (isComplete) {
		const s = map.get(id);
		if (!s) {
			const newState = createValueFlashState();
			newState.completed = true;
			map.set(id, newState);
			return newState;
		}
		s.completed = true;
		s.glitchQueue = [];
		return s;
	}

	let state = map.get(id);
	const isFirstCall = !state;
	if (!state) {
		state = createValueFlashState();
		state.prev = value;
		state.lastValueChangeTime = now;
		map.set(id, state);
	}

	if (!isComplete && state.completed) {
		state.completed = false;
		state.prev = '';
		state.glitchQueue = [];
		state.startTime = 0;
		state.lastGlitchTime = 0;
		state.lastFlashTime = 0;
		state.glitchFrame = 0;
	}

	if (state.completed) return state;

	const cooldownElapsed = now - state.lastFlashTime >= TPS_FLASH_COOLDOWN_MS;

	if (state.prev !== value) {
		let shouldFlash = staticLine ? state.startTime === 0 : true;
		state.lastValueChangeTime = now;
		if (shouldFlash && cooldownElapsed) {
			setupValueFlash(state, value, now);
			state.lastFlashTime = now;
		}
		state.prev = value;
	}

	if (isFirstCall && staticLine && state.startTime === 0 && cooldownElapsed) {
		setupValueFlash(state, value, now);
		state.lastFlashTime = now;
	}

	return state;
}

export function updateHeaderMetricImpl(
	id: string,
	kind: "tps" | "ctx",
	value: string,
	now: number,
	isComplete: boolean,
	staticLine: boolean,
	animationEnabled: boolean,
	tpsState: Map<string, ValueFlashState>,
	ctxState: Map<string, ValueFlashState>,
	getRandomChar: () => string,
): string {
	if (!animationEnabled) return value;
	if (!value || value.trim() === "-" || value.trim() === "") return value;

	const map = kind === "tps" ? tpsState : ctxState;
	if (isComplete) {
		const s = map.get(id);
		if (!s) return value;
	}

	let state = map.get(id);
	const isFirstCall = !state;
	if (!state) {
		state = createValueFlashState();
		state.prev = value;
		state.lastValueChangeTime = now;
		map.set(id, state);
		if (kind === "ctx" && staticLine) {
			return value;
		}
	}

	if (!isComplete && state.completed) {
		state.completed = false;
		state.prev = "";
		state.glitchQueue = [];
		state.startTime = 0;
		state.lastGlitchTime = 0;
		state.lastFlashTime = 0;
	}
	if (isComplete) {
		state.completed = true;
		state.glitchQueue = [];
	}
	if (state.completed) return value;

	const cooldownElapsed = now - state.lastFlashTime >= TPS_FLASH_COOLDOWN_MS;
	if (state.prev !== value) {
		let shouldFlash = staticLine ? state.startTime === 0 : true;
		if (kind === "tps") {
			const prevVal = parseFloat(state.prev);
			const newVal = parseFloat(value);
			if (!isNaN(prevVal) && !isNaN(newVal) && prevVal !== 0) {
				const deltaPct = Math.abs(newVal - prevVal) / prevVal;
				const timeSinceLastChange = state.lastValueChangeTime > 0 ? now - state.lastValueChangeTime : 0;
				shouldFlash = deltaPct > TPS_HYSTERESIS_PCT || timeSinceLastChange > TPS_HYSTERESIS_MS;
			}
		} else {
			const prevNum = parseFloat(state.prev.replace(/[kM]/g, ""));
			const newNum = parseFloat(value.replace(/[kM]/g, ""));
			if (!isNaN(prevNum) && !isNaN(newNum) && prevNum !== 0) {
				const deltaPct = Math.abs(newNum - prevNum) / prevNum;
				const timeSinceLastChange = state.lastValueChangeTime > 0 ? now - state.lastValueChangeTime : 0;
				shouldFlash = deltaPct > TPS_HYSTERESIS_PCT || timeSinceLastChange > TPS_HYSTERESIS_MS;
			}
		}
		state.lastValueChangeTime = now;
		if (shouldFlash && cooldownElapsed) {
			setupValueFlash(state, value, now);
			state.lastFlashTime = now;
		}
		state.prev = value;
	}
	if (isFirstCall && staticLine && state.startTime === 0 && cooldownElapsed) {
		setupValueFlash(state, value, now);
		state.lastFlashTime = now;
	}
	return renderValueFlash(state, value, now, getRandomChar);
}

import { stripAnsi, tailText, truncateChars } from '../render-utils.js';
import {
	AnimationConfig,
	ScrambleResult,
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
	TPS_HYSTERESIS_PCT,
	TPS_HYSTERESIS_MS,
	TPS_FLASH_COOLDOWN_MS,
	MAX_FLOW_ENTRIES,
	MAX_CACHE_AGE_MS,
	RANDOM_POOL_SIZE,
	SCRAMBLE_CHARS,
	POOL_REFILL_THRESHOLD,
} from './constants.js';
import {
	computeOverlapLen,
	isMinorStaticMutation,
} from './utils.js';
import {
	buildGlitchQueue,
	buildMsgGlitchQueue,
	computeGlitchFrame,
	applyScramble,
	isGlitchComplete,
	detectDirection,
	TransitionDirection,
} from './algorithm.js';
import {
	createLineState,
	createValueFlashState,
	processLine,
} from './line-state.js';
import {
	isLineAnimating,
	hasActiveAnimations,
	hasAnyActiveAnimations,
} from './animation-status.js';
import {
	setupValueFlash,
	renderValueFlash,
	updateValueKpi,
	updateHeaderMetricImpl,
} from './value-flash.js';
import {
	sweepCompletedEntries,
	completeFlowImpl,
} from './lifecycle.js';

export class ScrambleStateManager {
	private cache = new Map<string, Record<LineKey, LineState>>();
	private tpsState = new Map<string, ValueFlashState>();
	private ctxState = new Map<string, ValueFlashState>();
	private genericCache = new Map<string, LineState>();
	private randomPool: string[] = [];
	private randomPoolIndex = 0;
	private animationConfig: AnimationConfig = { enabled: true, glitch: true };

	private fillRandomPool(): void {
		this.randomPool = new Array(RANDOM_POOL_SIZE);
		for (let i = 0; i < RANDOM_POOL_SIZE; i++) {
			this.randomPool[i] = SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
		}
		this.randomPoolIndex = 0;
	}

	private poolRandomChar(): string {
		if (this.randomPoolIndex >= this.randomPool.length - POOL_REFILL_THRESHOLD) {
			this.fillRandomPool();
		}
		return this.randomPool[this.randomPoolIndex++];
	}

	setAnimationConfig(config: AnimationConfig): void {
		this.animationConfig = config;
	}

	private getState(id: string, key: LineKey): LineState {
		let record = this.cache.get(id);
		if (!record) {
			record = { aim: createLineState(), act: createLineState(), msg: createLineState() };
			this.cache.set(id, record);
		}
		return record[key];
	}

	private getGenericState(id: string, key: string, now: number): LineState {
		const cacheKey = `${id}#${key}`;
		let state = this.genericCache.get(cacheKey);
		if (!state) {
			state = createLineState();
			this.genericCache.set(cacheKey, state);
		}
		state.lastAccessTime = now;
		return state;
	}

	updateText(id: string, key: string, text: string, now: number, isComplete: boolean = false, staticLine: boolean = false): ScrambleResult {
		if (!this.animationConfig.enabled) {
			return { label: key, content: text, isAnimating: false };
		}
		if (isComplete) {
			const state = this.genericCache.get(`${id}#${key}`);
			if (!state) return { label: key, content: text, isAnimating: false };
		}
		const state = this.getGenericState(id, key, now);
		if (!isComplete && state.completed) {
			state.completed = false;
			state.lastText = '';
			state.displayedText = '';
			state.targetText = '';
			state.initialized = false;
			state.glitchQueue = [];
			state.glitchFrame = 0;
			state.pendingGlitch = null;
			state.pendingOldDisplayed = '';
			state.pendingNewDisplayed = '';
			state.pendingStartTime = 0;
		}
		if (isComplete) {
			state.completed = true;
			state.glitchQueue = [];
			state.glitchFrame = 0;
			state.pendingGlitch = null;
			state.pendingOldDisplayed = '';
			state.pendingNewDisplayed = '';
			state.pendingStartTime = 0;
		}
		if (state.completed) {
			if (state.glitchQueue.length > 0) {
				const frame = Math.floor((now - state.startTime) / GLITCH_FRAME_MS);
				if (!isGlitchComplete(state.glitchQueue, frame)) {
					const content = computeGlitchFrame(state.glitchQueue, frame, () => this.poolRandomChar(), text);
					return { label: key, content, isAnimating: true };
				}
				state.glitchQueue = [];
				state.glitchFrame = 0;
			}
			state.displayedText = text;
			state.lastText = text;
			return { label: key, content: text, isAnimating: false };
		}
		if (!state.initialized) {
			state.lastText = text;
			state.displayedText = text;
			state.initialized = true;
			state.lastAnimTime = now;
			if (this.animationConfig.glitch) {
				state.glitchQueue = buildGlitchQueue('', text, GLITCH_MAX_START, GLITCH_MAX_LENGTH, 'expand');
				state.startTime = now;
				state.lastGlitchTime = now;
				state.glitchFrame = 0;
			}
		} else if (staticLine && state.initialized) {
			const oldText = state.lastText;
			const textChanged = oldText !== text;
			state.lastText = text;
			const oldDisplayed = state.displayedText || '';
			state.displayedText = text;
			if (textChanged) {
				if (isMinorStaticMutation(oldText, text)) {
					// minor mutation — don't restart animation
				} else if (now - state.lastAnimTime >= MIN_GLITCH_INTERVAL) {
					state.lastAnimTime = now;
					if (this.animationConfig.glitch) {
						const frame = Math.floor((now - state.startTime) / GLITCH_FRAME_MS);
						const glitchComplete = isGlitchComplete(state.glitchQueue, frame);
						const direction = detectDirection(oldDisplayed, text);
						if (glitchComplete) {
							state.glitchQueue = buildGlitchQueue(oldDisplayed, text, GLITCH_MAX_START, GLITCH_MAX_LENGTH, direction);
							state.startTime = now;
							state.lastGlitchTime = now;
							state.glitchFrame = 0;
						} else if (state.glitchQueue.length > 0) {
							state.pendingGlitch = buildGlitchQueue(oldDisplayed, text, GLITCH_MAX_START, GLITCH_MAX_LENGTH, direction);
							state.pendingOldDisplayed = oldDisplayed;
							state.pendingNewDisplayed = text;
							state.pendingStartTime = now;
						}
					}
				}
			} else if (!this.isLineAnimating(state, now)) {
				state.glitchQueue = [];
				state.glitchFrame = 0;
				state.pendingGlitch = null;
				state.pendingOldDisplayed = '';
				state.pendingNewDisplayed = '';
				state.pendingStartTime = 0;
			}
		} else {
			processLine(state, text, now, undefined, this.animationConfig.glitch);
		}
		const content = applyScramble(text, state, now, undefined, () => this.poolRandomChar(), this.animationConfig.glitch);
		const isAnimating = this.isLineAnimating(state, now);
		return { label: key, content, isAnimating };
	}

	updateAim(id: string, text: string, now: number, isComplete: boolean = false, staticLine: boolean = false): ScrambleResult {
		if (!this.animationConfig.enabled) {
			return { label: 'aim:', content: text, isAnimating: false };
		}
		if (isComplete) {
			const record = this.cache.get(id);
			if (!record) return { label: 'aim:', content: text, isAnimating: false };
		}
		const state = this.getState(id, 'aim');
		if (!isComplete && state.completed) {
			state.completed = false;
			state.lastText = '';
			state.displayedText = '';
			state.targetText = '';
			state.initialized = false;
			state.glitchQueue = [];
			state.glitchFrame = 0;
			state.pendingGlitch = null;
			state.pendingOldDisplayed = '';
			state.pendingNewDisplayed = '';
			state.pendingStartTime = 0;
		}
		if (isComplete) {
			state.completed = true;
			state.glitchQueue = [];
			state.glitchFrame = 0;
			state.pendingGlitch = null;
			state.pendingOldDisplayed = '';
			state.pendingNewDisplayed = '';
			state.pendingStartTime = 0;
		}
		if (state.completed) {
			if (state.glitchQueue.length > 0) {
				const frame = Math.floor((now - state.startTime) / GLITCH_FRAME_MS);
				if (!isGlitchComplete(state.glitchQueue, frame)) {
					const content = computeGlitchFrame(state.glitchQueue, frame, () => this.poolRandomChar(), text);
					return { label: 'aim:', content, isAnimating: true };
				}
				state.glitchQueue = [];
				state.glitchFrame = 0;
			}
			state.displayedText = text;
			state.lastText = text;
			return { label: 'aim:', content: text, isAnimating: false };
		}
		if (!state.initialized) {
			state.lastText = text;
			state.initialized = true;
			state.lastAnimTime = now;
			if (this.animationConfig.glitch) {
				state.glitchQueue = buildGlitchQueue('', text, GLITCH_MAX_START, GLITCH_MAX_LENGTH, 'expand');
				state.startTime = now;
				state.lastGlitchTime = now;
				state.glitchFrame = 0;
			}
		} else if (staticLine && state.initialized) {
			const oldText = state.lastText;
			const textChanged = oldText !== text;
			state.lastText = text;
			const oldDisplayed = state.displayedText || '';
			state.displayedText = text;
			if (textChanged) {
				if (isMinorStaticMutation(oldText, text)) {
					// minor mutation — don't restart animation
				} else if (now - state.lastAnimTime >= MIN_GLITCH_INTERVAL) {
					state.lastAnimTime = now;
					if (this.animationConfig.glitch) {
						const frame = Math.floor((now - state.startTime) / GLITCH_FRAME_MS);
						const glitchComplete = isGlitchComplete(state.glitchQueue, frame);
						const direction = detectDirection(oldDisplayed, text);
						if (glitchComplete) {
							state.glitchQueue = buildGlitchQueue(oldDisplayed, text, GLITCH_MAX_START, GLITCH_MAX_LENGTH, direction);
							state.startTime = now;
							state.lastGlitchTime = now;
							state.glitchFrame = 0;
						} else if (state.glitchQueue.length > 0) {
							state.pendingGlitch = buildGlitchQueue(oldDisplayed, text, GLITCH_MAX_START, GLITCH_MAX_LENGTH, direction);
							state.pendingOldDisplayed = oldDisplayed;
							state.pendingNewDisplayed = text;
							state.pendingStartTime = now;
						}
					}
				}
			} else if (!this.isLineAnimating(state, now)) {
				state.glitchQueue = [];
				state.glitchFrame = 0;
				state.pendingGlitch = null;
				state.pendingOldDisplayed = '';
				state.pendingNewDisplayed = '';
				state.pendingStartTime = 0;
			}
		} else {
			processLine(state, text, now, undefined, this.animationConfig.glitch);
		}
		const content = applyScramble(text, state, now, undefined, () => this.poolRandomChar(), this.animationConfig.glitch);
		const isAnimating = this.isLineAnimating(state, now);
		return { label: 'aim:', content, isAnimating };
	}

	updateAct(id: string, text: string, now: number, isComplete: boolean = false, staticLine: boolean = false): ScrambleResult {
		if (!this.animationConfig.enabled) {
			return { label: 'act:', content: text, isAnimating: false };
		}
		if (isComplete) {
			const record = this.cache.get(id);
			if (!record) return { label: 'act:', content: text, isAnimating: false };
		}
		const state = this.getState(id, 'act');
		if (!isComplete && state.completed) {
			state.completed = false;
			state.lastText = '';
			state.displayedText = '';
			state.targetText = '';
			state.initialized = false;
			state.glitchQueue = [];
			state.glitchFrame = 0;
			state.pendingGlitch = null;
			state.pendingOldDisplayed = '';
			state.pendingNewDisplayed = '';
			state.pendingStartTime = 0;
		}
		if (isComplete) {
			state.completed = true;
			state.glitchQueue = [];
			state.glitchFrame = 0;
			state.pendingGlitch = null;
			state.pendingOldDisplayed = '';
			state.pendingNewDisplayed = '';
			state.pendingStartTime = 0;
		}
		if (state.completed) {
			if (state.glitchQueue.length > 0) {
				const frame = Math.floor((now - state.startTime) / GLITCH_FRAME_MS);
				if (!isGlitchComplete(state.glitchQueue, frame)) {
					const content = computeGlitchFrame(state.glitchQueue, frame, () => this.poolRandomChar(), text);
					return { label: 'act:', content, isAnimating: true };
				}
				state.glitchQueue = [];
				state.glitchFrame = 0;
			}
			state.displayedText = text;
			state.lastText = text;
			return { label: 'act:', content: text, isAnimating: false };
		}
		if (!state.initialized) {
			state.lastText = text;
			state.initialized = true;
			state.lastAnimTime = now;
			if (this.animationConfig.glitch) {
				state.glitchQueue = buildGlitchQueue('', text, GLITCH_MAX_START, GLITCH_MAX_LENGTH, 'expand');
				state.startTime = now;
				state.lastGlitchTime = now;
				state.glitchFrame = 0;
			}
		} else if (staticLine && state.initialized) {
			const oldText = state.lastText;
			const textChanged = oldText !== text;
			state.lastText = text;
			const oldDisplayed = state.displayedText || '';
			state.displayedText = text;
			if (textChanged) {
				if (isMinorStaticMutation(oldText, text)) {
					// minor mutation — don't restart animation
				} else if (now - state.lastAnimTime >= MIN_GLITCH_INTERVAL) {
					state.lastAnimTime = now;
					if (this.animationConfig.glitch) {
						const frame = Math.floor((now - state.startTime) / GLITCH_FRAME_MS);
						const glitchComplete = isGlitchComplete(state.glitchQueue, frame);
						const direction = detectDirection(oldDisplayed, text);
						if (glitchComplete) {
							state.glitchQueue = buildGlitchQueue(oldDisplayed, text, GLITCH_MAX_START, GLITCH_MAX_LENGTH, direction);
							state.startTime = now;
							state.lastGlitchTime = now;
							state.glitchFrame = 0;
						} else if (state.glitchQueue.length > 0) {
							state.pendingGlitch = buildGlitchQueue(oldDisplayed, text, GLITCH_MAX_START, GLITCH_MAX_LENGTH, direction);
							state.pendingOldDisplayed = oldDisplayed;
							state.pendingNewDisplayed = text;
							state.pendingStartTime = now;
						}
					}
				}
			} else if (!this.isLineAnimating(state, now)) {
				state.glitchQueue = [];
				state.glitchFrame = 0;
				state.pendingGlitch = null;
				state.pendingOldDisplayed = '';
				state.pendingNewDisplayed = '';
				state.pendingStartTime = 0;
			}
		} else {
			processLine(state, text, now, 'act', this.animationConfig.glitch);
		}
		const content = applyScramble(text, state, now, 'act', () => this.poolRandomChar(), this.animationConfig.glitch);
		const isAnimating = this.isLineAnimating(state, now);
		return { label: 'act:', content, isAnimating };
	}

	updateMsg(id: string, text: string, now: number, isComplete: boolean = false, budget?: number, staticLine: boolean = false): ScrambleResult {
		const visibleText = budget !== undefined ? tailText(text, budget) : text;

		if (!this.animationConfig.enabled) {
			return { label: 'msg:', content: visibleText, isAnimating: false };
		}
		if (isComplete) {
			const record = this.cache.get(id);
			if (!record) return { label: 'msg:', content: visibleText, isAnimating: false };
		}
		const state = this.getState(id, 'msg');
		if (!isComplete && state.completed) {
			state.completed = false;
			state.lastText = '';
			state.displayedText = '';
			state.targetText = '';
			state.initialized = false;
			state.glitchQueue = [];
			state.glitchFrame = 0;
			state.pendingGlitch = null;
			state.pendingOldDisplayed = '';
			state.pendingNewDisplayed = '';
			state.pendingStartTime = 0;
		}
		if (isComplete) {
			state.completed = true;
			state.glitchQueue = [];
			state.glitchFrame = 0;
			state.pendingGlitch = null;
			state.pendingOldDisplayed = '';
			state.pendingNewDisplayed = '';
			state.pendingStartTime = 0;
		}
		if (state.completed) {
			if (state.glitchQueue.length > 0) {
				const frame = Math.floor((now - state.startTime) / GLITCH_FRAME_MS);
				if (!isGlitchComplete(state.glitchQueue, frame)) {
					const content = computeGlitchFrame(state.glitchQueue, frame, () => this.poolRandomChar(), visibleText);
					return { label: 'msg:', content, isAnimating: true };
				}
				state.glitchQueue = [];
				state.glitchFrame = 0;
			}
			state.displayedText = visibleText;
			state.lastText = visibleText;
			return { label: 'msg:', content: visibleText, isAnimating: false };
		}
		if (!state.initialized) {
			state.lastText = visibleText;
			state.initialized = true;
			state.displayedText = visibleText;
			state.lastAnimTime = now;
			if (this.animationConfig.glitch) {
				state.glitchQueue = buildMsgGlitchQueue('', visibleText, 'expand');
				state.targetText = visibleText;
				state.startTime = now;
				state.lastGlitchTime = now;
				state.glitchFrame = 0;
			}
		} else if (staticLine && state.initialized) {
			const oldText = state.lastText;
			const textChanged = oldText !== visibleText;
			state.lastText = visibleText;
			const oldDisplayed = state.displayedText || '';
			let willAnimate = false;
			if (textChanged) {
				if (isMinorStaticMutation(oldText, visibleText)) {
					// minor mutation — don't restart animation
				} else if (now - state.lastAnimTime >= MIN_GLITCH_INTERVAL) {
					state.lastAnimTime = now;
					if (this.animationConfig.glitch) {
						const frame = Math.floor((now - state.startTime) / GLITCH_FRAME_MS);
						const glitchComplete = isGlitchComplete(state.glitchQueue, frame);
						const direction = detectDirection(oldDisplayed, visibleText);
						if (glitchComplete) {
							state.glitchQueue = buildMsgGlitchQueue(oldDisplayed, visibleText, direction);
							state.targetText = visibleText;
							state.startTime = now;
							state.lastGlitchTime = now;
							state.glitchFrame = 0;
							willAnimate = true;
						} else if (state.glitchQueue.length > 0) {
							state.pendingGlitch = buildMsgGlitchQueue(oldDisplayed, visibleText, direction);
							state.pendingOldDisplayed = oldDisplayed;
							state.pendingNewDisplayed = visibleText;
							state.pendingStartTime = now;
							willAnimate = true;
						}
					}
				}
			} else if (!this.isLineAnimating(state, now)) {
				state.glitchQueue = [];
				state.glitchFrame = 0;
				state.pendingGlitch = null;
				state.pendingOldDisplayed = '';
				state.pendingNewDisplayed = '';
				state.pendingStartTime = 0;
			}
			if (!willAnimate) {
				state.displayedText = visibleText;
			}
		} else {
			processLine(state, visibleText, now, 'msg', this.animationConfig.glitch);
		}
		let displayText: string;
		if (staticLine && state.glitchQueue.length > 0) {
			const frozenTarget = state.targetText || state.displayedText;
			displayText = visibleText.length > frozenTarget.length ? frozenTarget : visibleText;
		} else {
			const overlap = computeOverlapLen(state.displayedText, visibleText);
			const minDispLen = Math.min(state.displayedText.length, visibleText.length);
			const isTailSlide = overlap > 0 && overlap >= minDispLen * 0.5;
			const suppressTailSlide = staticLine && !isComplete && state.displayedText !== '' && state.displayedText !== visibleText && isTailSlide;
			displayText = suppressTailSlide ? state.displayedText : visibleText;
		}
		const content = applyScramble(displayText, state, now, 'msg', () => this.poolRandomChar(), this.animationConfig.glitch);
		const isAnimating = this.isLineAnimating(state, now);
		return { label: 'msg:', content, isAnimating };
	}

	private _setupValueFlash(state: ValueFlashState, value: string, now: number): void {
		setupValueFlash(state, value, now);
	}

	private _renderValueFlash(state: ValueFlashState, value: string, now: number): string {
		return renderValueFlash(state, value, now, () => this.poolRandomChar());
	}

	private _updateValueKpi(
		map: Map<string, ValueFlashState>,
		id: string,
		value: string,
		now: number,
		isComplete: boolean,
		staticLine: boolean
	): ValueFlashState {
		return updateValueKpi(map, id, value, now, isComplete, staticLine);
	}

	updateHeaderMetric(
		id: string,
		kind: "tps" | "ctx",
		value: string,
		now: number,
		isComplete: boolean = false,
		staticLine: boolean = false,
	): string {
		return updateHeaderMetricImpl(id, kind, value, now, isComplete, staticLine, this.animationConfig.enabled, this.tpsState, this.ctxState, () => this.poolRandomChar());
	}

	updateTps(id: string, tpsText: string, now: number, isComplete = false, staticLine = false): string {
		return this.updateHeaderMetric(id, "tps", tpsText, now, isComplete, staticLine);
	}

	updateCtx(id: string, ctxText: string, now: number, isComplete = false, staticLine = false): string {
		return this.updateHeaderMetric(id, "ctx", ctxText, now, isComplete, staticLine);
	}

	private isLineAnimating(state: LineState, now: number): boolean {
		return isLineAnimating(state, now);
	}

	hasActiveAnimations(id: string, now: number): boolean {
		return hasActiveAnimations(id, now, this.cache, this.genericCache, this.tpsState, this.ctxState);
	}

	hasAnyActiveAnimations(now: number): boolean {
		return hasAnyActiveAnimations(now, this.cache, this.genericCache, this.tpsState, this.ctxState);
	}

	clear(): void {
		this.cache.clear();
		this.tpsState.clear();
		this.ctxState.clear();
		this.genericCache.clear();
	}

	private sweepCompletedEntries(): void {
		sweepCompletedEntries(this.cache, this.tpsState, this.ctxState, this.genericCache);
	}

	completeFlow(id: string): void {
		completeFlowImpl(id, this.cache, this.tpsState, this.ctxState, this.genericCache);
		this.sweepCompletedEntries();
	}

	renderStatic(text: string): string {
		return text;
	}
}

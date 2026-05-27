// Re-exports preserving the public API of the former src/tui/scramble.ts
export {
	ScrambleStateManager,
} from './manager.js';

export {
	scrambleManager,
} from './singleton.js';

export {
	runScrambleTimer,
	setAnimationConfig,
} from './timer.js';

export {
	DynamicScrambleText,
} from './dynamic-text.js';

export {
	createLineState,
	createValueFlashState,
	processLine,
} from './line-state.js';

export {
	isLineAnimating,
	hasActiveAnimations,
	hasAnyActiveAnimations,
} from './animation-status.js';

export {
	setupValueFlash,
	renderValueFlash,
	updateValueKpi,
	updateHeaderMetricImpl,
} from './value-flash.js';

export {
	sweepCompletedEntries,
	completeFlowImpl,
} from './lifecycle.js';

export {
	getLiveText,
	setLiveText,
	clearLiveText,
	FastRNG,
	THIN_BRAILLE_SPARK,
	DEEP_GLITCH,
	MID_GLITCH,
	SHALLOW_GLITCH,
} from './constants.js';

export type {
	AnimationConfig,
	ScrambleResult,
	GlitchQueueItem,
	LineState,
	LineKey,
	ValueFlashState,
} from './constants.js';

export {
	buildGlitchQueue,
	buildMsgGlitchQueue,
	computeGlitchFrame,
	isGlitchComplete,
	applyScramble,
	detectDirection,
} from './algorithm.js';


export {
	hashNoise,
	makeAnimationSeed,
	selectScrambleChar,
	selectSparkChar,
} from './utils.js';

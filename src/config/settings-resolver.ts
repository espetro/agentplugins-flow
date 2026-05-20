/**
 * Settings resolution for session_start handler.
 *
 * Extracted from index.ts for single-responsibility and testability.
 */

import * as os from "node:os";
import * as fs from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type FlowConfig, discoverFlows } from "../flow/agents.js";
import {
	loadFlowModelConfigs,
	loadFlowSettings,
	loadProjectFlowModelConfigName,
	normalizeFlowModeName,
	selectFlowModelStrategy,
	writeGlobalFlowMode,
	formatFlowModelStrategy,
	type LoadedFlowModelConfigs,
} from "./config.js";
import { getInheritedCliArgs } from "../snapshot/cli-args.js";
import { parseBoolean, FLOW_TOOL_OPTIMIZE_ENV } from "../flow/depth.js";
import { logWarn } from "./log.js";
import {
	DEFAULT_COMPLEXITY,
	parseComplexity,
	type Complexity,
} from "../flow/complexity.js";

// Environment variables for steering and animation
const PI_FLOW_NO_STEERING_ENV = "PI_FLOW_NO_STEERING";
const PI_FLOW_NO_STRATEGIC_HINT_ENV = "PI_FLOW_NO_STRATEGIC_HINT";
const PI_FLOW_NO_ANIMATION_ENV = "PI_FLOW_NO_ANIMATION";
const PI_FLOW_NO_GLITCH_ENV = "PI_FLOW_NO_GLITCH";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResolvedSettings {
	toolOptimize: boolean;
	structuredOutput: boolean;
	maxConcurrency: number;
	defaultComplexity: Complexity;
	steeringEnabled: boolean;
	steeringCustomPrompt: string | undefined;
	steeringStrategicHint: boolean;
	animationEnabled: boolean;
	animationGlitch: boolean;
	askUserEnabled: boolean;
	askUserTimeout: number;
	discoveredFlows: FlowConfig[];
	loadedFlowModelConfigs: LoadedFlowModelConfigs;
	activeRuntimeFlowMode: string | undefined;
	bodyVerbosity: "lite" | "full";
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve all flow settings from env vars, CLI flags, and settings files.
 *
 * Called from the session_start handler. Returns the resolved settings
 * plus discovered flows and model configs.
 */
export function resolveSettings(
	pi: ExtensionAPI,
	cwd: string,
): ResolvedSettings & { projectFlowsDir: string | null } {
	const inheritedCliArgs = getInheritedCliArgs();

	let toolOptimize = true;
	let structuredOutput = true;
	let maxConcurrency = 4;
	let defaultComplexity: Complexity = DEFAULT_COMPLEXITY;
	let steeringEnabled = true;
	let steeringCustomPrompt: string | undefined = undefined;
	let steeringStrategicHint = true;
	let animationEnabled = true;
	let animationGlitch = true;
	let askUserEnabled = false;
	let askUserTimeout = 300000; // 5 minutes in ms

	const envToolOptimize = process.env[FLOW_TOOL_OPTIMIZE_ENV];
	if (envToolOptimize !== undefined) {
		const parsed = parseBoolean(envToolOptimize);
		if (parsed !== null) toolOptimize = parsed;
	}

	// Auto-discover flows
	const discovery = discoverFlows(cwd, "all");
	const discoveredFlows = discovery.flows;
	let loadedFlowModelConfigs: LoadedFlowModelConfigs = loadFlowModelConfigs(cwd);
	let activeRuntimeFlowMode: string | undefined = undefined;

	// Resolve --flow-mode persistent switch
	const requestedFlowMode = normalizeFlowModeName(pi.getFlag("flow-mode"));
	if (requestedFlowMode !== undefined) {
		if (!Object.prototype.hasOwnProperty.call(loadedFlowModelConfigs.configs, requestedFlowMode)) {
			const availableModes = Object.keys(loadedFlowModelConfigs.configs).sort().join(", ") || "(none)";
			logWarn(
				`[pi-agent-flow] Cannot switch flow mode to "${requestedFlowMode}"; no flowModelConfigs.${requestedFlowMode} strategy was found. Available modes: ${availableModes}.`,
			);
		} else {
			try {
				writeGlobalFlowMode(requestedFlowMode);
				const strategy = loadedFlowModelConfigs.configs[requestedFlowMode] ?? {};
				const strategyDescription = formatFlowModelStrategy(requestedFlowMode, strategy);
				logWarn(strategyDescription);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logWarn(`[pi-agent-flow] ${message}`);
			}

			const projectFlowModelConfig = loadProjectFlowModelConfigName(cwd);
			if (projectFlowModelConfig !== undefined && projectFlowModelConfig !== requestedFlowMode) {
				logWarn(
					`[pi-agent-flow] Switched global flow mode to "${requestedFlowMode}"; this project selects "${projectFlowModelConfig}" in .pi/settings.json, so future runs in this project may still use "${projectFlowModelConfig}" unless project settings are changed.`,
				);
			}

			activeRuntimeFlowMode = requestedFlowMode;
			loadedFlowModelConfigs = selectFlowModelStrategy(loadedFlowModelConfigs.configs, requestedFlowMode);
		}
	}

	// Resolve settings from .pi/settings.json
	const flowSettings = loadFlowSettings(cwd);
	if (typeof flowSettings.structuredOutput === "boolean") {
		structuredOutput = flowSettings.structuredOutput;
	}
	if (typeof flowSettings.maxConcurrency === "number") {
		maxConcurrency = flowSettings.maxConcurrency;
	}
	// steering defaults from settings.json
	if (typeof flowSettings.steering?.enabled === "boolean") {
		steeringEnabled = flowSettings.steering.enabled;
	}
	if (typeof flowSettings.steering?.customPrompt === "string") {
		steeringCustomPrompt = flowSettings.steering.customPrompt;
	}
	if (typeof flowSettings.steering?.strategicHint === "boolean") {
		steeringStrategicHint = flowSettings.steering.strategicHint;
	}
	// animation defaults from settings.json
	if (typeof flowSettings.animation?.enabled === "boolean") {
		animationEnabled = flowSettings.animation.enabled;
	}
	if (typeof flowSettings.animation?.glitch === "boolean") {
		animationGlitch = flowSettings.animation.glitch;
	}

	// Resolve toolOptimize: CLI flag > env var > settings.json > default
	const cliFlag = pi.getFlag("tool-optimize");
	if (typeof flowSettings.toolOptimize === "boolean") {
		toolOptimize = flowSettings.toolOptimize;
	}
	if (envToolOptimize !== undefined) {
		const parsed = parseBoolean(envToolOptimize);
		if (parsed !== null) toolOptimize = parsed;
	}
	if (typeof cliFlag === "boolean") {
		toolOptimize = cliFlag;
	} else if (typeof cliFlag === "string") {
		const parsed = parseBoolean(cliFlag);
		if (parsed !== null) toolOptimize = parsed;
	}

	// Resolve complexity: CLI flag > env var > settings.json > default
	defaultComplexity = flowSettings.complexity ?? DEFAULT_COMPLEXITY;
	const envComplexityRaw = process.env.PI_FLOW_COMPLEXITY;
	if (envComplexityRaw !== undefined) {
		const envComplexity = parseComplexity(envComplexityRaw);
		if (envComplexity !== undefined) {
			defaultComplexity = envComplexity;
		} else {
			logWarn(`[pi-agent-flow] Ignoring invalid PI_FLOW_COMPLEXITY="${envComplexityRaw}". Expected snap, simple, moderate, complex, or intricate.`);
		}
	}
	const cliComplexityRaw = pi.getFlag("flow-complexity");
	if (typeof cliComplexityRaw === "string") {
		const cliComplexity = parseComplexity(cliComplexityRaw);
		if (cliComplexity !== undefined) {
			defaultComplexity = cliComplexity;
		} else {
			logWarn(`[pi-agent-flow] Ignoring invalid --flow-complexity value "${cliComplexityRaw}". Expected snap, simple, moderate, complex, or intricate.`);
		}
	} else if (inheritedCliArgs.flowComplexity !== undefined) {
		defaultComplexity = inheritedCliArgs.flowComplexity;
	}

	// Resolve maxConcurrency: CLI flag > env var > settings.json > default
	const cliConcurrency = pi.getFlag("flow-max-concurrency");
	if (typeof cliConcurrency === "string") {
		const parsed = Number(cliConcurrency);
		if (Number.isSafeInteger(parsed) && parsed >= 1) maxConcurrency = parsed;
	} else if (typeof cliConcurrency === "number" && Number.isSafeInteger(cliConcurrency) && cliConcurrency >= 1) {
		maxConcurrency = cliConcurrency;
	}
	const envConcurrency = process.env["PI_FLOW_MAX_CONCURRENCY"];
	if (envConcurrency !== undefined && typeof cliConcurrency === "undefined") {
		const parsed = Number(envConcurrency);
		if (Number.isSafeInteger(parsed) && parsed >= 1) maxConcurrency = parsed;
	}
	// Cap concurrency to the number of available CPUs
	if (typeof os.availableParallelism === "function") {
		const hwConcurrency = os.availableParallelism();
		if (hwConcurrency > 0) maxConcurrency = Math.min(maxConcurrency, hwConcurrency);
	}

	// Resolve steering: CLI flag > env var > settings.json > default
	const envNoSteering = process.env[PI_FLOW_NO_STEERING_ENV];
	if (envNoSteering !== undefined) {
		const parsed = parseBoolean(envNoSteering);
		if (parsed !== null) steeringEnabled = !parsed; // env is "NO" steering, so invert
	}
	const cliNoSteering = pi.getFlag("no-steering");
	if (typeof cliNoSteering === "boolean") {
		steeringEnabled = !cliNoSteering;
	} else if (typeof cliNoSteering === "string") {
		const parsed = parseBoolean(cliNoSteering);
		if (parsed !== null) steeringEnabled = !parsed;
	}

	// Resolve strategic hint: CLI flag > env var > settings.json > default
	const envNoStrategicHint = process.env[PI_FLOW_NO_STRATEGIC_HINT_ENV];
	if (envNoStrategicHint !== undefined) {
		const parsed = parseBoolean(envNoStrategicHint);
		if (parsed !== null) steeringStrategicHint = !parsed;
	}
	const cliNoStrategicHint = pi.getFlag("no-strategic-hint");
	if (typeof cliNoStrategicHint === "boolean") {
		steeringStrategicHint = !cliNoStrategicHint;
	} else if (typeof cliNoStrategicHint === "string") {
		const parsed = parseBoolean(cliNoStrategicHint);
		if (parsed !== null) steeringStrategicHint = !parsed;
	}

	// Resolve animation: CLI flag > env var > settings.json > default
	const envNoAnimation = process.env[PI_FLOW_NO_ANIMATION_ENV];
	if (envNoAnimation !== undefined) {
		const parsed = parseBoolean(envNoAnimation);
		if (parsed !== null) animationEnabled = !parsed;
	}
	const cliNoAnimation = pi.getFlag("no-animation");
	if (typeof cliNoAnimation === "boolean") {
		animationEnabled = !cliNoAnimation;
	} else if (typeof cliNoAnimation === "string") {
		const parsed = parseBoolean(cliNoAnimation);
		if (parsed !== null) animationEnabled = !parsed;
	}

	// Resolve glitch: CLI flag > env var > settings.json > default
	const envNoGlitch = process.env[PI_FLOW_NO_GLITCH_ENV];
	if (envNoGlitch !== undefined) {
		const parsed = parseBoolean(envNoGlitch);
		if (parsed !== null) animationGlitch = !parsed;
	}
	const cliNoGlitch = pi.getFlag("no-glitch");
	if (typeof cliNoGlitch === "boolean") {
		animationGlitch = !cliNoGlitch;
	} else if (typeof cliNoGlitch === "string") {
		const parsed = parseBoolean(cliNoGlitch);
		if (parsed !== null) animationGlitch = !parsed;
	}

	// Resolve askUser: settings.json > env var > default
	if (typeof flowSettings.askUser?.enabled === "boolean") {
		askUserEnabled = flowSettings.askUser.enabled;
	}
	if (typeof flowSettings.askUser?.timeout === "number") {
		askUserTimeout = flowSettings.askUser.timeout * 1000;
	}
	const envAskUserTimeout = process.env["PI_ASK_USER_TIMEOUT"];
	if (envAskUserTimeout !== undefined) {
		const parsed = Number(envAskUserTimeout);
		if (Number.isSafeInteger(parsed) && parsed >= 1) {
			askUserTimeout = parsed * 1000;
		}
	}

	// Resolve custom steering prompt: CLI flag only (path to file)
	const cliSteeringPrompt = pi.getFlag("steering-prompt");
	if (typeof cliSteeringPrompt === "string" && cliSteeringPrompt.trim()) {
		try {
			steeringCustomPrompt = fs.readFileSync(cliSteeringPrompt.trim(), "utf-8").trim();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logWarn(`[pi-agent-flow] Could not read steering-prompt file: ${msg}`);
		}
	}

	// Resolve bodyVerbosity: CLI flag > env var > settings.json > default
	let bodyVerbosity: "lite" | "full" = "lite";
	if (typeof flowSettings.bodyVerbosity === "string") {
		bodyVerbosity = flowSettings.bodyVerbosity;
	}
	const envBodyVerbosity = process.env["PI_FLOW_BODY_VERBOSITY"];
	if (envBodyVerbosity === "full" || envBodyVerbosity === "lite") {
		bodyVerbosity = envBodyVerbosity;
	}

	// Resolve bodyVerbosity: CLI flag > env var > settings.json > default
	const cliBodyFull = pi.getFlag("body-full");
	const cliBodyLite = pi.getFlag("body-lite");
	if (cliBodyFull === true) {
		bodyVerbosity = "full";
	} else if (cliBodyLite === true) {
		bodyVerbosity = "lite";
	} else if (typeof cliBodyFull === "string") {
		const parsed = cliBodyFull.trim();
		if (parsed === "full" || parsed === "lite") bodyVerbosity = parsed as "full" | "lite";
	} else if (typeof cliBodyLite === "string") {
		const parsed = cliBodyLite.trim();
		if (parsed === "full" || parsed === "lite") bodyVerbosity = parsed as "full" | "lite";
	}

	return {
		toolOptimize,
		structuredOutput,
		maxConcurrency,
		defaultComplexity,
		steeringEnabled,
		steeringCustomPrompt,
		steeringStrategicHint,
		animationEnabled,
		animationGlitch,
		askUserEnabled,
		askUserTimeout,
		discoveredFlows,
		loadedFlowModelConfigs,
		activeRuntimeFlowMode,
		bodyVerbosity,
		projectFlowsDir: discovery.projectFlowsDir,
	};
}

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
import { parseComplexity, type Complexity, DEFAULT_COMPLEXITY } from "../flow/complexity.js";
import { logWarn } from "./log.js";
import { resolveBoolean, resolveString, resolveNumber, type ResolveContext } from "./resolver-helpers.js";

const PI_FLOW_NO_STEERING_ENV = "PI_FLOW_NO_STEERING";
const PI_FLOW_NO_STRATEGIC_HINT_ENV = "PI_FLOW_NO_STRATEGIC_HINT";
const PI_FLOW_NO_ANIMATION_ENV = "PI_FLOW_NO_ANIMATION";
const PI_FLOW_NO_GLITCH_ENV = "PI_FLOW_NO_GLITCH";
const PI_FLOW_TOOLS_TRACE_ENV = "PI_FLOW_TOOLS_TRACE";
const PI_FLOW_TOOLS_BATCH_READ_ENV = "PI_FLOW_TOOLS_BATCH_READ";
const PI_FLOW_TOOL_OPTIMIZE_ENV = "PI_FLOW_TOOL_OPTIMIZE";

export interface ResolvedSettings {
	toolOptimize: boolean; structuredOutput: boolean; maxConcurrency: number;
	defaultComplexity: Complexity; steeringEnabled: boolean;
	steeringCustomPrompt: string | undefined; steeringStrategicHint: boolean;
	animationEnabled: boolean; animationGlitch: boolean;
	askUserEnabled: boolean; askUserTimeout: number;
	discoveredFlows: FlowConfig[]; loadedFlowModelConfigs: LoadedFlowModelConfigs;
	activeRuntimeFlowMode: string | undefined; bodyVerbosity: "lite" | "full";
	debugMode: boolean; traceEnabled: boolean; batchReadEnabled: boolean;
}

export function resolveSettings(
	pi: ExtensionAPI,
	cwd: string,
): ResolvedSettings & { projectFlowsDir: string | null } {
	const inheritedCliArgs = getInheritedCliArgs();
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

	const flowSettings = loadFlowSettings(cwd);
	const ctx: ResolveContext = { pi, settings: flowSettings };

	// Resolve complexity: CLI flag > env var > settings.json > default
	let defaultComplexity: Complexity = flowSettings.complexity ?? DEFAULT_COMPLEXITY;
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

	const toolOptimize = resolveBoolean(ctx, { cliFlag: "tool-optimize", envVar: PI_FLOW_TOOL_OPTIMIZE_ENV, settingsPath: ["toolOptimize"], defaultValue: true });
	const structuredOutput = resolveBoolean(ctx, { envVar: "PI_FLOW_STRUCTURED_OUTPUT", settingsPath: ["structuredOutput"], defaultValue: true });
	let maxConcurrency = resolveNumber(ctx, { cliFlag: "flow-max-concurrency", envVar: "PI_FLOW_MAX_CONCURRENCY", settingsPath: ["maxConcurrency"], defaultValue: 4, min: 1 });
	if (typeof os.availableParallelism === "function") {
		const hwConcurrency = os.availableParallelism();
		if (hwConcurrency > 0) maxConcurrency = Math.min(maxConcurrency, hwConcurrency);
	}
	const steeringEnabled = resolveBoolean(ctx, { cliFlag: "no-steering", envVar: PI_FLOW_NO_STEERING_ENV, settingsPath: ["steering", "enabled"], defaultValue: true, invert: true });
	const steeringStrategicHint = resolveBoolean(ctx, { cliFlag: "no-strategic-hint", envVar: PI_FLOW_NO_STRATEGIC_HINT_ENV, settingsPath: ["steering", "strategicHint"], defaultValue: true, invert: true });
	const animationEnabled = resolveBoolean(ctx, { cliFlag: "no-animation", envVar: PI_FLOW_NO_ANIMATION_ENV, settingsPath: ["animation", "enabled"], defaultValue: true, invert: true });
	const animationGlitch = resolveBoolean(ctx, { cliFlag: "no-glitch", envVar: PI_FLOW_NO_GLITCH_ENV, settingsPath: ["animation", "glitch"], defaultValue: true, invert: true });
	const askUserEnabled = typeof flowSettings.askUser?.enabled === "boolean" ? flowSettings.askUser.enabled : false;
	let askUserTimeout = typeof flowSettings.askUser?.timeout === "number" ? flowSettings.askUser.timeout * 1000 : 300000;
	const envAskUserTimeout = process.env["PI_ASK_USER_TIMEOUT"];
	if (envAskUserTimeout !== undefined) {
		const parsed = Number(envAskUserTimeout);
		if (Number.isSafeInteger(parsed) && parsed >= 1) askUserTimeout = parsed * 1000;
	}
	let steeringCustomPrompt: string | undefined = undefined;
	const cliSteeringPrompt = pi.getFlag("steering-prompt");
	if (typeof cliSteeringPrompt === "string" && cliSteeringPrompt.trim()) {
		try {
			steeringCustomPrompt = fs.readFileSync(cliSteeringPrompt.trim(), "utf-8").trim();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logWarn(`[pi-agent-flow] Could not read steering-prompt file: ${msg}`);
		}
	}
	let bodyVerbosity = resolveString(ctx, { envVar: "PI_FLOW_BODY_VERBOSITY", settingsPath: ["bodyVerbosity"], defaultValue: "lite", validator: (v) => v === "lite" || v === "full" }) as "lite" | "full";
	const cliBodyFull = pi.getFlag("body-full");
	const cliBodyLite = pi.getFlag("body-lite");
	if (cliBodyFull === true) bodyVerbosity = "full";
	else if (cliBodyLite === true) bodyVerbosity = "lite";
	else if (typeof cliBodyFull === "string") { const parsed = cliBodyFull.trim(); if (parsed === "full" || parsed === "lite") bodyVerbosity = parsed as "lite" | "full"; }
	else if (typeof cliBodyLite === "string") { const parsed = cliBodyLite.trim(); if (parsed === "full" || parsed === "lite") bodyVerbosity = parsed as "lite" | "full"; }
	const debugMode = resolveBoolean(ctx, { cliFlag: "flow-debug", envVar: "PI_FLOW_DEBUG", settingsPath: ["debugMode"], defaultValue: false });
	const traceEnabled = resolveBoolean(ctx, { cliFlag: "tools-trace", envVar: PI_FLOW_TOOLS_TRACE_ENV, settingsPath: ["tools", "trace"], defaultValue: true });
	const batchReadEnabled = resolveBoolean(ctx, { cliFlag: "tools-batch-read", envVar: PI_FLOW_TOOLS_BATCH_READ_ENV, settingsPath: ["tools", "batchRead"], defaultValue: toolOptimize });

	return {
		toolOptimize, structuredOutput, maxConcurrency, defaultComplexity,
		steeringEnabled, steeringCustomPrompt, steeringStrategicHint,
		animationEnabled, animationGlitch, askUserEnabled, askUserTimeout,
		discoveredFlows, loadedFlowModelConfigs, activeRuntimeFlowMode,
		bodyVerbosity, debugMode, traceEnabled, batchReadEnabled,
		projectFlowsDir: discovery.projectFlowsDir,
	};
}

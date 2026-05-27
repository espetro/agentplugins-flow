/**
 * Settings menu item generators — extracted from settings-command.ts.
 */

import type { FlowSettings } from "../config/config.js";
import { loadFlowSettings, loadFlowModelConfigs, writeFlowModelConfig, writeGlobalFlowMode } from "../config/config.js";
import { getLoop } from "./loop.js";
import {
	Container,
	type Component,
	Input,
	SelectList,
	type SelectItem,
	Spacer,
	Text,
} from "@earendil-works/pi-tui";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SettingItem {
	id: string;
	label: string;
	description?: string;
	currentValue: string;
	values?: string[];
	submenu?: (currentValue: string, done: (selectedValue?: string) => void) => Component;
	editable?: boolean;
}

export interface SettingsListTheme {
	label: (text: string, selected: boolean) => string;
	value: (text: string, selected: boolean) => string;
	description: (text: string) => string;
	cursor: string;
	hint: (text: string) => string;
}

export type SettingsCategory =
	| "main"
	| "steering"
	| "animation"
	| "tools"
	| "session"
	| "ask-user"
	| "model-config"
	| "loop"
	| "debug"
	| "compression";

export interface TooltipSelectItem extends SelectItem {
	tooltip?: string;
}

// ---------------------------------------------------------------------------
// Module-level refs for submenu builders (set during handler call)
// ---------------------------------------------------------------------------

export const _moduleRefs = {
	modelRegistry: null as any,
	theme: null as any,
	keybindings: null as any,
};

// ---------------------------------------------------------------------------
// Menu item builders
// ---------------------------------------------------------------------------

export function getMainMenuItems(settings: FlowSettings, cwd: string): TooltipSelectItem[] {
	const steeringEnabled = settings.steering?.enabled ?? true;
	const animationEnabled = settings.animation?.enabled ?? true;
	const toolOptimize = settings.toolOptimize ?? true;
	const structuredOutput = settings.structuredOutput ?? true;
	const complexity = settings.complexity ?? "moderate";
	const askUserEnabled = settings.askUser?.enabled ?? false;
	const askUserTimeout = settings.askUser?.timeout ?? 300;

	const loaded = loadFlowModelConfigs(cwd);
	const strategyName = loaded.selectedName;
	const litePrimary = loaded.strategy.lite?.primary ?? "(default)";
	const primaryModelShort = litePrimary.includes("/") ? litePrimary.split("/").pop()! : litePrimary;

	const loop = getLoop(cwd);
	const loopDescription = loop ? `${loop.status} • ${loop.sessionCount} sessions` : "none";

	return [
		{
			value: "steering",
			label: "Steering Settings",
			description: steeringEnabled ? "enabled" : "disabled",
			tooltip: "Configure root state steering",
		},
		{
			value: "animation",
			label: "Animation Settings",
			description: animationEnabled ? "enabled" : "disabled",
			tooltip: "Toggle animation effects and glitch/scramble",
		},
		{
			value: "tools",
			label: "Tool Settings",
			description: `tool-optimize: ${toolOptimize ? "on" : "off"}, structured-output: ${structuredOutput ? "on" : "off"}, trace: ${(settings.tools?.trace ?? true) ? "on" : "off"}, batch-read: ${(settings.tools?.batchRead ?? toolOptimize) ? "on" : "off"}`,
			tooltip: "Configure tool optimization and structured output",
		},
		{
			value: "session",
			label: "Session Settings",
			description: `complexity: ${complexity} · body: ${settings.bodyVerbosity ?? "lite"}`,
			tooltip: "Set default complexity and concurrency",
		},
		{
			value: "compression",
			label: "Context Compression",
			description: `mode: ${settings.contextCompression ?? "auto"}`,
			tooltip: "Forked child context compression level",
		},
		{
			value: "ask-user",
			label: "Ask User Settings",
			description: `enabled: ${askUserEnabled ? "on" : "off"}, timeout: ${askUserTimeout}s`,
			tooltip: "Configure ask_user timeout and countdown",
		},
		{
			value: "model-config",
			label: "Model Config",
			description: `${strategyName} ▸ lite: ${primaryModelShort}`,
			tooltip: "Configure LLM models for lite, flash, and full flow tiers",
		},
		{
			value: "loop",
			label: "Loop Status",
			description: loopDescription,
			tooltip: "Endless loop state and statistics",
		},
		{
			value: "debug",
			label: "Debug Settings",
			description: `debugMode: ${settings.debugMode ?? false ? "on" : "off"}`,
			tooltip: "Write full child flow prompt to disk on every spawn",
		},
		{
			value: "reset",
			label: "Reset to Defaults",
			description: "restore all settings",
			tooltip: "Restore all flow settings to their default values",
		},
	];
}

export function getSteeringItems(settings: FlowSettings): SettingItem[] {
	const steering = settings.steering ?? {};
	return [
		{
			id: "steering.enabled",
			label: "enabled",
			description: "Toggle steering injection",
			currentValue: (steering.enabled ?? true) ? "on" : "off",
			values: ["on", "off"],
		},
		{
			id: "steering.customPrompt",
			label: "custom-prompt",
			description: "Enter custom steering prompt or type 'default' to reset",
			currentValue: steering.customPrompt ?? "(default)",
			submenu: buildInputSubmenu("Custom prompt (or 'default')", (v) => {
				const trimmed = v.trim();
				if (!trimmed || trimmed.toLowerCase() === "default") return "(default)";
				return trimmed;
			}),
		},
	];
}

export function getAnimationItems(settings: FlowSettings): SettingItem[] {
	const animation = settings.animation ?? {};
	return [
		{
			id: "animation.enabled",
			label: "enabled",
			description: "Master animation switch",
			currentValue: (animation.enabled ?? true) ? "on" : "off",
			values: ["on", "off"],
		},
		{
			id: "animation.glitch",
			label: "glitch",
			description: "Glitch/scramble effect",
			currentValue: (animation.glitch ?? true) ? "on" : "off",
			values: ["on", "off"],
		},
	];
}

export function getToolItems(settings: FlowSettings): SettingItem[] {
	return [
		{
			id: "toolOptimize",
			label: "tool-optimize",
			description: "Unified batch tool vs separate tools",
			currentValue: (settings.toolOptimize ?? true) ? "on" : "off",
			values: ["on", "off"],
		},
		{
			id: "structuredOutput",
			label: "structured-output",
			description: "Structured JSON output from flows",
			currentValue: (settings.structuredOutput ?? true) ? "on" : "off",
			values: ["on", "off"],
		},
		{
			id: "tools.trace",
			label: "trace",
			description: "Enable the trace tool",
			currentValue: (settings.tools?.trace ?? true) ? "on" : "off",
			values: ["on", "off"],
		},
		{
			id: "tools.batchRead",
			label: "batch-read",
			description: "Enable the batch_read tool",
			currentValue: (settings.tools?.batchRead ?? settings.toolOptimize ?? true) ? "on" : "off",
			values: ["on", "off"],
		},
	];
}

export function getDebugItems(settings: FlowSettings): SettingItem[] {
	return [
		{
			id: "debugMode",
			label: "emit-flow-content",
			description: "Write full child flow prompt to disk on every spawn",
			currentValue: (settings.debugMode ?? false) ? "on" : "off",
			values: ["on", "off"],
		},
	];
}

export function getCompressionItems(settings: FlowSettings): SettingItem[] {
	return [
		{
			id: "contextCompression",
			label: "context-compression",
			description: "Forked child context compression level",
			currentValue: settings.contextCompression ?? "auto",
			values: ["auto", "light", "medium", "aggressive"],
		},
	];
}

export function getSessionItems(settings: FlowSettings): SettingItem[] {
	return [
		{
			id: "bodyVerbosity",
			label: "body",
			description: "Collapsed result verbosity",
			currentValue: settings.bodyVerbosity ?? "lite",
			values: ["lite", "full"],
		},
		{
			id: "complexity",
			label: "complexity",
			description: "Complexity sets budget + review",
			currentValue: settings.complexity ?? "moderate",
			values: ["snap", "simple", "moderate", "complex", "intricate"],
		},
		{
			id: "maxConcurrency",
			label: "max-concurrency",
			description: "Maximum concurrent flows",
			currentValue: String(settings.maxConcurrency ?? 4),
			values: ["1", "2", "3", "4", "5", "6", "7", "8"],
			submenu: buildInputSubmenu("Max concurrency (1-20)", (v) => {
				const n = Number(v.trim());
				if (!Number.isSafeInteger(n) || n < 1 || n > 20) return null;
				return String(n);
			}),
		},
	];
}

export function getAskUserItems(settings: FlowSettings): SettingItem[] {
	const askUser = settings.askUser ?? {};
	return [
		{
			id: "askUser.enabled",
			label: "enabled",
			description: "Show countdown timer in ask_user prompt",
			currentValue: (askUser.enabled ?? false) ? "on" : "off",
			values: ["on", "off"],
		},
		{
			id: "askUser.timeout",
			label: "timeout",
			description: "Auto-dismiss timeout in seconds",
			currentValue: String(askUser.timeout ?? 300),
			values: ["30", "60", "120", "300", "600"],
			submenu: buildInputSubmenu("Timeout in seconds (10-3600)", (v) => {
				const n = Number(v.trim());
				if (!Number.isSafeInteger(n) || n < 10 || n > 3600) return null;
				return String(n);
			}),
		},
	];
}

export function getLoopItems(_settings: FlowSettings, cwd: string): SettingItem[] {
	const loop = getLoop(cwd);
	if (!loop) {
		return [
			{
				id: "loop.status",
				label: "status",
				description: "No active loop",
				currentValue: "none",
			},
		];
	}
	return [
		{
			id: "loop.status",
			label: "status",
			description: "Current loop status",
			currentValue: loop.status,
		},
		{
			id: "loop.objective",
			label: "objective",
			description: "Loop objective",
			currentValue: loop.objective,
		},
		{
			id: "loop.sessions",
			label: "sessions",
			description: "Number of warped sessions",
			currentValue: String(loop.sessionCount),
		},
		{
			id: "loop.flows",
			label: "flows",
			description: "Total flows across sessions",
			currentValue: String(loop.totalFlowsAcrossSessions),
		},
		{
			id: "loop.tokens",
			label: "tokens",
			description: "Total tokens across sessions",
			currentValue: String(loop.totalTokensAcrossSessions),
		},
	];
}

export function getModelConfigItems(settings: FlowSettings, cwd: string): SettingItem[] {
	const loaded = loadFlowModelConfigs(cwd);
	const strategyName = loaded.selectedName;
	const strategy = loaded.strategy;

	const items: SettingItem[] = [
		{
			id: "modelConfig.strategy",
			label: "strategy",
			description: "Active model strategy",
			currentValue: strategyName,
			values: Object.keys(loaded.configs).sort(),
		},
	];

	for (const tier of ["lite", "flash", "full"] as const) {
		const tierConfig = strategy[tier];
		const primary = tierConfig?.primary ?? "(default)";
		const failover = tierConfig?.failover?.join(", ") ?? "(none)";

		items.push({
			id: `modelConfig.${tier}.primary`,
			label: `${tier}: primary`,
			description: `Primary model for ${tier} tier`,
			currentValue: primary,
			submenu: buildModelPickerSubmenu(primary, tier, "primary"),
		});

		items.push({
			id: `modelConfig.${tier}.failover`,
			label: `${tier}: failover`,
			description: `Failover models for ${tier} tier`,
			currentValue: failover,
			submenu: buildModelPickerSubmenu(failover, tier, "failover"),
		});
	}

	return items;
}

// ---------------------------------------------------------------------------
// Submenu helpers
// ---------------------------------------------------------------------------

export function buildInputSubmenu(
	label: string,
	parseValue: (value: string) => string | null,
): (currentValue: string, done: (selectedValue?: string) => void) => Component {
	return (currentValue, done) => {
		const input = new Input();
		input.focused = true;
		input.setValue(currentValue);
		input.onSubmit = (value) => {
			const parsed = parseValue(value);
			if (parsed === null) return;
			done(parsed);
		};
		input.onEscape = () => {
			done();
		};

		const container = new Container();
		container.addChild(new Text(label, 1, 0));
		container.addChild(new Spacer(1));
		container.addChild(input);

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => input.handleInput(data),
		} as Component;
	};
}

export function buildModelPickerSubmenu(
	currentValue: string,
	tier: "lite" | "flash" | "full",
	slot: "primary" | "failover",
): (currentValue: string, done: (selectedValue?: string) => void) => Component {
	return (_currentValue, done) => {
		const models = _moduleRefs.modelRegistry?.getAvailable() ?? [];
		const items: SelectItem[] = models.map((m: any) => ({
			value: `${m.provider}/${m.id}`,
			label: `${m.provider}/${m.id}`,
			description: m.name ?? "",
		}));

		items.unshift({ value: "(default)", label: "(default)", description: "Use the default model" });

		const selectList = new SelectList(items, 15, {
			selectedPrefix: (t: string) => _moduleRefs.theme?.fg("accent", t) ?? t,
			selectedText: (t: string) => _moduleRefs.theme?.fg("accent", t) ?? t,
			description: (t: string) => _moduleRefs.theme?.fg("muted", t) ?? t,
			scrollInfo: (t: string) => _moduleRefs.theme?.fg("dim", t) ?? t,
			noMatch: (t: string) => _moduleRefs.theme?.fg("warning", t) ?? t,
		});

		selectList.onSelect = (item) => {
			done(item.value);
		};
		selectList.onCancel = () => {
			done();
		};

		return {
			render(width: number) {
				return selectList.render(width);
			},
			invalidate() {
				selectList.invalidate?.();
			},
			handleInput(data: string) {
				selectList.handleInput(data);
			},
		} as Component;
	};
}

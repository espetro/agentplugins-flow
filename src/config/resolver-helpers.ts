/**
 * Generic setting resolution helpers.
 *
 * Each resolver implements the priority: CLI flag > env var > settings.json > default.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseBoolean } from "../flow/depth.js";
import type { FlowSettings } from "./config.js";

export interface ResolveContext {
	pi: ExtensionAPI;
	settings: FlowSettings | null;
}

function getSettingsValue<T>(settings: FlowSettings | null, path: string[]): T | undefined {
	if (!settings) return undefined;
	let current: unknown = settings;
	for (const key of path) {
		if (current === null || current === undefined || typeof current !== "object" || Array.isArray(current)) {
			return undefined;
		}
		current = (current as Record<string, unknown>)[key];
	}
	return current as T;
}

/**
 * Resolve a boolean setting with priority: CLI flag > env var > settings.json > default.
 * @param invert - If true, env var "1" means false (e.g., PI_FLOW_NO_STEERING=1 disables steering)
 */
export function resolveBoolean(
	ctx: ResolveContext,
	opts: {
		cliFlag?: string;
		envVar?: string;
		settingsPath?: string[];
		defaultValue: boolean;
		invert?: boolean;
	},
): boolean {
	let value = opts.defaultValue;

	// settings.json
	if (opts.settingsPath) {
		const settingsValue = getSettingsValue<boolean>(ctx.settings, opts.settingsPath);
		if (typeof settingsValue === "boolean") {
			value = settingsValue;
		}
	}

	// env var
	if (opts.envVar) {
		const envRaw = process.env[opts.envVar];
		if (envRaw !== undefined) {
			const parsed = parseBoolean(envRaw);
			if (parsed !== null) {
				value = opts.invert ? !parsed : parsed;
			}
		}
	}

	// CLI flag
	if (opts.cliFlag) {
		const cliRaw = ctx.pi.getFlag(opts.cliFlag);
		if (typeof cliRaw === "boolean") {
			value = opts.invert ? !cliRaw : cliRaw;
		} else if (typeof cliRaw === "string") {
			const parsed = parseBoolean(cliRaw);
			if (parsed !== null) {
				value = opts.invert ? !parsed : parsed;
			}
		}
	}

	return value;
}

/**
 * Resolve a string setting with priority: CLI flag > env var > settings.json > default.
 */
export function resolveString(
	ctx: ResolveContext,
	opts: {
		cliFlag?: string;
		envVar?: string;
		settingsPath?: string[];
		defaultValue: string;
		validator?: (value: string) => boolean;
	},
): string {
	let value = opts.defaultValue;

	// settings.json
	if (opts.settingsPath) {
		const settingsValue = getSettingsValue<string>(ctx.settings, opts.settingsPath);
		if (typeof settingsValue === "string" && (!opts.validator || opts.validator(settingsValue))) {
			value = settingsValue;
		}
	}

	// env var
	if (opts.envVar) {
		const envRaw = process.env[opts.envVar];
		if (envRaw !== undefined && envRaw.trim() !== "") {
			const trimmed = envRaw.trim();
			if (!opts.validator || opts.validator(trimmed)) {
				value = trimmed;
			}
		}
	}

	// CLI flag
	if (opts.cliFlag) {
		const cliRaw = ctx.pi.getFlag(opts.cliFlag);
		if (typeof cliRaw === "string") {
			const trimmed = cliRaw.trim();
			if (!opts.validator || opts.validator(trimmed)) {
				value = trimmed;
			}
		}
	}

	return value;
}

/**
 * Resolve a number setting with priority: CLI flag > env var > settings.json > default.
 */
export function resolveNumber(
	ctx: ResolveContext,
	opts: {
		cliFlag?: string;
		envVar?: string;
		settingsPath?: string[];
		defaultValue: number;
		min?: number;
		max?: number;
	},
): number {
	let value = opts.defaultValue;

	// settings.json
	if (opts.settingsPath) {
		const settingsValue = getSettingsValue<number>(ctx.settings, opts.settingsPath);
		if (typeof settingsValue === "number" && Number.isSafeInteger(settingsValue)) {
			value = settingsValue;
		}
	}

	// env var
	if (opts.envVar) {
		const envRaw = process.env[opts.envVar];
		if (envRaw !== undefined) {
			const parsed = Number(envRaw);
			if (!Number.isNaN(parsed) && Number.isSafeInteger(parsed)) {
				value = parsed;
			}
		}
	}

	// CLI flag
	if (opts.cliFlag) {
		const cliRaw = ctx.pi.getFlag(opts.cliFlag);
		if (typeof cliRaw === "number" && Number.isSafeInteger(cliRaw)) {
			value = cliRaw;
		} else if (typeof cliRaw === "string") {
			const parsed = Number(cliRaw);
			if (!Number.isNaN(parsed) && Number.isSafeInteger(parsed)) {
				value = parsed;
			}
		}
	}

	// Clamp
	if (opts.min !== undefined) {
		value = Math.max(value, opts.min);
	}
	if (opts.max !== undefined) {
		value = Math.min(value, opts.max);
	}

	return value;
}

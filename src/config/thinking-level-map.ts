/**
 * Adaptive thinking level mapping.
 *
 * Maps unsupported / provider-specific thinking levels to the closest
 * valid value for child pi processes. Falls back to a static nearest-
 * neighbour map when provider-specific model info is unavailable.
 */

import { logWarn } from "./log.js";

/** Canonical thinking levels accepted by the majority of providers. */
export const CANONICAL_THINKING_LEVELS = ["low", "medium", "high"] as const;

export type CanonicalThinkingLevel = (typeof CANONICAL_THINKING_LEVELS)[number];

/**
 * Static nearest-neighbour mapping for known non-canonical values.
 */
const STATIC_THINKING_LEVEL_MAP: Record<string, CanonicalThinkingLevel> = {
	// Mappings to "low"
	none: "low",
	off: "low",
	minimal: "low",
	light: "low",
	small: "low",
	basic: "low",
	// Mappings to "medium"
	moderate: "medium",
	standard: "medium",
	normal: "medium",
	// Mappings to "high"
	heavy: "high",
	max: "high",
	maximum: "high",
	deep: "high",
	aggressive: "high",
	intense: "high",
};

/**
 * Map a thinking level string to a canonical value.
 *
 * @param level               Raw thinking level (e.g. "minimal").
 * @param modelThinkingLevelMap Optional provider-specific map from the
 *                              model definition (e.g. models.json).
 * @returns Canonical level, or `null` when the value is unmappable.
 */
export function mapThinkingLevel(
	level: string,
	modelThinkingLevelMap?: Record<string, string>,
): CanonicalThinkingLevel | null {
	const normalized = level.trim().toLowerCase();

	// Already canonical — pass through unchanged.
	if (CANONICAL_THINKING_LEVELS.includes(normalized as CanonicalThinkingLevel)) {
		return normalized as CanonicalThinkingLevel;
	}

	// Provider-aware mapping (e.g. models.json thinkingLevelMap).
	if (modelThinkingLevelMap) {
		const providerMapped = modelThinkingLevelMap[normalized];
		if (providerMapped) {
			const canonical = providerMapped.trim().toLowerCase();
			if (CANONICAL_THINKING_LEVELS.includes(canonical as CanonicalThinkingLevel)) {
				return canonical as CanonicalThinkingLevel;
			}
		}
	}

	// Static nearest-neighbour fallback.
	const staticMapped = STATIC_THINKING_LEVEL_MAP[normalized];
	if (staticMapped) {
		logWarn(
			`[pi-agent-flow] Thinking level "${level}" is not supported. Mapped to nearest neighbour "${staticMapped}".`,
		);
		return staticMapped;
	}

	// Unmappable — return null so the caller can omit the flag.
	logWarn(
		`[pi-agent-flow] Thinking level "${level}" is not supported and has no known mapping. Omitting --thinking.`,
	);
	return null;
}

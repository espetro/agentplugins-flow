/**
 * Complexity system — replaces sessionMode.
 *
 * Complexity is the single decider for:
 *   - session timeout budget
 *   - implied auditLoop (auto-review cycles for build flows)
 */

export const COMPLEXITY_VALUES = ["snap", "simple", "moderate", "complex", "intricate"] as const;

export type Complexity = typeof COMPLEXITY_VALUES[number];

export const DEFAULT_COMPLEXITY: Complexity = "moderate";

export interface ComplexityConfig {
	timeoutMs: number;
	impliedAuditLoop: number;
}

export const COMPLEXITY_MAP: Record<Complexity, ComplexityConfig> = {
	snap:       { timeoutMs: 120_000, impliedAuditLoop: 0 },
	simple:     { timeoutMs: 300_000, impliedAuditLoop: 0 },
	moderate:   { timeoutMs: 600_000, impliedAuditLoop: 1 },
	complex:    { timeoutMs: 900_000, impliedAuditLoop: 2 },
	intricate:  { timeoutMs: 1_200_000, impliedAuditLoop: 3 },
};

export function getComplexityTimeoutMs(complexity: Complexity): number {
	return COMPLEXITY_MAP[complexity].timeoutMs;
}

export function getImpliedAuditLoop(complexity: Complexity): number {
	return COMPLEXITY_MAP[complexity].impliedAuditLoop;
}

export function parseComplexity(value: unknown): Complexity | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	return (COMPLEXITY_VALUES as readonly string[]).includes(normalized)
		? normalized as Complexity
		: undefined;
}

export function resolveComplexity(
	value: unknown,
	fallback: Complexity = DEFAULT_COMPLEXITY,
): Complexity {
	return parseComplexity(value) ?? fallback;
}

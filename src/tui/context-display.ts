import type { UsageStats } from "../types/flow.js";

/** Rough context size before the child prompt is built (fork + intent + activation). */
export function computeInitialContextTokens(
	sharedContext: { totalTokens?: number } | undefined,
	intent: string,
	prompt?: string,
	activationOverhead = 10_000,
): number {
	const forked = sharedContext?.totalTokens ?? 0;
	const intentTokens = Math.floor(intent.length / 4);
	const promptTokens = prompt ? Math.floor(prompt.length / 4) : 0;
	return forked + intentTokens + promptTokens + activationOverhead;
}

/**
 * Resolve the context token count to show in flow/trace headers.
 * Prefers live flow usage, then forked shared-context snapshot, then a coarse
 * fallback from per-turn input+output when providers omit totalTokens.
 */
export function resolveDisplayContextTokens(
	usage: Pick<UsageStats, "contextTokens" | "input" | "output">,
	sharedContext?: { totalTokens: number },
): number {
	const fromUsage = usage.contextTokens || 0;
	const fromShared = sharedContext?.totalTokens || 0;
	let ctx = Math.max(fromShared, fromUsage);
	if (ctx <= 0 && (usage.input > 0 || usage.output > 0)) {
		ctx = usage.input + usage.output;
	}
	return ctx;
}

/** Merge streaming context estimate into usage (max with baseline). */
export function mergeStreamingContextTokens(
	usage: Pick<UsageStats, "contextTokens" | "input" | "output">,
	ctxEstimate: number,
	sharedContext?: { totalTokens: number },
): number {
	const resolved = resolveDisplayContextTokens(usage, sharedContext);
	if (ctxEstimate <= 0 && resolved <= 0) return resolved;
	return Math.max(resolved, ctxEstimate);
}

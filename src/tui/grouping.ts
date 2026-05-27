import type { SingleResult } from "../types/flow.js";
import type { FlowTheme } from "./flow-colors.js";
import { hashNoise, THIN_BRAILLE_SPARK } from "./scramble/index.js";

type ThemeFg = (color: string, text: string) => string;

export function getFlowStatus(r: SingleResult): string {
	return r.status ?? (r.exitCode === -1 ? "running" : r.exitCode === 0 ? "done" : "error");
}

export function isFlowStatusComplete(r: SingleResult): boolean {
	const status = getFlowStatus(r);
	return status === "done" || status === "error" || status === "skipped";
}

export function isFlowRunning(r: SingleResult): boolean {
	const status = getFlowStatus(r);
	return status === "running" || status === "pending";
}

export function isFlowAwaiting(r: SingleResult): boolean {
	return getFlowStatus(r) === "awaiting";
}

export interface FlowGroup {
  /** indices into results[] that are builds in this group */
  buildIndices: number[];
  /** index into results[] of the capstone audit */
  auditIndex: number;
}

export interface GroupDetectionResult {
  groups: FlowGroup[];
  /** indices into results[] of standalone flows not in any group */
  rootIndices: number[];
}

export function detectGroups(results: SingleResult[]): GroupDetectionResult {
  const groups: FlowGroup[] = [];
  const rootIndices: number[] = [];

  // Phase 1: explicit grouping by auditLoopGroupId
  const groupMap = new Map<number, { buildIndices: number[]; auditIndex: number }>();
  const ungroupedIndices: number[] = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.auditLoopGroupId !== undefined) {
      let g = groupMap.get(r.auditLoopGroupId);
      if (!g) {
        g = { buildIndices: [], auditIndex: -1 };
        groupMap.set(r.auditLoopGroupId, g);
      }
      if (r.pingPongMeta) {
        g.buildIndices.push(i);
      } else if (r.auditParentType === "build") {
        g.auditIndex = i;
      }
    } else {
      ungroupedIndices.push(i);
    }
  }

  for (const g of groupMap.values()) {
    if (g.auditIndex !== -1) {
      groups.push({ buildIndices: g.buildIndices, auditIndex: g.auditIndex });
    } else {
      // Orphaned builds with groupId but no audit capstone
      rootIndices.push(...g.buildIndices);
    }
  }

  // Phase 2: legacy fallback on ungrouped results (contiguity-based)
  let i = 0;
  while (i < ungroupedIndices.length) {
    const idx = ungroupedIndices[i];
    const r = results[idx];

    if (r.pingPongMeta) {
      const buildIndices: number[] = [];
      while (i < ungroupedIndices.length && results[ungroupedIndices[i]].pingPongMeta) {
        buildIndices.push(ungroupedIndices[i]);
        i++;
      }
      if (i < ungroupedIndices.length && results[ungroupedIndices[i]].auditParentType === "build") {
        groups.push({ buildIndices, auditIndex: ungroupedIndices[i] });
        i++;
      } else {
        rootIndices.push(...buildIndices);
      }
    } else if (r.auditParentType === "build" && i > 0 && results[ungroupedIndices[i - 1]].pingPongMeta) {
      i++; // orphan audit already consumed
    } else {
      rootIndices.push(idx);
      i++;
    }
  }

  return { groups, rootIndices };
}

export function flowStatusIcon(r: SingleResult, theme: { fg: ThemeFg }): string {
	const status = getFlowStatus(r);
	switch (status) {
		case "running":
		case "pending":
			return theme.fg("warning", "●");
		case "awaiting":
			return theme.fg("muted", "○");
		case "done":
			return theme.fg("success", "●");
		case "error":
			return theme.fg("error", "✗");
		case "skipped":
			return theme.fg("muted", "⊘");
		default:
			return theme.fg("muted", "?");
	}
}

export function hashStrToSeed(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

export function getScintillatingStatusDot(r: SingleResult, theme: { fg: ThemeFg }, now: number, flowId?: string): string {
	const status = getFlowStatus(r);
	switch (status) {
		case "running":
		case "pending": {
			const isPending = status === "pending";
			const seed = hashStrToSeed(flowId || r.type);
			const bucketSize = isPending ? 7000 : 5000;
			const bucket = Math.floor(now / bucketSize);
			const t = now % bucketSize;

			const burstCount = isPending
				? 1 + Math.floor(hashNoise(seed, bucket, 0, 0x5a4f) * 2) // 1-2
				: 2 + Math.floor(hashNoise(seed, bucket, 0, 0x5a4f) * 2); // 2-3

			let cursor = 50;
			for (let b = 0; b < burstCount; b++) {
				const gap = isPending
					? 800 + Math.floor(hashNoise(seed, bucket, b * 4, 0xb8a0) * 1400) // 800-2200ms
					: 500 + Math.floor(hashNoise(seed, bucket, b * 4, 0xb8a0) * 1300);  // 500-1800ms
				cursor += gap;
				const duration = isPending
					? 80 + Math.floor(hashNoise(seed, bucket, b * 4 + 1, 0xc0de) * 170)  // 80-250ms
					: 100 + Math.floor(hashNoise(seed, bucket, b * 4 + 1, 0xc0de) * 250); // 100-350ms
				const burstStart = cursor;
				const burstEnd = cursor + duration;
				cursor = burstEnd;

				if (t >= burstStart && t < burstEnd) {
					const tInBurst = t - burstStart;
					const tick = 12 + Math.floor(hashNoise(seed, bucket, b * 4 + 3, 0xd1a0) * 10); // 12-22ms per stutter step

					// Vary stutter depth: 3-tick ○●○ or 5-tick ○●○●○ per burst
					const rawStutterTicks = hashNoise(seed, bucket, b * 4 + 2, 0xe7a1) > 0.5 ? 5 : 3;
					const stutterLen5 = tick * 5;
					const onRunMax5 = duration - stutterLen5 - 5;
					const stutterTicks = (rawStutterTicks === 5 && onRunMax5 >= tick) ? 5 : 3;
					const stutterLen = tick * stutterTicks;

					const onRunMax = duration - stutterLen - 5;
					const onRun = Math.max(tick, Math.min(
						Math.floor(duration * (0.35 + hashNoise(seed, bucket, b * 4 + 2, 0xf1c0) * 0.3)),
						onRunMax
					));
					const cycleLen = onRun + stutterLen;
					const phaseInCycle = tInBurst % cycleLen;
					const cycleIdx = Math.floor(tInBurst / cycleLen);

					// Helper: dip ○ with occasional sparkle
					const dipDot = (dipIndex: number): string => {
						if (hashNoise(seed, bucket, cycleIdx + dipIndex * 100, 0x5ab0) < 0.05) {
							const sparkIdx = Math.floor(hashNoise(seed, bucket, cycleIdx + dipIndex * 100, 0x5b1) * THIN_BRAILLE_SPARK.length);
							return theme.fg("muted", THIN_BRAILLE_SPARK[sparkIdx]);
						}
						return theme.fg("muted", "○");
					};

					if (phaseInCycle < onRun) {
						// Sustained bright ●
						return theme.fg("warning", "●");
					} else if (phaseInCycle < onRun + tick) {
						return dipDot(0); // ○ dip 1
					} else if (phaseInCycle < onRun + tick * 2) {
						return theme.fg("warning", "●"); // ● flash 1
					} else if (phaseInCycle < onRun + tick * 3) {
						return dipDot(1); // ○ dip 2
					} else if (stutterTicks >= 5 && phaseInCycle < onRun + tick * 4) {
						return theme.fg("warning", "●"); // ● flash 2 (5-tick only)
					} else if (stutterTicks >= 5 && phaseInCycle < onRun + tick * 5) {
						return dipDot(2); // ○ dip 3 (5-tick only)
					} else {
						// Fallback: shouldn't reach if scheduling is correct
						return theme.fg("warning", "●");
					}
				}
			}
			return theme.fg("warning", "●");
		}
		case "awaiting":
			return theme.fg("muted", "○");
		case "done":
			return theme.fg("success", "●");
		case "error":
			return theme.fg("error", "✗");
		case "skipped":
			return theme.fg("muted", "⊘");
		default:
			return theme.fg("muted", "?");
	}
}

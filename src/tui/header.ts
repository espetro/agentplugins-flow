import * as os from "node:os";
import { Container } from "@earendil-works/pi-tui";
import type { FlowColorConfig, FlowTheme } from "./flow-colors.js";
import { applyRole } from "./flow-colors.js";
import { formatModelLabel, formatTps, resolveDisplayContextTokens, stripAnsi } from "./render-utils.js";
import { getFlowLiveState } from "./flow-live-state.js";
import { scrambleManager, DynamicScrambleText } from "./scramble/index.js";
import { isFlowError } from "../types/flow.js";
import type { SingleResult } from "../types/flow.js";
import { shortenPath, applyScrambledContextLabel } from "./traces.js";
import { flowStatusIcon, getScintillatingStatusDot, isFlowStatusComplete } from "./grouping.js";

function formatCollapsedFlowHeaderTypeName(type: string): string {
	return type.toLowerCase();
}

/** Center a label in a fixed-width header using em-dashes. Total width = 20. */
function sectionHeader(label: string): string {
	const total = 20;
	const innerLen = label.length + 2; // account for spaces around label
	const side = (total - innerLen) / 2;
	const left = "─".repeat(Math.floor(side));
	const right = "─".repeat(Math.ceil(side));
	return `${left} ${label} ${right}`;
}

/** Single segment of a multi-part header with its original plain length and style. */
export interface HeaderSegment {
	text: string;
	style: (text: string) => string;
}

/** Reconstruct multi-segment ANSI styles on a flat string by splitting at
 *  original segment boundaries and re-applying each segment's style function.
 */
export function reconstructHeader(content: string, segments: HeaderSegment[]): string {
	let offset = 0;
	const parts: string[] = [];
	for (const seg of segments) {
		const len = seg.text.length;
		if (offset >= content.length) break;
		parts.push(seg.style(content.slice(offset, offset + len)));
		offset += len;
	}
	if (offset < content.length) {
		parts.push(content.slice(offset));
	}
	return parts.join("");
}

function renderFlowHeader(
	container: Container,
	r: SingleResult,
	flowId: string,
	headerPrefix: string,
	theme: FlowTheme,
	now: number,
	config?: FlowColorConfig,
	sharedContext?: {
		messageCount: number;
		userMessageCount: number;
		assistantMessageCount: number;
		toolCalls: Record<string, number>;
		totalTokens: number;
		preview: string;
	},
): void {
	const typeName = formatCollapsedFlowHeaderTypeName(r.type);
	const modelLabel = formatModelLabel(r.model);
	const isComplete = isFlowStatusComplete(r);
	const flowComplete = isComplete;
	const error = isFlowError(r);
	const errorSegment = error && r.stopReason ? ` [${r.stopReason}]` : "";
	const initialDot = flowStatusIcon(r, theme);
	const dotPlaceholder = stripAnsi(initialDot) + ' ';

	let headerLine: string;
	let plainHeader: string;
	const headerSegments: HeaderSegment[] = [
		{ text: headerPrefix + " ", style: (s) => applyRole("treeChars", s, theme, config) },
		{ text: dotPlaceholder, style: (_s) => getScintillatingStatusDot(r, theme, Date.now(), flowId) + " " },
		{ text: typeName, style: (s) => applyRole("flowName", s, theme, config) },
	];

	{
		// Standard flow: model + stats
		const statsParts: string[] = [];
		const liveState = getFlowLiveState(flowId);
		const ctxTokens = Math.max(
			resolveDisplayContextTokens(r.usage, sharedContext),
			liveState?.contextTokens ?? 0,
		);
		let displayStats = "";
		if (r.maxContextTokens !== undefined || ctxTokens > 0) {
			const ctxLabel = applyScrambledContextLabel(flowId, ctxTokens, r.maxContextTokens, now, flowComplete);
			statsParts.push(ctxLabel);
			displayStats = statsParts.join(" · ");
		}
		if (r.usage.smoothedTps && r.usage.smoothedTps > 0) {
			const tpsFormatted = formatTps(r.usage.smoothedTps);
			statsParts.push(tpsFormatted);
			displayStats = statsParts.join(" · ");

			const tpsNum = tpsFormatted.slice(0, -4); // remove " t/s" suffix
			const scrambledTps = scrambleManager.updateHeaderMetric(flowId, "tps", tpsNum, now, flowComplete, true);
			if (scrambledTps !== tpsNum) {
				displayStats = displayStats.replace(`${tpsNum} t/s`, `${scrambledTps} t/s`);
			}
		}

		const modelSegment = modelLabel ? `  ${modelLabel}` : "";
		const statsSegment = ` · ${displayStats}`;
		const statsPlain = stripAnsi(statsSegment);
		headerLine = `${applyRole("treeChars", headerPrefix, theme, config)} ${initialDot} ${applyRole("flowName", typeName, theme, config)}${applyRole("modelName", modelSegment, theme, config)}${applyRole("stats", statsSegment, theme, config)}`;
		if (errorSegment) {
			headerLine += ` ${theme.fg("error", errorSegment)}`;
		}
		plainHeader = headerPrefix + " " + dotPlaceholder + typeName + modelSegment + statsPlain + errorSegment;
		headerSegments.push(
			{ text: modelSegment, style: (s) => applyRole("modelName", s, theme, config) },
			{ text: statsPlain, style: (s) => applyRole("stats", s, theme, config) },
		);
	}
	if (errorSegment) {
		headerSegments.push({ text: errorSegment, style: (s) => theme.fg("error", s) });
	}
	container.addChild(new DynamicScrambleText(
		headerLine,
		() => {
			const now = Date.now();
			const result = scrambleManager.updateText(flowId, 'header', plainHeader, now, flowComplete, true);
			return reconstructHeader(result.content, headerSegments);
		},
		true,
	));
}

export { formatCollapsedFlowHeaderTypeName, sectionHeader, renderFlowHeader };

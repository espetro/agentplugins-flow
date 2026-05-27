import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text, TruncatedText } from "@earendil-works/pi-tui";
import type { FlowColorConfig, FlowTheme } from "./flow-colors.js";
import { applyRole } from "./flow-colors.js";
import { formatCompactStats, formatFlowTypeName, lowerFirstWord, truncateChars, tailText, getTruncationBudget, visibleLength, stripAnsi, formatModelLabel, resolveDisplayContextTokens, formatTps } from "./render-utils.js";
import { getFlowSummaryText } from "../snapshot/runner-events.js";
import type { SingleResult, FlowDetails } from "../types/flow.js";
import { aggregateFlowUsage, getFlowOutput, isFlowError, isFlowSuccess } from "../types/flow.js";
import type { DisplayItem } from "../types/ui.js";
import { getFlowDisplayItems, getLastToolCall, getLastAssistantText } from "../types/ui.js";
import { getFlowLiveState, buildBootPhaseSingleResult } from "./flow-live-state.js";
import { scrambleManager, DynamicScrambleText } from "./scramble/index.js";
import { sectionHeader, reconstructHeader, HeaderSegment, formatCollapsedFlowHeaderTypeName } from "./header.js";
import { flowStatusIcon, getScintillatingStatusDot, isFlowAwaiting, isFlowRunning, isFlowStatusComplete } from "./grouping.js";
import { getContentRole, formatFlowToolCall, splitOutputLines, renderToolTraces, renderFlowReport, applyScrambledContextLabel, getLiveTextWithFallback } from "./traces.js";

function renderFlowExpanded(
	r: SingleResult,
	icon: string,
	error: boolean,
	displayItems: DisplayItem[],
	flowOutput: string,
	theme: FlowTheme,
	id: string,
	now: number,
	isComplete: boolean,
	streamingText?: string,
	config?: FlowColorConfig,
	sharedContext?: {
		messageCount: number;
		userMessageCount: number;
		assistantMessageCount: number;
		toolCalls: Record<string, number>;
		totalTokens: number;
		preview: string;
	},
): Container {
	const mdTheme = getMarkdownTheme();
	const container = new Container();

	const typeName = formatFlowTypeName(r.type);

	if (sharedContext) {
		container.addChild(new Text(applyRole("prefixLabel", "── shared context ──", theme, config), 0, 0));
		container.addChild(new Text(applyRole("aimContent", sharedContext.preview, theme, config), 0, 0));
		const statsParts: string[] = [];
		statsParts.push(`${sharedContext.userMessageCount} user`);
		statsParts.push(`${sharedContext.assistantMessageCount} assistant`);
		statsParts.push(`${sharedContext.totalTokens} tokens`);
		for (const [name, count] of Object.entries(sharedContext.toolCalls)) {
			statsParts.push(`${count}× ${name}`);
		}
		container.addChild(new Text(applyRole("stats", statsParts.join(" · "), theme, config), 0, 0));
		container.addChild(new Spacer(1));
		container.addChild(new Text(applyRole("prefixLabel", sectionHeader(typeName), theme, config), 0, 0));
		container.addChild(new Spacer(1));
	}
	const initialDot = flowStatusIcon(r, theme);
	let header = `${initialDot} ${applyRole("flowName", typeName, theme, config)}`;
	const errorSegment = error && r.stopReason ? ` [${r.stopReason}]` : "";
	if (errorSegment) header += ` ${theme.fg("error", errorSegment)}`;
	const dotPlaceholder = stripAnsi(initialDot) + ' ';
	const plainHeader = dotPlaceholder + typeName + errorSegment;
	const headerSegments: HeaderSegment[] = [
		{ text: dotPlaceholder, style: (_s) => getScintillatingStatusDot(r, theme, Date.now(), id) + " " },
		{ text: typeName, style: (s) => applyRole("flowName", s, theme, config) },
	];
	if (errorSegment) {
		headerSegments.push({ text: errorSegment, style: (s) => theme.fg("error", s) });
	}
	container.addChild(new DynamicScrambleText(
		header,
		() => {
			const now = Date.now();
			const result = scrambleManager.updateText(id, 'header', plainHeader, now, isComplete);
			return reconstructHeader(result.content, headerSegments);
		}
	));
	if (error && r.errorMessage) {
		container.addChild(new Text(scrambleManager.renderStatic(theme.fg("error", `Error: ${r.errorMessage}`)), 0, 0));
	}

	// Stats: dashboard format
	const displayUsage = sharedContext ? { ...r.usage, input: sharedContext.totalTokens } : r.usage;
	const inlineStats = formatCompactStats(displayUsage, r.model);
	container.addChild(new DynamicScrambleText(
		applyRole("stats", inlineStats, theme, config),
		() => {
			const result = scrambleManager.updateText(id, 'stats', stripAnsi(inlineStats), Date.now(), isComplete);
			return result.isAnimating ? applyRole("stats", result.content, theme, config) : applyRole("stats", inlineStats, theme, config);
		}
	));

	// Intent — column-aware truncation (budget recalculated inside closure for resize handling)
	const intentBudget = getTruncationBudget(0);
	const displayIntent = truncateChars(r.intent, intentBudget);
	container.addChild(new Spacer(1));
	container.addChild(new Text(applyRole("prefixLabel", sectionHeader("intent"), theme, config), 0, 0));
	container.addChild(new DynamicScrambleText(
		applyRole("aimContent", displayIntent, theme, config),
		() => {
			const budget = getTruncationBudget(0);
			const text = truncateChars(r.intent, budget);
			const result = scrambleManager.updateText(id, 'intent', text, Date.now(), isComplete);
			return result.isAnimating ? applyRole("aimContent", result.content, theme, config) : applyRole("aimContent", text, theme, config);
		}
	));

	// Acceptance
	if (r.acceptance) {
		const acceptanceRaw = r.acceptance;
		const acceptanceBudget = getTruncationBudget(0);
		const acceptanceText = truncateChars(acceptanceRaw, acceptanceBudget);
		container.addChild(new Spacer(1));
		container.addChild(new Text(applyRole("prefixLabel", sectionHeader("acceptance"), theme, config), 0, 0));
		container.addChild(new DynamicScrambleText(
			applyRole("aimContent", acceptanceText, theme, config),
			() => {
				const budget = getTruncationBudget(0);
				const text = truncateChars(acceptanceRaw, budget);
				const result = scrambleManager.updateText(id, 'acceptance', text, Date.now(), isComplete);
				return result.isAnimating ? applyRole("aimContent", result.content, theme, config) : applyRole("aimContent", text, theme, config);
			}
		));
	}

	// Flow report (structured output)
	container.addChild(new Spacer(1));
	container.addChild(new Text(applyRole("prefixLabel", sectionHeader("report"), theme, config), 0, 0));

	// Structured output summary (compact badge when available)
	if (r.structuredOutput) {
		const so = r.structuredOutput;
		const statusColor = so.status === "complete" ? "success" : so.status === "partial" ? "warning" : "error";
		const statusText = `[${so.status}] ${so.summary}`;
		const statusStatic = `${theme.fg(statusColor, `[${so.status}]`)} ${applyRole("aimContent", so.summary, theme, config)}`;
		container.addChild(new DynamicScrambleText(
			statusStatic,
			() => {
				const result = scrambleManager.updateText(id, 'report-status', statusText, Date.now(), isComplete, false);
				return result.isAnimating ? `${theme.fg(statusColor, result.content.split(' ')[0])} ${applyRole("aimContent", result.content.slice(result.content.indexOf(' ') + 1), theme, config)}` : statusStatic;
			}
		));
		if (so.files.length > 0) {
			const filesText = `Files: ${so.files.map((f) => f.path).join(", ")}`;
			container.addChild(new DynamicScrambleText(
				applyRole("aimContent", filesText, theme, config),
				() => {
					const result = scrambleManager.updateText(id, 'report-files', filesText, Date.now(), isComplete, false);
					return result.isAnimating ? applyRole("aimContent", result.content, theme, config) : applyRole("aimContent", filesText, theme, config);
				}
			));
		}
		if (so.commands?.length > 0) {
			const cmdLabels = so.commands.map((c) => {
				const short = c.command.length > 30 ? c.command.slice(0, 30) + "..." : c.command;
				return `${c.tool ?? "cmd"}: ${short}`;
			});
			const commandsText = `Commands: ${cmdLabels.join(", ")}`;
			container.addChild(new DynamicScrambleText(
				applyRole("aimContent", commandsText, theme, config),
				() => {
					const result = scrambleManager.updateText(id, 'report-commands', commandsText, Date.now(), isComplete, false);
					return result.isAnimating ? applyRole("aimContent", result.content, theme, config) : applyRole("aimContent", commandsText, theme, config);
				}
			));
		}
		if (so.notDone.length > 0) {
			const notDoneText = `Not Done: ${so.notDone.map((item) => {
				const details = [
					item.reason ? `reason: ${item.reason}` : undefined,
					item.blocker ? `blocker: ${item.blocker}` : undefined,
					item.nextStep ? `next: ${item.nextStep}` : undefined,
				].filter(Boolean).join("; ");
				return details ? `${item.item} (${details})` : item.item;
			}).join("; ")}`;
			container.addChild(new DynamicScrambleText(
				applyRole("aimContent", notDoneText, theme, config),
				() => {
					const result = scrambleManager.updateText(id, 'report-notDone', notDoneText, Date.now(), isComplete, false);
					return result.isAnimating ? applyRole("aimContent", result.content, theme, config) : applyRole("aimContent", notDoneText, theme, config);
				}
			));
		}
		if (so.nextSteps.length > 0) {
			const nextStepsText = `Next: ${so.nextSteps.join("; ")}`;
			container.addChild(new DynamicScrambleText(
				applyRole("aimContent", nextStepsText, theme, config),
				() => {
					const result = scrambleManager.updateText(id, 'report-nextSteps', nextStepsText, Date.now(), isComplete, false);
					return result.isAnimating ? applyRole("aimContent", result.content, theme, config) : applyRole("aimContent", nextStepsText, theme, config);
				}
			));
		}
		container.addChild(new Spacer(1));
	}

	// Output: animate streaming text; show clean markdown when complete
	if (isFlowAwaiting(r)) {
		container.addChild(new Text(applyRole("placeholder", "[awaiting...]", theme, config), 0, 0));
	} else if (!isComplete && streamingText != null) {
		const msgBudget = getTruncationBudget(0);
		const displayMsg = tailText(stripAnsi(streamingText), msgBudget);
		container.addChild(new DynamicScrambleText(
			applyRole("msgContent", displayMsg, theme, config),
			() => {
				const budget = getTruncationBudget(0);
				const freshStreamingText = getLiveTextWithFallback(id) ?? streamingText;
				const text = tailText(stripAnsi(freshStreamingText), budget);
				const result = scrambleManager.updateMsg(id, text, Date.now(), isComplete, undefined, true);
				return result.isAnimating ? applyRole("msgContent", result.content, theme, config) : applyRole("msgContent", text, theme, config);
			}
		));
	} else if (flowOutput) {
		container.addChild(new Markdown(flowOutput.trim(), 0, 0, mdTheme));
	} else {
		const summary = getFlowSummaryText(r);
		container.addChild(new DynamicScrambleText(
			applyRole("msgContent", summary, theme, config),
			() => {
				const result = scrambleManager.updateText(id, 'output-summary', summary, Date.now(), isComplete, false);
				return result.isAnimating ? applyRole("msgContent", result.content, theme, config) : applyRole("msgContent", summary, theme, config);
			}
		));
	}

	// Tool traces (expanded only) — per-line scramble
	const toolCallItems = displayItems.filter((item) => item.type === "toolCall");
	if (toolCallItems.length > 0) {
		container.addChild(new Spacer(1));
		container.addChild(new Text(applyRole("prefixLabel", sectionHeader("tool calls"), theme, config), 0, 0));
		const toolPrefixLen = visibleLength("→ ");
		const toolBudget = getTruncationBudget(toolPrefixLen);
		for (let i = 0; i < toolCallItems.length; i++) {
			const item = toolCallItems[i] as Extract<DisplayItem, { type: "toolCall" }>;
			const lineText = applyRole("prefixLabel", "→ ", theme, config) + formatFlowToolCall(item.name, item.args, theme.fg.bind(theme));
			const plainText = stripAnsi(lineText);
			const displayTool = truncateChars(plainText, toolBudget);
			const initialScrambled = scrambleManager.updateText(id, `tool#${i}`, displayTool, now, isComplete).content;
			container.addChild(new DynamicScrambleText(
				initialScrambled,
				() => {
					const budget = getTruncationBudget(toolPrefixLen);
					const freshPlain = stripAnsi(lineText);
					const text = truncateChars(freshPlain, budget);
					return scrambleManager.updateText(id, `tool#${i}`, text, Date.now(), isComplete).content;
				}
			));
		}
	}

	if (isComplete) {
		scrambleManager.completeFlow(id);
	}

	return container;
}

function renderFlowCollapsed(
	r: SingleResult,
	icon: string,
	error: boolean,
	flowOutput: string,
	theme: FlowTheme,
	streamingText?: string,
	toolCallId?: string,
	config?: FlowColorConfig,
	sharedContext?: {
		messageCount: number;
		userMessageCount: number;
		assistantMessageCount: number;
		toolCalls: Record<string, number>;
		totalTokens: number;
		preview: string;
	},
): Container {
	const id = toolCallId || "collapsed";
	const now = Date.now();
	const container = new Container();
	const maxWidth = process.stdout.columns ?? 80;
	const typeName = formatCollapsedFlowHeaderTypeName(r.type);
	const modelLabel = formatModelLabel(r.model);
	const headerPrefixLen = visibleLength(typeName) + visibleLength(modelLabel ? `  ${modelLabel} · ` : "  ");

	const isComplete = isFlowStatusComplete(r);

	// Build header stats: ctxLabel · t/s
	const statsParts: string[] = [];
	const liveState = getFlowLiveState(id);
	const ctxTokens = Math.max(
		resolveDisplayContextTokens(r.usage, sharedContext),
		liveState?.contextTokens ?? 0,
	);
	let displayStats = "";
	if (r.maxContextTokens !== undefined || ctxTokens > 0) {
		const ctxLabel = applyScrambledContextLabel(id, ctxTokens, r.maxContextTokens, now, isComplete);
		statsParts.push(ctxLabel);
		displayStats = statsParts.join(" · ");
	}
	if (r.usage.smoothedTps && r.usage.smoothedTps > 0) {
		const tpsFormatted = formatTps(r.usage.smoothedTps);
		statsParts.push(tpsFormatted);
		displayStats = statsParts.join(" · ");

		// Flash TPS value when it changes
		const tpsNum = tpsFormatted.slice(0, -4); // remove " t/s" suffix
		const scrambledTps = scrambleManager.updateHeaderMetric(id, "tps", tpsNum, now, isComplete, true);
		if (scrambledTps !== tpsNum) {
			displayStats = displayStats.replace(`${tpsNum} t/s`, `${scrambledTps} t/s`);
		}
	}

	const modelSegment = modelLabel ? `  ${modelLabel} · ` : "  ";
	const statsSegment = stripAnsi(displayStats);
	const errorSegment = error && r.stopReason ? ` [${r.stopReason}]` : "";
	const initialDot = flowStatusIcon(r, theme);
	let header = `${initialDot} ${applyRole("flowName", typeName, theme, config)}${applyRole("modelName", modelSegment, theme, config)}${applyRole("stats", displayStats, theme, config)}`;
	if (errorSegment) header += ` ${theme.fg("error", errorSegment)}`;
	const dotPlaceholder = stripAnsi(initialDot) + ' ';
	const plainHeader = dotPlaceholder + typeName + modelSegment + statsSegment + errorSegment;
	const headerSegments: HeaderSegment[] = [
		{ text: dotPlaceholder, style: (_s) => getScintillatingStatusDot(r, theme, Date.now(), id) + " " },
		{ text: typeName, style: (s) => applyRole("flowName", s, theme, config) },
		{ text: modelSegment, style: (s) => applyRole("modelName", s, theme, config) },
		{ text: statsSegment, style: (s) => applyRole("stats", s, theme, config) },
	];
	if (errorSegment) {
		headerSegments.push({ text: errorSegment, style: (s) => theme.fg("error", s) });
	}
	container.addChild(new DynamicScrambleText(
		header,
		() => {
			const now = Date.now();
			const result = scrambleManager.updateText(id, 'header', plainHeader, now, isComplete, true);
			return reconstructHeader(result.content, headerSegments);
		},
		true,
	));

	// aim: line — glitch on text change
	if (r.aim && r.type !== "trace") {
		const aimTree = "├─";
		const aimLabel = ` aim ▸ `;
		const aimPrefix = `${aimTree}${aimLabel}`;
		const budget = getTruncationBudget(visibleLength(aimPrefix));
		const displayAim = isFlowAwaiting(r) ? "[awaiting...]" : truncateChars(lowerFirstWord(r.aim), budget);
		container.addChild(new DynamicScrambleText(
			`${applyRole("treeChars", aimTree, theme, config)}${applyRole("prefixLabel", aimLabel, theme, config)}${applyRole(getContentRole("aimContent", displayAim), displayAim, theme, config)}`,
			() => {
				const now = Date.now();
				const freshAimLabel = ` aim ▸ `;
				const freshAimPrefix = `${aimTree}${freshAimLabel}`;
				const freshBudget = getTruncationBudget(visibleLength(freshAimPrefix));
				const freshText = isFlowAwaiting(r) ? "[awaiting...]" : truncateChars(lowerFirstWord(r.aim), freshBudget);
				const result = scrambleManager.updateAim(id, freshText, now, isComplete, true);
				return `${applyRole("treeChars", aimTree, theme, config)}${applyRole("prefixLabel", freshAimLabel, theme, config)}${applyRole(getContentRole("aimContent", freshText), result.content, theme, config)}`;
			},
			true,
		));
	}

	// act: line (last tool call with count)
	const lastTool = getLastToolCall(r.messages);
	const actStr = lastTool ? formatFlowToolCall(lastTool.name, lastTool.args, theme.fg.bind(theme)) : "[n/a]";
	const isLite = config?.bodyVerbosity !== "full";
	const actTree = isLite ? "└─" : "├─";
	const actLabel = ` cmd ▸ `;
	const prefixStub = `${actTree}${actLabel}`;
	const budget = getTruncationBudget(visibleLength(prefixStub));
	const actFullText = stripAnsi(lowerFirstWord(actStr));
	const initialActContent = isFlowAwaiting(r) ? "[n/a]" : (actFullText.length > budget ? tailText(actFullText, budget) : actFullText);
	container.addChild(new DynamicScrambleText(
		`${applyRole("treeChars", actTree, theme, config)}${applyRole("prefixLabel", actLabel, theme, config)}${applyRole(getContentRole("actContent", initialActContent), initialActContent, theme, config)}`,
		() => {
			const now = Date.now();
			const actLabel = ` cmd ▸ `;
			const actPrefix = `${actTree}${actLabel}`;
			const freshBudget = getTruncationBudget(visibleLength(actPrefix));
			const displayAct = isFlowAwaiting(r) ? "[n/a]" : tailText(actFullText, freshBudget);
			const actContent = scrambleManager.updateAct(id, displayAct, now, isComplete, true).content;
			return `${applyRole("treeChars", actTree, theme, config)}${applyRole("prefixLabel", actLabel, theme, config)}${applyRole(getContentRole("actContent", displayAct), actContent, theme, config)}`;
		},
		true,
	));

	// msg: line (last assistant text or streaming) — full mode only
	if (!isLite) {
		const msgPrefixStub = `└─ msg ▸ `;
		const msgBudget = getTruncationBudget(visibleLength(msgPrefixStub));

		let rawMsg: string;
		let useError = false;
		if (isFlowAwaiting(r)) {
			rawMsg = "[awaiting...]";
		} else if (r.status === "skipped") {
			rawMsg = "[skipped]";
		} else {
			const liveMsgText = isFlowRunning(r) ? getLiveTextWithFallback(id) : undefined;
			if (liveMsgText != null) {
				rawMsg = stripAnsi(liveMsgText);
			} else if (isFlowRunning(r) && streamingText != null) {
				rawMsg = stripAnsi(streamingText);
			} else if (r.structuredOutput?.summary) {
				rawMsg = stripAnsi(r.structuredOutput.summary);
			} else if (flowOutput) {
				rawMsg = stripAnsi(flowOutput);
			} else if (error && r.errorMessage) {
				rawMsg = stripAnsi(r.errorMessage);
				useError = true;
			} else {
				const summary = getFlowSummaryText(r);
				rawMsg = stripAnsi(summary) || "[n/a]";
			}
		}

		const initialNeedsTail = !isFlowAwaiting(r) && isFlowRunning(r) && (streamingText != null || getLiveTextWithFallback(id) != null);
		const initialMsgContent = initialNeedsTail
			? tailText(rawMsg, msgBudget)
			: truncateChars(rawMsg, msgBudget);
		const msgTree = "└─";
		const msgLabel = ` msg ▸ `;
		const initialMsgPrefix = `${msgTree}${msgLabel}`;
		container.addChild(new DynamicScrambleText(
			`${applyRole("treeChars", msgTree, theme, config)}${applyRole("prefixLabel", msgLabel, theme, config)}${applyRole(getContentRole("msgContent", initialMsgContent, useError), initialMsgContent, theme, config)}`,
			() => {
				const now = Date.now();
				const msgLabel = ` msg ▸ `;
				const msgPrefix = `${msgTree}${msgLabel}`;
				let freshRawMsg: string;
				let needsTail: boolean;
				if (isFlowAwaiting(r)) {
					freshRawMsg = "[awaiting...]";
					needsTail = false;
				} else if (r.status === "skipped") {
					freshRawMsg = "[skipped]";
					needsTail = false;
				} else {
					const isRunningNow = isFlowRunning(r);
					freshRawMsg = (isRunningNow ? getLiveTextWithFallback(id) : undefined) ?? rawMsg;
					needsTail = isRunningNow && (streamingText != null || getLiveTextWithFallback(id) != null);
				}
				const displayMsg = needsTail ? tailText(freshRawMsg, msgBudget) : truncateChars(freshRawMsg, msgBudget);
				const result = scrambleManager.updateMsg(id, displayMsg, now, isComplete, undefined, true);
				return `${applyRole("treeChars", msgTree, theme, config)}${applyRole("prefixLabel", msgLabel, theme, config)}${applyRole(getContentRole("msgContent", freshRawMsg, useError), result.content, theme, config)}`;
			},
			true,
		));
		}

	if (isComplete) {
		scrambleManager.completeFlow(id);
	}

	return container;
}

// ---------------------------------------------------------------------------
// Multi-flow result
// ---------------------------------------------------------------------------

function renderMultiFlowExpanded(
	results: SingleResult[],
	successCount: number,
	icon: string,
	theme: FlowTheme,
	baseId: string,
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
): Container {
	const mdTheme = getMarkdownTheme();
	const container = new Container();

	if (sharedContext) {
		container.addChild(new Text(applyRole("prefixLabel", "── shared context ──", theme, config), 0, 0));
		container.addChild(new Text(applyRole("aimContent", sharedContext.preview, theme, config), 0, 0));
		const statsParts: string[] = [];
		statsParts.push(`${sharedContext.userMessageCount} user`);
		statsParts.push(`${sharedContext.assistantMessageCount} assistant`);
		statsParts.push(`${sharedContext.totalTokens} tokens`);
		for (const [name, count] of Object.entries(sharedContext.toolCalls)) {
			statsParts.push(`${count}× ${name}`);
		}
		container.addChild(new Text(applyRole("stats", statsParts.join(" · "), theme, config), 0, 0));
		container.addChild(new Spacer(1));
	}

	// Summary: just show count, no icon
	container.addChild(new Text(
		applyRole("flowName", `${results.length} flows`, theme, config),
		0, 0,
	));

	for (let flowIdx = 0; flowIdx < results.length; flowIdx++) {
		const r = results[flowIdx];
		const flowId = `${baseId}#${flowIdx}`;
		const isComplete = isFlowStatusComplete(r);
		const displayItems = getFlowDisplayItems(r.messages);
		const flowOutput = getFlowOutput(r.messages);
		const typeName = formatFlowTypeName(r.type);

		container.addChild(new Spacer(1));
		// Per-flow header: ─── EXPLORER (no icon)
		const headerStatic = applyRole("prefixLabel", sectionHeader(typeName), theme, config);
		container.addChild(new DynamicScrambleText(
			headerStatic,
			() => {
				const result = scrambleManager.updateText(flowId, 'header', typeName, Date.now(), isComplete, true);
				return result.isAnimating ? applyRole("prefixLabel", result.content, theme, config) : headerStatic;
			}
		));

		// Stats: dashboard format
		const flowStats = formatCompactStats(r.usage, r.model);
		container.addChild(new DynamicScrambleText(
			applyRole("stats", flowStats, theme, config),
			() => {
				const result = scrambleManager.updateText(flowId, 'stats', stripAnsi(flowStats), Date.now(), isComplete, true);
				return result.isAnimating ? applyRole("stats", result.content, theme, config) : applyRole("stats", flowStats, theme, config);
			}
		));

		// Intent: just show text, no prefix (budget computed dynamically for resize recalculation)
		const intentBudget = getTruncationBudget(0);
		const displayIntent = truncateChars(r.intent, intentBudget);
		container.addChild(new DynamicScrambleText(
			applyRole("aimContent", displayIntent, theme, config),
			() => {
				const budget = getTruncationBudget(0);
				const text = truncateChars(r.intent, budget);
				const result = scrambleManager.updateText(flowId, 'intent', text, Date.now(), isComplete, true);
				return result.isAnimating ? applyRole("aimContent", result.content, theme, config) : applyRole("aimContent", text, theme, config);
			}
		));

		if (r.acceptance) {
			const acceptanceRaw = r.acceptance;
			const acceptancePrefix = "Acceptance: ";
			const acceptanceBudget = getTruncationBudget(visibleLength(acceptancePrefix));
			const acceptanceText = truncateChars(acceptanceRaw, acceptanceBudget);
			const acceptanceStatic = applyRole("aimContent", `${acceptancePrefix}${acceptanceText}`, theme, config);
			container.addChild(new DynamicScrambleText(
				acceptanceStatic,
				() => {
					const budget = getTruncationBudget(visibleLength(acceptancePrefix));
					const text = truncateChars(acceptanceRaw, budget);
					const result = scrambleManager.updateText(flowId, 'acceptance', text, Date.now(), isComplete, true);
					return result.isAnimating ? applyRole("aimContent", `${acceptancePrefix}${result.content}`, theme, config) : applyRole("aimContent", `${acceptancePrefix}${text}`, theme, config);
				}
			));
		}

		// Output: animate streaming text; show clean markdown when complete
		if (isFlowAwaiting(r)) {
			container.addChild(new Text(applyRole("placeholder", "[awaiting...]", theme, config), 0, 0));
		} else if (!isComplete && r.streamingText != null) {
			const streamingRaw = r.streamingText;
			const msgBudget = getTruncationBudget(0);
			const displayMsg = tailText(stripAnsi(streamingRaw), msgBudget);
			container.addChild(new DynamicScrambleText(
				applyRole("msgContent", displayMsg, theme, config),
				() => {
					const budget = getTruncationBudget(0);
					const freshStreamingText = getLiveTextWithFallback(flowId) ?? streamingRaw;
					const text = tailText(stripAnsi(freshStreamingText), budget);
					const result = scrambleManager.updateMsg(flowId, text, Date.now(), isComplete, undefined, true);
					return result.isAnimating ? applyRole("msgContent", result.content, theme, config) : applyRole("msgContent", text, theme, config);
				}
			));
		} else if (flowOutput) {
			container.addChild(new Spacer(1));
			container.addChild(new Markdown(flowOutput.trim(), 0, 0, mdTheme));
		}

		// Tool traces in expanded view — per-line scramble
		const toolCallItems = displayItems.filter((item) => item.type === "toolCall");
		if (toolCallItems.length > 0) {
			container.addChild(new Spacer(1));
			container.addChild(new Text(applyRole("prefixLabel", sectionHeader("tool calls"), theme, config), 0, 0));
			const toolPrefixLen = visibleLength("→ ");
			const toolBudget = getTruncationBudget(toolPrefixLen);
			for (let i = 0; i < toolCallItems.length; i++) {
				const item = toolCallItems[i] as Extract<DisplayItem, { type: "toolCall" }>;
				const lineText = applyRole("prefixLabel", "→ ", theme, config) + formatFlowToolCall(item.name, item.args, theme.fg.bind(theme));
				const plainText = stripAnsi(lineText);
				const displayTool = truncateChars(plainText, toolBudget);
				const initialScrambled = scrambleManager.updateText(flowId, `tool#${i}`, displayTool, now, isComplete).content;
				container.addChild(new DynamicScrambleText(
					initialScrambled,
					() => {
						const budget = getTruncationBudget(toolPrefixLen);
						const freshPlain = stripAnsi(lineText);
						const text = truncateChars(freshPlain, budget);
						return scrambleManager.updateText(flowId, `tool#${i}`, text, Date.now(), isComplete).content;
					}
				));
			}
		}

		if (isComplete) {
			scrambleManager.completeFlow(flowId);
		}
	}

	// Total stats: dashboard format
	const totalUsage = aggregateFlowUsage(results);
	const totalModel = results[0]?.model;
	const totalStats = formatCompactStats(totalUsage, totalModel);
	container.addChild(new Spacer(1));
	container.addChild(new Text(applyRole("stats", totalStats, theme, config), 0, 0));

	return container;
}
function renderFlowBody(
	container: Container,
	r: SingleResult,
	flowId: string,
	indent: string,
	theme: FlowTheme,
	now: number,
	config?: FlowColorConfig,
): void {
	const isComplete = isFlowStatusComplete(r);
	const flowComplete = isComplete;

	// aim: line — glitch on text change
	if (r.aim && r.type !== "trace") {
		const aimTree = indent + "├─";
		const aimLabel = ` aim ▸ `;
		const aimPrefix = `${aimTree}${aimLabel}`;
		const budget = getTruncationBudget(visibleLength(aimPrefix));
		const displayAim = isFlowAwaiting(r) ? "[awaiting...]" : truncateChars(lowerFirstWord(r.aim), budget);
		container.addChild(new DynamicScrambleText(
			`${applyRole("treeChars", aimTree, theme, config)}${applyRole("prefixLabel", aimLabel, theme, config)}${applyRole(getContentRole("aimContent", displayAim), displayAim, theme, config)}`,
			() => {
				const now = Date.now();
				const freshAimLabel = ` aim ▸ `;
				const freshAimPrefix = `${aimTree}${freshAimLabel}`;
				const freshBudget = getTruncationBudget(visibleLength(freshAimPrefix));
				const freshText = isFlowAwaiting(r) ? "[awaiting...]" : truncateChars(lowerFirstWord(r.aim), freshBudget);
				const result = scrambleManager.updateAim(flowId, freshText, now, flowComplete, true);
				return `${applyRole("treeChars", aimTree, theme, config)}${applyRole("prefixLabel", freshAimLabel, theme, config)}${applyRole(getContentRole("aimContent", freshText), result.content, theme, config)}`;
			},
			true,
		));
	}

	// act: line (last tool call with count)
	const lastTool = getLastToolCall(r.messages);
	const actStr = lastTool ? formatFlowToolCall(lastTool.name, lastTool.args, theme.fg.bind(theme)) : "[n/a]";
	const isLite = config?.bodyVerbosity !== "full";
	const actTree = isLite ? `${indent}└─` : `${indent}├─`;
	const actLabel = ` cmd ▸ `;
	const prefixStub = `${actTree}${actLabel}`;
	const budget = getTruncationBudget(visibleLength(prefixStub));
	const actFullText = stripAnsi(lowerFirstWord(actStr));
	const initialActContent = isFlowAwaiting(r) ? "[n/a]" : (actFullText.length > budget ? tailText(actFullText, budget) : actFullText);
	container.addChild(new DynamicScrambleText(
		`${applyRole("treeChars", actTree, theme, config)}${applyRole("prefixLabel", actLabel, theme, config)}${applyRole(getContentRole("actContent", initialActContent), initialActContent, theme, config)}`,
		() => {
			const now = Date.now();
			const actLabel = ` cmd ▸ `;
			const actPrefix = `${actTree}${actLabel}`;
			const freshBudget = getTruncationBudget(visibleLength(actPrefix));
			const displayAct = isFlowAwaiting(r) ? "[n/a]" : tailText(actFullText, freshBudget);
			const actContent = scrambleManager.updateAct(flowId, displayAct, now, flowComplete, true).content;
			return `${applyRole("treeChars", actTree, theme, config)}${applyRole("prefixLabel", actLabel, theme, config)}${applyRole(getContentRole("actContent", displayAct), actContent, theme, config)}`;
		},
		true,
	));

	// msg: line (live streaming text or last assistant text) — full mode only
	if (!isLite) {
		const msgTree = `${indent}└─`;
		const msgLabel = ` msg ▸ `;
		const msgPrefixStub = `${msgTree}${msgLabel}`;
		const msgBudget = getTruncationBudget(visibleLength(msgPrefixStub));

		let rawMsg: string;
		let useError = false;
		if (isFlowAwaiting(r)) {
			rawMsg = "[awaiting...]";
		} else if (r.status === "skipped") {
			rawMsg = "[skipped]";
		} else if (isFlowStatusComplete(r) && !isFlowRunning(r)) {
			if (isFlowError(r) && r.errorMessage) {
				rawMsg = stripAnsi(r.errorMessage);
				useError = true;
			} else if ((r.pingPongMeta?.finalVerdict === "pass" || r.structuredOutput?.verdict === "pass") && r.type === "audit") {
				rawMsg = "[approved]";
			} else if (r.type === "audit" && !r.structuredOutput?.summary && !getFlowOutput(r.messages)) {
				rawMsg = "[finished]";
			} else {
				rawMsg = stripAnsi(r.structuredOutput?.summary ?? getFlowOutput(r.messages) ?? getFlowSummaryText(r)) || "[n/a]";
			}
		} else {
			const liveMsgText = isFlowRunning(r) ? getLiveTextWithFallback(flowId) : undefined;
			if (liveMsgText != null) {
				rawMsg = stripAnsi(liveMsgText);
			} else if (isFlowRunning(r) && r.streamingText != null) {
				rawMsg = stripAnsi(r.streamingText);
			} else if (r.structuredOutput?.summary) {
				rawMsg = stripAnsi(r.structuredOutput.summary);
			} else {
				const flowOutput = getFlowOutput(r.messages);
				if (flowOutput) {
					rawMsg = stripAnsi(flowOutput);
				} else if (isFlowError(r) && r.errorMessage) {
					rawMsg = stripAnsi(r.errorMessage);
					useError = true;
				} else {
					const summary = getFlowSummaryText(r);
					rawMsg = stripAnsi(summary) || "[n/a]";
				}
			}
		}

		const initialNeedsTail = !isFlowAwaiting(r) && isFlowRunning(r) && (r.streamingText != null || getLiveTextWithFallback(flowId) != null);
		const initialDisplayMsg = initialNeedsTail ? tailText(rawMsg, msgBudget) : truncateChars(rawMsg, msgBudget);
		container.addChild(new DynamicScrambleText(
			`${applyRole("treeChars", msgTree, theme, config)}${applyRole("prefixLabel", msgLabel, theme, config)}${applyRole(getContentRole("msgContent", initialDisplayMsg, useError), initialDisplayMsg, theme, config)}`,
			() => {
				const now = Date.now();
				const msgLabel = ` msg ▸ `;
				const msgPrefix = `${msgTree}${msgLabel}`;
				let freshRawMsg: string;
				let needsTail: boolean;
				if (isFlowAwaiting(r)) {
					freshRawMsg = "[awaiting...]";
					needsTail = false;
				} else if (r.status === "skipped") {
					freshRawMsg = "[skipped]";
					needsTail = false;
				} else {
					const isRunningNow = isFlowRunning(r);
					freshRawMsg = (isRunningNow ? getLiveTextWithFallback(flowId) : undefined) ?? rawMsg;
					needsTail = isRunningNow && (r.streamingText != null || getLiveTextWithFallback(flowId) != null);
				}
				const displayMsg = needsTail ? tailText(freshRawMsg, msgBudget) : truncateChars(freshRawMsg, msgBudget);
				const result = scrambleManager.updateMsg(flowId, displayMsg, now, flowComplete, undefined, true);
				return `${applyRole("treeChars", msgTree, theme, config)}${applyRole("prefixLabel", msgLabel, theme, config)}${applyRole(getContentRole("msgContent", freshRawMsg, useError), result.content, theme, config)}`;
			},
			true,
		));
		}

}
export { renderFlowExpanded, renderFlowCollapsed, renderFlowBody, renderMultiFlowExpanded };

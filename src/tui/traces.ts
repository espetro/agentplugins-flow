import * as os from "node:os";
import type { FlowColorConfig, FlowColorRole, FlowTheme } from "./flow-colors.js";
import { applyRole } from "./flow-colors.js";
import type { DisplayItem } from "../types/ui.js";
import { formatBatchOpsSummary } from "../batch/summary.js";
import { scrambleManager, getLiveText } from "./scramble/index.js";
import { formatContextLabel } from "./render-utils.js";

type ThemeFg = (color: string, text: string) => string;

function getContentRole(
	baseRole: "aimContent" | "actContent" | "msgContent",
	text: string,
	useError?: boolean,
): FlowColorRole {
	if (useError) return "msgError";
	if (["[awaiting...]", "[skipped]", "[approved]", "[finished]"].includes(text)) {
		return "placeholder";
	}
	return baseRole;
}

function applyScrambledContextLabel(
	id: string,
	ctxTokens: number,
	maxCtxTokens: number | undefined,
	now: number,
	isComplete: boolean,
): string {
	const ctxLabel = formatContextLabel(ctxTokens, maxCtxTokens);
	if (maxCtxTokens === undefined) {
		return scrambleManager.updateHeaderMetric(id, "ctx", ctxLabel, now, isComplete, true);
	}
	const slash = ctxLabel.indexOf("/");
	const current = slash >= 0 ? ctxLabel.slice(0, slash) : ctxLabel;
	const suffix = slash >= 0 ? ctxLabel.slice(slash) : "";
	return scrambleManager.updateHeaderMetric(id, "ctx", current, now, isComplete, true) + suffix;
}

function getLiveTextWithFallback(id: string): string | undefined {
	const value = getLiveText(id);
	if (value !== undefined) return value;
	const fallbackId = id.includes("#") ? "collapsed" + id.slice(id.indexOf("#")) : "collapsed";
	return getLiveText(fallbackId);
}

function shortenPath(p: string): string {
	const home = os.homedir();
	return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

function formatFlowToolCall(toolName: string, args: Record<string, unknown>, fg: ThemeFg): string {
	const pathArg = (args.file_path || args.path || "...") as string;

	switch (toolName) {
		case "bash": {
			const cmd = ((args.command as string) || "...").replace(/[\n\r\t]+/g, " ").replace(/ +/g, " ").trim();
			return fg("muted", "$ ") + fg("toolOutput", cmd);
		}
		case "read": {
			let text = fg("accent", shortenPath(pathArg));
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			if (offset !== undefined || limit !== undefined) {
				const start = offset ?? 1;
				const end = limit !== undefined ? start + limit - 1 : "";
				text += fg("warning", `:${start}${end ? `-${end}` : ""}`);
			}
			return fg("muted", "read ") + text;
		}
		case "write": {
			const lines = ((args.content || "") as string).split("\n").length;
			let text = fg("muted", "write ") + fg("accent", shortenPath(pathArg));
			if (lines > 1) text += fg("dim", ` (${lines} lines)`);
			return text;
		}
		case "edit":
			return fg("muted", "edit ") + fg("accent", shortenPath(pathArg));
		case "ls":
			return fg("muted", "ls ") + fg("accent", shortenPath((args.path || ".") as string));
		case "find":
			return fg("muted", "find ") + fg("accent", (args.pattern || "*") as string) + fg("dim", ` in ${shortenPath((args.path || ".") as string)}`);
		case "grep":
			return fg("muted", "grep ") + fg("accent", `/${(args.pattern || "") as string}/`) + fg("dim", ` in ${shortenPath((args.path || ".") as string)}`);
		case "batch":
		case "batch_read": {
			const summary = formatBatchOpsSummary(args);
			return fg("muted", `${toolName} `) + fg("accent", summary);
		}
		default:
			return fg("accent", toolName) + fg("dim", ` ${JSON.stringify(args)}`);
	}
}

function splitOutputLines(text: string): string[] {
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
	return lines;
}

function renderToolTraces(
	items: DisplayItem[],
	theme: FlowTheme,
	config?: FlowColorConfig,
): string {
	const lines: string[] = [];
	for (const item of items) {
		if (item.type === "toolCall") {
			lines.push(applyRole("prefixLabel", "→ ", theme, config) + formatFlowToolCall(item.name, item.args, theme.fg.bind(theme)));
		}
	}
	return lines.join("\n");
}

function renderFlowReport(
	output: string,
	theme: FlowTheme,
	config?: FlowColorConfig,
): string {
	const lines = splitOutputLines(output);
	return lines.map((line) => applyRole("actContent", line, theme, config)).join("\n");
}

export { getContentRole, applyScrambledContextLabel, getLiveTextWithFallback, shortenPath, formatFlowToolCall, splitOutputLines, renderToolTraces, renderFlowReport };

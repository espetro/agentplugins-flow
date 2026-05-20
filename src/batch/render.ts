/**
 * batch — rendering helpers for tool calls and results.
 *
 * Result rendering uses a tree-directory format when `details.results`
 * is available, showing per-operation status icons and metadata.
 * Falls back to legacy flat text rendering when `details.results` is
 * empty (backward compatibility for test fixtures and older data).
 */

import { Container, Text, TruncatedText } from "@earendil-works/pi-tui";
import { scrambleManager, runScrambleTimer } from "../tui/scramble/index.js";
import { stripAnsi } from "../tui/render-utils.js";
import type { BatchTheme, OpResult } from "./constants.js";
import { italic } from "../tui/render-utils.js";
/** Reuse a cached root container from args.state so the TUI host's reference stays valid. */
function reuseRootContainer(
	args: Record<string, unknown> | undefined,
	fresh: Text | Container | TruncatedText,
): Text | Container | TruncatedText {
	const state = (args as any)?.state as Record<string, any> | undefined;
	if (!state) return fresh;

	if (!state.__rootContainer) {
		const root = new Container();
		root.addChild(fresh);
		state.__rootContainer = root;
		return root;
	}

	const root = state.__rootContainer as Container;
	root.clear();
	root.addChild(fresh);
	root.invalidate();
	return root;
}

export function renderBatchCall(_args: Record<string, unknown>, _theme: BatchTheme): Container {
	// Call frame is invisible — result frame shows tool name + stats.
	return new Container();
}

// ---------------------------------------------------------------------------
// Tree-directory result rendering
// ---------------------------------------------------------------------------

function shortenPath(p: string): string {
	const home = process.env.HOME || process.env.USERPROFILE || "";
	return home && p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

function statusIcon(status: OpResult["status"]): string {
	switch (status) {
		case "ok":
			return "✓";
		case "error":
			return "✗";
		case "skipped":
			return "⊘";
		case "pending":
			return "○";
		default:
			return "?";
	}
}

function statusColor(status: OpResult["status"]): string {
	switch (status) {
		case "ok":
			return "accent";
		case "error":
			return "error";
		case "skipped":
			return "muted";
		case "pending":
			return "warning";
		default:
			return "muted";
	}
}

function formatOpTarget(op: OpResult): string {
	switch (op.op) {
		case "read":
			return shortenPath(op.path ?? "?");
		case "edit":
			return shortenPath(op.path ?? "?");
		case "write":
			return shortenPath(op.path ?? "?");
		case "delete":
			return shortenPath(op.path ?? "?");
		case "rg":
			return shortenPath(op.path ?? "?");
		case "bash":
			return op.command ?? shortenPath(op.path ?? "?");
		case "search":
			return `"${op.q ?? op.query ?? "?"}"`;
		case "fetch":
			return op.url ?? (op as any).u ?? "?";
		case "patch":
			return shortenPath(op.path ?? "patch");
		default:
			return shortenPath(op.path ?? "?");
	}
}

function formatOpMeta(op: OpResult): string {
	const parts: string[] = [];
	switch (op.op) {
		case "read": {
			if (op.totalLines !== undefined) parts.push(`${op.totalLines} lines`);
			else if (op.content) parts.push(`${op.content.split("\n").length} lines`);
			if (op.truncated && op.nextOffset) parts.push(`truncated, s=${op.nextOffset}`);
			else if (op.truncated) parts.push("truncated");
			if (op.contextMap) parts.push("context map");
			break;
		}
		case "edit": {
			if (op.blocksChanged !== undefined) parts.push(`${op.blocksChanged} block${op.blocksChanged > 1 ? "s" : ""}`);
			break;
		}
		case "write": {
			if (op.bytes !== undefined) parts.push(`${op.bytes} bytes`);
			break;
		}
		case "rg": {
			if (op.content) {
				const matchCount = op.content.split("\n").filter((l) => l.trim()).length;
				parts.push(`${matchCount} match${matchCount !== 1 ? "es" : ""}`);
			}
			break;
		}
		case "bash": {
			if (op.exitCode !== undefined) parts.push(`exit ${op.exitCode}`);
			if (op.duration !== undefined) parts.push(`${(op.duration / 1000).toFixed(1)}s`);
			break;
		}
		case "search": {
			const searchResults = (op as any).results?.length;
			if (searchResults !== undefined && searchResults >= 0) {
				parts.push(`${searchResults} result${searchResults !== 1 ? "s" : ""}`);
			} else if (op.content) {
				const resultCount = op.content.split("\n").filter((l) => l.trim()).length;
				parts.push(`${resultCount} result${resultCount !== 1 ? "s" : ""}`);
			}
			break;
		}
		case "fetch": {
			if (op.contentLength !== undefined) parts.push(`${op.contentLength} bytes`);
			else if (op.content) parts.push(`${op.content.length} bytes`);
			break;
		}
		case "patch": {
			const parts2: string[] = [];
			if (op.affected?.added?.length) parts2.push(`A ${op.affected.added.join(", ")}`);
			if (op.affected?.modified?.length) parts2.push(`M ${op.affected.modified.join(", ")}`);
			if (op.affected?.deleted?.length) parts2.push(`D ${op.affected.deleted.join(", ")}`);
			if (parts2.length) parts.push(parts2.join(" "));
			break;
		}
	}

	if (op.status === "error" && op.error) {
		const shortError = op.error.length > 40 ? op.error.slice(0, 37) + "..." : op.error;
		parts.push(shortError);
	} else if (op.status === "skipped" && op.error) {
		const shortError = op.error.length > 40 ? op.error.slice(0, 37) + "..." : op.error;
		parts.push(shortError);
	}

	if (parts.length === 0) return "";
	return " · " + parts.join(" · ");
}

function buildResultHeader(results: OpResult[]): string {
	const total = results.length;
	const ok = results.filter((r) => r.status === "ok").length;
	const err = results.filter((r) => r.status === "error").length;
	const skipped = results.filter((r) => r.status === "skipped").length;
	const pending = results.filter((r) => r.status === "pending").length;

	// Per-op-type tallies for the "file / web / bash" breakdown
	const typeCounts: Record<string, number> = {};
	for (const r of results) {
		const type =
			r.op === "read" || r.op === "edit" || r.op === "write" || r.op === "delete" || r.op === "rg" || r.op === "patch"
				? "file"
				: r.op === "search" || r.op === "fetch"
					? "web"
					: r.op === "bash"
						? "bash"
						: r.op;
		typeCounts[type] = (typeCounts[type] || 0) + 1;
	}

	const parts: string[] = [`${total} op${total !== 1 ? "s" : ""}`];
	if (ok > 0) parts.push(`${ok} ok`);
	if (err > 0) parts.push(`${err} err`);
	if (skipped > 0) parts.push(`${skipped} skipped`);
	if (pending > 0) parts.push(`${pending} pending`);

	// Add type tallies: e.g. "2 file · 1 web · 1 bash"
	const typeOrder = ["file", "web", "bash"];
	for (const type of typeOrder) {
		const count = typeCounts[type];
		if (count) parts.push(`${count} ${type}`);
	}
	// Any remaining unclassified types
	for (const [type, count] of Object.entries(typeCounts)) {
		if (!typeOrder.includes(type) && count) parts.push(`${count} ${type}`);
	}

	return parts.join(" · ");
}

function buildOpContentPreview(op: OpResult, childPrefix: string): string | null {
	if (op.status !== "ok") return null;

	switch (op.op) {
		case "read": {
			if (!op.content) return null;
			const lines = op.content.split("\n");
			const preview = lines.slice(0, 3).join("\n");
			return preview || null;
		}
		case "rg": {
			if (!op.content) return null;
			const lines = op.content.split("\n").filter((l) => l.trim());
			const preview = lines.slice(0, 3).join("\n");
			return preview || null;
		}
		case "bash": {
			if (!op.stdout?.trim()) return null;
			const lines = op.stdout.split("\n");
			const preview = lines.slice(0, 3).join("\n");
			return preview || null;
		}
		case "search": {
			const results = (op as any).results as Array<{ title?: string; url?: string }> | undefined;
			if (results && results.length > 0) {
				const preview = results
					.slice(0, 3)
					.map((r) => `${r.title || "untitled"} — ${r.url || "?"}`)
					.join("\n");
				return preview || null;
			}
			if (!op.content) return null;
			const lines = op.content.split("\n");
			const preview = lines.slice(0, 3).join("\n");
			return preview || null;
		}
		case "fetch": {
			const filePath = (op as any).filePath as string | undefined;
			const contentLen = op.contentLength ?? (op as any).contentLength;
			if (filePath) {
				return `saved: ${shortenPath(filePath)}${contentLen !== undefined ? ` (${contentLen} bytes)` : ""}`;
			}
			if (!op.content) return null;
			const lines = op.content.split("\n");
			const preview = lines.slice(0, 3).join("\n");
			return preview || null;
		}
		default:
			return null;
	}
}

/** Extract plain text from a Container by recursively reading child text nodes. */
function extractContainerText(node: any): string {
	if ("text" in node && typeof node.text === "string") {
		return node.text;
	} else if ("children" in node && Array.isArray(node.children)) {
		return node.children.map((child: any) => extractContainerText(child)).join("\n");
	}
	return String(node);
}

function renderTreeResult(
	results: OpResult[],
	expanded: boolean,
	theme: BatchTheme,
	args?: Record<string, unknown>,
	isBatchRead: boolean = false,
): any {
	const container = new Container();
	const label = isBatchRead ? "batch_read" : "batch";

	// Header line
	const header = `${label}  ·  ${buildResultHeader(results)}`;
	container.addChild(new Text(theme.fg("muted", header), 0, 0));

	// Tree lines
	for (let i = 0; i < results.length; i++) {
		const op = results[i];
		const isLast = i === results.length - 1;
		const treePrefix = isLast ? "└─" : "├─";
		const childPrefix = isLast ? "   " : "│  ";

		const icon = statusIcon(op.status);
		const iconColored = theme.fg(statusColor(op.status), icon);
		const target = formatOpTarget(op);
		const meta = formatOpMeta(op);

		const treeLine = `${treePrefix} ${iconColored} ${op.op}: ${theme.fg("accent", target)}${meta ? theme.fg("muted", meta) : ""}`;
		container.addChild(new Text(treeLine, 0, 0));

		// Expanded content preview
		if (expanded) {
			const preview = buildOpContentPreview(op, childPrefix);
			if (preview) {
				const previewLines = preview.split("\n");
				for (const line of previewLines) {
					container.addChild(new Text(`${childPrefix}${theme.fg("muted", italic(line))}`, 0, 0));
				}
			}
		}
	}

	// Scramble animation support
	const canAnimate = !!(args as any)?.invalidate && !!(args as any)?.state;
	if (canAnimate) {
		const id = (args as any)?.toolCallId || (args as any)?.id || label;
		const now = Date.now();
		const fullText = extractContainerText(container);
		const scrambled = scrambleManager.updateText(id, "result", stripAnsi(fullText), now, false).content;
		// Rebuild container with scrambled text
		const scrambledContainer = new Container();
		for (const line of scrambled.split("\n")) {
			scrambledContainer.addChild(new Text(line, 0, 0));
		}
		runScrambleTimer(args as Record<string, any> | undefined, id);
		return reuseRootContainer(args, scrambledContainer);
	}

	return reuseRootContainer(args, container);
}

// ---------------------------------------------------------------------------
// Legacy fallback (content-text based)
// ---------------------------------------------------------------------------

function renderLegacyResult(
	result: { content?: Array<{ type: string; text?: string }> },
	expanded: boolean,
	args?: Record<string, unknown>,
): any {
	const fullText = result.content?.find((c) => c.type === "text")?.text ?? "";
	const canAnimate = !!(args as any)?.invalidate && !!(args as any)?.state;
	if (!canAnimate) {
		if (!expanded) {
			const summary = fullText.split("\n")[0] ?? "";
			const fresh = new TruncatedText(scrambleManager.renderStatic(summary), 0, 0);
			return reuseRootContainer(args, fresh);
		}
		const fresh = new Text(scrambleManager.renderStatic(fullText), 0, 0);
		return reuseRootContainer(args, fresh);
	}
	const now = Date.now();
	const id = (args as any)?.toolCallId || (args as any)?.id || "batch";
	if (!expanded) {
		const summary = fullText.split("\n")[0] ?? "";
		const scrambled = scrambleManager.updateText(id, "result", stripAnsi(summary), now, false).content;
		runScrambleTimer(args as Record<string, any> | undefined, id);
		const fresh = new TruncatedText(scrambled, 0, 0);
		return reuseRootContainer(args, fresh);
	}
	const scrambled = scrambleManager.updateText(id, "result", stripAnsi(fullText), now, false).content;
	runScrambleTimer(args as Record<string, any> | undefined, id);
	const fresh = new Text(scrambled, 0, 0);
	return reuseRootContainer(args, fresh);
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

export function renderBatchResult(
	result: { content?: Array<{ type: string; text?: string }>; details?: { results?: OpResult[] } },
	expanded: boolean,
	theme: BatchTheme,
	args?: Record<string, unknown>,
): any {
	const results = result.details?.results;
	if (results && results.length > 0) {
		return renderTreeResult(results, expanded, theme, args, false);
	}
	return renderLegacyResult(result, expanded, args);
}

export function renderBatchReadResult(
	result: { content?: Array<{ type: string; text?: string }>; details?: { results?: OpResult[] } },
	expanded: boolean,
	theme: BatchTheme,
	args?: Record<string, unknown>,
): any {
	const results = result.details?.results;
	if (results && results.length > 0) {
		return renderTreeResult(results, expanded, theme, args, true);
	}
	return renderLegacyResult(result, expanded, args);
}

export function renderBatchReadCall(_args: Record<string, unknown>, _theme: BatchTheme): Container {
	// Call frame is invisible — result frame shows tool name + stats.
	return new Container();
}

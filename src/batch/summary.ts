/**
 * Pure formatting utilities for batch operation summaries.
 */

import * as os from "node:os";

function shortenPath(p: string): string {
	const home = os.homedir();
	return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

export interface PlannedOp {
	o: string;
	p: string;
	e?: unknown[];
	c?: string;
	s?: number;
	l?: number;
	q?: string;
	t?: string;
	u?: string;
}

function extractBatchOps(args: Record<string, unknown>): PlannedOp[] {
	// CLI format: { cmd: "read a.txt; write -c 'x' b.txt" }
	if (typeof args.cmd === "string") {
		return extractCliOps(args.cmd);
	}

	let rawOps: unknown[];
	if (Array.isArray(args.o)) rawOps = args.o;
	else if (Array.isArray(args.op)) rawOps = args.op;
	else if (Array.isArray(args.operations)) rawOps = args.operations;
	else if (Array.isArray(args)) rawOps = args;
	else rawOps = [];

	return rawOps
		.filter((op): op is Record<string, unknown> => !!op && typeof op === "object")
		.map((op) => {
			const opName = String(op.o ?? op.op ?? "?");
			const opPath = String(op.p ?? op.path ?? "?");
			const edits = Array.isArray(op.e) ? op.e : Array.isArray(op.edits) ? op.edits : undefined;
			const cmd = typeof op.c === "string" ? op.c : typeof op.command === "string" ? op.command : undefined;
			const offset = typeof op.s === "number" ? op.s : typeof op.offset === "number" ? op.offset : undefined;
			const limit = typeof op.l === "number" ? op.l : typeof op.limit === "number" ? op.limit : undefined;
			const pattern = typeof op.q === "string" ? op.q : undefined;
			const typeFilter = typeof op.t === "string" ? op.t : undefined;
			return { o: opName, p: opPath, e: edits, c: cmd, s: offset, l: limit, q: pattern, t: typeFilter };
		});
}

function tokenizeSimple(input: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let inSingle = false;
	let inDouble = false;

	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		if (inSingle) {
			if (ch === "'") {
				inSingle = false;
				if (current.length > 0) {
					tokens.push(current);
					current = "";
				}
			} else {
				current += ch;
			}
			continue;
		}
		if (inDouble) {
			if (ch === '"') {
				inDouble = false;
				if (current.length > 0) {
					tokens.push(current);
					current = "";
				}
			} else {
				current += ch;
			}
			continue;
		}
		if (ch === "'") {
			inSingle = true;
			continue;
		}
		if (ch === '"') {
			inDouble = true;
			continue;
		}
		if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
			if (current.length > 0) {
				tokens.push(current);
				current = "";
			}
			continue;
		}
		current += ch;
	}
	if (current.length > 0) {
		tokens.push(current);
	}
	return tokens;
}

function splitChainSimple(input: string): string[] {
	const parts: string[] = [];
	let current = "";
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		if (ch === "'" && !inDouble) {
			inSingle = !inSingle;
			current += ch;
			continue;
		}
		if (ch === '"' && !inSingle) {
			inDouble = !inDouble;
			current += ch;
			continue;
		}
		if (!inSingle && !inDouble && ch === '&' && i + 1 < input.length && input[i + 1] === '&') {
			parts.push(current.trim());
			current = "";
			i++; // skip second &
			continue;
		}
		if (!inSingle && !inDouble && ch === ';') {
			parts.push(current.trim());
			current = "";
			continue;
		}
		current += ch;
	}
	parts.push(current.trim());
	return parts;
}

function extractCliOps(cmd: string): PlannedOp[] {
	const ops: PlannedOp[] = [];
	const links = splitChainSimple(cmd);
	for (const link of links) {
		const trimmed = link.trim();
		if (!trimmed) continue;
		const tokens = tokenizeSimple(trimmed);
		if (tokens.length === 0) continue;
		const subcommand = tokens[0];
		if (subcommand === "batch" || subcommand === "batch_read") {
			tokens.shift();
		}
		if (tokens.length === 0) continue;
		const op = tokens[0];
		if (op === "read" || op === "write" || op === "edit" || op === "delete" || op === "patch" || op === "bash" || op === "rg" || op === "poll") {
			// Parse flags and positionals
			const flags: Record<string, string> = {};
			let i = 1;
			while (i < tokens.length) {
				if (tokens[i].startsWith("-")) {
					const flagName = tokens[i];
					i++;
					if (i < tokens.length && !tokens[i].startsWith("-")) {
						flags[flagName] = tokens[i];
						i++;
					}
				} else {
					break;
				}
			}
			const positionals = tokens.slice(i);
			const path = positionals[0] ?? "?";
			let content: string | undefined;
			if (op === "write" && (flags["-c"] || flags["--content"])) {
				content = flags["-c"] || flags["--content"];
			}
			if (op === "bash") {
				content = positionals.join(" ");
			}
			// Count repeated --find flags for block info
			const findCount = tokens.filter((t) => t === "-f" || t === "--find").length;
			ops.push({ o: op, p: path, c: content, e: findCount > 1 ? Array(findCount).fill({ f: "", r: "" }) : undefined });
		} else if (op === "web") {
			const webOp = tokens[1] ?? "?";
			ops.push({ o: webOp, p: "?" });
		}
	}
	return ops;
}

function extractWebOps(args: Record<string, unknown>): Array<{ o: string; q?: string; u?: string }> {
	const rawOps = (args as { w?: unknown[] }).w;
	if (!Array.isArray(rawOps)) return [];
	return rawOps
		.filter((op: unknown): op is Record<string, unknown> => !!op && typeof op === "object")
		.map((op: Record<string, unknown>) => ({
			o: String(op.o ?? "?"),
			q: typeof op.q === "string" ? op.q : undefined,
			u: typeof op.u === "string" ? op.u : undefined,
		}));
}

function formatOpSummary(op: { o: string; p?: string; e?: unknown[]; c?: string; s?: number; l?: number; q?: string; t?: string; u?: string }): string {
	const shortPath = op.p ? shortenPath(op.p) : "";
	switch (op.o) {
		case "bash": {
			const cmd = op.c ?? "?";
			const display = cmd.length > 30 ? cmd.slice(0, 27) + "..." : cmd;
			return `bash: ${display}`;
		}
		case "read": {
			let text = `read ${shortPath}`;
			if (op.s !== undefined || op.l !== undefined) {
				const start = op.s ?? 1;
				const end = op.l !== undefined ? start + op.l - 1 : "";
				text += `:${start}${end ? `-${end}` : ""}`;
			}
			return text;
		}
		case "write": {
			const lines = (op.c ?? "").split("\n").length;
			return lines > 1 ? `write ${shortPath} (${lines} lines)` : `write ${shortPath}`;
		}
		case "edit": {
			const blockInfo = op.e && op.e.length > 1 ? ` (${op.e.length} blocks)` : "";
			return `edit ${shortPath}${blockInfo}`;
		}
		case "ls":
			return `ls ${shortPath}`;
		case "find":
			return `find ${shortPath}`;
		case "rg":
			return `rg ${op.q ?? "?"} in ${shortPath}${op.t ? ` (${op.t})` : ""}`;
		case "delete":
			return `delete ${shortPath}`;
		case "search":
			return `search: "${op.q ?? ""}"`;
		case "fetch":
			return `fetch: ${op.u ?? ""}`;
		case "patch": {
			const patchPreview = op.c ? ` (${op.c.split("\n")[0]}…)` : "";
			return `patch${patchPreview}`;
		}
		default:
			return op.p ? `${op.o} ${shortPath}` : `${op.o}`;
	}
}

/** Planned ops in execution order: file ops, web ops, then bash (matches batch execute). */
export function buildPlannedOps(args: Record<string, unknown>): PlannedOp[] {
	const all = extractBatchOps(args);
	const fileOps = all.filter((op) => op.o !== "bash");
	const bashOps = all.filter((op) => op.o === "bash");
	const webOps = extractWebOps(args).map((w) => ({
		o: w.o,
		p: w.u ?? w.q ?? "",
		q: w.q,
		u: w.u,
	}));
	return [...fileOps, ...webOps, ...bashOps];
}

export function formatBatchOpsSummary(args: Record<string, unknown>): string {
	const ops = extractBatchOps(args);
	const webOps = extractWebOps(args);
	const allOps = [...ops, ...webOps];
	if (allOps.length === 0) return "batch (empty)";

	const parts: string[] = [];
	let prev = "";
	let count = 0;

	for (const op of allOps) {
		const summary = formatOpSummary(op);
		if (summary === prev) {
			count++;
		} else {
			if (count > 1) {
				parts[parts.length - 1] += `×${count}`;
			}
			parts.push(summary);
			prev = summary;
			count = 1;
		}
	}
	if (count > 1) {
		parts[parts.length - 1] += `×${count}`;
	}

	if (parts.length <= 3) {
		return parts.join(", ");
	}
	return `${parts.slice(0, 2).join(", ")} +${parts.length - 2} more`;
}

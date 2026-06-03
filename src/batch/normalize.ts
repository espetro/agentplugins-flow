import { logWarn } from "../config/log.js";
import { resolveAlias } from "../flow/op-aliases.js";

export function generateBashId(): string {
	return Math.random().toString(36).slice(2, 10);
}

export function normalizeBatchOp(raw: Record<string, unknown>): Record<string, unknown> {
	const op: Record<string, unknown> = {};
	const ctx = { tool: "batch" };

	// Map operation type
	const o = resolveAlias("o", raw, ctx);
	const c = resolveAlias("c", raw, ctx);
	const e = resolveAlias("e", raw, ctx);
	op.o = o ?? (c != null ? "write" : (e != null ? "edit" : "read"));

	// Bash ops use a separate normalizer
	if (op.o === "bash") {
		return normalizeBashOp(raw);
	}

	// Map path
	op.p = resolveAlias("p", raw, ctx);

	// Map content
	const content = resolveAlias("c", raw, ctx);
	if (content !== undefined) op.c = content;
	else if (raw.patch !== undefined) op.c = raw.patch;

	// Map edits
	let editsRaw = resolveAlias("e", raw, ctx);
	if (typeof editsRaw === "string") {
		try { editsRaw = JSON.parse(editsRaw); } catch (e) { logWarn(`[pi-agent-flow] Failed to parse batch edits JSON: ${e}`); }
	}
	if (Array.isArray(editsRaw)) {
		op.e = editsRaw.map((edit: unknown) => {
			if (!edit || typeof edit !== "object") return edit;
			const editObj = edit as Record<string, unknown>;
			return {
				f: resolveAlias("f", editObj, ctx) ?? editObj.oldText,
				r: resolveAlias("r", editObj, ctx) ?? editObj.newText,
			};
		});
	}

	// Map offset / limit
	const s = resolveAlias("s", raw, ctx);
	if (s !== undefined) op.s = s;
	const l = resolveAlias("l", raw, ctx);
	if (l !== undefined) op.l = l;

	// Map timeout / type filter
	const t = resolveAlias("t", raw, ctx);
	if (t !== undefined) op.t = t;

	// Map ignore-case
	const i = resolveAlias("i", raw, ctx);
	if (i !== undefined) op.i = i;

	// Map rg-specific fields
	const q = resolveAlias("q", raw, ctx);
	if (q !== undefined) op.q = q;
	const n = resolveAlias("n", raw, ctx);
	if (n !== undefined) op.n = n;
	const u = resolveAlias("u", raw, ctx);
	if (u !== undefined) op.u = u;

	return op;
}

export function normalizeBashOp(raw: Record<string, unknown>): Record<string, unknown> {
	const ctx = { tool: "bash" };
	return {
		o: "bash",
		c: resolveAlias("c", raw, ctx) ?? raw.command,
		i: resolveAlias("i", raw, ctx) ?? generateBashId(),
		t: resolveAlias("t", raw, ctx),
		h: resolveAlias("h", raw, ctx) ?? raw.cwdPath ?? raw.cwd,
		p: resolveAlias("p", raw, ctx) ?? raw.h ?? ".",
	};
}

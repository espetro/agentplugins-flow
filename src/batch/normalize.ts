import { logWarn } from "../config/log.js";

export function generateBashId(): string {
	return Math.random().toString(36).slice(2, 10);
}

export function normalizeBatchOp(raw: Record<string, unknown>): Record<string, unknown> {
	const op: Record<string, unknown> = {};

	// Map operation type
	op.o = raw.o ?? raw.op ?? (raw.c != null || raw.content != null ? "write" : (raw.e != null || raw.edits != null ? "edit" : "read"));

	// Bash ops use a separate normalizer
	if (op.o === "bash") {
		return normalizeBashOp(raw);
	}

	// Map path
	op.p = raw.p ?? raw.path;

	// Map content
	if (raw.c !== undefined) op.c = raw.c;
	else if (raw.patch !== undefined) op.c = raw.patch;
	else if (raw.content !== undefined) op.c = raw.content;

	// Map edits
	let editsRaw = raw.e ?? raw.edits;
	if (typeof editsRaw === "string") {
		try { editsRaw = JSON.parse(editsRaw); } catch (e) { logWarn(`[pi-agent-flow] Failed to parse batch edits JSON: ${e}`); }
	}
	if (Array.isArray(editsRaw)) {
		op.e = editsRaw.map((e: unknown) => {
			if (!e || typeof e !== "object") return e;
			const edit = e as Record<string, unknown>;
			return { f: edit.f ?? edit.oldText, r: edit.r ?? edit.newText };
		});
	}

	// Map offset / limit
	if (raw.s !== undefined) op.s = raw.s;
	else if (raw.offset !== undefined) op.s = raw.offset;
	if (raw.l !== undefined) op.l = raw.l;
	else if (raw.limit !== undefined) op.l = raw.limit;

	// Map timeout / type filter
	if (raw.t !== undefined) op.t = raw.t;

	// Map id / ignore-case
	if (raw.i !== undefined) op.i = raw.i;

	// Map rg-specific fields
	if (raw.q !== undefined) op.q = raw.q;
	if (raw.n !== undefined) op.n = raw.n;
	if (raw.u !== undefined) op.u = raw.u;

	return op;
}

export function normalizeBashOp(raw: Record<string, unknown>): Record<string, unknown> {
	return {
		o: "bash",
		c: raw.c ?? raw.command,
		i: raw.i ?? raw.id ?? generateBashId(),
		t: raw.t ?? raw.timeout,
		h: raw.h ?? raw.cwdPath ?? raw.cwd,
		p: raw.p ?? raw.h ?? ".",
	};
}

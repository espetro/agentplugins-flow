/**
 * Field alias registry for the flow/trace tool dispatch chain.
 *
 * The canonical-wins rule: if a canonical key is present, its value is used
 * and any alias key for the same canonical is removed. If only the alias
 * is present, it is resolved to the canonical key and the alias key is removed.
 *
 * Context-split aliases resolve differently depending on the tool context
 * (batch, bash, web). This avoids collisions where the same alias letter
 * means different things in different tool contexts.
 */

export const OP_FIELD_ALIASES: Record<string, string | Record<string, string | null>> = {
	o: "op",
	p: "path",
	e: "edits",
	s: "offset",
	l: "limit",
	h: "cwd",
	q: "query",
	n: "maxCount",
	f: "find",
	r: "replace",
	c: { batch: "content", bash: "cmd", web: null },
	t: { batch: null, bash: "timeout", web: null },
	i: { batch: "ignoreCase", bash: "id", web: "ignoreCase" },
	u: { batch: null, bash: null, web: "url" },
};

export const DISPATCH_WRAPPER_ALIASES: Record<string, string> = {
	tool: "t",
	ops: "o",
};

/**
 * Resolve a canonical field value from an object, using the alias registry.
 *
 * @param canonical - The canonical key (e.g. "c", "p", "o").
 * @param obj - The object to read from.
 * @param ctx - The tool context (batch, bash, or web).
 * @returns The value at the canonical key, or the resolved alias value, or undefined.
 */
export function resolveAlias(
	canonical: string,
	obj: Record<string, unknown>,
	ctx: { tool: string },
): unknown {
	if (obj[canonical] !== undefined) {
		return obj[canonical];
	}
	const alias = OP_FIELD_ALIASES[canonical];
	if (typeof alias === "string") {
		return obj[alias];
	}
	if (alias && typeof alias === "object") {
		const toolAlias = alias[ctx.tool];
		if (toolAlias !== null) {
			const val = obj[toolAlias];
			if (val !== undefined) return val;
		}
	}
	// Legacy fallbacks not in the alias registry
	if (canonical === "c" && ctx.tool === "bash" && obj.command !== undefined) {
		return obj.command;
	}
	return undefined;
}

/**
 * Apply canonical field aliases to a single operation object.
 *
 * Returns a new object with every canonical key resolved via resolveAlias,
 * preserving unknown keys for forward compatibility.
 *
 * @param op - The raw operation object.
 * @param tool - The tool context (batch, bash, or web).
 * @returns The aliased result, and flags indicating whether aliasing occurred.
 */
export function applyOpAliases(
	op: Record<string, unknown>,
	tool: "batch" | "bash" | "web",
): { result: Record<string, unknown>; aliased: boolean; changed: boolean } {
	const result: Record<string, unknown> = {};
	let aliased = false;
	let changed = false;

	for (const key of Object.keys(op)) {
		result[key] = op[key];
	}

	for (const canonical of Object.keys(OP_FIELD_ALIASES)) {
		const resolved = resolveAlias(canonical, op, { tool });
		if (resolved !== undefined) {
			result[canonical] = resolved;
			if (op[canonical] === undefined) {
				aliased = true;
			}
		}
	}

	// Remove all alias keys
	for (const canonical of Object.keys(OP_FIELD_ALIASES)) {
		const alias = OP_FIELD_ALIASES[canonical];
		if (typeof alias === "string") {
			if (result[alias] !== undefined) {
				delete result[alias];
				changed = true;
			}
		} else if (alias && typeof alias === "object") {
			const toolAlias = alias[tool];
			if (toolAlias !== null && result[toolAlias] !== undefined) {
				delete result[toolAlias];
				changed = true;
			}
		}
	}

	// Legacy fallback: bash command → c
	if (tool === "bash" && result.command !== undefined) {
		delete result.command;
		changed = true;
	}

	// Process edit aliases for batch context
	if (tool === "batch" && Array.isArray(result.e)) {
		const edits = result.e as unknown[];
		let editChanged = false;
		const normalizedEdits = edits.map((edit) => {
			if (!edit || typeof edit !== "object") return edit;
			const editObj = edit as Record<string, unknown>;
			const f = resolveAlias("f", editObj, { tool: "batch" });
			const r = resolveAlias("r", editObj, { tool: "batch" });
			const hasFindAlias = f !== undefined && editObj.f === undefined;
			const hasReplaceAlias = r !== undefined && editObj.r === undefined;
			if (!hasFindAlias && !hasReplaceAlias) return edit;

			editChanged = true;
			const normalizedEdit: Record<string, unknown> = {};
			for (const key of Object.keys(editObj)) {
				normalizedEdit[key] = editObj[key];
			}
			if (f !== undefined) normalizedEdit.f = f;
			if (r !== undefined) normalizedEdit.r = r;
			if (normalizedEdit.find !== undefined) delete normalizedEdit.find;
			if (normalizedEdit.replace !== undefined) delete normalizedEdit.replace;
			return normalizedEdit;
		});
		if (editChanged) {
			result.e = normalizedEdits;
			changed = true;
		}
	}

	return { result, aliased, changed };
}

/**
 * Apply canonical field aliases to a dispatch wrapper object.
 *
 * @param group - The raw dispatch wrapper object.
 * @returns The aliased result, and flags indicating whether aliasing occurred.
 */
export function applyDispatchWrapperAliases(
	group: Record<string, unknown>,
): { result: Record<string, unknown>; aliased: boolean; changed: boolean } {
	const result: Record<string, unknown> = {};
	let aliased = false;
	let changed = false;

	for (const key of Object.keys(group)) {
		result[key] = group[key];
	}

	for (const canonical of Object.keys(DISPATCH_WRAPPER_ALIASES)) {
		const alias = DISPATCH_WRAPPER_ALIASES[canonical];
		const canonicalValue = group[canonical];
		const aliasValue = group[alias];

		if (canonicalValue !== undefined) {
			result[canonical] = canonicalValue;
			if (aliasValue !== undefined) {
				changed = true;
			}
		} else if (aliasValue !== undefined) {
			result[canonical] = aliasValue;
			aliased = true;
			changed = true;
		}
	}

	// Remove all alias keys
	for (const canonical of Object.keys(DISPATCH_WRAPPER_ALIASES)) {
		const alias = DISPATCH_WRAPPER_ALIASES[canonical];
		if (result[alias] !== undefined) {
			delete result[alias];
			changed = true;
		}
	}

	return { result, aliased, changed };
}

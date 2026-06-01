import { applyOpAliases, applyDispatchWrapperAliases } from "../flow/op-aliases.js";

export type DispatchPrepResult = {
	dispatch: Array<{ tool: "batch" | "bash" | "web"; ops: unknown[] }>;
	notes: string[];
	changed: boolean;
};

export function prepareTraceDispatchArguments(input: unknown): DispatchPrepResult {
	if (!input || typeof input !== "object") {
		return { dispatch: [], notes: [], changed: false };
	}

	const args = input as Record<string, unknown>;
	const rawDispatch = args.dispatch;

	if (!rawDispatch) {
		return { dispatch: [], notes: [], changed: false };
	}

	if (typeof rawDispatch === "string") {
		return {
			dispatch: [{ tool: "bash", ops: [{ c: rawDispatch }] }],
			notes: ["string → bash[1]"],
			changed: true,
		};
	}

	if (!Array.isArray(rawDispatch)) {
		return { dispatch: [], notes: [], changed: true };
	}

	const notes: string[] = [];
	const dispatch: Array<{ tool: "batch" | "bash" | "web"; ops: unknown[] }> = [];
	let changed = false;

	for (let i = 0; i < rawDispatch.length; i++) {
		const group = rawDispatch[i];
		if (group === null || group === undefined) {
			changed = true;
			notes.push(`dispatch[${i}]: dropped null/undefined`);
			continue;
		}
		if (typeof group !== "object" || Array.isArray(group)) {
			changed = true;
			const type = Array.isArray(group) ? "array" : typeof group;
			notes.push(`dispatch[${i}]: dropped non-object (${type})`);
			continue;
		}
		const rawG = group as Record<string, unknown>;
		const wrapperResult = applyDispatchWrapperAliases(rawG);
		if (wrapperResult.aliased) notes.push("aliased dispatch wrapper");
		if (wrapperResult.changed) changed = true;
		const g = wrapperResult.result;

		const tool = g.tool;
		if (tool !== "batch" && tool !== "bash" && tool !== "web") {
			changed = true;
			continue;
		}

		let ops = g.ops;

		// Handle bare string ops
		if (typeof ops === "string") {
			ops = [{ c: ops }];
			notes.push("string → bash[1]");
			changed = true;
		}

		// Handle single object ops (wrap in array) or nested dispatcher
		if (ops && typeof ops === "object" && !Array.isArray(ops)) {
			const opsObj = ops as Record<string, unknown>;
			// Check for nested dispatcher: { tool, ops: { item: {...} } }
			if (opsObj.item && typeof opsObj.item === "object") {
				if (Array.isArray(opsObj.item)) {
					ops = opsObj.item;
				} else {
					ops = [opsObj.item];
				}
				notes.push("flattened nested dispatcher");
				changed = true;
			} else {
				ops = [ops];
				notes.push("single obj → array[1]");
				changed = true;
			}
		}

		const opsArray = Array.isArray(ops) ? ops : [];
		if (opsArray !== ops) {
			changed = true;
		}

		const normalizedOps: unknown[] = [];

		for (const op of opsArray) {
			if (typeof op === "string") {
				normalizedOps.push({ c: op });
				notes.push("string → bash[1]");
				changed = true;
				continue;
			}

			if (!op || typeof op !== "object") {
				changed = true;
				continue;
			}

			const opObj = op as Record<string, unknown>;

			// Flatten nested dispatcher inside ops array: { tool: 'bash', ops: { item: {...} } }
			if (opObj.tool && opObj.ops) {
				const innerOps = opObj.ops as Record<string, unknown>;
				if (innerOps.item && typeof innerOps.item === "object") {
					if (Array.isArray(innerOps.item)) {
						for (const innerItem of innerOps.item) {
							const flatOp = { ...(innerItem as Record<string, unknown>) };
							const aliased = applyOpAliases(flatOp, tool as "batch" | "bash" | "web");
							if (aliased.aliased) notes.push("aliased op");
							if (aliased.changed) changed = true;
							const inferred = applyInference(aliased.result, tool as string, notes, normalizedOps);
							if (inferred) changed = true;
						}
					} else {
						const flatOp = { ...innerOps.item } as Record<string, unknown>;
						const aliased = applyOpAliases(flatOp, tool as "batch" | "bash" | "web");
						if (aliased.aliased) notes.push("aliased op");
						if (aliased.changed) changed = true;
						const inferred = applyInference(aliased.result, tool as string, notes, normalizedOps);
						if (inferred) changed = true;
					}
					notes.push("flattened nested dispatcher");
					changed = true;
					continue;
				}
			}

			const aliasedOp = applyOpAliases(opObj, tool as "batch" | "bash" | "web");
			if (aliasedOp.aliased) notes.push("aliased op");
			if (aliasedOp.changed) changed = true;

			// Strip stray 'tool' key from bash ops
			if (tool === "bash" && aliasedOp.result.tool !== undefined) {
				const { tool: _, ...rest } = aliasedOp.result;
				normalizedOps.push(rest);
				notes.push("stripped stray tool");
				changed = true;
				continue;
			}

			const inferred = applyInference(aliasedOp.result, tool as string, notes, normalizedOps);
			if (inferred) changed = true;
		}

		// Preserve unknown wrapper keys for forward compatibility
		dispatch.push({ tool: tool as "batch" | "bash" | "web", ...g, ops: normalizedOps });
	}

	// If no structural changes were made, return the original array to preserve
	// reference equality so upstream callers can detect whether normalization occurred.
	if (notes.length === 0 && !changed) {
		return {
			dispatch: rawDispatch as Array<{ tool: "batch" | "bash" | "web"; ops: unknown[] }>,
			notes: [],
			changed: false,
		};
	}

	return { dispatch, notes, changed: true };
}

function applyInference(
	opObj: Record<string, unknown>,
	tool: string,
	notes: string[],
	normalizedOps: unknown[],
): boolean {
	if (tool === "batch") {
		if (opObj.o === undefined) {
			if (opObj.c !== undefined && opObj.p === undefined) {
				normalizedOps.push({ ...opObj, o: "bash", p: opObj.c });
				notes.push("inferred o=bash");
				return true;
			} else if (opObj.e !== undefined) {
				normalizedOps.push({ ...opObj, o: "edit" });
				notes.push("inferred o=edit");
				return true;
			} else if (opObj.c !== undefined) {
				normalizedOps.push({ ...opObj, o: "write" });
				notes.push("inferred o=write");
				return true;
			} else if (opObj.p !== undefined) {
				normalizedOps.push({ ...opObj, o: "read" });
				notes.push("inferred o=read");
				return true;
			}
		}
	}

	if (tool === "web") {
		if (opObj.o === undefined) {
			if (opObj.q !== undefined) {
				normalizedOps.push({ ...opObj, o: "search" });
				notes.push("inferred o=search");
				return true;
			} else if (opObj.u !== undefined) {
				normalizedOps.push({ ...opObj, o: "fetch" });
				notes.push("inferred o=fetch");
				return true;
			}
		}
	}

	normalizedOps.push(opObj);
	return false;
}

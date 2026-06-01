export type DispatchPrepResult = {
	dispatch: Array<{ tool: "batch" | "bash" | "web"; ops: unknown[] }>;
	notes: string[];
};

export function prepareTraceDispatchArguments(input: unknown): DispatchPrepResult {
	if (!input || typeof input !== "object") {
		return { dispatch: [], notes: [] };
	}

	const args = input as Record<string, unknown>;
	const rawDispatch = args.dispatch;

	if (!rawDispatch) {
		return { dispatch: [], notes: [] };
	}

	if (typeof rawDispatch === "string") {
		return {
			dispatch: [{ tool: "bash", ops: [{ c: rawDispatch }] }],
			notes: ["string → bash[1]"],
		};
	}

	if (!Array.isArray(rawDispatch)) {
		return { dispatch: [], notes: [] };
	}

	const notes: string[] = [];
	const dispatch: Array<{ tool: "batch" | "bash" | "web"; ops: unknown[] }> = [];

	for (const group of rawDispatch) {
		if (!group || typeof group !== "object") continue;
		const g = group as Record<string, unknown>;

		const tool = g.tool;
		if (tool !== "batch" && tool !== "bash" && tool !== "web") {
			continue;
		}

		let ops = g.ops;

		// Handle bare string ops
		if (typeof ops === "string") {
			ops = [{ c: ops }];
			notes.push("string → bash[1]");
		}

		// Handle single object ops (wrap in array) or nested dispatcher
		if (ops && typeof ops === "object" && !Array.isArray(ops)) {
			const opsObj = ops as Record<string, unknown>;
			// Check for nested dispatcher: { tool, ops: { item: {...} } }
			if (opsObj.item && typeof opsObj.item === "object" && !Array.isArray(opsObj.item)) {
				ops = [opsObj.item];
				notes.push("flattened nested dispatcher");
			} else {
				ops = [ops];
				notes.push("single obj → array[1]");
			}
		}

		const opsArray = Array.isArray(ops) ? ops : [];

		const normalizedOps: unknown[] = [];

		for (const op of opsArray) {
			if (typeof op === "string") {
				normalizedOps.push({ c: op });
				notes.push("string → bash[1]");
				continue;
			}

			if (!op || typeof op !== "object") {
				continue;
			}

			const opObj = op as Record<string, unknown>;

			// Flatten nested dispatcher inside ops array: { tool: 'bash', ops: { item: {...} } }
			if (opObj.tool && opObj.ops) {
				const innerOps = opObj.ops as Record<string, unknown>;
				if (innerOps.item && typeof innerOps.item === "object" && !Array.isArray(innerOps.item)) {
					const flatOp = { ...innerOps.item } as Record<string, unknown>;
					applyInference(flatOp, tool as string, notes, normalizedOps);
					notes.push("flattened nested dispatcher");
					continue;
				}
			}

			// Strip stray 'tool' key from bash ops
			if (tool === "bash" && opObj.tool !== undefined) {
				const { tool: _, ...rest } = opObj;
				normalizedOps.push(rest);
				notes.push("stripped stray tool");
				continue;
			}

			applyInference(opObj, tool as string, notes, normalizedOps);
		}

		dispatch.push({ tool: tool as "batch" | "bash" | "web", ops: normalizedOps });
	}

	return { dispatch, notes };
}

function applyInference(
	opObj: Record<string, unknown>,
	tool: string,
	notes: string[],
	normalizedOps: unknown[],
): void {
	if (tool === "batch") {
		if (opObj.o === undefined) {
			if (opObj.c !== undefined && opObj.p === undefined) {
				normalizedOps.push({ ...opObj, o: "bash", p: opObj.c });
				notes.push("inferred o=bash");
				return;
			} else if (opObj.e !== undefined) {
				normalizedOps.push({ ...opObj, o: "edit" });
				notes.push("inferred o=edit");
				return;
			} else if (opObj.c !== undefined) {
				normalizedOps.push({ ...opObj, o: "write" });
				notes.push("inferred o=write");
				return;
			} else if (opObj.p !== undefined) {
				normalizedOps.push({ ...opObj, o: "read" });
				notes.push("inferred o=read");
				return;
			}
		}
	}

	if (tool === "web") {
		if (opObj.o === undefined) {
			if (opObj.q !== undefined) {
				normalizedOps.push({ ...opObj, o: "search" });
				notes.push("inferred o=search");
				return;
			} else if (opObj.u !== undefined) {
				normalizedOps.push({ ...opObj, o: "fetch" });
				notes.push("inferred o=fetch");
				return;
			}
		}
	}

	normalizedOps.push(opObj);
}

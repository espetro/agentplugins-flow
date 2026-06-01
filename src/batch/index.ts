/**
 * batch — re-export shim.
 *
 * The batch tool is now a CLI-style tool (src/cli/batch.ts).
 * This file re-exports the new factory and legacy symbols for
 * backward compatibility with existing imports.
 */

export { createBatchCliTool } from "../cli/register.js";
export { WeavePatchParams } from "./schema.js";

// Re-export polling tool factory and tracker from batch-bash
export { BashProcessTracker, createBatchBashPollTool, pollBatchBashResults, runBashWithLimits } from "./batch-bash.js";

// Backward-compatible alias: createBatchTool → createBatchCliTool
export { createBatchCliTool as createBatchTool } from "../cli/register.js";

// Legacy prepareArguments for backward compatibility
import { coerceArrayOfObjects } from "../tools/array-coerce.js";
import { normalizeBatchOp } from "./normalize.js";

export function prepareBatchArguments(input: unknown): { o: unknown[]; w?: unknown[] } | unknown {
	if (!input || typeof input !== "object") return { o: [] };
	const args = input as Record<string, unknown>;

	if (
		typeof args.oldText === "string" &&
		typeof args.newText === "string" &&
		typeof args.path === "string"
	) {
		return {
			o: [
				normalizeBatchOp({
					o: "edit",
					p: args.path,
					e: [{ oldText: args.oldText, newText: args.newText }],
				}),
			],
		};
	}

	let opsArray: unknown[];
	if (Array.isArray(args.o)) {
		opsArray = args.o;
	} else if (Array.isArray(args.op)) {
		opsArray = args.op;
	} else if (Array.isArray(args.operations)) {
		opsArray = args.operations;
	} else if (Array.isArray(args)) {
		opsArray = args;
	} else if (typeof args.p === "string" || typeof args.path === "string") {
		opsArray = [args];
	} else {
		opsArray = [];
	}

	const sanitized = coerceArrayOfObjects<Record<string, unknown>>(opsArray, { label: "batch.o" });
	const result: { o: unknown[]; w?: unknown[] } = {
		o: sanitized.value.map((op) => normalizeBatchOp(op)),
	};

	if (Array.isArray(args.w)) {
		const sanitizedW = coerceArrayOfObjects<Record<string, unknown>>(args.w, { label: "batch.w" });
		if (sanitizedW.value.length > 0) {
			result.w = sanitizedW.value;
		} else if (args.w.length > 0) {
			result.w = [];
		}
	}

	return result;
}

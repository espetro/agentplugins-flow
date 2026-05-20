/**
 * batch — tool definition factory.
 *
 * Creates the `batch` and `batch_read` tool instances with schema, argument
 * preparation, execution, and rendering wired up.
 */

import { Type } from "@sinclair/typebox";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BatchTheme, FileOpInput, BatchOnUpdate } from "./constants.js";
import { SAFE_FULL_READ_LIMIT, TARGETED_READ_LINE_LIMIT, BASH_SOFT_TIMEOUT_MS, MAX_LINES, MAX_BYTES, MAX_BASH_OUTPUT_LINES, MAX_BASH_OUTPUT_BYTES } from "./constants.js";
import { executeOperations, suggestSimilarFiles } from "./execute.js";
import { expandTilde, isWithinDirectory } from "./fuzzy-edit.js";
import {
	renderBatchCall,
	renderBatchReadCall,
	renderBatchResult,
	renderBatchReadResult,
} from "./render.js";
import {
	type BashProcessTracker,
	generateBashId,
	normalizeBashOp,
	executeBatchBash,
} from "./batch-bash.js";
import { appendDirectiveOnce } from "../steering/tool-utils.js";
import { runWebOps } from "../tools/web-ops.js";

// Re-export polling tool factory and tracker from batch-bash
export { BashProcessTracker, createBatchBashPollTool, pollBatchBashResults, runBashWithLimits } from "./batch-bash.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const EditOp = Type.Object({
	f: Type.String({
		description:
			"Exact text to find (oldText). Must be unique in the file. All edits matched against original file, not incrementally.",
	}),
	r: Type.String({ description: "Replacement text (newText)." }),
});

const FileOp = Type.Object({
	o: Type.Union([
		Type.Literal("read"),
		Type.Literal("write"),
		Type.Literal("edit"),
		Type.Literal("delete"),
		Type.Literal("bash"),
		Type.Literal("rg"),
		Type.Literal("patch"),
	]),
	p: Type.String({ description: "Path to the file (relative or absolute). Use 'bash' or any string for o: 'bash'." }),
	c: Type.Optional(
		Type.String({
			description:
				"File content for o: 'write'. Shell command for o: 'bash'. Patch text for o: 'patch'.",
		}),
	),
	e: Type.Optional(
		Type.Array(EditOp, {
			description:
				"One or more targeted replacements matched against the original file, not incrementally.",
		}),
	),
	s: Type.Optional(
		Type.Number({
			minimum: 1,
			description:
				"1-indexed line number to start reading from (offset). Used with o: 'read'.",
		}),
	),
	l: Type.Optional(
		Type.Union([
			Type.Number({
				minimum: 1,
				description:
					"Maximum number of lines to read (limit). Used with o: 'read'.",
			}),
			Type.Boolean({
				description:
					"Files-with-matches flag for o: 'rg'. Default false — returns matching lines with content. Set true to get filenames only.",
			}),
		]),
	),
	i: Type.Optional(
		Type.Union([
			Type.String({
				description: "Unique ID for this bash operation. Auto-generated if omitted. Used with o: 'bash'.",
			}),
			Type.Boolean({
				description: "Ignore-case flag for o: 'rg'. Used with o: 'rg'.",
			}),
		]),
	),
	t: Type.Optional(
		Type.Union([
			Type.Number({
				minimum: 1,
				description: `Soft timeout in ms. Default: ${BASH_SOFT_TIMEOUT_MS}. Command keeps running after timeout; returns partial output with pending status. Used with o: 'bash'.`,
			}),
			Type.String({
				description: "Type filter for o: 'rg' (e.g., 'ts', 'js'). Used with o: 'rg'.",
			}),
		]),
	),
	h: Type.Optional(
		Type.String({
			description: "Working directory override for this command. Used with o: 'bash'.",
		}),
	),
	q: Type.Optional(
		Type.String({
			description: "Search pattern for o: 'rg'.",
		}),
	),
	n: Type.Optional(
		Type.Number({
			minimum: 1,
			description: "Max-count for o: 'rg'.",
		}),
	),
	u: Type.Optional(
		Type.Number({
			minimum: 0,
			maximum: 3,
			description: "Ignore level for o: 'rg' (0-3). Maps to -u (0), -uu (1), -uuu (2-3).",
		}),
	),
});

const WebOp = Type.Union([
	Type.Object({
		o: Type.Literal("search"),
		q: Type.String({ minLength: 1, description: "Search query" }),
	}),
	Type.Object({
		o: Type.Literal("fetch"),
		u: Type.String({ minLength: 1, description: "URL to fetch" }),
		f: Type.Optional(
			Type.Union([Type.Literal("markdown"), Type.Literal("text"), Type.Literal("html")], {
				description: "Output format (default: markdown). Content is saved to a temp file — use read ops to access.",
			}),
		),
	}),
]);

export const WeavePatchParams = Type.Object({
	o: Type.Array(FileOp, {
		description:
			"Ordered list of operations. File ops (read/write/edit/delete) execute sequentially — each operation executes independently; failures are reported per-operation without stopping remaining ops. Bash ops (bash) run in parallel after file ops complete and do not skip each other on failure.",
	}),
	w: Type.Optional(
		Type.Array(WebOp, {
			description:
				"Web operations (search or fetch) to perform. Executed after file ops, before bash ops. Use w: [{ o: 'search', q: '...' }] or w: [{ o: 'fetch', u: '...', f: 'markdown' }]",
		}),
		),
});

const BatchReadOp = Type.Union([
	Type.Object({
		o: Type.Literal("read"),
		p: Type.String({ description: "Path to the file (relative or absolute)" }),
		s: Type.Optional(
			Type.Number({
				minimum: 1,
				description:
					"1-indexed line number to start reading from (offset). Used with o: 'read'.",
			}),
		),
		l: Type.Optional(
			Type.Number({
				minimum: 1,
				description:
					"Maximum number of lines to read (limit). Used with o: 'read'.",
			}),
		),
	}),
	Type.Object({
		o: Type.Literal("rg"),
		p: Type.String({ description: "Path to search (relative or absolute). Use '.' for cwd." }),
		q: Type.String({ description: "Search pattern for o: 'rg'." }),
		l: Type.Optional(
			Type.Boolean({
				description:
					"Files-with-matches flag for o: 'rg'. Default true.",
			}),
		),
		i: Type.Optional(
			Type.Boolean({
				description: "Ignore-case flag for o: 'rg'.",
			}),
		),
		t: Type.Optional(
			Type.String({
				description: "Type filter for o: 'rg' (e.g., 'ts', 'js').",
			}),
		),
		n: Type.Optional(
			Type.Number({
				minimum: 1,
				description: "Max-count for o: 'rg'.",
			}),
		),
		u: Type.Optional(
			Type.Number({
				minimum: 0,
				maximum: 3,
				description: "Ignore level for o: 'rg' (0-3). Maps to -u (0), -uu (1), -uuu (2-3).",
			}),
		),
	}),
]);

export const BatchReadParams = Type.Object({
	o: Type.Array(BatchReadOp, {
		description:
			"Ordered list of read operations. Executed sequentially. Each operation executes independently; failures are reported per-operation without stopping remaining ops.",
	}),
});

// ---------------------------------------------------------------------------
// Argument preparation
// ---------------------------------------------------------------------------

function normalizeOp(raw: Record<string, unknown>): Record<string, unknown> {
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
		try { editsRaw = JSON.parse(editsRaw); } catch { /* ignore */ }
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

function prepareArguments(input: unknown): { o: unknown[]; w?: unknown[] } | unknown {
	if (!input || typeof input !== "object") return { o: [] };

	const args = input as Record<string, unknown>;

	// Handle legacy top-level format: { path, oldText, newText }
	if (
		typeof args.oldText === "string" &&
		typeof args.newText === "string" &&
		typeof args.path === "string"
	) {
		return {
			o: [
				normalizeOp({
					o: "edit",
					p: args.path,
					e: [{ oldText: args.oldText, newText: args.newText }],
				}),
			],
		};
	}

	// Extract ops array — canonical { o: [...] }, legacy { op: [...] }, legacy { operations: [...] }, or bare array
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
		// Single-operation shorthand: { p: "...", o: "read" }
		opsArray = [args];
	} else {
		opsArray = [];
	}

	// Normalize each operation to single-letter form
	const result: { o: unknown[]; w?: unknown[] } = {
		o: opsArray.map((op: unknown) => {
			if (!op || typeof op !== "object") return op;
			return normalizeOp(op as Record<string, unknown>);
		}),
	};

	// Extract web ops if present
	if (Array.isArray(args.w)) {
		result.w = args.w;
	}

	return result;
}

function prepareBatchReadArguments(input: unknown): { o: FileOpInput[] } | unknown {
	const prepared = prepareArguments(input);
	const ops = Array.isArray(prepared) ? prepared : (prepared as { o: unknown[] }).o;
	if (!Array.isArray(ops)) return { o: [] };

	// batch_read is local-only — reject web ops
	const webOpsInRead = (prepared as { w?: unknown[] }).w;
	if (webOpsInRead && webOpsInRead.length > 0) {
		throw new Error("batch_read does not support web operations. Use the full `batch` tool with w: [...] for web ops.");
	}

	const allowedBatchReadOps = new Set(["read", "rg"]);
	for (const op of ops) {
		if (!op || typeof op !== "object") continue;
		const obj = op as Record<string, unknown>;
		const opType = String(obj.o ?? obj.op ?? "").toLowerCase();
		if (opType && !allowedBatchReadOps.has(opType)) {
			throw new Error(`batch_read only supports read operations. Received: ${opType}`);
		}
	}
	return prepared;
}

// ---------------------------------------------------------------------------
// Tool factories
// ---------------------------------------------------------------------------

export function createBatchReadTool() {
	return {
		name: "batch_read",
		label: "batch_read",
		description: "Batch read-only file operations. Useful for reading multiple files or sections at once.",
		promptSnippet: "Batch read-only file operations — run multiple read ops in one call",
		promptGuidelines: [
			"Use `batch_read` to perform multiple reads in one call.",
			"Large files return a context map; use targeted `s` (offset) and `l` (limit) to read specific parts.",
		],
		parameters: BatchReadParams,
		prepareArguments: prepareBatchReadArguments,

		async execute(
			_toolCallId: string,
			input: unknown,
			signal: AbortSignal | undefined,
			onUpdate: BatchOnUpdate | undefined,
			ctx: ExtensionContext,
		) {
			const prepared = prepareBatchReadArguments(input);

			const ops = Array.isArray(prepared)
				? (prepared as FileOpInput[])
				: (prepared as { o: FileOpInput[] }).o;

			if (!Array.isArray(ops) || ops.length === 0) {
				throw new Error("Error: o array is required and must not be empty.");
			}

			// Defensive validation: reject any non-read/rg operations
			const allowedBatchReadOps = new Set(["read", "rg"]);
			for (const op of ops) {
				if (!allowedBatchReadOps.has(op.o)) {
					throw new Error(`Error: batch_read only supports read operations. Received ${op.o} for ${op.p}.`);
				}
			}

			if (signal?.aborted) {
				throw new Error("Operation aborted.");
			}

			const { contentText, results } = await executeOperations(ops, ctx.cwd, signal, {
				readOptions: { truncate: false, toolName: "batch_read" },
				includeLimitWarnings: false,
			}, onUpdate);

			const readResult = {
				content: [{ type: "text", text: contentText }],
				details: { results },
			};
			appendDirectiveOnce(readResult);
			return readResult;
		},

		renderCall: (args: Record<string, unknown>, theme: BatchTheme) => renderBatchReadCall(args, theme),
		renderResult: (result: any, { expanded, isPartial }: { expanded: boolean; isPartial?: boolean }, theme: BatchTheme, args?: Record<string, unknown>) =>
			renderBatchReadResult(result, { expanded, isPartial: isPartial ?? false }, theme, args),
	};
}

/**
 * Create the batch tool.
 *
 * @param bashTracker Optional BashProcessTracker for executing bash operations.
 *   When omitted, bash ops return an error. Both the batch tool and the
 *   batch_bash_poll tool must share the same tracker instance.
 */
export function createBatchTool(bashTracker?: BashProcessTracker, toolOptimize?: boolean) {
	return {
		name: "batch",
		label: "batch",
		description: "Unified tool for file ops (read/write/edit/delete/patch), shell commands, and web operations.",
		promptSnippet: "Batch operations — run multiple file ops and bash commands in one call",
		promptGuidelines: [
			"ALWAYS combine pending operations into a single `batch` call.",
			"File ops run sequentially; bash ops run in parallel after file and web ops complete.",
			"Use `o: 'write'` then `o: 'bash'` to run scripts.",
			"Use `w: [...]` for web search/fetch.",
			...(toolOptimize ? ["In this mode batch is your ONLY edit tool — there is no separate edit command."] : []),
		],
		parameters: WeavePatchParams,
		prepareArguments: prepareArguments,

		async execute(
			_toolCallId: string,
			input: unknown,
			signal: AbortSignal | undefined,
			onUpdate: BatchOnUpdate | undefined,
			ctx: ExtensionContext,
		) {
			const prepared = prepareArguments(input);
			// prepareArguments always returns { o: [...] }, but handle
			// legacy bare arrays for backward compatibility
			const ops = Array.isArray(prepared)
				? prepared as FileOpInput[]
				: (prepared as { o: FileOpInput[] }).o;

			// Extract web ops (pass-through, no normalization needed)
			const webOps = (prepared as { w?: unknown[] }).w;

			const hasFileOps = Array.isArray(ops) && ops.length > 0;
			const hasWebOps = Array.isArray(webOps) && webOps.length > 0;
			if (!hasFileOps && !hasWebOps) {
				throw new Error("Error: o or w array must not be empty.");
			}

			if (signal?.aborted) {
				throw new Error("Operation aborted.");
			}

			// Split ops into file ops and bash ops
			const fileOps: FileOpInput[] = [];
			const bashOps: FileOpInput[] = [];
			if (hasFileOps) {
				for (const op of ops) {
					if (op.o === "bash") {
						bashOps.push(op);
					} else {
						fileOps.push(op);
					}
				}
			}

			// Execute file ops first (sequential)
			let fileContentText = "";
			let fileResults: import("./constants.js").OpResult[] = [];

			if (fileOps.length > 0) {
				const fileOutput = await executeOperations(fileOps, ctx.cwd, signal, {}, onUpdate);
				fileContentText = fileOutput.contentText;
				fileResults = fileOutput.results;
			}

			// Emit update after file ops
			if (onUpdate && fileOps.length > 0) {
				onUpdate({
					content: [{ type: "text", text: fileContentText }],
					details: { results: fileResults },
				});
			}

			// Execute web ops after file ops, before bash ops (sequential)
			let webContentText = "";
			let webResults: import("./constants.js").OpResult[] = [];

			if (Array.isArray(webOps) && webOps.length > 0) {
				try {
					const webOutput = await runWebOps({ op: webOps as import("../tools/web-ops.js").WebOpInput[] }, ctx, signal);
					webContentText = webOutput.content[0].text;
					webResults = webOutput.details.ops as unknown as import("./constants.js").OpResult[];
				} catch (err) {
					// Catastrophic failure in runWebOps itself (should not happen with per-op handling)
					const errorText = err instanceof Error ? err.message : String(err);
					webContentText = `\n--- web error (unexpected) ---\n${errorText}`;
					webResults = [];
				}

				// Emit update after web ops
				if (onUpdate) {
					onUpdate({
						content: [{ type: "text", text: [fileContentText, webContentText].filter(Boolean).join("\n") }],
						details: { results: [...fileResults, ...webResults] },
					});
				}
			}

			// Execute bash ops in parallel after file and web ops complete.
			// Bash ops run regardless of file or web op failures.
			let bashResults: import("./constants.js").OpResult[] = [];
			let bashContentText = "";

			if (bashOps.length > 0 && bashTracker) {
				const normalizedBashOps = bashOps.map((op) => ({
					i: op.i ?? generateBashId(),
					c: op.c ?? "",
					t: op.t,
					h: op.h,
				}));

				const bashOutput = await executeBatchBash(
					normalizedBashOps,
					ctx.cwd,
					bashTracker,
					signal,
				);

				bashResults = bashOutput;

				// Format bash results into content text
				const bashLines: string[] = [];
				for (const r of bashOutput) {
					if (r.status === "ok") {
						bashLines.push(`\n--- bash [${r.id}] exit ${r.exitCode} ---`);
						if (r.timingTier) bashLines.push(`[Execution time: ${r.timingTier}]`);
						if (r.stdout?.trim()) bashLines.push(r.stdout.trimEnd());
					} else if (r.status === "pending") {
						bashLines.push(`\n--- bash [${r.id}] pending ---`);
						if (r.stdout?.trim()) bashLines.push(`[partial output]\n${r.stdout.trimEnd()}`);
						bashLines.push(`[Use batch_bash_poll with i: ["${r.id}"] to check results]`);
					} else {
						bashLines.push(`\n--- bash [${r.id}] error ---`);
						if (r.timingTier) bashLines.push(`[Execution time: ${r.timingTier}]`);
						if (r.stdout?.trim()) bashLines.push(r.stdout.trimEnd());
						if (r.stderr?.trim()) bashLines.push(`[stderr]\n${r.stderr.trimEnd()}`);
					}
				}
				bashContentText = bashLines.join("\n");
			} else if (bashOps.length > 0 && !bashTracker) {
				bashResults = bashOps.map((op) => ({
					op: "bash" as const,
					path: op.p,
					status: "error" as const,
					id: op.i,
					command: op.c,
					error: "Bash tracker not available.",
				}));
				bashContentText = "\n--- bash: tracker not available ---";
			}

			// Combine results
			const allResults = [...fileResults, ...webResults, ...bashResults];
			const contentText = [fileContentText, webContentText, bashContentText].filter(Boolean).join("\n");

			// Emit final update after bash ops complete
			if (onUpdate && (bashOps.length > 0 || (Array.isArray(webOps) && webOps.length > 0))) {
				onUpdate({
					content: [{ type: "text", text: contentText }],
					details: { results: allResults },
				});
			}

			const batchResult = {
				content: [{ type: "text", text: contentText }],
				details: { results: allResults },
			};
			appendDirectiveOnce(batchResult);
			return batchResult;
		},

		renderCall: (args: Record<string, unknown>, theme: BatchTheme) => renderBatchCall(args, theme),
		renderResult: (result: any, { expanded, isPartial }: { expanded: boolean; isPartial?: boolean }, theme: BatchTheme, args?: Record<string, unknown>) =>
			renderBatchResult(result, { expanded, isPartial: isPartial ?? false }, theme, args),
	};
}

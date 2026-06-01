/**
 * Legacy batch schema (preserved for backward compatibility with tests).
 */

import { Type } from "@sinclair/typebox";

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
				description: "Timeout in ms. Default: 120000. Commands keep running after soft timeout; returns partial output with pending status. Used with o: 'bash'.",
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
			description: "Max-count for o: 'rg' (matches per file). Broad searches on '.' auto-default to 50 when omitted.",
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

export const WeavePatchParams = Type.Object({
	o: Type.Array(FileOp, {
		description:
			"Ordered list of operations. File ops (read/write/edit/delete) execute sequentially — each operation executes independently; failures are reported per-operation without stopping remaining ops. Bash ops (bash) run in parallel after file ops complete and do not skip each other on failure.",
	}),
	w: Type.Optional(
		Type.Array(Type.Object({
			o: Type.Union([Type.Literal("search"), Type.Literal("fetch")]),
			q: Type.String({ minLength: 1, description: "Search query" }),
			u: Type.Optional(Type.String({ minLength: 1, description: "URL to fetch" })),
			f: Type.Optional(Type.String({ description: "Output format" })),
		}), {
			description:
				"Web operations (search or fetch) to perform. Executed after file ops, before bash ops. Use w: [{ o: 'search', q: '...' }] or w: [{ o: 'fetch', u: '...', f: 'markdown' }]",
		}),
	),
});

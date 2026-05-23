/**
 * Core-2 snapshot builder — dead-simple fork snapshot.
 *
 * Strips batch read/write/edit bodies (keeping first 3 + last 3 lines as
 * orientation) and preserves all other conversation verbatim in
 * chronological order.
 */

export interface SessionSnapshotSource {
	getHeader: () => unknown;
	getBranch: () => unknown[];
}

export interface BuildCore2SnapshotOptions {
	forkedFrom?: string;
	forkedAt?: string;
	parentFlow?: string;
	depth?: number;
	activeToolCallId?: string;
}

export function buildCore2Snapshot(
	sessionManager: SessionSnapshotSource,
	options?: BuildCore2SnapshotOptions,
): string | null {
	const header = sessionManager.getHeader();
	if (!header || typeof header !== "object") return null;

	// Compress cwd in session header: relative to repo root if under it,
	// otherwise basename only. Saves ~50-100 bytes per snapshot.
	const repoRoot = process.cwd();
	let compressedHeader = header as Record<string, unknown>;
	if (typeof compressedHeader.cwd === "string") {
		const cwd = compressedHeader.cwd;
		let compressedCwd: string;
		if (cwd === repoRoot) {
			compressedCwd = ".";
		} else if (cwd.startsWith(repoRoot + "/") || cwd.startsWith(repoRoot + "\\")) {
			compressedCwd = cwd.slice(repoRoot.length + 1);
		} else {
			const lastSep = Math.max(cwd.lastIndexOf("/"), cwd.lastIndexOf("\\"));
			compressedCwd = lastSep >= 0 ? cwd.slice(lastSep + 1) : cwd;
		}
		if (compressedCwd !== cwd) {
			compressedHeader = { ...compressedHeader, cwd: compressedCwd };
		}
	}

	const branchEntries = sessionManager.getBranch();
	const lines: string[] = [];

	// Emit session header once, unless getBranch() already includes it as the
	// first entry (some session managers include the header in the branch).
	const firstBranch = branchEntries[0];
	const headerId = (header as Record<string, unknown>)?.id;
	const firstId =
		firstBranch && typeof firstBranch === "object"
			? (firstBranch as Record<string, unknown>)?.id
			: undefined;
	const firstType =
		firstBranch && typeof firstBranch === "object"
			? (firstBranch as Record<string, unknown>)?.type
			: undefined;
	if (
		!firstBranch ||
		typeof firstBranch !== "object" ||
		(firstType !== "session" && firstType !== "header") ||
		firstId !== headerId
	) {
		lines.push(JSON.stringify(compressedHeader));
	}

	for (const entry of branchEntries) {
		let processedEntry = maybeStripCompaction(entry);
		if (!processedEntry) continue;

		if (options?.activeToolCallId) {
			processedEntry = stripActiveToolCall(processedEntry, options.activeToolCallId);
			if (!processedEntry) continue;
		}

		const line = JSON.stringify(processedEntry);
		// Strip batch read/write/edit bodies from tool result messages
		const processed = maybeStripBatchBodies(line);
		lines.push(processed);
	}

	return `${lines.join("\n")}\n`;
}

/**
 * Filter compaction-related entries from the snapshot.
 * - Strips compaction_trigger entirely (internal signal).
 * - Replaces compaction/context_compaction with a lightweight readable summary.
 */
function maybeStripCompaction(entry: unknown): unknown | null {
	if (!entry || typeof entry !== "object") return entry;
	const e = entry as Record<string, unknown>;

	if (e.type === "compaction_trigger") {
		return null;
	}

	if (e.type === "compaction" || e.type === "context_compaction") {
		// Replace potentially large and encrypted compaction entries with a
		// lightweight verbatim summary for child flows.
		const summary = typeof e.summary === "string" ? e.summary : "Parent context was compacted.";
		const tokensSaved = typeof e.tokensBefore === "number" ? e.tokensBefore : undefined;

		return {
			type: "message",
			message: {
				role: "system",
				content: `[Context Compacted] ${summary}${tokensSaved ? ` (${tokensSaved} tokens summarized)` : ""}`,
			},
		};
	}

	return entry;
}

// ---------------------------------------------------------------------------
// Batch body stripping
// ---------------------------------------------------------------------------

/** Headers that delimit the end of any batch tool section. */
function isKnownSectionHeader(line: string): boolean {
	return [
		/^--- (.+) \((\d+) lines\) ---$/,
		/^--- (.+) (context map|file summary) ---$/,
		/^--- bash \[.+\] (exit (\d+)|pending|error) ---$/,
		/^--- \[.+\] (exit (\d+)|interrupted) ---$/,
		/^--- \[.+\] still running ---$/,
		/^--- edit: .+ ---$/,
		/^--- write: .+ ---$/,
		/^--- delete: .+ ---$/,
		/^--- read: .+ ---$/,
		/^--- rg: .+ ---$/,
		/^--- patch: .+ ---$/,
		/^--- (?!bash \[|edit:|write:|delete:|read:|rg:|patch:)(.+) ---$/,
	].some((re) => re.test(line));
}

/** Headers that identify a batch read/write/edit section to strip. */
function isBatchSectionHeader(line: string): boolean {
	return (
		/^--- (.+) \((\d+) lines\) ---$/.test(line) ||
		/^--- (.+) (context map|file summary) ---$/.test(line) ||
		/^--- read: (.+) ---$/.test(line) ||
		/^--- write: (.+) \((\d+) bytes\) ---$/.test(line) ||
		/^--- write: (.+) ---$/.test(line) ||
		/^--- edit: (.+) \(([^)]*)\) ---$/.test(line) ||
		/^--- edit: (.+) ---$/.test(line)
	);
}

/** Replace batch section bodies with first 3 + last 3 lines as orientation. */
export function stripBatchBodies(text: string): string {
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	const out: string[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];
		if (isBatchSectionHeader(line)) {
			out.push(line);
			i++;
			const body: string[] = [];
			while (i < lines.length && !isKnownSectionHeader(lines[i])) {
				body.push(lines[i]);
				i++;
			}
			if (body.length > 6) {
				out.push(...body.slice(0, 3));
				out.push(`[...${body.length - 6} lines truncated...]`);
				out.push(...body.slice(-3));
			} else {
				out.push(...body);
			}
		} else {
			out.push(line);
			i++;
		}
	}

	return out.join("\n");
}

/** If the JSONL line is a tool/toolResult message, strip batch bodies from its text. */
function maybeStripBatchBodies(line: string): string {
	// Fast path: skip non-tool messages without parsing JSON.
	if (!line.includes('"role":"tool"') && !line.includes('"role":"toolResult"')) {
		return line;
	}

	let entry: Record<string, unknown>;
	try {
		entry = JSON.parse(line) as Record<string, unknown>;
	} catch {
		return line;
	}

	if (entry.type !== "message" || !entry.message) {
		return line;
	}

	const message = entry.message as Record<string, unknown>;
	if (message.role !== "tool" && message.role !== "toolResult") {
		return line;
	}

	// Extract text content (string or first text part in array)
	let text: string | undefined;
	let textIndex: number | undefined;

	if (typeof message.content === "string") {
		text = message.content;
	} else if (Array.isArray(message.content)) {
		for (let idx = 0; idx < message.content.length; idx++) {
			const part = message.content[idx] as Record<string, unknown>;
			if (part.type === "text" && typeof part.text === "string") {
				text = part.text;
				textIndex = idx;
				break;
			}
		}
	}

	// Fast path: no batch section headers present
	if (!text || !text.includes("\n--- ")) {
		return line;
	}

	const stripped = stripBatchBodies(text);
	if (stripped === text) {
		return line;
	}

	if (typeof message.content === "string") {
		entry = {
			...entry,
			message: { ...message, content: stripped },
		};
	} else if (textIndex !== undefined) {
		const newContent = (message.content as Array<Record<string, unknown>>).map((part, idx) => {
			if (idx === textIndex && part.type === "text" && typeof part.text === "string") {
				return { ...part, text: stripped };
			}
			return part;
		});
		entry = {
			...entry,
			message: { ...message, content: newContent },
		};
	}

	return JSON.stringify(entry);
}

/**
 * Filter out the active tool call from assistant messages in snapshot.
 * If the assistant message becomes empty (e.g. no other tool calls, no text/thinking),
 * it returns null to omit the message entirely from the snapshot.
 */
function stripActiveToolCall(entry: unknown, activeToolCallId: string | undefined): unknown | null {
	if (!activeToolCallId || !entry || typeof entry !== "object") return entry;
	const e = entry as Record<string, unknown>;

	if (e.type !== "message" || !e.message || typeof e.message !== "object") {
		return entry;
	}

	const message = e.message as Record<string, unknown>;
	if (message.role !== "assistant" || !Array.isArray(message.content)) {
		return entry;
	}

	const newContent = message.content.filter((block: any) => {
		if (block && block.type === "toolCall") {
			const id = block.id || block.toolCallId || block.tool_call_id;
			if (id === activeToolCallId) {
				return false;
			}
		}
		return true;
	});

	const hasSubstance = newContent.some((block: any) => {
		if (!block) return false;
		if (block.type === "text" && typeof block.text === "string" && block.text.trim() === "") {
			return false;
		}
		if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim() === "") {
			return false;
		}
		return true;
	});

	if (newContent.length === 0 || !hasSubstance) {
		return null;
	}

	return {
		...e,
		message: {
			...message,
			content: newContent,
		},
	};
}


/**
 * Core-2 snapshot builder — dead-simple fork snapshot.
 *
 * Strips batch read/write/edit bodies (keeping first 3 + last 3 lines as
 * orientation) and preserves all other conversation verbatim in
 * chronological order.
 */

import { stripDirectives } from "../steering/tool-utils.js";
import type { FlowTier } from "../flow/agents.js";
import { logWarn } from "../config/log.js";

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
	tier?: FlowTier;
}

/** Normalize toolCalls field from various input shapes. */
function normalizeToolCalls(msg: unknown): unknown[] {
	if (!msg || typeof msg !== "object") return [];
	const m = msg as Record<string, unknown>;
	const tcs = m.toolCalls ?? m.tool_calls;
	if (Array.isArray(tcs)) return tcs;
	return [];
}

// Fallback for external APIs that use snake_case
const SNAKE_TOOL_CALL_ID = "tool_call_id";

/** Normalize tool call id from various input shapes. */
function normalizeToolCallId(tc: unknown): string | undefined {
	if (!tc || typeof tc !== "object") return undefined;
	const t = tc as Record<string, unknown>;
	return (t.id as string | undefined) || (t.toolCallId as string | undefined) || (t[SNAKE_TOOL_CALL_ID] as string | undefined);
}

/** Synthetic system message providing the context architecture map. */
const CONTEXT_MAP_ENTRY = {
	type: "message",
	message: {
		role: "system",
		content: `   ┌─────────────────────────────┐
   │  [SHARED CONTEXT]           │
   │  Inherited conversation     │
   │  history. Situational       │
   │  awareness only.            │
   │                             │
   │  Do NOT reply to anything   │
   │  above this line.           │
   ├─────────────────────────────┤  ◀ <context-seal>
   │  [YOUR MISSION]             │
   │  <activation> · role, tier  │
   │  <directive>  · rules       │
   │  <mission>    · intent      │
   │                             │
   │  Execute from here.         │
   └─────────────────────────────┘`,
	},
};

export function buildCore2Snapshot(
	sessionManager: SessionSnapshotSource,
	options?: BuildCore2SnapshotOptions,
): string | null {
	const header = sessionManager.getHeader();
	if (!header || typeof header !== "object") return null;

	// Compress cwd in session header: relative to repo root if under it,
	// otherwise basename only. Saves ~50-100 bytes per snapshot.
	const repoRoot = process.cwd();
	let compressedHeader = { ...(header as Record<string, unknown>) };
	delete compressedHeader.timestamp;
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
			compressedHeader.cwd = compressedCwd;
		}
	}

	const branchEntries = sessionManager.getBranch();
	const optimizedEntries = optimizeSharedContext(branchEntries);
	const lines: string[] = [];

	// Emit session header once, unless getBranch() already includes it as the
	// first entry (some session managers include the header in the branch).
	const firstBranch = optimizedEntries[0];
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

	const processedEntries: unknown[] = [];
	for (const entry of optimizedEntries) {
		let processedEntry = sanitizeSnapshotEntry(entry);
		if (!processedEntry) continue;

		processedEntry = maybeStripCompaction(processedEntry);
		if (!processedEntry) continue;

		processedEntry = compressSnapshotEntry(processedEntry, options?.tier);
		processedEntry = truncateStandaloneBashResult(processedEntry);

		if (options?.activeToolCallId) {
			processedEntry = stripActiveToolCall(processedEntry, options.activeToolCallId);
			if (!processedEntry) continue;
		}

		processedEntries.push(processedEntry);
	}

	const finalEntries = applyMessageLimit(processedEntries, options?.tier);
	const entriesWithMap = insertContextMap(finalEntries);

	for (const entry of entriesWithMap) {
		const line = JSON.stringify(entry);
		// Strip batch read/write/edit bodies from tool result messages
		const processed = maybeStripBatchBodies(line);
		lines.push(processed);
	}

	return `${lines.join("\n")}\n`;
}

/**
 * Keep only the usage fields pi-coding-agent needs for context accounting.
 * Full usage objects (~150+ chars) are stripped; deleting usage entirely breaks
 * forked child sessions (calculateContextTokens reads usage.totalTokens).
 */
function slimAssistantUsage(usage: unknown): Record<string, number> | undefined {
	if (!usage || typeof usage !== "object") return undefined;
	const u = usage as Record<string, unknown>;
	const input = typeof u.input === "number" ? u.input : (typeof u.prompt_tokens === "number" ? u.prompt_tokens : 0);
	const output = typeof u.output === "number" ? u.output : (typeof u.completion_tokens === "number" ? u.completion_tokens : 0);
	const cacheRead = typeof u.cacheRead === "number" ? u.cacheRead : (typeof u.cache_read === "number" ? u.cache_read : 0);
	const cacheWrite = typeof u.cacheWrite === "number" ? u.cacheWrite : (typeof u.cache_write === "number" ? u.cache_write : 0);
	const totalTokens =
		typeof u.totalTokens === "number"
			? u.totalTokens
			: (typeof u.total_tokens === "number" ? u.total_tokens : input + output + cacheRead + cacheWrite);
	if (totalTokens <= 0 && input <= 0 && output <= 0) return undefined;
	return { input, output, cacheRead, cacheWrite, totalTokens };
}

/**
 * Pattern-based sanitization of snapshot entries.
 * Strips out:
 * - config/model/thinking-level events (model_change, thinking_level_change)
 * - assistant thinking/reasoning content blocks and fields
 * - empty messages resulting from stripping
 */
function sanitizeSnapshotEntry(entry: unknown): unknown | null {
	if (!entry || typeof entry !== "object") return entry;
	const e = entry as Record<string, unknown>;

	// 1. Drop config/control events that aren't needed by child flows
	if (e.type === "model_change" || e.type === "thinking_level_change") {
		return null;
	}

	const result = { ...e };
	delete result.timestamp;
	delete result.parentId; // Tree linkage irrelevant to linear replay
	// result.id is preserved for child session manager deduplication

	// 2. Process message entries
	if (result.type === "message" && result.message && typeof result.message === "object") {
		const msg = { ...result.message as Record<string, unknown> };

		// Strip message-level reasoning/thinking fields
		delete msg.thinking;
		delete msg.reasoning;
		delete msg.reasoningContent;

		// Strip model execution metadata and noise fields
		delete msg.api;
		delete msg.provider;
		delete msg.model;
		delete msg.cost;
		delete msg.details;
		delete msg.responseId;
		delete msg.responseModel;
		delete msg.timestamp;
		delete msg.isError;
		// Slim usage for assistant messages — pi child needs totalTokens for compaction.
		if (msg.role === "assistant" && "usage" in msg) {
			const slim = slimAssistantUsage(msg.usage);
			if (slim) {
				msg.usage = slim;
			} else {
				delete msg.usage;
			}
		} else {
			delete msg.usage;
		}

		// Strip tool correlation IDs — child flows replay linearly, no invocation by ID
		if (msg.role === "toolResult" || msg.role === "tool") {
			delete msg.toolCallId;
		}

		// Defensive: upstream host assumes content is always an array for tool/toolResult
		// messages. Normalize string / null / undefined into a block array so .filter()
		// never explodes on the platform side.
		if ((msg.role === "toolResult" || msg.role === "tool") && !Array.isArray(msg.content)) {
			const text = typeof msg.content === "string" ? msg.content : "";
			msg.content = text ? [{ type: "text", text }] : [];
		}

		// Strip block-level thinking/reasoning elements from content array
		if (Array.isArray(msg.content)) {
			const filteredContent = msg.content.filter((block: any) => {
				return block && block.type !== "thinking" && block.type !== "reasoning";
			});

			// If the content array is now empty or only has empty text blocks,
			// and there are no tool calls, check if we should discard the message
			const hasSubstance = filteredContent.some((block: any) => {
				if (!block) return false;
				if (block.type === "text" && typeof block.text === "string" && block.text.trim() === "") {
					return false;
				}
				if (block.type === "toolCall") {
					return true;
				}
				return true;
			});

			const hasToolCalls = normalizeToolCalls(msg).length > 0 || filteredContent.some(b => b && b.type === "toolCall");

			if (filteredContent.length === 0 || !hasSubstance) {
				// If assistant message has no substance and no tool calls, drop it
				if (msg.role === "assistant" && !hasToolCalls) {
					return null;
				}
			}
			msg.content = filteredContent;
		} else if (typeof msg.content === "string" && msg.content.trim() === "") {
			const hasToolCalls = normalizeToolCalls(msg).length > 0;
			if (msg.role === "assistant" && !hasToolCalls) {
				return null;
			}
		}

		result.message = msg;
	}

	return result;
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
				content: [{ type: "text", text: `[Context Compacted] ${summary}${tokensSaved ? ` (${tokensSaved} tokens summarized)` : ""}` }],
			},
		};
	}

	return entry;
}

// ---------------------------------------------------------------------------
// Shared context optimizations (Deduplication)
// ---------------------------------------------------------------------------

function optimizeSharedContext(branchEntries: unknown[]): unknown[] {
	const toolCallMap = new Map<string, { toolName: string; keys: string[]; isReadWrite: boolean; op: string }>();
	const lastExecution = new Map<string, string>();

	// Scan to populate toolCallMap and lastExecution
	for (const entry of branchEntries) {
		if (!entry || typeof entry !== "object") continue;
		const e = entry as Record<string, unknown>;
		if (e.type === "message" && e.message && typeof e.message === "object") {
			const msg = e.message as Record<string, unknown>;
			
			// Gather tool calls from content array and toolCalls/tool_calls field
			const tcs = normalizeToolCalls(msg);
			const contentBlocks = Array.isArray(msg.content) ? msg.content : [];
			const allCalls = [...tcs, ...contentBlocks.filter((b) => b && b.type === "toolCall")];

			for (const tc of allCalls) {
				const id = normalizeToolCallId(tc);
				const name = (tc as Record<string, unknown>).name || ((tc as Record<string, unknown>).toolCall as Record<string, unknown> | undefined)?.name;
				if (!id || !name) continue;

				if (name === "bash" && tc.arguments) {
					const cmd = (tc.arguments.command || tc.arguments.c || "").trim();
					if (cmd) {
						toolCallMap.set(id, { toolName: "bash", keys: [`bash:${cmd}`], isReadWrite: false, op: "bash" });
						lastExecution.set(`bash:${cmd}`, id);
					}
				} else if ((name === "batch" || name === "batch_read") && tc.arguments) {
					const ops = tc.arguments.ops || tc.arguments.o || [];
					if (Array.isArray(ops)) {
						const keys: string[] = [];
						let opType = "read";
						for (const op of ops) {
							const operation = op.o;
							const path = (op.p || "").trim();
							if (path && (operation === "read" || operation === "write" || operation === "edit")) {
								const key = `${operation}:${path}`;
								keys.push(key);
								opType = operation;
								lastExecution.set(key, id);
							}
						}
						if (keys.length > 0) {
							toolCallMap.set(id, { toolName: name, keys, isReadWrite: true, op: opType });
						}
					}
				}
			}
		}
	}

	// Re-process branch entries using the maps
	return branchEntries.map((entry) => {
		if (!entry || typeof entry !== "object") return entry;
		const e = entry as Record<string, unknown>;
		if (e.type !== "message" || !e.message || typeof e.message !== "object") return entry;
		const msg = { ...(e.message as Record<string, unknown>) };

		if (msg.role !== "tool" && msg.role !== "toolResult") return entry;
		const toolCallId = normalizeToolCallId(msg);
		if (typeof toolCallId !== "string") return entry;

		const info = toolCallMap.get(toolCallId);
		if (!info) return entry;

		const isLatest = info.keys.some((k) => lastExecution.get(k) === toolCallId);

		if (!isLatest) {
			const newContent = info.isReadWrite
				? `[File ${info.op} output omitted; file was accessed/modified later]`
				: `[Bash output omitted; command was re-run later]`;
			
			const contentVal = typeof msg.content === "string" 
				? newContent 
				: [{ type: "text", text: newContent }];
			return {
				...e,
				message: {
					...msg,
					content: contentVal,
				},
			};
		}

		return entry;
	});
}

// ---------------------------------------------------------------------------
// Standalone bash result truncation
// ---------------------------------------------------------------------------

function truncateStandaloneBashResult(entry: unknown): unknown {
	if (!entry || typeof entry !== "object") return entry;
	const e = entry as Record<string, unknown>;
	if (e.type !== "message" || !e.message || typeof e.message !== "object") return entry;
	const msg = e.message as Record<string, unknown>;

	if (msg.role !== "tool" && msg.role !== "toolResult") return entry;

	const toolName = typeof msg.toolName === "string" ? msg.toolName : typeof msg.name === "string" ? msg.name : undefined;
	if (toolName !== "bash") return entry;

	let text: string | undefined;
	let textIndex: number | undefined;

	if (typeof msg.content === "string") {
		text = msg.content;
	} else if (Array.isArray(msg.content)) {
		for (let idx = 0; idx < msg.content.length; idx++) {
			const part = msg.content[idx] as Record<string, unknown>;
			if (part.type === "text" && typeof part.text === "string") {
				text = part.text;
				textIndex = idx;
				break;
			}
		}
	}

	if (!text) return entry;

	const lines = text.split("\n");
	const head = 30;
	const tail = 20;
	if (lines.length <= head + tail) return entry;

	const kept = [...lines.slice(0, head), `[...${lines.length - head - tail} lines of bash output truncated...]`, ...lines.slice(-tail)];
	const truncatedText = kept.join("\n");

	const newMsg = { ...msg };
	if (typeof msg.content === "string") {
		newMsg.content = truncatedText;
	} else if (textIndex !== undefined) {
		newMsg.content = (msg.content as Array<Record<string, unknown>>).map((part, idx) => {
			if (idx === textIndex) {
				return { ...part, text: truncatedText };
			}
			return part;
		});
	}

	return {
		...e,
		message: newMsg,
	};
}

// ---------------------------------------------------------------------------
// Tier-based context compression
// ---------------------------------------------------------------------------

const DEFAULT_LITE_MAX_MESSAGES = 30;
const DEFAULT_FLASH_MAX_MESSAGES = 50;
const DEFAULT_FULL_MAX_MESSAGES = 80;

function getTierMaxMessages(tier: FlowTier | undefined): number {
	if (!tier) return Number.MAX_SAFE_INTEGER;
	const env =
		tier === "lite"
			? process.env.PI_FLOW_LITE_MAX_MESSAGES
			: tier === "flash"
				? process.env.PI_FLOW_FLASH_MAX_MESSAGES
				: process.env.PI_FLOW_FULL_MAX_MESSAGES;
	const defaultVal =
		tier === "lite"
			? DEFAULT_LITE_MAX_MESSAGES
			: tier === "flash"
				? DEFAULT_FLASH_MAX_MESSAGES
				: DEFAULT_FULL_MAX_MESSAGES;
	if (!env) return defaultVal;
	const n = Number(env);
	return Number.isFinite(n) && n > 0 ? n : defaultVal;
}

/**
 * Compress a single snapshot entry based on tier.
 *
 * All tiers strip tool/toolResult content to placeholders (e.g. [toolResult: bash])
 * so the child flow sees what tools were used without receiving full verbatim
 * output, keeping the snapshot compact and focused on conversation history.
 */
function compressSnapshotEntry(entry: unknown, tier: FlowTier | undefined): unknown {
	if (!tier) return entry;
	if (!entry || typeof entry !== "object") return entry;
	const e = entry as Record<string, unknown>;
	if (e.type !== "message" || !e.message || typeof e.message !== "object") {
		return entry;
	}
	const msg = { ...(e.message as Record<string, unknown>) };
	const role = msg.role;
	if (role !== "tool" && role !== "toolResult") {
		return entry;
	}

	const toolName = typeof msg.toolName === "string" ? msg.toolName : typeof msg.name === "string" ? msg.name : undefined;
	const placeholder = toolName ? `[${role}: ${toolName}]` : `[${role} result omitted]`;
	msg.content = [{ type: "text", text: placeholder }];
	return { ...e, message: msg };
}

/**
 * Apply array-level message limit based on tier: keep only the last N messages.
 * Header/session entries at the start of the branch are preserved; only
 * `type: "message"` entries count toward the limit.
 */
function insertContextMap(entries: unknown[]): unknown[] {
	const insertIndex = entries.findIndex((e) => {
		if (!e || typeof e !== "object") return false;
		const type = (e as Record<string, unknown>).type;
		return type !== "session" && type !== "header";
	});
	if (insertIndex === -1) {
		return [...entries, CONTEXT_MAP_ENTRY];
	}
	return [
		...entries.slice(0, insertIndex),
		CONTEXT_MAP_ENTRY,
		...entries.slice(insertIndex),
	];
}

function applyMessageLimit(entries: unknown[], tier: FlowTier | undefined): unknown[] {
	const max = getTierMaxMessages(tier);

	// Extract leading header/session entries so they survive the slice
	let headerEnd = 0;
	for (; headerEnd < entries.length; headerEnd++) {
		const e = entries[headerEnd];
		if (e && typeof e === "object") {
			const type = (e as Record<string, unknown>).type;
			if (type === "session" || type === "header") continue;
		}
		break;
	}

	const headers = entries.slice(0, headerEnd);
	const rest = entries.slice(headerEnd);

	if (rest.length <= max) return entries;

	let messageCount = 0;
	for (let i = rest.length - 1; i >= 0; i--) {
		const e = rest[i];
		if (e && typeof e === "object" && (e as Record<string, unknown>).type === "message") {
			messageCount++;
		}
		if (messageCount >= max) {
			// Keep headers + everything from this index onward in rest
			return [...headers, ...rest.slice(i)];
		}
	}
	return entries;
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
		/^--- edit: (.+) ---$/.test(line) ||
		/^--- bash \[.+\] (exit (\d+)|pending|error) ---$/.test(line) ||
		/^--- \[.+\] (exit (\d+)|interrupted) ---$/.test(line) ||
		/^--- \[.+\] still running ---$/.test(line)
	);
}

/** Replace batch section bodies with first 3 + last 3 lines as orientation. */
function stripBatchBodies(text: string): string {
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
			const isBash = line.includes("--- bash [") || line.includes("--- [");
			if (isBash) {
				const head = 30;
				const tail = 20;
				if (body.length > head + tail) {
					out.push(...body.slice(0, head));
					out.push(`[...${body.length - head - tail} lines of bash output truncated...]`);
					out.push(...body.slice(-tail));
				} else {
					out.push(...body);
				}
			} else {
				if (body.length > 6) {
					out.push(...body.slice(0, 3));
					out.push(`[...${body.length - 6} lines truncated...]`);
					out.push(...body.slice(-3));
				} else {
					out.push(...body);
				}
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
	} catch (e) {
		logWarn(`[pi-agent-flow] Failed to parse JSONL line in snapshot: ${e}`);
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

	// Fast path: no batch section headers or directive/hint markers present
	if (!text || (!text.includes("\n--- ") && !text.includes("[Directive:") && !text.includes("[Hint:"))) {
		return line;
	}

	const stripped = stripBatchBodies(text);
	const cleaned = stripDirectives(stripped);
	if (cleaned === text) {
		return line;
	}

	if (typeof message.content === "string") {
		entry = {
			...entry,
			message: { ...message, content: cleaned },
		};
	} else if (textIndex !== undefined) {
		const newContent = (message.content as Array<Record<string, unknown>>).map((part, idx) => {
			if (idx === textIndex && part.type === "text" && typeof part.text === "string") {
				return { ...part, text: cleaned };
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
			const id = normalizeToolCallId(block);
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

// ---------------------------------------------------------------------------
// Shared context
// ---------------------------------------------------------------------------

export interface SharedContext {
	messageCount: number;
	userMessageCount: number;
	assistantMessageCount: number;
	toolCalls: Record<string, number>;
	totalTokens: number;
	preview: string;
}

export function parseSharedContext(snapshotJsonl: string | null): SharedContext | undefined {
	if (!snapshotJsonl) return undefined;
	let messageCount = 0;
	let userMessageCount = 0;
	let assistantMessageCount = 0;
	let totalTokens = 0;
	const toolCalls: Record<string, number> = {};
	let preview = "";
	for (const line of snapshotJsonl.split(/\r?\n/)) {
		if (!line.trim()) continue;
		try {
			const entry = JSON.parse(line);
			if (entry.type === "message" && entry.message && typeof entry.message === "object") {
				const msg = entry.message;
				messageCount++;
				if (msg.role === "user") {
					userMessageCount++;
					if (!preview) {
						if (typeof msg.content === "string") {
							preview = msg.content;
						} else if (Array.isArray(msg.content)) {
							for (const part of msg.content) {
								if (part && part.type === "text" && typeof part.text === "string") {
									preview = part.text;
									break;
								}
							}
						}
					}
				} else if (msg.role === "assistant") {
					assistantMessageCount++;
					const usage = entry.usage || msg.usage;
					if (usage && typeof usage === "object") {
						const u = usage as Record<string, unknown>;
						const explicit =
							typeof u.totalTokens === "number"
								? u.totalTokens
								: typeof u.total_tokens === "number"
									? u.total_tokens
									: undefined;
						if (typeof explicit === "number" && explicit > 0) {
							totalTokens = explicit;
						} else {
							const input =
								typeof u.input === "number"
									? u.input
									: typeof u.prompt_tokens === "number"
										? u.prompt_tokens
										: 0;
							const output =
								typeof u.output === "number"
									? u.output
									: typeof u.completion_tokens === "number"
										? u.completion_tokens
										: 0;
							const cacheRead =
								typeof u.cacheRead === "number"
									? u.cacheRead
									: typeof u.cache_read === "number"
										? u.cache_read
										: 0;
							const cacheWrite =
								typeof u.cacheWrite === "number"
									? u.cacheWrite
									: typeof u.cache_write === "number"
										? u.cache_write
										: 0;
							const computed = input + output + cacheRead + cacheWrite;
							if (computed > 0) {
								totalTokens = computed;
							}
						}
					}
				}
				// Aggregate tool calls from any message
				const tcs = normalizeToolCalls(msg);
				if (tcs.length > 0) {
					for (const tc of tcs) {
						const t = tc as Record<string, unknown>;
						const name = t.name || (t.function as Record<string, unknown> | undefined)?.name;
						if (typeof name === "string") {
							toolCalls[name] = (toolCalls[name] || 0) + 1;
						}
					}
				}
				if (Array.isArray(msg.content)) {
					for (const block of msg.content) {
						if (block && block.type === "toolCall") {
							const name = block.name || block.toolCall?.name || block.function?.name;
							if (typeof name === "string") {
								toolCalls[name] = (toolCalls[name] || 0) + 1;
							}
						}
					}
				}
			}
		} catch (e) {
			logWarn(`[pi-agent-flow] Skipping invalid JSONL line in snapshot: ${e}`);
		}
	}
	if (messageCount === 0) return undefined;
	return { messageCount, userMessageCount, assistantMessageCount, toolCalls, totalTokens, preview };
}


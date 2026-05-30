import type { Message } from "@earendil-works/pi-ai";
import { logWarn } from "../config/log.js";
import type { TraceStructuredOutput } from "../types/output.js";

/**
 * Strip markdown code block fences from the start/end of a string when the
 * ENTIRE string is wrapped in a fence. Returns the original string if no
 * complete fence is found.
 *
 * Matches:
 *   ^\s*```(?:\w+)?\s*\n  ...  \n\s*```\s*$
 *
 * Uses a greedy inner capture so nested fences are preserved.
 */
export function unwrapMarkdownCodeBlock(text: string): string {
	if (!text || typeof text !== "string") return text;
	const match = text.match(/^\s*```(?:\w+)?(?:[^\S\n]+[^\n]*)?\n([\s\S]*)\n\s*```\s*$/);
	return match ? match[1] : text;
}

/**
 * Extract a structured JSON output block from the end of an assistant's text for trace flow.
 *
 * Looks for a final ```json ... ``` code block, parses it, and validates
 * against the TraceStructuredOutput schema. Returns undefined when the block
 * is missing, malformed, or fails validation.
 */
export function extractTraceStructuredOutput(text: string): TraceStructuredOutput | undefined {
	if (!text) return undefined;

	// Find the last ```json block and try closing fences from the end inward
	// to handle nested code blocks inside the JSON content.
	const lastJsonIdx = text.lastIndexOf("```json");
	if (lastJsonIdx === -1) return undefined;

	const afterJson = text.slice(lastJsonIdx + 7);
	const closePositions: number[] = [];
	let pos = afterJson.indexOf("```");
	while (pos !== -1) {
		closePositions.push(pos);
		pos = afterJson.indexOf("```", pos + 1);
	}

	for (let i = closePositions.length - 1; i >= 0; i--) {
		const jsonStr = afterJson.slice(0, closePositions[i]).trim();
		if (!jsonStr) continue;
		try {
			const parsed = JSON.parse(jsonStr);
			if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
				if (typeof parsed.note === "string" && Array.isArray(parsed.tool_ids)) {
					return {
						note: unwrapMarkdownCodeBlock(parsed.note.trim()),
						tool_ids: parsed.tool_ids.map((id: unknown) =>
							unwrapMarkdownCodeBlock(String(id).trim())
						),
					};
				}
			}
		} catch {
			// Continue trying earlier closing positions
		}
	}
	return undefined;
}

// Fallback for external APIs that use snake_case
const SNAKE_TOOL_CALL_ID = "tool_call_id";

function findToolCall(messages: Message[], targetId: string) {
	for (const msg of messages) {
		if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
		for (const part of msg.content) {
			if (part && part.type === "toolCall") {
				const id = part.id || part.toolCallId || ((part as unknown) as Record<string, unknown>)[SNAKE_TOOL_CALL_ID] as string | undefined;
				if (id === targetId) {
					return {
						tool: part.name || part.toolName || "",
						args: part.arguments || part.input || {},
					};
				}
			}
		}
	}
	return null;
}

function findToolResult(messages: Message[], targetId: string): string | null {
	const outputParts: string[] = [];
	for (const msg of messages) {
		if (msg.role !== "tool" && msg.role !== "toolResult") continue;
		const id = (msg as { toolCallId?: string }).toolCallId || ((msg as unknown) as Record<string, unknown>)[SNAKE_TOOL_CALL_ID] as string | undefined || (msg as { id?: string }).id;
		if (id === targetId) {
			if (typeof msg.content === "string") {
				outputParts.push(msg.content);
			} else if (Array.isArray(msg.content)) {
				const text = msg.content
					.filter((c: unknown) => c && typeof c === "object" && (c as { type?: string; text?: unknown }).type === "text" && typeof (c as { text?: unknown }).text === "string")
					.map((c: unknown) => (c as { text: string }).text)
					.join("");
				outputParts.push(text);
			}
		}
	}
	return outputParts.length > 0 ? outputParts.join("\n\n") : null;
}

/** Choose a backtick fence that cannot be closed by any run of backticks inside content. */
function chooseFence(content: string): string {
	const maxTicks = [...content.matchAll(/`+/g)].reduce((max, m) => Math.max(max, m[0].length), 0);
	return "`".repeat(Math.max(3, maxTicks + 1));
}

/**
 * Automatically resolve tool_ids to verbatim args + output
 */
export function resolveToolEvidence(
	toolIds: string[],
	messages: Message[],
	parentBranch: unknown[],
): string {
	const branchMessages: Message[] = [];
	if (Array.isArray(parentBranch)) {
		for (const entry of parentBranch) {
			if (entry && typeof entry === "object" && (entry as Record<string, unknown>).type === "message" && (entry as Record<string, unknown>).message) {
				branchMessages.push((entry as Record<string, unknown>).message as Message);
			}
		}
	}

	const allMessages = [...branchMessages, ...messages];
	const evidenceParts: string[] = [];

	for (const id of toolIds) {
		const toolCall = findToolCall(allMessages, id);
		if (!toolCall) {
			continue;
		}

		const resultText = findToolResult(allMessages, id);
		if (resultText === null) {
			continue;
		}

		const argsFence = chooseFence(JSON.stringify(toolCall.args, null, 2));
		const outputFence = chooseFence(resultText);
		const outputLabel = "text";

		evidenceParts.push(
			`### ${toolCall.tool} [${id}]\n` +
			`**Args:**\n` +
			`${argsFence}json\n` +
			`${JSON.stringify(toolCall.args, null, 2)}\n` +
			`${argsFence}\n\n` +
			`**Output:**\n` +
			`${outputFence}${outputLabel}\n` +
			`${resultText}\n` +
			`${outputFence}`
		);
	}

	if (evidenceParts.length === 0) {
		return "";
	}

	return `## Verbatim Evidence\n\n` + evidenceParts.join("\n\n");
}

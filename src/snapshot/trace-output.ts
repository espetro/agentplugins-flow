import type { Message } from "@earendil-works/pi-ai";
import { logWarn } from "../config/log.js";
import type { TraceStructuredOutput } from "../types/output.js";

/**
 * Extract a structured JSON output block from the end of an assistant's text for trace flow.
 *
 * Looks for a final ```json ... ``` code block, parses it, and validates
 * against the TraceStructuredOutput schema. Returns undefined when the block
 * is missing, malformed, or fails validation.
 */
export function extractTraceStructuredOutput(text: string): TraceStructuredOutput | undefined {
	if (!text) return undefined;

	// Find the last ```json ... ``` block in the text.
	// Scan backward from the end to handle multiple blocks.
	const allMatches = [...text.matchAll(/```json\s*([\s\S]*?)\s*```/g)];
	const match = allMatches.length > 0 ? allMatches[allMatches.length - 1] : null;
	if (!match || !match[1]) return undefined;

	const jsonStr = match[1].trim();
	if (!jsonStr) return undefined;

	try {
		const parsed = JSON.parse(jsonStr);
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
			if (typeof parsed.note === "string" && Array.isArray(parsed.tool_ids)) {
				return {
					note: parsed.note.trim(),
					tool_ids: parsed.tool_ids.map((id: unknown) => String(id).trim()),
				};
			}
		}
	} catch (e) {
		logWarn(`[pi-agent-flow] Failed to parse trace structured output: ${e}`);
		return undefined;
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

		evidenceParts.push(
			`### ${toolCall.tool} [${id}]\n` +
			`**Args:**\n` +
			`\`\`\`json\n` +
			`${JSON.stringify(toolCall.args, null, 2)}\n` +
			`\`\`\`\n\n` +
			`**Output:**\n` +
			`\`\`\`text\n` +
			`${resultText}\n` +
			`\`\`\``
		);
	}

	if (evidenceParts.length === 0) {
		return "";
	}

	return `## Verbatim Evidence\n\n` + evidenceParts.join("\n\n");
}

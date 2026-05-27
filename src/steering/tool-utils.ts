/**
 * Shared tool-result utilities.
 *
 * Provides helpers for appending text to tool results and stripping
 * directive hints from text and messages.
 */

import { isJsonEqual } from "./sliding-prompt.js";

/**
 * Append text to the first text content item in a tool result,
 * or push a new text item if none exists.
 */
export function appendTextToToolResult(result: any, text: string): void {
	const textItem = result?.content?.find?.((c: any) => c.type === "text");
	if (textItem && typeof textItem.text === "string") {
		textItem.text += text;
	} else if (Array.isArray(result?.content)) {
		result.content.push({ type: "text", text: text.trim() });
	}
}

const DIRECTIVE_RE = /\n\n\[Directive: [^\n]*\]/g;
const LEGACY_HINT_RE = /\n\n\[Hint: [\s\S]*?\]/g;

/**
 * Strip directive hints from text (including legacy [Hint:] format).
 */
export function stripDirectives(text: string): string {
	return text.replace(DIRECTIVE_RE, "").replace(LEGACY_HINT_RE, "");
}

/**
 * Strip directive hints from tool result content (string or text-part array).
 */
export function stripDirectivesFromContent(
	content: string | Array<{ type: string; text?: string }>,
): string | Array<{ type: string; text?: string }> {
	if (typeof content === "string") {
		return stripDirectives(content);
	}
	return content.map((part) => {
		if (part.type === "text" && typeof part.text === "string") {
			return { ...part, text: stripDirectives(part.text) };
		}
		return part;
	});
}

/**
 * Remove directive hints from an array of messages.
 * Returns the sanitized messages and a flag indicating whether anything changed.
 */
export function stripDirectivesFromMessages(messages: any[]): { messages: any[]; changed: boolean } {
	let changed = false;
	const result = messages.map((msg) => {
		if (!("content" in msg)) return msg;
		const stripped = stripDirectivesFromContent(msg.content);
		if (isJsonEqual(stripped, msg.content)) return msg;
		changed = true;
		return { ...msg, content: stripped };
	});
	return { messages: result, changed };
}

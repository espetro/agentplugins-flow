/**
 * UI display types and helpers.
 */

import type { Message } from "@earendil-works/pi-ai";

/** A display-friendly representation of a message part. */
export type DisplayItem =
	| { type: "text"; text: string }
	| { type: "toolCall"; name: string; args: Record<string, unknown> };

/** Extract all display-worthy items from a message history. */
export function getFlowDisplayItems(messages: Message[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") {
					items.push({ type: "text", text: part.text });
				} else if (part.type === "toolCall") {
					const name = part.name ?? part.toolName ?? "unknown";
					const args = (part.arguments ?? part.input ?? {}) as Record<string, unknown>;
					items.push({ type: "toolCall", name, args });
				}
			}
		}
	}
	return items;
}

/** Extract the last tool call from message history. */
export function getLastToolCall(messages: Message[]): { type: "toolCall"; name: string; args: Record<string, unknown> } | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			for (let j = msg.content.length - 1; j >= 0; j--) {
				const part = msg.content[j];
				if (part.type === "toolCall") {
					const name = part.name ?? part.toolName ?? "unknown";
					const args = (part.arguments ?? part.input ?? {}) as Record<string, unknown>;
					return { type: "toolCall", name, args };
				}
			}
		}
	}
	return undefined;
}

/** Count tool calls in the most recent assistant message (pending batch). */
export function countPendingToolCalls(messages: Message[]): number {
	const lastMsg = messages[messages.length - 1];
	if (!lastMsg || lastMsg.role !== "assistant") return 0;
	let count = 0;
	for (const part of lastMsg.content) {
		if (part.type === "toolCall") count++;
	}
	return count;
}

/** Count pending operations, expanding batch tool calls into individual ops. */
export function countPendingOps(messages: Message[]): number {
	const pendingCount = countPendingToolCalls(messages);
	if (pendingCount <= 0) return 0;
	const lastMsg = messages[messages.length - 1];
	if (!lastMsg || lastMsg.role !== "assistant") return 0;
	let ops = 0;
	for (const part of lastMsg.content) {
		if (part.type === "toolCall") {
			const name = part.name ?? part.toolName ?? "unknown";
			const args = (part.arguments ?? part.input ?? {}) as Record<string, unknown>;
			if (name === "batch") {
				const rawOps = (args.o ?? args.op ?? args.operations ?? args) as unknown[];
				if (Array.isArray(rawOps)) {
					ops += rawOps.length;
				} else {
					ops++;
				}
			} else {
				ops++;
			}
		}
	}
	return ops;
}

/** Extract the last assistant text from message history. */
export function getLastAssistantText(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			for (let j = msg.content.length - 1; j >= 0; j--) {
				const part = msg.content[j];
				if (part.type === "text" && part.text.trim()) {
					return part.text.trim();
				}
			}
		}
	}
	return "";
}

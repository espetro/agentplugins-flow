/**
 * Steering hint utilities.
 *
 * Manages the steering hint tag that is injected before the latest user
 * message each turn. Provides helpers for stripping, detecting, and building
 * the hint so they can be tested independently.
 */

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Tag constants
// ---------------------------------------------------------------------------

const STEERING_HINT_UUID = randomUUID();

export const STEERING_HINT_OPEN_TAG = `<pi-flow-steering-hint id="${STEERING_HINT_UUID}">`;
export const STEERING_HINT_CLOSE_TAG = `</pi-flow-steering-hint id="${STEERING_HINT_UUID}">`;

export const STEERING_HINT =
	`${STEERING_HINT_OPEN_TAG}` +
	`Available tools: batch_read (bash-style CLI: pass cmd: "batch_read <sub> [flags] <args>"), flow, trace, ask_user. Pass cmd: "help" or "<tool> --help" for the man page. ` +
	`Be direct — zero preamble or filler. Answer directly when context is available. ` +
	`Critical review: Before every action, verify you have actual evidence (file content, real errors, real test output). STOP if uncertain or repeating a failed path. ` +
	`Tool selection: Default [flow] for real work. [trace] only for [verify] between flows. [scout] maps, [build] ships. Never chain [trace] alone. ` +
	`Backward: When quality or correctness is at risk — flow-audit (quality checks), flow-debug (root cause + fix), flow-build (corrections/refactor). Verify mid-loop via the [trace] sandwich slot. ` +
	`Completeness: No placeholders, no TODOs, no half-finished work. ` +
	`When the sign of regression is detected - backtrack IMMEDIATELY to trace/audit/build flow. ` +
	`Use \`ask_user\` for: ambiguous goals, or conflicting requirements, question must have bite, and impact to the final outcomes.` +
	`${STEERING_HINT_CLOSE_TAG}`;

const STEERING_HINT_RE = new RegExp(
	STEERING_HINT_OPEN_TAG.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
	"[\\s\\S]*?" +
	STEERING_HINT_CLOSE_TAG.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
	"g",
);

/** Legacy regex to strip old bare steering hint tags (no id attribute). */
const LEGACY_STEERING_HINT_RE = /<pi-flow-steering-hint(?:\s[^>]*)?>[\s\S]*?<\/pi-flow-steering-hint(?:\s[^>]*)?>/g;

// ---------------------------------------------------------------------------
// Content types
// ---------------------------------------------------------------------------

/** Input-message content types (string or multipart text-part array). */
type MessageContent = string | Array<{ type: string; text?: string }>;

/** Type guard: is this a text-part with a string .text? */
function isTextPart(part: unknown): part is { type: "text"; text: string } {
	return (
		part != null &&
		typeof part === "object" &&
		"type" in part &&
		part.type === "text" &&
		"text" in part &&
		typeof (part as { text?: unknown }).text === "string"
	);
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/** Strip any old steering hint tags from a string. */
export function stripSteeringHintText(text: string): string {
	return text.replace(STEERING_HINT_RE, "").replace(LEGACY_STEERING_HINT_RE, "");
}

/** Strip steering hint tags from content (string or text-part array). */
export function stripSteeringHintFromContent(
	content: string | { type: string; text?: string }[],
): string | { type: string; text?: string }[] {
	if (typeof content === "string") {
		return stripSteeringHintText(content);
	}
	return content.map((c) => {
		if (c.type === "text" && typeof c.text === "string") {
			return { ...c, text: stripSteeringHintText(c.text) };
		}
		return c;
	});
}

/** Check whether content (string or text-part array) contains the steering hint tag. */
export function contentContainsSteeringHintTag(content: MessageContent): boolean {
	const hasCurrent = (text: string) => text.includes(STEERING_HINT_OPEN_TAG);
	const hasLegacy = (text: string) => /<pi-flow-steering-hint(?:\s[^>]*)?>/.test(text);
	const check = (text: string) => hasCurrent(text) || hasLegacy(text);
	if (typeof content === "string") {
		return check(content);
	}
	if (Array.isArray(content)) {
		return content.some((part) => isTextPart(part) && check(part.text));
	}
	return false;
}

/** Deep-equality check that handles unordered object keys (unlike JSON.stringify). */
export function isJsonEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;

	const keysA = Object.keys(a as Record<string, unknown>);
	const keysB = Object.keys(b as Record<string, unknown>);
	if (keysA.length !== keysB.length) return false;

	for (const key of keysA) {
		if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
		if (!isJsonEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
	}
	return true;
}

/** Remove any existing steering-hint system messages and strip tags from user messages.
 *  Returns the sanitized messages and a flag indicating whether anything changed.
 */
export function stripSteeringHintsFromMessages(messages: any[]): { messages: any[]; changed: boolean } {
	let changed = false;
	const result = messages
		.filter((msg) => {
			// Remove dedicated steering hint system messages
			if (msg.role === "system" && contentContainsSteeringHintTag(msg.content)) {
				changed = true;
				return false;
			}
			return true;
		})
		.map((msg) => {
			// Also strip stray tags embedded in user/assistant messages
			if (!("content" in msg)) return msg;
			const stripped = stripSteeringHintFromContent(msg.content);
			if (isJsonEqual(stripped, msg.content)) return msg;
			changed = true;
			return { ...msg, content: stripped };
		});
	return { messages: result, changed };
}

// ---------------------------------------------------------------------------
// Configurable steering
// ---------------------------------------------------------------------------

let steeringConfig = { enabled: true, customPrompt: undefined as string | undefined };

export function configureSteering(config: { enabled: boolean; customPrompt?: string }): void {
	steeringConfig = { enabled: config.enabled, customPrompt: config.customPrompt };
}

/** Build a system message containing the steering hint.
 *  Returns null when steering is disabled so the caller can skip injection.
 */
export function makeSteeringHintMessage(referenceMessage?: any): any | null {
	if (!steeringConfig.enabled) {
		return null;
	}
	let body = steeringConfig.customPrompt ?? STEERING_HINT;
	if (steeringConfig.customPrompt) {
		const hasCurrent = body.includes(STEERING_HINT_OPEN_TAG) && body.includes(STEERING_HINT_CLOSE_TAG);
		const hasLegacy = /<pi-flow-steering-hint(?:\s[^>]*)?>/.test(body) && /<\/pi-flow-steering-hint(?:\s[^>]*)?>/.test(body);
		if (!hasCurrent && !hasLegacy) {
			body = `${STEERING_HINT_OPEN_TAG}\n${body}\n${STEERING_HINT_CLOSE_TAG}`;
		}
	}
	return {
		role: "system",
		content: body,
		timestamp: referenceMessage?.timestamp,
	};
}

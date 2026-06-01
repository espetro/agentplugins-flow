/**
 * Flow prompt construction for the before_agent_start handler.
 *
 * Extracted from index.ts for single-responsibility and testability.
 */

import {
	looksLikeUrlPrompt,
	looksLikeWebSearchPrompt,
} from "../tools/web-ops.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BeforeAgentStartEvent {
	prompt: string;
	systemPrompt: string;
}

// ---------------------------------------------------------------------------
// Active tools helper
// ---------------------------------------------------------------------------

export function computeActiveTools(
	optimize: boolean,
	traceEnabled: boolean = true,
	batchReadEnabled: boolean = optimize,
): string[] {
	if (optimize) {
		const tools: string[] = [];
		if (batchReadEnabled) {
			tools.push("batch_read");
		}
		tools.push("flow");
		if (traceEnabled) {
			tools.push("trace");
		}
		tools.push("ask_user");
		return tools;
	}
	const tools: string[] = ["read", "write", "edit", "batch", "bash", "flow"];
	if (traceEnabled) {
		tools.push("trace");
	}
	if (batchReadEnabled) {
		tools.push("batch_read");
	}
	tools.push("ask_user");
	return tools;
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

/**
 * Build the before_agent_start system prompt augmentation.
 *
 * Adds web steering (when tool optimize is off) and the flow transition
 * guide with guard info. The steering hint is NOT included here — it
 * is injected dynamically by the context hook in index.ts.
 *
 * Returns the augmented systemPrompt, or undefined if the child flow
 * should skip this handler.
 */
export function buildBeforeAgentStartPrompt(
	event: BeforeAgentStartEvent,
	toolOptimize: boolean,
): string | undefined {
	const prompt = event.prompt;
	const hasUrl = looksLikeUrlPrompt(prompt);
	const likelyNeedsWeb = looksLikeWebSearchPrompt(prompt);

	const webInstructions: string[] = [];
	if (hasUrl) {
		webInstructions.push(
			"The prompt includes a URL. Use batch web fetch -u <url> before answering about that page.",
		);
	}
	if (likelyNeedsWeb) {
		webInstructions.push(
			"The prompt likely needs external or current info. Prefer batch web search -q <query> over memory.",
		);
	}

	let systemPrompt = event.systemPrompt;
	if (!toolOptimize && webInstructions.length > 0) {
		systemPrompt +=
			"\n\n## pi-web steering\n" +
			webInstructions.map((line) => `- ${line}`).join("\n");
	}

	return systemPrompt;
}

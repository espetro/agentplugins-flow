/**
 * Flow prompt construction for the before_agent_start handler.
 *
 * Extracted from index.ts for single-responsibility and testability.
 */

import type { FlowConfig } from "../flow/agents.js";
import {
	looksLikeUrlPrompt,
	looksLikeWebSearchPrompt,
} from "../tools/web-ops.js";
import type { FlowDepthConfig } from "../flow/depth.js";

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

export function computeActiveTools(optimize: boolean): string[] {
	return optimize
		? ["batch_read", "flow", "trace", "ask_user"]
		: ["read", "write", "edit", "batch", "bash", "flow", "trace", "ask_user"];
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
	canTransition: boolean,
	discoveredFlows: FlowConfig[],
	depthConfig: FlowDepthConfig,
): string | undefined {
	const { currentDepth, maxDepth, ancestorFlowStack, preventCycles } = depthConfig;

	const prompt = event.prompt;
	const hasUrl = looksLikeUrlPrompt(prompt);
	const likelyNeedsWeb = looksLikeWebSearchPrompt(prompt);

	const webInstructions: string[] = [];
	if (hasUrl) {
		webInstructions.push(
			"The prompt includes a URL. Use batch with w: [{ o: 'fetch', u: '<url>' }] before answering about that page.",
		);
	}
	if (likelyNeedsWeb) {
		webInstructions.push(
			"The prompt likely needs external or current info. Prefer batch with w: [{ o: 'search', q: '<query>' }] over memory.",
		);
	}

	let systemPrompt = event.systemPrompt;
	if (!toolOptimize && webInstructions.length > 0) {
		systemPrompt +=
			"\n\n## pi-web steering\n" +
			webInstructions.map((line) => `- ${line}`).join("\n");
	}

	if (!canTransition || discoveredFlows.length === 0) {
		return systemPrompt;
	}

	const flowList = discoveredFlows
		.map((f) => {
			const badge = f.source === "project" ? " 🔒" : f.source === "user" ? " ⚙" : "";
			return `- [${f.name}]${badge} — ${f.description}`;
		})
		.join("\n");

	// Root state gets the full guide; child flows get a minimal version
	if (currentDepth > 0) {
		return (
			systemPrompt +
			`\n\n## Flows\n${flowList}\n\n` +
			`Guards: depth ${currentDepth}/${maxDepth} | cycles: ${preventCycles ? "blocked" : "off"} | stack: ${ancestorFlowStack.length > 0 ? ancestorFlowStack.join(" -> ") : "(root)"}`
		);
	}

	return (
		systemPrompt +
		`\n\n## Flows

Reason about whether to dive into a flow before acting:
- [trace] Fast code verification / snap user Q&A.
- [scout] Deep dive / architecture mapping / bash execution.
- [build] Implementation / verification (already clear).

${flowList}

Batch independent flows: { "flow": [{ "type": "scout", "intent": "..." }, { "type": "audit", "intent": "..." }] }

Results: summary, files, actions, commands, notDone, nextSteps, reasoning, notes.

### Guards
- Depth: ${currentDepth}/${maxDepth} | Cycles: ${preventCycles ? "blocked" : "off"} | Stack: ${ancestorFlowStack.length > 0 ? ancestorFlowStack.join(" -> ") : "(root)"}

### Shared Context
Child flows fork a sanitized snapshot (files read, commands, compressed results).
Write 'intent' as a **forward-looking mission**.
Set inheritContext: false for a clean slate.
`
	);
}

/**
 * Skip flow mode: classify user input to determine if flow orchestration is needed.
 *
 * Two-tier classification:
 * 1. Regex fast path — catches clear-cut cases with zero latency
 * 2. LLM fallback — handles ambiguous cases for accurate classification
 *
 * Design principles:
 * - Pure functions where possible
 * - LLM call is async and isolated
 * - Testable with mocks
 * - Debug logging for auditability
 */

import { complete } from "@earendil-works/pi-ai";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkipFlowConfig {
	enabled: boolean;
	debugMode?: boolean;
}

export type TaskClassification = "single-purpose" | "orchestrated" | "uncertain";

export interface ClassificationResult {
	classification: TaskClassification;
	source: "regex" | "llm";
	matches: string[];
}

// ---------------------------------------------------------------------------
// Regex patterns — ONLY match when 100% confident
// ---------------------------------------------------------------------------

/**
 * Patterns that DEFINITELY indicate single-purpose tasks.
 * Only match when we're absolutely certain — no false positives allowed.
 */
const DEFINITE_SINGLE_PURPOSE: Array<[RegExp, string]> = [
	// Pure search/find with no follow-up
	[/^(find|search|locate|grep|where\s+is|where\s+are|list\s+all|show\s+me)\s+.+$/i, "search-command"],
	// Pure read/cat operations
	[/^(read|cat|show|display|print|view|output)\s+(the\s+)?(contents?\s+of\s+)?.+\.(json|ts|js|md|txt|yaml|yml|toml|css|html|py|rs|go|java|cpp|c|h)$/i, "read-file"],
	// Pure check/verify
	[/^(check|verify|validate|test|inspect|examine)\s+.+$/i, "check-command"],
	// Pure count/measure
	[/^(count|how\s+many|how\s+much|what('s|\s+is)\s+the\s+(size|length|number))\s+.+$/i, "count-command"],
];

/**
 * Patterns that DEFINITELY indicate multi-step orchestrated tasks.
 */
const DEFINITE_MULTI_STEP: Array<[RegExp, string]> = [
	// Explicit sequential markers with multiple actions
	[/\b(first|1st)\b.*\b(then|2nd|after)\b.*\b(finally|3rd|last)\b/i, "explicit-sequence"],
	// Chinese explicit sequence
	[/第一[步骤].*第二[步骤].*第三[步骤]/, "explicit-sequence-zh"],
	// "do X, then Y, then Z" pattern
	[/\b\w+\s+.+,\s*then\s+\w+\s+.+,\s*then\s+\w+\s+/i, "then-sequence"],
	// Numbered list with 3+ items (strong signal)
	[/^\s*1\.\s+.+\n\s*2\.\s+.+\n\s*3\.\s+.+/m, "numbered-list"],
];

// Cache to store classification results per message to prevent redundant LLM calls
const classificationCache = new Map<string, ClassificationResult>();

export function clearClassificationCache(): void {
	classificationCache.clear();
}

/**
 * Exclude list of words that indicate multi-step actions or sequences.
 * If these are present, the task is ambiguous/orchestrated, so we bypass regex fast path.
 */
const MULTI_STEP_INDICATORS = /\b(and|then|after|next|first|finally|run|execute|fix|update|modify|change|refactor|create|make|write|add|delete|remove|rm)\b/i;

// ---------------------------------------------------------------------------
// Regex classification
// ---------------------------------------------------------------------------

/**
 * Try to classify using regex patterns.
 * Returns "uncertain" if no pattern matches definitively.
 */
export function classifyByRegex(message: string): {
	classification: TaskClassification;
	matches: string[];
} {
	const cleaned = message.trim();

	// If message has indicators of multi-step sequences or actions, we bypass the regex single-purpose fast path.
	const hasMultiStepIndicators = MULTI_STEP_INDICATORS.test(cleaned);

	if (!hasMultiStepIndicators) {
		// Check definite single-purpose patterns
		for (const [pattern, description] of DEFINITE_SINGLE_PURPOSE) {
			if (pattern.test(cleaned)) {
				return { classification: "single-purpose", matches: [description] };
			}
		}
	}

	// Check definite multi-step patterns
	for (const [pattern, description] of DEFINITE_MULTI_STEP) {
		if (pattern.test(cleaned)) {
			return { classification: "orchestrated", matches: [description] };
		}
	}

	// No definitive match — needs LLM
	return { classification: "uncertain", matches: [] };
}

// ---------------------------------------------------------------------------
// LLM classification
// ---------------------------------------------------------------------------

const CLASSIFY_PROMPT = `You are a task classifier. Determine if the user's request is a SINGLE-PURPOSE task or a MULTI-STEP ORCHESTRATED task.

SINGLE-PURPOSE tasks:
- Search, find, locate, grep
- Read, show, display file contents
- Analyze, summarize, explain ONE thing
- Check, verify, validate
- Count, measure, calculate
- Fix ONE bug, update ONE thing

MULTI-STEP ORCHESTRATED tasks:
- Do A, then B, then C
- Refactor module + update tests + deploy
- Research options + pick one + implement
- Plan and execute a workflow
- Tasks with explicit sequential steps

Reply with ONLY one word: "single" or "multi"`;

/**
 * Classify using LLM for uncertain cases.
 */
export async function classifyByLLM(
	message: string,
	model: any,
	apiKey: string,
	headers?: Record<string, string>,
	debugMode?: boolean,
): Promise<{ classification: TaskClassification; matches: string[] }> {
	const messages = [
		{
			role: "user" as const,
			content: [
				{
					type: "text" as const,
					text: `${CLASSIFY_PROMPT}\n\nUser request: ${message}`,
				},
			],
			timestamp: Date.now(),
		},
	];

	try {
		const response = await complete(
			model,
			{ messages },
			{
				apiKey,
				headers,
				maxTokens: 10,
			} as any,
		);

		const text = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("")
			.trim()
			.toLowerCase();

		if (debugMode) {
			console.log(`[skip-flow] LLM response: "${text}"`);
		}

		if (text.includes("multi")) {
			return { classification: "orchestrated", matches: ["llm-classified"] };
		}
		if (text.includes("single")) {
			return { classification: "single-purpose", matches: ["llm-classified"] };
		}

		// Unclear LLM response — default to orchestrated (safe)
		return { classification: "orchestrated", matches: ["llm-unclear-default"] };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (debugMode) {
			console.log(`[skip-flow] LLM error: ${message}`);
		}
		// On error, default to orchestrated (safe)
		return { classification: "orchestrated", matches: ["llm-error-default"] };
	}
}

// ---------------------------------------------------------------------------
// Main classification function
// ---------------------------------------------------------------------------

export interface ClassifyDeps {
	model?: any;
	apiKey?: string;
	headers?: Record<string, string>;
}

/**
 * Classify a user message as single-purpose or orchestrated.
 * Uses regex fast path first, falls back to LLM for uncertain cases.
 */
export async function classifyTask(
	message: string,
	config: SkipFlowConfig,
	deps?: ClassifyDeps,
): Promise<ClassificationResult> {
	const cleaned = message.trim();

	// Return cached result if available
	if (classificationCache.has(cleaned)) {
		const cached = classificationCache.get(cleaned)!;
		if (config.debugMode) {
			console.log(`[skip-flow] Cache hit for message: "${cleaned.slice(0, 40)}...":`, cached.classification);
		}
		return cached;
	}

	// Tier 1: Regex fast path
	const regexResult = classifyByRegex(cleaned);

	if (regexResult.classification !== "uncertain") {
		if (config.debugMode) {
			console.log(`[skip-flow] Regex classified as ${regexResult.classification}:`, regexResult.matches);
		}
		const result: ClassificationResult = {
			classification: regexResult.classification,
			source: "regex",
			matches: regexResult.matches,
		};
		classificationCache.set(cleaned, result);
		return result;
	}

	// Tier 2: LLM fallback
	if (deps?.model && deps?.apiKey) {
		if (config.debugMode) {
			console.log(`[skip-flow] Regex uncertain, falling back to LLM`);
		}

		const llmResult = await classifyByLLM(
			cleaned,
			deps.model,
			deps.apiKey,
			deps.headers,
			config.debugMode,
		);

		const result: ClassificationResult = {
			classification: llmResult.classification,
			source: "llm",
			matches: llmResult.matches,
		};
		classificationCache.set(cleaned, result);
		return result;
	}

	// No LLM available — default to orchestrated (safe)
	if (config.debugMode) {
		console.log(`[skip-flow] No LLM available, defaulting to orchestrated`);
	}
	const result: ClassificationResult = {
		classification: "orchestrated",
		source: "regex",
		matches: ["no-llm-default"],
	};
	classificationCache.set(cleaned, result);
	return result;
}

// ---------------------------------------------------------------------------
// Tool filtering
// ---------------------------------------------------------------------------

/**
 * Get active tools based on skip flow analysis.
 * If skip flow is enabled and task is single-purpose, exclude flow tool.
 */
export async function getSkipFlowTools(
	baseTools: string[],
	message: string,
	config: SkipFlowConfig,
	deps?: ClassifyDeps,
): Promise<string[]> {
	if (!config.enabled) {
		return baseTools;
	}

	const result = await classifyTask(message, config, deps);

	if (config.debugMode) {
		console.log(`[skip-flow] Classification result:`, {
			classification: result.classification,
			source: result.source,
			matches: result.matches,
			messageLength: message.trim().length,
		});
	}

	if (result.classification === "orchestrated") {
		return baseTools;
	}

	// Filter out flow tool for single-purpose tasks
	return baseTools.filter(tool => tool !== "flow");
}

/**
 * Check if flow is needed for a given message.
 * Convenience wrapper for boolean checks.
 */
export async function needsFlow(
	message: string,
	config: SkipFlowConfig,
	deps?: ClassifyDeps,
): Promise<boolean> {
	if (!config.enabled) {
		return true;
	}
	const result = await classifyTask(message, config, deps);
	return result.classification === "orchestrated";
}

/**
 * Smart mode: classify user input to determine if flow orchestration is needed.
 *
 * Single-purpose tasks (search, research, analyze) should skip flow
 * to avoid unnecessary orchestration overhead and potential timeouts.
 *
 * Design principles (matching pi-agent-flow conventions):
 * - Pure function, no side effects
 * - Testable in isolation
 * - Clear separation: classification vs. tool filtering
 * - Follows existing resolver pattern for settings
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SmartModeConfig {
	enabled: boolean;
	debugMode?: boolean;
}

export type TaskClassification = "single-purpose" | "orchestrated";

// ---------------------------------------------------------------------------
// Classification patterns
// ---------------------------------------------------------------------------

/**
 * Patterns indicating single-purpose tasks (no flow needed).
 * Each entry is [pattern, description] for debug logging.
 */
const SINGLE_PURPOSE_INDICATORS: Array<[RegExp, string]> = [
	// Search and find operations
	[/\b(find|search|locate|grep|look\s+for|where\s+is|where\s+are|list\s+all)\b/i, "search"],
	// Analysis and explanation
	[/\b(analyze|analyse|summarize|summarise|explain|describe|what\s+does|how\s+does|why\s+does)\b/i, "analysis"],
	// Read/list operations
	[/\b(read|show|display|print|output|cat|ls|tree|view)\b/i, "read"],
	// Check/verify operations
	[/\b(check|verify|validate|test|inspect|examine|debug|trace)\b/i, "check"],
	// Count/measure operations
	[/\b(count|measure|calculate|compute|how\s+many|how\s+much|size|length)\b/i, "count"],
	// Compare operations
	[/\b(compare|diff|difference|contrast)\b/i, "compare"],
	// Single action verbs
	[/\b(fix|update|change|rename|move|delete|remove|add|create)\b.*\b(bug|error|typo|name|file)\b/i, "single-action"],
];

/**
 * Patterns indicating multi-step orchestrated tasks (flow needed).
 */
const MULTI_STEP_INDICATORS: Array<[RegExp, string]> = [
	// Sequential indicators
	[/\b(first|then|after\s+that|finally|lastly|step\s+\d)\b/i, "sequential"],
	// Chinese sequential indicators
	[/第[一二三四五六七八九十]+|步骤|步[骤]?[\s\d]/, "sequential-zh"],
	// Multiple actions with conjunctions
	[/\b(and\s+then|then\s+and)\b/i, "conjunction"],
	// Workflow indicators
	[/\b(refactor|migrate|deploy|build|setup|configure|integrate|implement)\b/i, "workflow"],
	// Planning indicators
	[/\b(plan|strategy|roadmap|workflow|pipeline|orchestrat)\b/i, "planning"],
	// Chinese workflow indicators
	[/重构|迁移|部署|构建|配置|集成|实现|计划|策略|路线图|工作流|流水线|编排/, "workflow-zh"],
];

// ---------------------------------------------------------------------------
// Classification logic
// ---------------------------------------------------------------------------

/**
 * Classify a user message as single-purpose or orchestrated.
 * Returns the classification and matched indicators for debugging.
 */
export function classifyTask(message: string): {
	classification: TaskClassification;
	singlePurposeMatches: string[];
	multiStepMatches: string[];
} {
	const cleaned = message.trim();
	const singlePurposeMatches: string[] = [];
	const multiStepMatches: string[] = [];

	// Check single-purpose indicators
	for (const [pattern, description] of SINGLE_PURPOSE_INDICATORS) {
		if (pattern.test(cleaned)) {
			singlePurposeMatches.push(description);
		}
	}

	// Check multi-step indicators
	for (const [pattern, description] of MULTI_STEP_INDICATORS) {
		if (pattern.test(cleaned)) {
			multiStepMatches.push(description);
		}
	}

	// Decision logic:
	// - If list structure found → orchestrated (strongest signal)
	// - If multi-step indicators found → orchestrated
	// - If only single-purpose indicators → single-purpose
	// - If both found → orchestrated (err on side of caution)
	// - If neither found → check message length/structure

	let classification: TaskClassification;

	// Check for list structure first (strongest signal)
	if (hasListStructure(cleaned)) {
		classification = "orchestrated";
	} else if (multiStepMatches.length > 0) {
		classification = "orchestrated";
	} else if (singlePurposeMatches.length > 0) {
		classification = "single-purpose";
	} else {
		// No indicators found — use heuristics
		classification = classifyByStructure(cleaned);
	}

	return { classification, singlePurposeMatches, multiStepMatches };
}

/**
 * Check if message has list-like structure (numbered items, bullet points).
 */
function hasListStructure(message: string): boolean {
	const listPatterns = [
		/^\s*[\d]+\.\s/m,
		/^\s*[-*•]\s/m,
		/第[一二三四五六七八九十]+/,
		/step\s+\d/i,
	];

	return listPatterns.some(pattern => pattern.test(message));
}

/**
 * Structural heuristics when no keyword patterns match.
 */
function classifyByStructure(message: string): TaskClassification {
	// Very short messages are likely single-purpose
	if (message.length < 60) {
		return "single-purpose";
	}

	// Check for multiple sentences with different verbs
	const sentences = message.split(/[.!?。！？\n]+/).filter(s => s.trim().length > 10);
	if (sentences.length >= 3) {
		// Multiple sentences might indicate multi-step
		const verbPattern = /\b\w+(ed|ing|ize|ise|ify)\b/g;
		const verbs = new Set(message.match(verbPattern));
		if (verbs.size >= 3) {
			return "orchestrated";
		}
	}

	// Default to single-purpose for unclear cases
	return "single-purpose";
}

// ---------------------------------------------------------------------------
// Tool filtering
// ---------------------------------------------------------------------------

/**
 * Get active tools based on smart mode analysis.
 * If smart mode is enabled and task is single-purpose, exclude flow tool.
 */
export function getSmartModeTools(
	baseTools: string[],
	message: string,
	config: SmartModeConfig,
): string[] {
	if (!config.enabled) {
		return baseTools;
	}

	const { classification, singlePurposeMatches, multiStepMatches } = classifyTask(message);

	if (config.debugMode) {
		console.log(`[smart-mode] Classification: ${classification}`, {
			singlePurpose: singlePurposeMatches,
			multiStep: multiStepMatches,
			messageLength: message.trim().length,
		});
	}

	if (classification === "orchestrated") {
		return baseTools;
	}

	// Filter out flow tool for single-purpose tasks
	return baseTools.filter(tool => tool !== "flow");
}

/**
 * Check if flow is needed for a given message.
 * Convenience wrapper for boolean checks.
 */
export function needsFlow(message: string, config: SmartModeConfig): boolean {
	if (!config.enabled) {
		return true;
	}
	const { classification } = classifyTask(message);
	return classification === "orchestrated";
}

import { BUNDLED_FLOW_TYPES } from "./agents.js";
import { prepareFlowDispatchArguments } from "./flow-dispatch-prep.js";

export type FlowArgsPrepResult = {
	flow: Array<{ dispatch?: Array<{ tool: "batch" | "bash" | "web"; ops: unknown[] }> }>;
	notes: string[];
};

const FLOW_TYPE_NAMES: Set<string> = new Set(BUNDLED_FLOW_TYPES);

/**
 * Lenient argument normalizer for the `flow` tool.
 *
 * The strict TypeBox schema requires:
 *   { flow: [{ type, intent, aim, complexity, dispatch?: [...] }], ... }
 *
 * In practice, models sometimes:
 *   - Forget the outer `flow` wrapper and pass a single FlowItem at the top level.
 *   - Wrap `flow` in `{ item: {...} }` or pass it as a bare object (not an array).
 *   - Pass `dispatch` as a single object or as `{ item: {...} }` instead of an array.
 *
 * This normalizer transparently rewrites those shapes into the canonical form
 * before TypeBox validation runs, so the model gets a successful validation
 * result and a hint instead of a hard failure.
 *
 * Canonical input is returned unchanged (no allocation, no notes).
 */
export function prepareFlowArguments(input: unknown): unknown {
	if (!input || typeof input !== "object") return input;
	const args = input as Record<string, unknown>;

	let normalizedArgs = args;
	let changed = false;

	// CASE 1: bare FlowItem at the top level (no `flow` key, but has FlowItem fields).
	// Heuristic: `type` is a known flow name and `intent` is a string.
	// This catches the most common mistake: forgetting the outer `flow` wrapper.
	if (
		args.flow === undefined &&
		typeof args.type === "string" &&
		FLOW_TYPE_NAMES.has(args.type) &&
		typeof args.intent === "string"
	) {
		normalizedArgs = { flow: [args] };
		changed = true;
	}

	// CASE 2: `flow` is a single object (not an array) — wrap it.
	else if (args.flow && !Array.isArray(args.flow) && typeof args.flow === "object") {
		normalizedArgs = { ...normalizedArgs, flow: [args.flow] };
		changed = true;
	}

	// CASE 3: `flow` is wrapped as `{ item: {...} }` (a single-element wrapper).
	else if (
		args.flow &&
		typeof args.flow === "object" &&
		!Array.isArray(args.flow) &&
		(args.flow as Record<string, unknown>).item &&
		typeof (args.flow as Record<string, unknown>).item === "object" &&
		!Array.isArray((args.flow as Record<string, unknown>).item)
	) {
		normalizedArgs = { ...normalizedArgs, flow: [(args.flow as Record<string, unknown>).item] };
		changed = true;
	}

	// CASE 4: for each flow item, normalize `dispatch` shape.
	if (Array.isArray(normalizedArgs.flow)) {
		let flowChanged = false;
		const normalizedFlow = normalizedArgs.flow.map((item: unknown) => {
			if (!item || typeof item !== "object") return item;
			const flowItem = item as Record<string, unknown>;
			const rawDispatch = flowItem.dispatch;
			if (!rawDispatch || Array.isArray(rawDispatch)) return item;
			if (typeof rawDispatch !== "object") return item;

			const dispatchObj = rawDispatch as Record<string, unknown>;
			// 4a. Unwrap `{ item: {...} }` wrapper.
			if (dispatchObj.item && typeof dispatchObj.item === "object" && !Array.isArray(dispatchObj.item)) {
				flowChanged = true;
				return { ...flowItem, dispatch: [dispatchObj.item] };
			}
			// 4b. Wrap bare single object in an array.
			flowChanged = true;
			return { ...flowItem, dispatch: [dispatchObj] };
		});

		if (flowChanged) {
			normalizedArgs = { ...normalizedArgs, flow: normalizedFlow };
			changed = true;
		}
	}

	// Delegate inner-ops normalization to the dispatch-level prep.
	// Always call it so alias resolution and inference run even when the flow
	// shape itself is already canonical.
	return prepareFlowDispatchArguments(changed ? normalizedArgs : input);
}

import { prepareTraceDispatchArguments } from "../tools/trace-dispatch-prep.js";

export type FlowDispatchPrepResult = {
	flow: Array<{ dispatch?: Array<{ tool: "batch" | "bash" | "web"; ops: unknown[] }> }>;
	notes: string[];
};

export function prepareFlowDispatchArguments(input: unknown): unknown {
	if (!input || typeof input !== "object") return input;
	const args = input as Record<string, unknown>;
	const rawFlow = args.flow;
	if (!Array.isArray(rawFlow)) return input;

	let hasChanges = false;
	const normalizedFlow = rawFlow.map((item: unknown) => {
		if (!item || typeof item !== "object") return item;
		const flowItem = item as Record<string, unknown>;
		const rawDispatch = flowItem.dispatch;
		if (!rawDispatch) return flowItem;

		const dispatchResult = prepareTraceDispatchArguments({ dispatch: rawDispatch });
		if (dispatchResult.changed || dispatchResult.notes.length > 0) {
			hasChanges = true;
			return { ...flowItem, dispatch: dispatchResult.dispatch, _dispatchNotes: dispatchResult.notes };
		}
		return flowItem;
	});

	if (!hasChanges) return input;
	return { ...args, flow: normalizedFlow };
}

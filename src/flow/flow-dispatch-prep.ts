import { prepareTraceDispatchArguments } from "../tools/trace-dispatch-prep.js";
import { coerceArrayOfObjects } from "../tools/array-coerce.js";

export type FlowDispatchPrepResult = {
  flow: Array<{ dispatch?: Array<{ tool: "batch" | "bash" | "web"; ops: unknown[] }> }>;
  notes: string[];
};

export function prepareFlowDispatchArguments(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const args = input as Record<string, unknown>;
  const rawFlow = args.flow;
  if (!Array.isArray(rawFlow)) return input;

  const sanitized = coerceArrayOfObjects<Record<string, unknown>>(rawFlow, {
    label: "flow",
  });
  let hasChanges = sanitized.dropped > 0;

  const normalizedFlow = sanitized.value.map((item) => {
    const flowItem = item as Record<string, unknown>;
    const rawDispatch = flowItem.dispatch;
    if (!rawDispatch) return flowItem;

    const dispatchResult = prepareTraceDispatchArguments({
      dispatch: rawDispatch,
    });
    if (dispatchResult.changed || dispatchResult.notes.length > 0) {
      hasChanges = true;
      return {
        ...flowItem,
        dispatch: dispatchResult.dispatch,
        _dispatchNotes: dispatchResult.notes,
      };
    }
    return flowItem;
  });

  if (!hasChanges) return input;
  const result = { ...args, flow: normalizedFlow };
  if (sanitized.notes.length > 0) {
    (result as Record<string, unknown>)._flowNotes = sanitized.notes;
  }
  return result;
}

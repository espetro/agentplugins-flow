# Host render contract (flow / trace tools)

Pi must pass a **stable `args.state` object** for the lifetime of one tool call:

1. `renderCall(args, theme, args)` — may initialize `state`
2. Every `onUpdate(partial)` → host calls `renderResult(partial, …, args)` with the **same** `state`
3. Final `renderResult(result, …, args)` — same `state` again

## Required state fields (extension-managed)

| Field | Purpose |
|-------|---------|
| `__widgetId` | Stable scramble / header id (set on first render) |
| `__rootContainer` | In-place TUI root; subsequent renders mutate children instead of allocating a new tree |
| `__scramble.animTimer` | Optional animation invalidation timer |

## Extension guarantees

- Every partial from `runFlow` / `executeFlows` includes `_toolCallId` matching the parent tool call.
- `renderFlowResult` reuses `__rootContainer` when `args.state` is provided (see `tests/trace-render-state.test.ts`).
- Boot-phase UI uses `FlowLiveState` (`phase: "boot"`) until the first `runFlow` partial sets `phase: "running"`.

## If the host cannot pass stable `state`

Open an issue on pi-coding-agent to thread `state` through tool partial rendering, or pass `state` on each `onUpdate` payload once the host API supports it.

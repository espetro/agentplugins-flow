# Trace / flow TUI — tech debt (resolved)

All items from the original plan are implemented on branch `fix/trace-tui-context-and-headers` and follow-ups.

| ID | Item | Resolution |
|----|------|------------|
| TD-1 | Host partial `state` contract | [HOST-RENDER-CONTRACT.md](./HOST-RENDER-CONTRACT.md) + `tests/trace-render-state.test.ts` |
| TD-2 | Bootstrap side channel | Replaced by `src/tui/flow-live-state.ts` |
| TD-3 | Context seed math | `src/tui/context-display.ts` + `tests/context-display.test.ts` |
| TD-4 | Two live-update pipelines | `src/flow/flow-live.ts` (`runFlowWithLiveSession`, `wrapFlowOnUpdate`) |
| TD-5 | Ghost vs partial render | `buildBootPhaseSingleResult` + single `renderSingleFlowResult` path |
| TD-6 | Scramble TPS/ctx | `updateHeaderMetric()` in `scramble/manager.ts` |
| TD-7 | CI dist guard | `npm run check:dist` in CI; `scripts/sync-pi.mjs` for local install |
| TD-8 | Render state machine test | `tests/trace-render-state.test.ts` in `test:trace-ui` |
| TD-9 | Collapsed live text | Trace uses `toolCallId` only; multi-flow uses `publishFlowLiveTextAtIndex` |

## Local development

```bash
npm run verify:pi   # trace UI tests + sync to ~/.pi/agent/npm/node_modules/pi-agent-flow
npm run check:dist  # build + fail if dist contains legacy -----/ placeholder
```

## Architecture (current)

```
execute (flow/trace)
  → beginFlowLiveSession(toolCallId)
  → runFlow / executeFlows
       → emitUpdate / emitProgress (_toolCallId, details)
  → wrapFlowOnUpdate → host
  → endFlowLiveSession

renderResult
  → getFlowLiveState (boot paint)
  → buildBootPhaseSingleResult OR details.results
  → renderSingleFlowResult / multi
  → __rootContainer in-place update
```

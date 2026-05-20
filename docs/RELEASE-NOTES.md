# Release Notes — Audit Loop Feature

## Overview

This release introduces the **audit loop** feature: every `build` flow automatically receives a paired `audit` review, with up to `auditLoop` rework cycles.

## Breaking Changes

### Audit agent behavioral shift

The `audit` flow changed from a **fixer** to a **reviewer**:

| Before | After |
|---|---|
| Audit would apply patches directly | Audit returns a structured `verdict` (`pass`/`rework`) with `feedback` |
| Build and audit roles overlapped | Clear separation: audit analyzes, build implements |
| No rework loop | Build re-runs with audit feedback up to `auditLoop` times |

**Migration:** No action needed. Existing `audit` flow calls continue to work. The new behavior is automatic when `auditLoop > 0` on a `build` flow.

## New Features

- **`auditLoop` parameter** on the `flow` tool (default `1`, max `3`). Controls how many build↔audit rework cycles run.
- **Grouped audit** — multiple builds with the same `auditLoop` share one audit capstone.
- **Per-build verdicts** — the audit can flag individual builds for rework while approving others.
- **State-aware TUI rendering** — dormant flows show `[awaiting...]`, approved flows show `[approved]`, finished flows show `----- t/s`.
- **Metadata preservation** — `pingPongMeta` and `auditParentType` survive the runFlow → onUpdate → runFlow cycle via a shallow merge helper.

## Bug Fixes

- Fixed double blank line after group block.
- Fixed group header connector (`├─` instead of `└─`).
- Fixed tree child prefix for last build before audit capstone.
- Fixed `isValidBuildVerdict` rejecting `feedback: null`.

## Files Changed

- `src/flow/executor.ts` — grouped ping-pong executor, metadata preservation helper
- `src/tui/render.ts` — group detection, tree connectors, state-aware rendering
- `src/types/flow.ts` — `status`, `auditParentType`, `pingPongMeta`, `cycle` fields
- `src/types/output.ts` — `verdict`, `feedback`, `builds[]` in structured output
- `src/snapshot/structured-output.ts` — validation for per-build verdicts
- `src/index.ts` — top-level `auditLoop` parameter on flow tool
- `src/steering/sliding-prompt.ts` — auditLoop steering hint
- `agents/audit.md` — structured output instructions for verdict/feedback
- `docs/FLOWS.md` — audit loop documentation

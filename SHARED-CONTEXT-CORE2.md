# Shared Context Pipeline — Core-2 Specification

> **Active document.** This describes the core-2 snapshot pipeline (`src/core2/snapshot.ts`) introduced in v2.1+ as a replacement for the core-1 23-pass compression pipeline (see `SHARED-CONTEXT.md`, historical). Core-2 applies a deterministic **6-stage sanitization pipeline** that strips metadata noise irrelevant to child flow orientation while preserving chronological conversation history.
>
> **Correction note:** Prior versions of this spec (dated 2026-05-18) incorrectly claimed "verbatim preservation — strip only batch file bodies." The actual pipeline strips 10+ field categories and performs six distinct passes. This document was rewritten on 2026-05-23 to match reality.
>
> **Document type:** Conservative architectural specification  
> **Scope:** What IS, not what could be. Based on source-code evidence (`src/core2/snapshot.ts`, `src/flow/runner.ts`, `src/index.ts`) and test evidence (`tests/core2-snapshot.test.ts`).  
> **Date:** 2026-05-23  
> **Pipeline version:** 2.x

## §1 Main Ideas — What Every Child Flow Receives

### 1.1 Fork Snapshot JSONL

When a flow is spawned, the parent's session is serialized into a JSONL string and passed as the `--session` argument. This JSONL contains:

1. **One header line** — the session header (with compressed `cwd` and stripped `timestamp`).
2. **N branch entries** — one `JSON.stringify()` per branch entry, in exact chronological order, each processed through the 6-stage pipeline.

The function that builds this is `buildCore2Snapshot()` in `src/core2/snapshot.ts`.

### 1.2 Sanitization Philosophy

Core-2's design principle: **strip metadata noise that cannot be acted on by a child flow, while preserving every piece of conversation history the child needs for orientation.**

Core-1 used a 23-pass compression pipeline that made heuristic decisions about what to keep, truncate, or collapse. Core-2 takes a deterministic, stage-based approach: every entry runs through the same six passes in the same order, and each pass has a single, well-defined responsibility.

### 1.3 The 6 Stages

The pipeline runs in this exact order for every branch entry:

| Stage | Name | Function | What it strips |
|-------|------|----------|----------------|
| 1 | **Header compression** | `buildCore2Snapshot` | `timestamp` from header; `cwd` → relative/basename |
| 2 | **Entry sanitization** | `sanitizeSnapshotEntry` | `parentId`, `timestamp`; `thinking`/`reasoning`/`reasoningContent`; `api`/`provider`/`model`/`cost`/`details`/`responseId`/`responseModel`/`usage`/`isError`; `toolCallId` from tool/toolResult; `model_change`/`thinking_level_change` events; empty assistant messages |
| 3 | **Compaction filtering** | `maybeStripCompaction` | `compaction_trigger` events; replaces `compaction`/`context_compaction` with summary |
| 4 | **Active tool-call stripping** | `stripActiveToolCall` | Removes the active `toolCall` block from assistant messages; drops message if empty |
| 5 | **Batch body truncation** | `stripBatchBodies` | Truncates read/write/edit/context-map/file-summary bodies to first 3 + last 3 lines |
| 6 | **Directive/hint stripping** | `stripDirectives` | Removes `[Directive:...]` and `[Hint:...]` blocks from tool result text |

Source: `src/core2/snapshot.ts:24–406`.

### 1.4 What Is Preserved

The following content survives all six stages and is delivered to the child flow:

- **Chronological order** — every entry's sequence is maintained exactly.
- **System messages** — including compaction summaries.
- **User messages** — including those containing `---` headers (these are never stripped).
- **Assistant messages** — minus thinking blocks, API metadata, and usage telemetry.
- **Tool results** — after batch body truncation and directive stripping.
- **Bash output** — preserved verbatim (batch body rules do not truncate bash sections).
- **`rg` output** — preserved verbatim.
- **Web tool results** — preserved verbatim (unless they contain batch section headers).
- **`ask_user` results** — preserved verbatim.
- **Non-batch tool results** — any tool result not containing `\n--- ` section headers passes through untouched.
- **Flow tool calls and results** — name, arguments, and output text are preserved (minus `toolCallId`).

Test evidence: `tests/core2-snapshot.test.ts` retention suite (lines 29–110) and metadata-stripping suite (lines 500–632).

### 1.5 What Is Stripped — Summary

The following fields and content categories are removed by the pipeline:

**From entries:**
- `id` — session-manager deduplication IDs irrelevant to linear replay.
- `parentId` — tree linkage is irrelevant to linear replay.
- `timestamp` — on both the header and every entry.

**From messages:**
- `thinking`, `reasoning`, `reasoningContent` — reasoning blocks are stripped from both message-level fields and content-array blocks.
- `api`, `provider`, `model` — execution provider metadata.
- `cost` — cost telemetry.
- `details` — arbitrary detail objects on tool results.
- `responseId`, `responseModel` — response identifiers.
- `usage` — token telemetry (input/output/total) irrelevant to child orientation.
- `isError` — error flag on tool results.
- `toolCallId` — from `role: "tool"` and `role: "toolResult"` messages only; child flows replay linearly and never invoke by ID.

**Dropped entirely:**
- `model_change` events — child flows do not need to know the parent switched models.
- `thinking_level_change` events — internal control signal.
- `compaction_trigger` events — internal compaction signal.
- Empty assistant messages — if stripping leaves an assistant message with no text and no tool calls, the entry is omitted.

**Replaced:**
- `compaction` and `context_compaction` entries — replaced with a lightweight system message: `[Context Compacted] <summary> (<N> tokens summarized)`.

**Truncated:**
- Batch read/write/edit/context-map/file-summary bodies exceeding 6 lines — truncated to first 3 + last 3 lines.

**Cleaned:**
- `[Directive: ...]` and `[Hint: ...]` blocks — removed from all tool result text.

### 1.6 CWD Compression

The session header's `cwd` field is compressed to save ~50–100 bytes:

| Condition | Result | Example |
|-----------|--------|---------|
| `cwd === process.cwd()` | `"."` | `/Users/dev/project` → `"."` |
| `cwd` starts with `process.cwd() + "/"` | Relative path | `/Users/dev/project/src` → `"src"` |
| `cwd` starts with `process.cwd() + "\\"` | Relative path (Windows) | `C:\project\src` → `"src"` |
| Otherwise | Basename only | `/tmp/some-dir` → `"some-dir"` |

Additionally, the header's `timestamp` field is deleted entirely.

Source: `src/core2/snapshot.ts:26–41`.

### 1.7 Header Deduplication

If the first branch entry already has `type === "session"` or `type === "header"` with the same `id` as the header, the header line is **not emitted**. This prevents double-headers when the session manager includes the header in the branch.

Source: `src/core2/snapshot.ts:55–70`.

## §2 Stage Details

### 2.1 Stage 1 — Header Compression

Before iterating branch entries, `buildCore2Snapshot` receives the session header from `sessionManager.getHeader()`. It:

1. Deletes `timestamp` from the header object.
2. Compresses `cwd` according to §1.6 rules.
3. Stores the compressed header for later emission (unless deduplicated per §1.7).

Source: `src/core2/snapshot.ts:26–41`.

### 2.2 Stage 2 — Entry Sanitization (`sanitizeSnapshotEntry`)

This is the most extensive stage. It operates on a single branch entry and returns `null` to drop the entry entirely.

**Step A — Drop config events:**
If `entry.type === "model_change"` or `entry.type === "thinking_level_change"`, return `null`.

**Step B — Strip entry-level fields:**
- `delete result.timestamp`
- `delete result.parentId`
- `delete result.id`

**Step C — Strip message metadata:**
For `type === "message"` entries, a copy of `entry.message` is made and the following fields are deleted:
- `msg.thinking`
- `msg.reasoning`
- `msg.reasoningContent`
- `msg.api`
- `msg.provider`
- `msg.model`
- `msg.cost`
- `msg.details`
- `msg.responseId`
- `msg.responseModel`
- `msg.timestamp`
- `msg.isError`
- `msg.usage` (deleted for non-assistant roles; **slimmed** for `role === "assistant"` via `slimAssistantUsage` to `{input, output, cacheRead, cacheWrite, totalTokens}` — child `pi` needs `totalTokens` for compaction accounting)

**Step D — Strip tool correlation IDs:**
If `msg.role === "toolResult"` or `msg.role === "tool"`, delete `msg.toolCallId`.

**Step E — Filter thinking blocks from content array:**
If `msg.content` is an array, filter out any block where `block.type === "thinking"` or `block.type === "reasoning"`.

**Step F — Drop empty assistant messages:**
If, after the above filtering, an assistant message has:
- No remaining content blocks with substance (non-empty text, non-thinking blocks, or tool calls), **and**
- No `toolCalls` / `tool_calls`

…then the entire entry is dropped (`return null`).

Source: `src/core2/snapshot.ts:104–188`.

### 2.3 Stage 3 — Compaction Filtering (`maybeStripCompaction`)

Handles two compaction-related entry types:

| Input type | Action |
|------------|--------|
| `compaction_trigger` | Return `null` (drop entirely). |
| `compaction` or `context_compaction` | Replace with a synthetic system message: `[Context Compacted] <summary> (<N> tokens summarized)`. If no summary is present, uses `"Parent context was compacted."` as fallback. The potentially large `encrypted_content` blob is discarded. |

Source: `src/core2/snapshot.ts:189–219`.

### 2.4 Stage 4 — Active Tool-Call Stripping (`stripActiveToolCall`)

When `buildCore2Snapshot` is called with `options.activeToolCallId` (the ID of the tool call that triggered the current flow spawn), this stage removes that tool call block from any assistant message in the snapshot.

**Why:** The assistant message that invoked the `flow` tool should not appear to the child flow as if it still needs to execute that same tool call. The child receives the tool call via its own activation prompt, not via the snapshot.

If removing the active tool call leaves the assistant message with no other substance (no text, no other tool calls), the entire entry is dropped.

Source: `src/core2/snapshot.ts:359–406`.

### 2.5 Stage 5 — Batch Body Truncation (`stripBatchBodies`)

This stage operates on the **text content** of `role: "tool"` and `role: "toolResult"` messages. It identifies batch section headers and truncates their bodies.

**Section header regexes (what triggers truncation):**

| Regex | Matches | Example |
|-------|---------|---------|
| `/^--- (.+) \((\d+) lines\) ---$/` | Batch file read with line count | `--- src/foo.ts (42 lines) ---` |
| `/^--- (.+) (context map\|file summary) ---$/` | Context map or file summary | `--- src/bar.ts context map ---` |
| `/^--- read: (.+) ---$/` | Individual read | `--- read: src/baz.ts ---` |
| `/^--- write: (.+) \((\d+) bytes\) ---$/` | Write with byte count | `--- write: src/qux.ts (128 bytes) ---` |
| `/^--- write: (.+) ---$/` | Write without byte count | `--- write: src/qux.ts ---` |
| `/^--- edit: (.+) \(([^)]*)\) ---$/` | Edit with details | `--- edit: src/qux.ts (3 changes) ---` |
| `/^--- edit: (.+) ---$/` | Edit without details | `--- edit: src/qux.ts ---` |

**Boundary headers (end of current section):**

These mark where one section ends and the next begins. A header can be both a batch truncation trigger AND a section boundary.

| Regex | Matches |
|-------|---------|
| `/^--- (.+) \((\d+) lines\) ---$/` | Batch file read (dual role) |
| `/^--- (.+) (context map\|file summary) ---$/` | Context map / file summary (dual role) |
| `/^--- bash \[.+\] (exit (\d+)\|pending\|error) ---$/` | Bash result header |
| `/^--- \[.+\] (exit (\d+)\|interrupted) ---$/` | Generic command result |
| `/^--- \[.+\] still running ---$/` | Still-running process |
| `/^--- edit: .+ ---$/` | Edit header (dual role) |
| `/^--- write: .+ ---$/` | Write header (dual role) |
| `/^--- delete: .+ ---$/` | Delete header |
| `/^--- read: .+ ---$/` | Read header (dual role) |
| `/^--- rg: .+ ---$/` | Grep result header |
| `/^--- patch: .+ ---$/` | Patch header |
| `/^--- (?!bash \[\|edit:\|write:\|delete:\|read:\|rg:\|patch:)(.+) ---$/` | Generic section header (catch-all) |

**Truncation math:**

```
if body.length > 6:
  output = header_line
          + body[0..2]              // first 3 lines
          + "[...{body.length - 6} lines truncated...]"
          + body[body.length - 3]   // last 3 lines
else:
  output = header_line + body    // keep entire body
```

- "Body" = all lines between the batch section header and the next `isKnownSectionHeader` match.
- The section header itself is **not** counted in the body.
- `\r\n` is normalized to `\n` before splitting.
- The `[...N lines truncated...]` marker is a single line.

Source: `src/core2/snapshot.ts:220–235` (`isKnownSectionHeader`), `src/core2/snapshot.ts:238–248` (`isBatchSectionHeader`), `src/core2/snapshot.ts:251–280` (`stripBatchBodies`).

### 2.6 Stage 6 — Directive/Hint Stripping (`stripDirectives`)

After batch body truncation, the text is passed to `stripDirectives()` (imported from `src/steering/tool-utils.ts`). This removes:

- Any line containing `[Directive: ...]`
- Any line containing `[Hint: ...]`

These directives are injected by the parent flow's steering system to guide the *parent* agent. Child flows receive their own fresh directives in the activation prompt, so inherited directives are noise.

This stage is applied inside `maybeStripBatchBodies` immediately after `stripBatchBodies`, but it runs on the full text regardless of whether batch sections were present.

Source: `src/core2/snapshot.ts:328` (inside `maybeStripBatchBodies`); `src/steering/tool-utils.ts` (`stripDirectives`).

## §3 Processing Pipeline (Per-Entry)

1. `buildCore2Snapshot()` iterates branch entries in order (`src/core2/snapshot.ts:72–77`).
2. For each entry, `sanitizeSnapshotEntry()` runs Stage 2 (`src/core2/snapshot.ts:104–188`).
3. `maybeStripCompaction()` runs Stage 3 (`src/core2/snapshot.ts:189–219`).
4. `stripActiveToolCall()` runs Stage 4 if `options.activeToolCallId` is set (`src/core2/snapshot.ts:359–404`).
5. `JSON.stringify()` produces a JSONL line.
6. `maybeStripBatchBodies()` runs Stages 5 and 6 on the string (`src/core2/snapshot.ts:283–352`).
   - Fast path: if the line does not contain `"role":"tool"` or `"role":"toolResult"`, skip.
   - Otherwise JSON-parse, extract text content, run `stripBatchBodies` then `stripDirectives`.
   - If the text changed, reconstruct the entry and re-stringify.

## §4 Function Interface

### 4.1 `SessionSnapshotSource`

```ts
export interface SessionSnapshotSource {
  getHeader: () => unknown;
  getBranch: () => unknown[];
}
```

The session manager must implement these two methods. `getHeader()` returns the session header object (or null/undefined if no header). `getBranch()` returns the chronological array of branch entries.

### 4.2 `BuildCore2SnapshotOptions`

```ts
export interface BuildCore2SnapshotOptions {
  forkedFrom?: string;
  forkedAt?: string;
  parentFlow?: string;
  depth?: number;
  activeToolCallId?: string;
}
```

`activeToolCallId` is the critical field for Stage 4. When a flow is spawned in response to a tool call, this ID ensures the child snapshot does not contain the still-pending tool call block.

### 4.3 `buildCore2Snapshot` Return

```ts
export function buildCore2Snapshot(
  sessionManager: SessionSnapshotSource,
  options?: BuildCore2SnapshotOptions,
): string | null
```

- Returns `null` if `getHeader()` returns null or non-object.
- Otherwise returns a JSONL string with a trailing newline.
- Each branch entry is one line; the header (if not deduplicated) is one line.

Source: `src/core2/snapshot.ts:24–103`.

## §5 JSONL Format

### 5.1 Header Line

The first line (if emitted — see §1.7 for dedup) is the session header with compressed `cwd` and no `timestamp`.

### 5.2 Branch Entries

Each branch entry is `JSON.stringify(entry)` on its own line. Entries may be dropped entirely (`null` returned by a stage) or have their text content modified by Stages 5 and 6.

### 5.3 No Compression Stats Entry

Unlike core-1, core-2 JSONL does **not** contain a trailing `compression-stats` entry. There is no post-pipeline metrics entry.

## §6 Dump File Format

When `PI_FLOW_DUMP_SNAPSHOT` is set, each flow produces two files:

### 6.1 Markdown Dump (`.md`)

```markdown
<!-- pi-agent-flow dump -->
{metadata}

## Session Snapshot (JSONL)
{full JSONL content}

## Activation Prompt (-p)
{reconstructed raw prompt}
```

> **Note:** The `## Compression Stats` markdown section that existed in earlier versions has been removed (it always showed zeroed values and provided no signal). Core-2 does not emit pre/post byte metrics.

### 6.2 Text Dump (`.txt`)

Verbatim copy of the reconstructed `-p` prompt only.

### 6.3 Activation Prompt Changes

The activation prompt no longer contains a standalone `Transition: on/off (depth X/Y · stack: ...)` line. Transition state is communicated exclusively through the `<activation ... depth="..." lineage="...">` XML attributes, removing duplication.

Source: `src/flow/runner.ts` (dump writing and activation prompt construction).

### 6.4 Differences from Core-1 Dumps

| Feature | Core-1 | Core-2 |
|---------|--------|--------|
| `compression-stats` JSONL entry | Present | **Absent** |
| `## Compression Stats` markdown section | Present | **Absent** |
| `passesApplied` array | Present | **Absent** |
| `preBytes` / `postBytes` metrics | Present | Zeroed (section removed) |
| `Transition:` line in prompt | Present | **Absent** |

## §7 Conservative Improvement Principles

### 7.1 Bar for Adding New Stripping

**High.** Any new stripping rule must be justified by:

1. **Concrete token-bloat measurement** — not aesthetics or assumptions.
2. **No information loss** — truncation must preserve orientation (first/last lines or summary).
3. **Preference for alternatives** — env-var injection, `-p` prompt tuning, or session-mode budgets before snapshot mutation.
4. **Test coverage** — every new strip must have a regression test in `tests/core2-snapshot.test.ts`.

### 7.2 Backward Compatibility

Dump format sections are a de-facto API. Do not reorder or rename:
- `## Session Snapshot (JSONL)`
- `## Activation Prompt (-p)`

Existing dump-analysis scripts depend on these headings.

### 7.3 Fixture Discipline

If `isBatchSectionHeader` or `isKnownSectionHeader` regexes change:
1. Regenerate dump fixtures.
2. Update `tests/core2-snapshot.test.ts`.
3. Run `npm run build && npm test` before committing.

`tests/fixtures/dumps/` are verbatim artifacts — **never** modify them directly.

## §8 File References

| File | Role | Lines of Interest |
|------|------|-------------------|
| `src/core2/snapshot.ts` | Snapshot builder, all 6 stages | 24–95 (`buildCore2Snapshot`), 104–182 (`sanitizeSnapshotEntry`), 189–213 (`maybeStripCompaction`), 220–235 (`isKnownSectionHeader`), 238–248 (`isBatchSectionHeader`), 251–280 (`stripBatchBodies`), 283–352 (`maybeStripBatchBodies`), 359–404 (`stripActiveToolCall`) |
| `tests/core2-snapshot.test.ts` | 19+ regression tests | 29–110 (retention), 113–145 (chronology), 148–300 (nuance), 350–632 (compaction + metadata stripping) |
| `src/flow/runner.ts` | Dump writing, activation prompt builder, env propagation | 660–720 (dump format), 700–720 (env propagation) |
| `src/flow/transition.ts` | Transition state logic | 1–88 (`buildGuardLine`, `buildFlowListSection`, `buildLineage`) |
| `src/steering/tool-utils.ts` | Directive/hint stripping helper | `stripDirectives()` |
| `src/index.ts` | Core-2 switch point | 561–567 (`buildCore2Snapshot` call) |

## §9 Glossary

| Term | Meaning |
|------|---------|
| **Fork snapshot** | Serialized session state passed to child flow via `--session` argument |
| **Sanitization** | The 6-stage pipeline that strips metadata noise before serialization |
| **Batch body stripping** | Truncation of read/write/edit/context-map/file-summary sections to first 3 + last 3 lines when body exceeds 6 lines |
| **Orientation lines** | The first 3 and last 3 lines kept after truncation, providing context about what was read/written/edited without the full body |
| **JSONL** | JSON Lines format — one JSON object per line, newline-delimited |
| **Section header** | A line matching `isBatchSectionHeader()` or `isKnownSectionHeader()`, formatted as `--- <path> (<detail>) ---` |
| **Cold-start dump** | A dump where the session has no history — contains only the HTML header and Activation Prompt, no Session Snapshot section |
| **Active tool call** | The `toolCall` block that triggered the current flow spawn; stripped from the parent snapshot so the child does not replay it |

## §10 Compaction Awareness

The native `/compact` command in `pi` summarizes conversation history. Core-2 handles this by treating the resulting summary as a verbatim history entry.

### 10.1 Summarization Injection
To prevent information loss during compaction, `pi-agent-flow` implements a `session_before_compact` hook that injects the current **Goal Objective**, **Acceptance Criteria**, and **Recent Flow History** into the summarization prompt. This ensures that the native "compaction summary" is flow-aware and maintains situational awareness for the current mission.

### 10.2 Post-Compaction Re-anchoring
After a compaction completes, `pi-agent-flow` sends a non-displaying "orientation" message to the tail of the new history. This message restates the current goal to ensure the agent (and any future child flows) remains anchored to the objective, even if the generic summary is brief.

### 10.3 Goal Persistence in Snapshots
Regardless of compaction, every child flow's activation prompt (`-p`) includes a `<flow>` block containing the current goal's objective and a summary of completed steps. This provides a "double-entry" safety mechanism ensuring that child flows never lose sight of the higher-level mission, even in heavily compacted sessions.

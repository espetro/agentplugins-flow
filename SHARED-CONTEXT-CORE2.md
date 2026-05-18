# Shared Context Pipeline — Core-2 Specification

> **Active document.** This describes the core-2 pipeline (`src/core2/snapshot.ts`) introduced in v2.1+ as a replacement for the core-1 23-pass compression pipeline (see `SHARED-CONTEXT.md`, historical). Core-2 preserves all conversation context verbatim in chronological order, stripping only batch read/write/edit file bodies.
>
> **Document type:** Conservative architectural specification  
> **Scope:** What IS, not what could be. Based on source-code evidence (`src/core2/snapshot.ts`, `src/flow/runner.ts`, `src/index.ts`) and test evidence (`tests/core2-snapshot.test.ts`).  
> **Date:** 2026-05-18  
> **Pipeline version:** 2.x

## §1 Main Ideas — What Every Child Flow Receives

### 1.1 Fork Snapshot JSONL

When a flow is spawned, the parent's session is serialized into a JSONL string and passed as the `--session` argument. This JSONL contains:

1. **One header line** — the session header (with compressed `cwd`).
2. **N branch entries** — one `JSON.stringify()` per branch entry, in exact chronological order.

The function that builds this is `buildCore2Snapshot()` in `src/core2/snapshot.ts`.

### 1.2 Verbatim Preservation Philosophy

Core-2's design principle: **preserve all conversation context verbatim; strip only batch file bodies.**

Core-1 used a 23-pass compression pipeline that made heuristic decisions about what to keep, truncate, or collapse. This caused information loss in edge cases. Core-2 takes the opposite approach: everything is preserved as-is, and the only mutation is truncating large file bodies in batch tool results.

### 1.3 What Is NOT Stripped

The following content is preserved **verbatim** in the snapshot:

- System messages
- User messages (including those containing `---` headers)
- Assistant reasoning / thinking blocks
- API metadata (model, stop reason, usage)
- Timestamps
- Custom messages and config events
- Flow tool calls and results
- Web tool results
- `ask_user` results
- Bash output
- `rg` output
- Non-batch tool results (any tool result not containing `\n--- ` section headers)
- All other `type: "message"` entries that are not `role: "tool"` or `role: "toolResult"`

Test evidence: `tests/core2-snapshot.test.ts` retention suite (7 tests, lines 29–110).

### 1.4 What Is Stripped

Only **batch read/write/edit file bodies** are truncated. Specifically:

- `--- <path> (<n> lines) ---` sections (batch file reads)
- `--- <path> (context map) ---` and `--- <path> (file summary) ---` sections
- `--- read: <path> ---` sections
- `--- write: <path> (<n> bytes) ---` and `--- write: <path> ---` sections
- `--- edit: <path> (<details>) ---` and `--- edit: <path> ---` sections

For sections with **more than 6 body lines**, only the first 3 and last 3 lines are kept, with `[...N-6 lines truncated...]` inserted. Sections with 6 or fewer body lines are kept intact.

### 1.5 CWD Compression

The session header's `cwd` field is compressed to save ~50–100 bytes:

| Condition | Result | Example |
|-----------|--------|---------|
| `cwd === process.cwd()` | `"."` | `/Users/alice/project` → `"."` |
| `cwd` starts with `process.cwd() + "/"` | Relative path | `/Users/alice/project/src` → `"src"` |
| `cwd` starts with `process.cwd() + "\\"` | Relative path (Windows) | `C:\project\src` → `"src"` |
| Otherwise | Basename only | `/tmp/some-dir` → `"some-dir"` |

Source: `src/core2/snapshot.ts:26–41`.

### 1.6 Header Deduplication

If the first branch entry already has `type === "session"` or `type === "header"` with the same `id` as the header, the header line is **not emitted**. This prevents double-headers when the session manager includes the header in the branch.

Source: `src/core2/snapshot.ts:55–70`.

## §2 Batch Body Stripping — Exact Rules

### 2.1 Sections That Are Stripped

A line is identified as a batch section header if it matches `isBatchSectionHeader()` (`src/core2/snapshot.ts:104–122`). The exact regexes:

| Regex | Matches | Example |
|-------|---------|---------|
| `/^--- (.+) \((\d+) lines\) ---$/` | Batch file read with line count | `--- src/foo.ts (42 lines) ---` |
| `/^--- (.+) (context map\|file summary) ---$/` | Context map or file summary | `--- src/bar.ts context map ---` |
| `/^--- read: (.+) ---$/` | Individual read | `--- read: src/baz.ts ---` |
| `/^--- write: (.+) \((\d+) bytes\) ---$/` | Write with byte count | `--- write: src/qux.ts (128 bytes) ---` |
| `/^--- write: (.+) ---$/` | Write without byte count | `--- write: src/qux.ts ---` |
| `/^--- edit: (.+) \(([^)]*)\) ---$/` | Edit with details | `--- edit: src/qux.ts (3 changes) ---` |
| `/^--- edit: (.+) ---$/` | Edit without details | `--- edit: src/qux.ts ---` |

Only `role: "tool"` or `role: "toolResult"` messages are processed. User messages containing `---` headers are **not** stripped.

### 2.2 Sections That Are NOT Stripped

A line matching `isKnownSectionHeader()` (`src/core2/snapshot.ts:82–103`) marks the end of the current batch section. These headers delimit sections whose bodies are preserved verbatim:

| Regex | Matches |
|-------|---------|
| `/^--- (.+) \((\d+) lines\) ---$/` | Batch file read (also in §2.1 — dual role: it's a batch header AND a section boundary) |
| `/^--- (.+) (context map\|file summary) ---$/` | Context map / file summary (also in §2.1) |
| `/^--- bash \[.+\] (exit (\d+)\|pending\|error) ---$/` | Bash result header |
| `/^--- \[.+\] (exit (\d+)\|interrupted) ---$/` | Generic command result |
| `/^--- \[.+\] still running ---$/` | Still-running process |
| `/^--- edit: .+ ---$/` | Edit header (also in §2.1) |
| `/^--- write: .+ ---$/` | Write header (also in §2.1) |
| `/^--- delete: .+ ---$/` | Delete header |
| `/^--- read: .+ ---$/` | Read header (also in §2.1) |
| `/^--- rg: .+ ---$/` | Grep result header |
| `/^--- patch: .+ ---$/` | Patch header |
| `/^--- (?!bash \[\|edit:\|write:\|delete:\|read:\|rg:\|patch:)(.+) ---$/` | Generic section header (catch-all) |

The key distinction: `isBatchSectionHeader` identifies sections whose **bodies are truncated**. `isKnownSectionHeader` identifies **section boundaries** (where one section ends and the next begins). A header can be both — batch read headers trigger truncation AND mark the end of the previous section.

### 2.3 Truncation Math

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

Source: `src/core2/snapshot.ts:137–146`.

### 2.4 Processing Pipeline

1. `buildCore2Snapshot()` iterates branch entries in order (`src/core2/snapshot.ts:72–77`).
2. For each entry, `JSON.stringify()` produces a JSONL line.
3. `maybeStripBatchBodies()` checks if the line contains `"role":"tool"` or `"role":"toolResult"` (fast string check before JSON parse).
4. If yes, JSON-parses the entry and checks `type === "message"` with `message.role` matching.
5. Extracts text content (string content or first `type: "text"` part in array content).
6. Fast path: if text does not contain `\n--- `, returns unmodified.
7. Otherwise, runs `stripBatchBodies()` on the text.
8. If the stripped text differs from the original, reconstructs the entry with the stripped content and re-stringifies.

Source: `src/core2/snapshot.ts:173–219`.

## §3 Function Interface

### 3.1 `SessionSnapshotSource`

```ts
export interface SessionSnapshotSource {
  getHeader: () => unknown;
  getBranch: () => unknown[];
}
```

The session manager must implement these two methods. `getHeader()` returns the session header object (or null/undefined if no header). `getBranch()` returns the chronological array of branch entries.

### 3.2 `BuildCore2SnapshotOptions`

```ts
export interface BuildCore2SnapshotOptions {
  forkedFrom?: string;
  forkedAt?: string;
  parentFlow?: string;
  depth?: number;
}
```

All fields are optional metadata for the fork context. Currently unused in the snapshot builder itself but reserved for future use.

### 3.3 `buildCore2Snapshot` Return

```ts
export function buildCore2Snapshot(
  sessionManager: SessionSnapshotSource,
  _options?: BuildCore2SnapshotOptions,
): string | null
```

- Returns `null` if `getHeader()` returns null or non-object.
- Otherwise returns a JSONL string with a trailing newline.
- Each branch entry is one line; the header (if not deduplicated) is one line.

Source: `src/core2/snapshot.ts:24–77`.

## §4 JSONL Format

### 4.1 Header Line

The first line (if emitted — see §1.6 for dedup) is the session header with compressed `cwd`.

### 4.2 Branch Entries

Each branch entry is `JSON.stringify(entry)` on its own line. Only entries with `type: "message"` and `role: "tool"` or `"toolResult"` may have their text content modified by `maybeStripBatchBodies()`. All other entries are verbatim.

### 4.3 No Compression Stats Entry

Unlike core-1, core-2 JSONL does **not** contain a trailing `compression-stats` entry. There is no sanitization pipeline to measure. This is a format difference from core-1 dumps.

## §5 Dump File Format

When `PI_FLOW_DUMP_SNAPSHOT` is set, each flow produces two files:

### 5.1 Markdown Dump (`.md`)

```markdown
<!-- pi-agent-flow dump -->
{metadata}

## Session Snapshot (JSONL)
{full JSONL content}

## Activation Prompt (-p)
{reconstructed raw prompt}
```

Note: `## Compression Stats` is **absent** — core-2 has no compression metrics.

### 5.2 Text Dump (`.txt`)

Verbatim copy of the reconstructed `-p` prompt only.

### 5.3 Differences from Core-1 Dumps

| Feature | Core-1 | Core-2 |
|---------|--------|--------|
| `compression-stats` JSONL entry | Present | **Absent** |
| `## Compression Stats` markdown section | Present | **Absent** |
| `passesApplied` array | Present | **Absent** |
| `preBytes` / `postBytes` metrics | Present | **Absent** |

Source: `src/flow/runner.ts:666–681`.

## §6 Conservative Improvement Principles

### 6.1 Bar for Adding New Stripping

**High.** Core-2's value proposition is verbatim preservation. Any new stripping rule must be justified by:

1. **Concrete token-bloat measurement** — not aesthetics or assumptions.
2. **No information loss** — truncation must preserve orientation (first/last lines).
3. **Preference for alternatives** — env-var injection, `-p` prompt tuning, or session-mode budgets before snapshot mutation.

### 6.2 Backward Compatibility

Dump format sections are a de-facto API. Do not reorder or rename:
- `## Session Snapshot (JSONL)`
- `## Activation Prompt (-p)`

Existing dump-analysis scripts depend on these headings.

### 6.3 Fixture Discipline

If `isBatchSectionHeader` or `isKnownSectionHeader` regexes change:
1. Regenerate dump fixtures.
2. Update `tests/core2-snapshot.test.ts`.
3. Run `npm run build && npm test` before committing.

`tests/fixtures/dumps/` are verbatim artifacts — **never** modify them directly.

## §7 File References

| File | Role | Lines of Interest |
|------|------|-------------------|
| `src/core2/snapshot.ts` | Snapshot builder, batch stripping logic | 24–77 (`buildCore2Snapshot`), 82–103 (`isKnownSectionHeader`), 104–122 (`isBatchSectionHeader`), 123–171 (`stripBatchBodies`), 173–219 (`maybeStripBatchBodies`) |
| `tests/core2-snapshot.test.ts` | 19 regression tests | 29–110 (retention), 113–145 (chronology), 148–300 (nuance) |
| `src/flow/runner.ts` | Dump writing, env propagation | 666–681 (dump format), 700–720 (env propagation) |
| `src/index.ts` | Core-2 switch point | 407–410 (`buildCore2Snapshot` call) |

## §8 Glossary

| Term | Meaning |
|------|---------|
| **Fork snapshot** | Serialized session state passed to child flow via `--session` argument |
| **Batch body stripping** | Truncation of read/write/edit/context-map/file-summary sections to first 3 + last 3 lines when body exceeds 6 lines |
| **Orientation lines** | The first 3 and last 3 lines kept after truncation, providing context about what was read/written/edited without the full body |
| **JSONL** | JSON Lines format — one JSON object per line, newline-delimited |
| **Section header** | A line matching `isBatchSectionHeader()` or `isKnownSectionHeader()`, formatted as `--- <path> (<detail>) ---` |
| **Cold-start dump** | A dump where the session has no history — contains only the HTML header and Activation Prompt, no Session Snapshot section |

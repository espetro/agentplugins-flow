# Snapshot Instrumentation Guide

> How to capture, inspect, and verify the exact context presented to flow agents.

## Quick Capture

Set `PI_FLOW_DUMP_SNAPSHOT` before starting `pi`. Every spawned flow writes a `.md` + `.txt` dump pair:

```bash
export PI_FLOW_DUMP_SNAPSHOT=/tmp/pi-dump
pi -p "spawn a trace to read src/core2/snapshot.ts"
# … do your work …
ls -lh /tmp/pi-dump.*
```

> ⚠️ **Must be exported in the same shell.** Subshell exports (e.g. `bash -c 'export …'`) will not propagate.

## What a Dump Contains

| File | Purpose |
|------|---------|
| `pi-dump.<flowName>.<timestamp>.md` | Full markdown — JSONL snapshot + activation prompt + compression stats |
| `pi-dump.<flowName>.<timestamp>.txt` | Reconstructed prompt transcript only |

## Reading the JSONL Snapshot

The `## Session Snapshot (JSONL)` section is what the child flow actually receives. Read it line by line — each line is a JSON object representing one entry in the conversation history.

```bash
# Extract just the JSONL section
cat /tmp/pi-dump.trace.1234567890.md | sed -n '/## Session Snapshot/,/## Activation Prompt/p'
```

## Verification Checklist

After capturing a dump, verify stripping is working:

```bash
# Should all print 0
for field in parentId toolCallId api provider model cost details responseId responseModel timestamp isError; do
  echo -n "$field: "
  grep -c "\"$field\"" /tmp/pi-dump.*.md 2>/dev/null || echo 0
done

# Should also print 0
echo -n "Directive: "
grep -c '\[Directive:' /tmp/pi-dump.*.md 2>/dev/null || echo 0

echo -n "Hint: "
grep -c '\[Hint:' /tmp/pi-dump.*.md 2>/dev/null || echo 0
```

### What should be present

```bash
# Should print non-zero (content preserved)
echo -n "role: "
grep -c '"role"' /tmp/pi-dump.*.md 2>/dev/null || echo 0

echo -n "content: "
grep -c '"content"' /tmp/pi-dump.*.md 2>/dev/null || echo 0
```

## Live Verification Loop

Use this loop when iterating on snapshot stripping changes:

```bash
# 1. Build
npm run build

# 2. Capture
export PI_FLOW_DUMP_SNAPSHOT=/tmp/pi-verify
pi -p "spawn a trace to read src/core2/snapshot.ts"

# 3. Inspect latest
cat /tmp/pi-verify.trace.*.md

# 4. Verify
echo "parentId: $(grep -c '"parentId"' /tmp/pi-verify.*.md 2>/dev/null || echo 0)"
echo "toolCallId: $(grep -c '"toolCallId"' /tmp/pi-verify.*.md 2>/dev/null || echo 0)"
echo "Directive: $(grep -c '\[Directive:' /tmp/pi-verify.*.md 2>/dev/null || echo 0)"
```

## Copying Dumps for Cross-Session Examination

`/tmp` dumps are transient. Copy the latest to a stable path:

```bash
# Copy latest dump pair to repo tmp/
cp /tmp/pi-verify.trace.*.md ./tmp/latest-dump.md
cp /tmp/pi-verify.trace.*.txt ./tmp/latest-dump.txt
```

This preserves the exact context presented to the flow agent for later review or for sharing with another session.

## Automated Validation

Use the standalone instruments in `./tmp/`:

```bash
# Synthetic validation (requires dist/ built)
npm run build
node ./tmp/validate-context-pipeline.js

# Real dump analysis (run after a live `pi` session)
node ./tmp/analyze-dump.js
```

## Environment Variables

| Variable | Effect |
|----------|--------|
| `PI_FLOW_DUMP_SNAPSHOT` | Base path for dump files. Each flow appends `.<flowName>.<timestamp>` |
| `PI_FLOW_DUMP_MAX_AGE_HOURS` | Auto-cleanup age (default 168 = 7 days) |

## Related

- [`CLAUDE.md`](../CLAUDE.md) — Project index and dev loop
- [`docs/autonomous-pi-testing.md`](autonomous-pi-testing.md) — PTY test harness and scripted sessions
- [`docs/dump-artifacts/README.md`](dump-artifacts/README.md) — Curated dump catalog
- [`scripts/sync-dumps.sh`](../scripts/sync-dumps.sh) — Sync `/tmp` dumps into `dump-artifacts/`

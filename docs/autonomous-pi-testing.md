# Autonomous Pi testing (bash)

How to prepare a shell environment and run **repo checks** plus **scripted Pi sessions**—without babysitting the keyboard. Use this when you need repeatable runs while hacking flows, TUI rendering, or streaming status lines.

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Shell** | Bash or zsh; examples use `bash`. |
| **Node.js** | Match `engines.node` in root `package.json` (currently `>=20.19.0`). |
| **`pi` on `PATH`** | Install via [pi.dev](https://pi.dev); extension loading follows the main [README](../README.md). |
| **`expect`** (optional) | For driving Pi through a **pseudo-terminal** (PTY). macOS: `brew install expect`. Debian/Ubuntu: `sudo apt-get install expect`. |

Sanity check:

```bash
command -v bash pi node npm
node -v
pi --version || true
```

## Wire this repo into Pi (local extension)

From the repository root:

```bash
npm install
npm run build
./scripts/switch.sh          # or: npm run switch:local
npm ls -g pi-agent-flow      # expect "->" pointing at this checkout
```

Quit and restart `pi` after linking so it picks up `dist/index.js`.

> Never run `pi update` while globally linked to this checkout—it replaces the symlink with the published package. Toggle remote first; see [CLAUDE.md § Quick Switch](../CLAUDE.md#quick-switch-local--remote).

## Automated tests for `pi-agent-flow` (no Pi process)

These match CI (`lint` + `test`) and do **not** open the Pi TUI:

```bash
npm run lint                 # tsc --noEmit
npm run build                # tsc → dist/
npm test                     # vitest run
npm test -- tests/scramble.test.ts   # single file example
```

Use this loop while refactoring core logic. Anything that only touches rendering inside **interactive** Pi still benefits from a PTY session (below).

## Integration Testing Guide

There are two levels of integration tests in this repository: **mocked integrations** (running under Vitest without calling actual APIs or invoking the global `pi` CLI) and **real-world end-to-end (E2E) integration tests** (which execute the global `pi` command against your local build).

### 1. Mocked Integration Tests (Vitest)
These test modules such as tool execution, loop/continuation logic, and snapshot compilation by mocking the underlying process runner (`runFlow`) but executing the full orchestration layers.

- **Location**: Files ending in `*.test.ts` in `tests/` contain integration blocks (e.g., `tests/trace.test.ts` has `describe("Trace Tool Execution Integration", ...)`).
- **Structure**:
  - They create a temporary directory (`fs.mkdtempSync`) and setup mock agent definitions (e.g. creating `.pi/agents/trace.md`).
  - They mock `src/flow/runner.ts` using Vitest's `vi.mock()` to prevent child processes from actually spawning, returning structured tool call responses instead.
  - They invoke the tools via the tool interface `.execute(toolCallId, params, ...)` mimicking the actual loader.
- **Running Mocked Integrations**:
  ```bash
  npm test -- tests/trace.test.ts
  ```

### 2. E2E / Live CLI Integration Tests
These tests run the actual global `pi` executable using your compiled local build. They verify real LLM interaction and verbatim snapshot context construction.

#### Setup / Prerequisites
1. **Link to Local Build**: You must be linked to your local checkout:
   ```bash
   npm run build
   ./scripts/switch.sh          # Toggle to LOCAL (or: npm run switch:local)
   npm ls -g pi-agent-flow      # Verify link — should point to this repo
   ```
2. **Clean Background Instances**: If you want to check child flow snapshot boundaries cleanly without previous cached state, run:
   ```bash
   pkill -f pi                  # Terminate any stray background pi instances
   ```

#### Executing E2E Integration Tests
Run `pi -p` with standard input redirected from `/dev/null` to execute non-interactively (headless):

- **Verbatim Trace Integration Test** (verifies that child flows do not inherit active/pending tool calls and successfully return verbatim evidence):
  ```bash
  pi -p "Use only the trace tool exactly one time to read the file SHARED-CONTEXT-CORE2.md and print its content. Tell me: do you see file content verbatim in the tool output?" < /dev/null
  ```
  *Expected Output*: The agent should answer **Yes** and confirm seeing the verbatim content inside the output evidence block, rather than claiming that the trace tool output was `"No result provided"`.


## Why `pi -p "…"` often misses TUI bugs

One-shot invocations and some non-TTY stdin modes **short-circuit or skip** the full interactive render loop. Problems involving:

- live `msg:` / `act:` streaming lines,
- scramble / glitch animations on the activity panel,
- collapsed-flow headers or tail truncation,

…usually need **`pi` running with a real terminal** (PTY), not only `-p` from a bare subprocess.

For **model payloads** and fork prompts without the TUI, prefer snapshot dumps ([CLAUDE.md § Payload dump workflow](../CLAUDE.md#payload-dump-workflow)) plus unit tests.

## Scripted Pi with `expect` (recommended PTY harness)

`expect`'s `spawn` allocates a PTY by default, which mirrors interactive behavior more closely than pipes alone.

1. Copy the template:

   ```bash
   cp scripts/example-autonomous-pi.expect /tmp/pi-smoke.expect
   chmod +x /tmp/pi-smoke.expect
   ```

2. Tune **`AFTER_MS`** so the TUI finishes painting before you type (Pi has no classic `$` prompt while fullscreen).

3. Optionally set **`STARTUP_RE`** if you want to sync on a stable on-screen token (for example a git branch chip).

4. Align **`RESPONSE_RE`** with what your **`send`** mission should produce (default looks for `ok`).

5. Edit the **`send`** payload (short scout missions reduce flake).

6. Run:

   ```bash
   /tmp/pi-smoke.expect
   ```

**Operational tips**

- On macOS/BSD **do not** assume `expect -n -f script.exp` is a no-op syntax check—it can still **run** `spawn` and launch Pi.
- Use generous `timeout` values on cold starts or slow providers.
- Stop stray `pi` processes before collecting logs—multiple parents confuse dumps and UI traces.
- If matching fails, keep `log_user 1` (already on) and widen **`RESPONSE_RE`** or raise **`timeout`** / **`AFTER_MS`**.

## One-liner PTY without `expect`

Some systems ship `script` from **util-linux** or BSD—use it to wrap Pi when you only need “has a TTY”:

```bash
script -qec 'pi' /dev/null
```

macOS provides `/usr/bin/script`; behavior differs slightly from Linux—if this flakes, use `expect` instead.

## Combine with snapshot dumps

Export dump paths **in the same environment** that launches `pi` (see [CLAUDE.md environment table](../CLAUDE.md#environment-variables)):

```bash
export PI_FLOW_DUMP_SNAPSHOT=/tmp/pi-autonomous-dump
script -qec 'pi' /dev/null
# After triggering a flow:
ls -la /tmp/pi-autonomous-dump.*
```

## Troubleshooting

| Symptom | Likely cause | Mitigation |
|---------|----------------|------------|
| `spawn pi` fails | `pi` not on `PATH` | Fix shell init or use full path to the Pi binary. |
| Expect hangs at startup | **`STARTUP_RE`** never matches | Leave **`STARTUP_RE`** empty and rely on **`AFTER_MS`**, or match text you see after boot (branch chip, model label). |
| Smoke run times out after send | **`RESPONSE_RE`** too strict | Broaden the pattern or pick a phrase your mission always prints. |
| API / auth errors | Scripted runs still call providers | Configure Pi the same way as interactive use (keys, settings). |
| Mixed logs | Several Pi instances | `pkill -f pi` or equivalent **before** the run (careful on shared machines). |

## See also

- [CLAUDE.md](../CLAUDE.md) — switch script, dump workflow, env vars, CI publishing rules.
- [README.md](../README.md) — installing Pi and `pi-agent-flow`.

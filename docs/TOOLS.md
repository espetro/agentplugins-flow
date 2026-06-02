# Tools Reference

## `flow` — transition to flow states

Spawns specialized agent flows (`scout`, `build`, `debug`, `audit`, `craft`, `ideas`, `trace`). Bash-style CLI: pass a single `cmd: string` with flags. Chain multiple items with `;` (sequential) or `&&` (conditional).

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `cmd` | `string` | Flow command. Multiple items chained with `;` or `&&`. Each item: `--type --intent --aim --concern [--acceptance] [--cwd] [--complexity] [-- <batch-dispatch>]`. Global: `--confirm <bool>`, `--audit <n>` (first item only). Run `cmd: "help"` for the man page. |
| `cwd` | `string` | Optional working directory override. |

### Per-item flags

| Flag | Short | Description |
|------|-------|-------------|
| `--type` | `-t` | Flow name: `scout`, `build`, `debug`, `audit`, `craft`, `ideas`, `trace` (required) |
| `--intent` | `-i` | Mission description (required) |
| `--aim` | `-a` | Short headline, 5–7 words (required) |
| `--concern` | `-c` | Known risks, uncertainties, or areas requiring extra care (required) |
| `--acceptance` | | One-sentence success criteria |
| `--cwd` | | Working directory override for this flow |
| `--complexity` | | Budget level: `snap`, `simple`, `moderate`, `complex`, `intricate` |

### Global flags (first item only)

| Flag | Type | Description |
|------|------|-------------|
| `--confirm` | `boolean` | Prompt before running project flows (default: true) |
| `--audit` | `number` | Override audit cycles 0–3 (default: 0) |

### Examples

```json
{ "cmd": "flow --type scout --intent 'Map auth code' --aim 'Map auth code' --concern 'JWT complexity'" }
```

```json
{ "cmd": "flow --type build --intent 'Add tests' --aim 'Add tests' --concern 'regression' --acceptance 'All green'" }
```

```json
{ "cmd": "flow --type build --intent 'Implement feature' --aim 'Implement feature' --concern 'breaking change' -- batch read src/foo.ts" }
```

Chain multiple flows:

```json
{ "cmd": "flow --type scout --intent 'Find auth' --aim 'Find auth' --concern 'scope'; flow --type build --intent 'Fix auth' --aim 'Fix auth' --concern 'regression'" }
```

## `trace` — quick verbatim reads, checks, and exploration

A lightweight flow state with `maxDepth: 0` that runs verbatim checks, explorations, or diagnostics. All fields are optional. Defaults to `simple` complexity.

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `cmd` | `string` | Trace command. Optional flags (`--intent`, `--cwd`, `--complexity`) followed by optional pre-flight dispatch after `--`. Run `cmd: "help"` for the man page. |
| `cwd` | `string` | Optional working directory override. |

### Flags

| Flag | Short | Description |
|------|-------|-------------|
| `--intent` | `-i` | Mission override. Default: trace agent's built-in description. |
| `--cwd` | | Working directory override. |
| `--complexity` | `-c` | Budget level: `snap`, `simple`, `moderate`, `complex`, `intricate`. Default: `simple`. |
| `--help` | `-h` | Show help text. |

### Pre-flight dispatch

Everything after the first top-level `--` is a batch-style command string that runs before the trace starts. Results are injected into the trace prompt.

```json
{ "cmd": "trace --intent 'verify auth' -- batch read src/auth.ts" }
```

```json
{ "cmd": "trace -- batch read src/auth.ts; batch rg -q 'password' src/" }
```

### Snapshot behavior

`trace` receives the **main agent's full session context** — no tier-based message cap, no profile-based compression. The `tier: lite` in `agents/trace.md` only affects which model is selected (cheaper/faster), not the snapshot content. The shared context display accurately reflects the main agent's actual message counts and conversation history.

## `batch` / `batch_read` — unified file operations

When **tool optimization** is enabled (default), the separate `read` / `write` / `edit` tools are replaced by:

- **`batch`** — multi-op executor: `read`, `write`, `edit`, `delete`, `patch`, `bash`, `rg`, `web`, `poll`. File/shell ops execute first; web runs after. Supports chaining with `;` and `&&`.
- **`batch_read`** — read-only variant: `read` and `rg` only. No write, edit, delete, bash, or web.

Both use a single `cmd: string` field with subcommands and flags.

### `batch` subcommands

| Subcommand | Flags | Description |
|------------|-------|-------------|
| `read` | `-s`, `-l`, `-e` | Read file contents. Paths may include `:N` or `:N-M` line ranges. |
| `write` | `-c` | Write content to file. |
| `edit` | `-f`, `-r`, `-a`, `-A` | Targeted file edit using `--find`/`--replace` pairs. Repeat for multi-edit. |
| `delete` | | Delete file(s). |
| `patch` | `-c` | Apply a patch. |
| `bash` | `-i`, `-t`, `-h` | Execute a shell command. `-i` = ID, `-t` = timeout, `-h` = cwd. |
| `rg` | `-q`, `-i`, `-l`, `-t`, `-n`, `-u` | Search with ripgrep. `-q` = pattern (required), `-i` = ignore-case, `-l` = files-only, `-t` = type filter, `-n` = max-count, `-u` = ignore-level. |
| `web search` | `-q` | Search the web. |
| `web fetch` | `-u`, `-f` | Fetch a URL. `-u` = URL, `-f` = format (markdown, text, html). |
| `poll` | `-i` | Poll pending bash commands by ID. |

### `batch_read` subcommands

| Subcommand | Flags | Description |
|------------|-------|-------------|
| `read` | `-s`, `-l`, `-e` | Read file contents. |
| `rg` | `-q`, `-i`, `-l`, `-t`, `-n`, `-u` | Search with ripgrep. |

### Examples

```json
{ "cmd": "batch read src/index.ts:10-50" }
```

```json
{ "cmd": "batch write -c 'console.log(1)' src/hello.ts" }
```

```json
{ "cmd": "batch edit -f 'old' -r 'new' src/index.ts" }
```

```json
{ "cmd": "batch bash 'npm test'" }
```

```json
{ "cmd": "batch read src/index.ts; batch rg -q 'TODO' src/" }
```

```json
{ "cmd": "batch read src/index.ts && batch bash 'npm test'" }
```

```json
{ "cmd": "batch_read read src/index.ts:10-50" }
```

```json
{ "cmd": "batch_read rg -q 'TODO' src/" }
```

> **Caution:** `batch_read` only supports read-only operations (`read` and `rg`). It does **not** support `edit`, `write`, `delete`, `bash`, or `patch` — use the full `batch` tool for those.

## `batch_bash_poll` — poll pending bash commands

For child flows using the `batch` tool, `batch_bash_poll` lets the agent check on pending bash operations that exceeded the soft timeout. Pass the operation IDs from the pending results to retrieve completed output or see updated partial output.

## `web` — search and fetch

Built-in web operations (no API keys required):

- **Search** — queries Brave and DuckDuckGo HTML endpoints, returns top results with titles, URLs, and snippets.
- **Fetch** — downloads a page, converts HTML to Markdown via JSDOM + Turndown, saves to a temp file in the session directory, and returns a preview. Falls back through direct fetch → `r.jina.ai` → `curl`.

In the collapsed activity panel, web operations display as compact one-line summaries (e.g., `search: "query"` or `fetch: example.com`). Like other tools, web results are scramble-animated in the collapsed view.

## `ask_user` — interactive prompts

Ask the user a focused question with optional multiple-choice answers. Use this to gather information interactively. Ask exactly one focused question per call. When presenting options, mark your recommended choice with `[preferred]` and place it first.

### Tool parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `question` | `string` | The question to ask the user |
| `options` | `array` | Optional list of choices. Each option is an object with `title` (short label) and `description` (longer explanation). |

Example:

```json
{
  "question": "Which database should we use?",
  "options": [
    { "title": "PostgreSQL", "description": "Robust relational database with great TypeScript support" },
    { "title": "SQLite", "description": "Simple file-based database, good for small projects" }
  ]
}
```

> **Note:** The `ask_user` tool only accepts `question` and `options`. Timeout and UI behavior are controlled via flow settings (`/flow:settings ask-user timeout <seconds>` or `PI_ASK_USER_TIMEOUT`). If user input is needed inside a flow, the flow emits a `⚠️ Decision Required` block for the root state to present. Only the root state talks to the user; bundled flows do not have `ask_user`.

## Migration from the old JSON mega-schema (v2.2.x → v2.3.0)

The four primary tools migrated from a nested JSON mega-schema to a single `cmd: string` field.

| Tool | Old shape (v2.2.x) | New shape (v2.3.0) |
|------|-------------------|-------------------|
| `batch` | `{ tool: "batch", ops: [{ o: "read", p: "src/index.ts", s: 10, l: 40 }] }` | `{ cmd: "read src/index.ts:10-50" }` |
| `batch` write | `{ tool: "batch", ops: [{ o: "write", p: "file.txt", c: "content" }] }` | `{ cmd: "write -c 'content' file.txt" }` |
| `batch` edit | `{ tool: "batch", ops: [{ o: "edit", p: "file.ts", e: [{ f: "old", r: "new" }] }] }` | `{ cmd: "edit -f 'old' -r 'new' file.ts" }` |
| `batch` bash | `{ tool: "batch", ops: [{ o: "bash", c: "npm test", i: "id1" }] }` | `{ cmd: "bash 'npm test'" }` |
| `flow` | `{ flow: [{ type: "scout", intent: "...", aim: "...", concern: "...", dispatch: [{ tool: "batch", ops: [...] }] }] }` | `{ cmd: "flow --type scout --intent '...' --aim '...' --concern '...' -- batch read ..." }` |
| `trace` | `{ intent: "...", dispatch: [{ tool: "batch", ops: [...] }] }` | `{ cmd: "trace --intent '...' -- batch read ..." }` |

- **No more `tool` wrapper**: `batch`, `bash`, and `web` ops are now expressed as subcommands inside a single `cmd` string.
- **No more `ops` array**: Operations are separated by `;` (sequential) or `&&` (conditional) within the `cmd` string.
- **No more `o`, `p`, `c`, `e` fields**: Replaced by subcommand names (`read`, `write`, `edit`, `bash`, `rg`, `web`) and `--flag` arguments.
- **No more `dispatch` array**: Pre-flight ops for `flow` and `trace` are appended after `--` as a plain batch-style command string.

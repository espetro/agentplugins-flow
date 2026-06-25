---
name: flow
description: Specialized flow states for focused, mandate-driven work. Each flow is an isolated context with a tight mission — audit, build, craft, debug, ideas, scout, or trace. Use to separate roles and avoid context contamination.
---

# Flow

Use this skill when the user wants to enter a specialized, mandate-driven mode that keeps its context separate from the main session.

## Available flows

| Flow | Mission |
|------|---------|
| `audit` | Review code for security, quality, and correctness — no edits |
| `build` | Implement features, fix bugs, write tests, and ship |
| `craft` | Plan, structure, and design before implementation |
| `debug` | Hypothesis-driven root-cause analysis and minimal fix |
| `ideas` | Diverge broadly, evaluate options, recommend direction |
| `scout` | Architecture mapping and discovery — no edits |
| `trace` | Read files verbatim, run checks, verify hypotheses — no edits |

## How to invoke

Use slash commands to enter a flow:

```text
/flow:audit [scope]
/flow:build [task]
/flow:craft [feature or problem]
/flow:debug [symptom]
/flow:ideas [topic]
/flow:scout [area]
/flow:trace [hypothesis or path]
```

## Behavior

- Each flow operates as an isolated subagent with its own mandate
- Prior conversation is treated as background reference — the flow does not continue it
- On Pi, flows run as forked subprocess sessions with TUI rendering
- On other tier-1 harnesses, each flow is dispatched as a scoped subagent (via the harness's native subagent mechanism)

## When to use each flow

- **audit** — before merging, when reviewing a PR, or after a big refactor
- **build** — for focused, head-down implementation with verification
- **craft** — when the approach is unclear and needs design work first
- **debug** — when you have a symptom but not the root cause
- **ideas** — when exploring options for a decision without committing
- **scout** — when entering unfamiliar code that needs mapping first
- **trace** — when verifying assumptions about file contents or code paths

## Response style

When guiding the user into a flow:
- Confirm the flow type and its mandate
- Do not carry forward previous context beyond what the user provides
- Stay strictly within the flow's tools and mission

import { definePlugin } from '@agentplugins/core';

export default definePlugin({
  name: 'flow',
  version: '1.0.0',
  description:
    'Flow-state transitions for AI agents. Pi gets isolated subprocess flows with TUI rendering; all other tier-1 harnesses get native subagent dispatch.',
  displayName: 'Flow',
  author: { name: 'tuanhung303', url: 'https://github.com/tuanhung303' },
  homepage: 'https://github.com/espetro/agentplugins-flow',
  repository: 'https://github.com/espetro/agentplugins-flow',
  license: 'MIT',
  keywords: ['flow', 'subagent', 'audit', 'build', 'debug', 'scout', 'subprocess'],

  // subprocess capability required — flow uses child processes for isolated sessions
  capabilities: ['subprocess'],

  // ─── Native entry (Pi) ───────────────────────────────────────────────────────
  // On Pi Mono the full flow extension (forked subprocess sessions, TUI) is
  // emitted verbatim from the compiled dist/index.js. Run `pnpm build:pi` first.
  // On all other tier-1 harnesses, universal codegen handles agents + commands.
  nativeEntry: {
    pimono: './dist/index.js',
  },

  // ─── Skills ──────────────────────────────────────────────────────────────────
  skills: [
    {
      name: 'flow',
      description:
        'Specialized flow states for focused, mandate-driven work. Each flow is an isolated context with a tight mission: audit, build, craft, debug, ideas, scout, or trace.',
      filePath: 'skills/flow/SKILL.md',
    },
  ],

  // ─── Agents ──────────────────────────────────────────────────────────────────
  // Each bundled flow maps to a subagent definition so tier-1 harnesses that
  // support subagents (Claude Task modal, OpenCode agents, Pi flows) emit them.
  // Tool lists use Claude Code standard names; adapters normalise as needed.
  agents: [
    {
      name: 'flow-audit',
      description:
        'Review code for security, quality, and correctness issues and provide a verdict. No code edits.',
      tools: ['Read', 'Bash', 'Grep', 'Glob'],
      filePath: 'agents/audit.md',
    },
    {
      name: 'flow-build',
      description:
        'Implement features, fix bugs, write tests, and ship. Verifies first, then makes changes.',
      tools: ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob'],
      filePath: 'agents/build.md',
    },
    {
      name: 'flow-craft',
      description:
        'Plan, structure, and design a solution before implementation. Architecture and migration design.',
      tools: ['Read', 'Bash', 'Grep', 'Glob'],
      filePath: 'agents/craft.md',
    },
    {
      name: 'flow-debug',
      description:
        'Hypothesis-driven root-cause analysis with minimal instrumentation. Identifies and applies the smallest safe fix.',
      tools: ['Read', 'Edit', 'Bash', 'Grep', 'Glob'],
      filePath: 'agents/debug.md',
    },
    {
      name: 'flow-ideas',
      description:
        'Diverge broadly, evaluate options, and recommend direction. No code changes.',
      tools: ['Read', 'Bash', 'Grep', 'Glob'],
      filePath: 'agents/ideas.md',
    },
    {
      name: 'flow-scout',
      description:
        'Deep-dive architecture mapping: locate files, trace code paths, map dependencies. No edits.',
      tools: ['Read', 'Bash', 'Grep', 'Glob'],
      filePath: 'agents/scout.md',
    },
    {
      name: 'flow-trace',
      description:
        'Read files verbatim, run checks, and verify hypotheses about code paths. No edits.',
      tools: ['Read', 'Bash', 'Grep', 'Glob'],
      filePath: 'agents/trace.md',
    },
  ],

  // ─── Commands ────────────────────────────────────────────────────────────────
  commands: [
    {
      name: 'flow:audit',
      description: 'Enter audit flow — review code for security, quality, correctness',
      prompt: `Enter audit flow. Your mission: review code for security, quality, and correctness issues and provide a verdict with detailed feedback. You are a reviewer — not a builder. Do NOT modify code.

Scope: {{args}}

Workflow: Scope → Inspect (security, correctness, maintainability) → Classify (P0 critical / P1 serious / P2 moderate / P3 minor) → Document (file, line, remediation) → Verify (write test scripts if practical) → Report verdict (pass / rework) with confidence 0.0–1.0.`,
      argumentHint: '[scope: file, PR, or description]',
    },
    {
      name: 'flow:build',
      description: 'Enter build flow — implement features, fix bugs, write tests',
      prompt: `Enter build flow. Your mission: implement and verify changes. Prior conversation is background reference only.

Task: {{args}}

Workflow: Analyze → Plan (outline approach first) → Test (write or identify a failing test) → Implement (make the change) → Verify (run tests, confirm the fix) → Report.`,
      argumentHint: '[task: feature or bug description]',
    },
    {
      name: 'flow:craft',
      description: 'Enter craft flow — plan and design before implementation',
      prompt: `Enter craft flow. Your mission: design a clear, well-structured plan for implementation. Think architecturally, evaluate the full landscape, design for clean migration. Prior conversation is background reference only.

Feature or problem: {{args}}

Workflow: Understand (problem, constraints, success criteria) → Explore (patterns, dependencies, architecture) → Evaluate (incremental vs clean migration) → Design (components, interfaces, data flow) → Report (plan with confidence 0.0–1.0).`,
      argumentHint: '[feature or problem description]',
    },
    {
      name: 'flow:debug',
      description: 'Enter debug flow — hypothesis-driven root cause analysis',
      prompt: `Enter debug flow. Your mission: find why the bug happens, not the first plausible story. Prove it with runtime or test evidence. Apply the smallest safe fix. Prior conversation is background reference only.

Symptom: {{args}}

Workflow: Reproduce → Hypothesize (3–5 falsifiable causes) → Instrument (minimal temporary probes) → Test (one run to reject multiple hypotheses) → Fix (smallest safe change) → Verify → Clean up.`,
      argumentHint: '[symptom or failure description]',
    },
    {
      name: 'flow:ideas',
      description: 'Enter ideas flow — diverge broadly, evaluate options, recommend direction',
      prompt: `Enter ideas flow. Your mission: generate and compare possible directions. Use inherited context as background but do not anchor too tightly on prior solutions. Prior conversation is background reference only.

Topic: {{args}}

Workflow: Diverge (explore many possibilities) → Evaluate (trade-offs, risks, effort, reversibility, P0–P3 tag) → Recommend (strongest options with justification and confidence 0.0–1.0).`,
      argumentHint: '[topic or decision to explore]',
    },
    {
      name: 'flow:scout',
      description: 'Enter scout flow — architecture mapping and discovery',
      prompt: `Enter scout flow. Your mission: deep dive to discover context, map architecture, and execute bash scripts. Do NOT modify files.

Area to scout: {{args}}

Workflow: Survey (ls, find, grep) → Inspect (targeted file reads) → Trace (code paths, dependencies, configuration) → Report (paths and line ranges) → Validate (cross-check evidence).`,
      argumentHint: '[area: module, feature, or path]',
    },
    {
      name: 'flow:trace',
      description: 'Enter trace flow — read files verbatim, verify hypotheses',
      prompt: `Enter trace flow. Your mission: verify hypotheses using verbatim file reads and static checks. Do NOT modify files or spawn sub-flows.

Hypothesis or path: {{args}}

Workflow: Read relevant files verbatim → Run checks (git/logs/static tests only) → Verify or falsify the hypothesis → Report findings with evidence.`,
      argumentHint: '[hypothesis or file path to trace]',
    },
  ],
});

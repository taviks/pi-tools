---
description: Transform feature descriptions into concrete implementation plans with scope, failure modes, and validation
argument-hint: "[feature description, bug report, brainstorm file, or improvement idea]"
---

# Create an Implementation Plan

## Input

<input> #$ARGUMENTS </input>

If the input is empty, ask the user what they want to plan and wait.

## Rules

- Plan the work; do **not** implement it.
- If the input looks like a file path, read it completely before doing anything else.
- If the input is plain text, look for a recent matching brainstorm in `docs/brainstorms/` and use it when clearly relevant.
- Ask clarifying questions only when they materially change the plan.
- Use the current year, **2026**, when dating plan files.
- Prefer the smallest complete version: no needless platform-building, but do not leave easy edge cases/tests undone.

## Workflow

### 1. Understand the request

Classify the input as:

- feature / product change,
- bug / correctness fix,
- refactor / architecture improvement,
- test / tooling / release work,
- existing plan/spec that needs restructuring.

Capture in one sentence: who is affected, what changes, and how we know it is done.

### 2. Ground in local context before planning

Use targeted local repo research first: `find`, `rg`, `git diff`, focused `read`.

Hard requirement: read at least one relevant file, symbol, doc, or config before drafting technical steps. Do not ask the user what file to inspect unless you genuinely cannot infer it.

Focus on:

- existing code that already solves part of the problem,
- current patterns and conventions,
- likely integration points and tests,
- data/API/deployment boundaries,
- instructions in repo docs.

If the context is non-trivial, use a `scout` subagent for targeted recon.

### 3. Scope challenge

Before drafting, answer:

- What is the minimum set of changes that delivers the value?
- What is explicitly **not** in scope?
- What existing code/flows should be reused instead of rebuilt?
- Does the plan introduce >8 files or >2 new services/classes? If yes, challenge the complexity and propose a smaller path.
- What is the blast radius and rollback/backout path?

### 4. Draft the plan

Create a concrete, execution-ready plan. Include failure modes and tests, not just happy-path implementation.

For non-trivial data flow, state machines, or pipelines, include an ASCII diagram. For complex implementation, identify where inline code comments/diagrams should be maintained.

If a second planning pass would improve quality, optionally use a `planner` or `reviewer` subagent, then synthesize.

### 5. Write the plan file

Write the result to:

`docs/plans/YYYY-MM-DD-<slug>-plan.md`

Use a descriptive slug.

## Plan document structure

```markdown
# <Title>

## Goal
One clear sentence describing the outcome.

## Background / Existing Patterns
Concrete repo context, paths read, examples, and constraints.

## What Already Exists
Existing code/flows that solve part of the problem and how the plan reuses them.

## Scope
### In scope
### Not in scope

## Implementation Plan
Numbered, actionable steps.

## Files Likely to Change
Concrete file paths when known, otherwise likely areas.

## Failure Modes / Edge Cases
For each new path, list realistic failures and how they are handled or tested.

## Tests / Validation
Unit, integration, regression, manual/browser, and release checks as applicable.

## Parallelization
State whether work should be sequential or split into independent lanes.

## Rollout / Backout
Only when relevant for risky, data, deploy, or user-facing changes.

## Risks / Open Questions
Anything that could block or materially change implementation.
```

## Handoff

After writing the plan, summarize:

- plan file path,
- top 3-6 implementation steps,
- major risks/open questions,
- recommended next command (`/workflows-work`, `/review`, or a specific test).

---
description: Transform feature descriptions into well-structured implementation plans
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

## Workflow

### 1. Understand the request

- Decide whether the input is:
  - a plain-language request
  - a brainstorm document
  - an existing plan/spec that needs restructuring
- If there is a relevant brainstorm, treat it as the primary source of truth.

### 2. Gather local context

Use local repo research first:
- `find`
- `grep`
- `read`

If the codebase context is non-trivial, use `subagent` with `agent: "scout"` for targeted recon.

Focus on:
- existing patterns
- likely files/components involved
- constraints from current architecture
- nearby tests or examples to follow

### 3. Draft the plan

Create a concrete, execution-ready plan.

If a second planning pass would improve quality, optionally use `subagent` with `agent: "planner"`, passing along the gathered repo context.

### 4. Write the plan file

Write the result to:

`docs/plans/YYYY-MM-DD-<slug>-plan.md`

Use a descriptive slug.

## Plan document structure

# <Title>

## Goal
One clear sentence describing the outcome.

## Background / Existing Patterns
Relevant context, examples, and constraints from the repo.

## Scope
What is in scope and out of scope.

## Implementation Plan
Numbered, actionable steps.

## Files Likely to Change
Concrete file paths when known, otherwise likely areas.

## Risks / Open Questions
Anything that could block or complicate implementation.

## Validation
How the finished work should be verified.

## Rollout / Backout
Only when relevant for risky or user-facing changes.

## Quality bar

The plan should be:
- concrete
- easy to execute
- grounded in actual repo patterns
- explicit about validation
- free of references to agents/skills/tools that are not installed

## Handoff

After writing the plan, summarize:
- plan file path
- top 3-6 implementation steps
- major risks/open questions

Then ask whether to proceed to `/workflows-work`.

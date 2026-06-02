---
description: Enhance an existing plan with more detail, validation, and implementation guidance
argument-hint: "[path to plan file]"
---

# Deepen Plan

## Plan File

<plan_path> #$ARGUMENTS </plan_path>

If the plan path is empty, ask the user which plan file to deepen and wait.

## Rules

- Read the plan completely before changing it.
- Expand the plan; do **not** implement code.
- Use current Pi tools only.
- Do **not** rely on Claude-specific paths, missing custom agents, or missing skills.
- If extra repo context helps, use `find`, `grep`, `read`, or `subagent` with `agent: "scout"`, `"planner"`, or `"reviewer"`.

## Workflow

### 1. Parse the plan into major workstreams

Identify the main sections, dependencies, and risky areas.

### 2. Deepen each workstream

For each important section, add:
- assumptions
- dependencies
- edge cases
- failure modes
- validation steps
- rollout / backout steps when relevant

### 3. Ground the plan in the codebase

When the repo already has relevant patterns, cite concrete file paths and examples.

### 4. Write the enhanced result

- By default, write the enhanced version back to the same file.
- If the user asks for a separate artifact, write a new `*-detailed-plan.md` file instead.

## Upgrade checklist

The improved plan should have:
- sharper scope boundaries
- more specific files/functions
- explicit dependency ordering
- stronger test strategy
- migration/data safety notes when relevant
- rollout/rollback guidance for risky changes

## Final output

Summarize:
- what became clearer
- what new risks or dependencies were identified
- what still needs user decisions

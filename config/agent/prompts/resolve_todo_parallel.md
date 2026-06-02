---
description: Resolve TODO items using a dependency-aware parallel workflow
argument-hint: "[optional: specific todo ID, file, or pattern]"
---

# Resolve TODOs in Parallel

## Focus

<focus> #$ARGUMENTS </focus>

## Rules

- First gather all unresolved TODO items from the relevant files/directories.
- If a TODO suggests deleting or gitignoring files in `docs/plans/` or `docs/solutions/`, treat that as `wont_fix`.
- Do **not** assume custom agents like `pr-comment-resolver` or missing skills like `file-todos` exist.
- Use existing tools directly, and use `subagent` with `agent: "worker"` and `agent: "reviewer"` only when that genuinely helps.

## Workflow

### 1. Analyze

- find unresolved TODO items
- group them by dependency and file overlap
- identify what is safe to do in parallel

### 2. Plan

- list sequential prerequisites first
- then identify independent items that can run in parallel
- include a short checklist or mermaid diagram if it helps explain the execution order

### 3. Implement

- use `subagent` `tasks` mode for independent items when safe
- keep shared-file or dependency-heavy TODOs sequential
- update TODO markers as items are resolved

### 4. Validate

Run the relevant tests/checks for the affected areas.

### 5. Close out

Summarize:
- resolved items
- skipped / `wont_fix` items
- remaining follow-ups

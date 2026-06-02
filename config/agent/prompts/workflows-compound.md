---
description: Document a recently solved problem so the solution is easy to reuse later
argument-hint: "[optional: brief context about the fix]"
---

# Compound Knowledge

Document a solved problem in a single markdown file under `docs/solutions/`.

## Context Hint

<context_hint> #$ARGUMENTS </context_hint>

## Rules

- Create exactly **one** final documentation file.
- Do not create scratch docs or helper files.
- Use the current session, relevant files, and git history to reconstruct the problem and fix.
- If extra context helps, use normal tools or `subagent` with `agent: "scout"` or `agent: "reviewer"`.
- Do not depend on missing custom agents or setup skills.

## Workflow

### 1. Reconstruct the solution

Identify:
- the problem
- observable symptoms
- root cause
- the working fix
- how it was validated
- how to prevent it next time

### 2. Choose a category

Use one of:
- `build-errors`
- `test-failures`
- `runtime-errors`
- `performance-issues`
- `database-issues`
- `security-issues`
- `ui-bugs`
- `integration-issues`
- `logic-errors`

### 3. Write the document

Write a single file to:

`docs/solutions/<category>/YYYY-MM-DD-<slug>.md`

## Suggested document structure

---
title: <short title>
date: 2026-<mm>-<dd>
category: <category>
tags: [<tags>]
related: [<related files, issues, or docs>]
---

# Problem
## Symptoms
## Root Cause
## Fix
## Validation
## Prevention
## Related Files / Issues

## Final output

After writing the file, report:
- the file path
- a 3-5 bullet summary of the lesson

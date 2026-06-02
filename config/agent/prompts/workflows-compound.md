---
description: Document a recently solved problem so the solution compounds into reusable project knowledge
argument-hint: "[optional: brief context about the fix]"
---

# Compound Knowledge

Document a solved problem in one durable markdown note under `docs/solutions/`.

For general non-solution lessons, use `/learn` instead.

## Context Hint

<context_hint> #$ARGUMENTS </context_hint>

## Rules

- Create exactly **one** final documentation file.
- Do not create scratch docs or helper files.
- Use the current session, relevant files, and git history to reconstruct the problem and fix.
- Capture root cause, not just the surface patch.
- Include exact validation evidence where available.
- If the same class of problem has happened twice, recommend a future prompt/skill/check to prevent it.

## Workflow

### 1. Reconstruct the solution

Identify:

- the original problem,
- observable symptoms,
- root cause,
- the working fix,
- validation commands/results,
- prevention lesson.

Use targeted repo inspection when needed: `git diff`, changed files, nearby tests, relevant logs.

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

Use 2026 for dates.

## Document structure

```markdown
---
title: <short title>
date: 2026-<mm>-<dd>
type: solution
category: <category>
tags: [<tags>]
related: [<related files, commands, issues, or docs>]
---

# <Title>

## Problem
## Symptoms
## Root Cause
## Fix
## Validation
## Prevention
## Related Files / Issues
```

## Final output

After writing the file, report:

- file path,
- 3-5 bullet summary of the lesson,
- whether a future skill/prompt/check should be created.

---
description: Capture a durable project learning, preference, pitfall, or solved-problem note
argument-hint: "[optional: lesson, fix context, or solved problem]"
---

# Capture Project Learning

## Input

<input> #$ARGUMENTS </input>

Use this when a lesson should survive the session: a solved bug, recurring pitfall, architectural decision, user preference, tool recipe, or repeatable workflow.

## Rules

- Create exactly **one** final markdown file.
- Do not modify application code.
- Infer from the current session, git state, and relevant files; ask only if the lesson cannot be reconstructed.
- Prefer specific lessons tied to files/commands/evidence over generic advice.
- If this is a solved problem, include symptoms, root cause, fix, and validation.
- If the same kind of work has happened twice, recommend codifying it as a skill/prompt/check.

## Workflow

### 1. Classify the learning

Choose one:

- `solution` — a solved bug/problem with root cause and validation.
- `pitfall` — a trap to avoid next time.
- `pattern` — a reusable implementation/review/testing pattern.
- `preference` — a personal/team way of working.
- `architecture` — a decision or seam worth preserving.
- `tool` — a useful command, script, or workflow recipe.

### 2. Gather evidence

Use focused repo/context inspection:

- current conversation summary,
- `git diff --stat` and relevant changed files,
- failing/passing commands and logs,
- related docs/plans/TODOs.

### 3. Write the note

For `solution`, write to:

`docs/solutions/<category>/YYYY-MM-DD-<slug>.md`

where category is one of:

- `build-errors`, `test-failures`, `runtime-errors`, `performance-issues`,
- `database-issues`, `security-issues`, `ui-bugs`, `integration-issues`, `logic-errors`.

For all other learning types, write to:

`docs/learnings/YYYY-MM-DD-<type>-<slug>.md`

Use 2026 for dates.

## Solution template

```markdown
---
title: <short title>
date: 2026-<mm>-<dd>
type: solution
category: <category>
tags: [<tags>]
related: [<files, issues, commands, docs>]
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

## Learning template

```markdown
---
title: <short title>
date: 2026-<mm>-<dd>
type: <pitfall|pattern|preference|architecture|tool>
tags: [<tags>]
related: [<files, commands, docs>]
---

# <Title>

## Lesson
One concise statement of the learning.

## Context
What happened and where this applies.

## Evidence
Files, commands, examples, or observations that support it.

## How To Apply Next Time
Concrete steps or checklist.

## When Not To Apply
Boundaries and exceptions.
```

## Final output

Report:

- file path,
- learning type/category,
- 3-5 bullet summary,
- whether this should become a prompt/skill/check next time.

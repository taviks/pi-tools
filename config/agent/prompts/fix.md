---
description: Diagnose and fix a bug or error with root-cause discipline
argument-hint: "[error, failing command, bug report, or reproduction steps]"
---

# Investigate and Fix

## Issue

<issue> #$ARGUMENTS </issue>

If the issue is empty and the current conversation does not contain enough context, ask for the failing command, error output, or reproduction steps.

## Non-negotiables

- **No fix before root cause.** Do not patch symptoms or guess.
- Start with evidence: error output, reproduction path, relevant code, recent changes.
- Keep the diff minimal; do not refactor adjacent code unless the root cause requires it.
- Add or update a regression test when practical.
- If three hypotheses fail, stop and explain the evidence gap instead of thrashing.
- If the fix would touch more than five files, pause and ask before expanding blast radius.

## Workflow

### 1. Collect evidence

- Read the error/stack trace/repro steps.
- Locate the relevant code with targeted `rg`, `find`, `git diff`, or focused reads.
- Check recent changes for affected files with `git log --oneline -20 -- <files>` when useful.
- Reproduce the failure if possible.

### 2. State the root-cause hypothesis

Before editing, write one sentence:

> Root-cause hypothesis: `<specific, testable claim about what is wrong and why>`

Then verify it with code reading, logs, targeted assertions, or a focused failing test.

### 3. Implement the smallest root-cause fix

- Fix the actual cause, not the symptom.
- Prefer explicit, boring code over cleverness.
- Preserve existing behavior outside the failing path.
- If multiple approaches are plausible, explain the tradeoff and ask.

### 4. Test and verify

- Add/update a regression test when feasible.
- Run the narrowest relevant test first, then broader checks when appropriate.
- Re-run the original repro or failing command.
- Use quiet logging for noisy checks and report concise evidence.

## Final response

Use this structure:

```text
DEBUG REPORT
Symptom: <what failed>
Root cause: <confirmed cause>
Fix: <files changed and what changed>
Evidence: <tests/repro commands run>
Regression test: <test path or "not added" with reason>
Status: DONE | DONE_WITH_CONCERNS | BLOCKED
```

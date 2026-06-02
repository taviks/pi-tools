---
description: Execute work plans efficiently while keeping the source plan updated
argument-hint: "[plan file, specification, or todo file path]"
---

# Work Plan Execution

## Input Document

<input_document> #$ARGUMENTS </input_document>

If the input document is empty, ask the user which plan or spec to execute and wait.

## Rules

- Read the input document completely before making changes.
- Keep the source plan updated as work progresses.
- Ask normal conversational questions when clarification is needed.
- Do **not** assume custom helpers like `file-todos`, `git-worktree`, or other missing skills exist.
- For large or risky tasks, prefer delegation to `subagent` with `agent: "worker"`.
- For final validation on important changes, consider `subagent` with `agent: "reviewer"`.

## Recommended workflow

### 1. Clarify scope

- If the plan is ambiguous, ask now.
- Confirm any assumptions that would change implementation.

### 2. Check branch safety

- If you are on the default branch, recommend creating a feature branch before making edits.
- If the user wants a worktree, explain the normal git worktree commands explicitly rather than assuming a custom skill exists.

### 3. Convert the plan into an ordered checklist

- Keep a concise checklist in your response.
- If the plan file already has checkboxes, update them as tasks are completed.
- If the plan file does not have checkboxes, still keep the plan document in sync by updating progress notes where appropriate.

### 4. Implement step by step

- Use direct tools (`read`, `find`, `grep`, `bash`, `edit`, `write`) for small/local work.
- Use `subagent` with `agent: "worker"` when isolated implementation would reduce context load or keep the main thread cleaner.
- Prefer small, coherent changes over giant unreviewable edits.

### 5. Validate continuously

After meaningful changes, run the relevant checks:
- tests
- lint
- build/typecheck
- targeted smoke tests

Update the source plan as you go.

### 6. Review before wrapping up

For larger, riskier, or user-facing changes, run `subagent` with `agent: "reviewer"` before finalizing.

### 7. Close out

Summarize:
- what was completed
- files changed
- validation performed
- remaining risks or follow-ups
- recommended next step

## Minimum final output

## Completed
What was done.

## Files Changed
List exact file paths.

## Validation
What you ran or verified.

## Risks / Follow-ups
Anything still worth checking.

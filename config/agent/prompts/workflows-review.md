---
description: Perform an actionable review of a PR, branch, or current diff
argument-hint: "[PR number, GitHub URL, branch name, file path, or current]"
---

# Review Command

## Review Target

<review_target> #$ARGUMENTS </review_target>

If the review target is empty, default to the current branch diff.

## Rules

- Focus on correctness, security, migration/data safety, UX breakage, performance, and maintainability.
- Skip style-only nits.
- Use read-only bash for git/gh inspection.
- Ask normal chat questions if you need missing context from the user.
- Prefer concrete findings with file paths and line numbers.

## Workflow

### 1. Determine the target

Support these inputs:
- PR number
- GitHub PR URL
- branch name
- markdown/doc path
- `current` or empty

Suggested approach:
- PR number / PR URL: use `gh pr view` if available for metadata and changed files
- branch name: inspect `git diff main...<branch>` or `git diff master...<branch>`
- current / empty: inspect `git diff HEAD`, then `git diff --cached`, then `git diff main...HEAD` if needed
- file path: read the document directly and review it as a document/spec

### 2. Gather context

- Read the touched files, not just the diff hunks.
- Follow important call paths and nearby tests.
- If useful, use `subagent` with `agent: "reviewer"` and/or `agent: "scout"` for an additional pass.

### 3. Run special checks when relevant

Pay extra attention to:
- schema and migration drift
- data backfills and ID mappings
- rollout / rollback safety
- authorization and permission boundaries
- error handling and retries
- tests that exercise the real integration path, not only mocks

### 4. Output format

## Files Reviewed
List exact files and important line ranges when possible.

## Critical
Only issues that must be fixed before merge.

## Warnings
Important issues that should likely be fixed.

## Suggestions
Optional improvements worth considering.

## Summary
2-4 sentences with the overall assessment.

## Optional next step

If the change is UI-heavy or browser-sensitive, you may recommend `/test-browser`.

---
description: Commit only this task's changes
argument-hint: "[message or scope hint]"
---
Commit the completed work for the current task.

If arguments were provided, treat them as commit-message or scope guidance, not as permission to include unrelated changes:

`$ARGUMENTS`

Workflow:

1. Inspect the working tree and recent commit style before staging or committing:
   - `git status --short`
   - relevant `git diff` / `git diff --cached`
   - recent commits, e.g. `git log --oneline -n 10`
2. Determine which changes belong to the task from the conversation and the diffs.
3. Stage only task-owned changes.
   - Do not use `git add .` or `git add -A`.
   - Use explicit paths or patch staging.
   - If a file contains mixed task-owned and unrelated hunks, stage only the relevant hunks.
   - If unrelated changes are already staged, do not commit them. Preserve the user's staging state when possible; ask if preserving it safely is ambiguous.
4. Do not perform extra implementation, refactors, formatting sweeps, or broad validation just because you are committing.
   - Run only lightweight checks if they are clearly appropriate or required by repo convention/hooks.
5. Write a commit message that matches this repository's existing style.
   - Prefer the style shown by recent commits over generic conventions.
   - Keep it concise and specific.
6. Commit the staged task-owned changes.
7. Respond concisely with the commit hash, subject, and any checks run. Do not list unrelated uncommitted files unless needed to explain a blocker.

If it is unclear which changes belong to this task, stop and ask instead of guessing.

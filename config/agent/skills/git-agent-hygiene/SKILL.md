---
name: git-agent-hygiene
description: "Safe, explicit Git worktree hygiene for coding agents. Use when inspecting repo status, distinguishing tracked/staged/untracked/ignored files, preparing commits, handling dirty worktrees, or avoiding destructive Git operations."
license: MIT
compatibility: Usable in any Git repository with shell access.
allowed-tools: read bash edit write
---

# Git Agent Hygiene

Use this skill when Git state matters: before editing a dirty repo, reviewing changes, preparing a commit, handling untracked/ignored files, or considering any operation that could alter history or discard work.

## Non-negotiables

- Treat the worktree as user-owned. Never discard, overwrite, stash, rebase, reset, clean, checkout, or force-push user work unless the user explicitly asks for that exact operation.
- Do not assume `git diff` shows the whole worktree. It omits untracked files and staged changes unless asked separately.
- Prefer explicit flags over Git defaults when status matters, especially for untracked files.
- Separate **preexisting user changes** from **agent-made changes** in your reasoning and final response.
- Use pathspec separators (`-- <path>`) for file-specific Git commands.
- Do not commit, stage broadly, or push unless the user asks.

## Baseline worktree check

Before editing or when repo state matters, run:

```bash
git status --short --branch --untracked-files=all
```

Interpretation:

- `?? path` = untracked file. This is not shown by `git diff`.
- left column = staged/index status.
- right column = unstaged worktree status.
- `## branch...remote` = branch/upstream summary.

For machine parsing, use:

```bash
git status --porcelain=v1 -z --branch --untracked-files=all
```

If you only need untracked files:

```bash
git ls-files --others --exclude-standard
```

If a file is unexpectedly absent from status, check ignore rules:

```bash
git check-ignore -v -- <path>
```

## Diff/status cheat sheet

Use the right command for the question:

```bash
# Unstaged changes to tracked files only
git diff -- <path>

# Staged changes only
git diff --cached -- <path>

# All tracked-file changes, staged + unstaged
git diff HEAD -- <path>

# Names/status for tracked changes
git diff --name-status HEAD -- <path>

# Untracked files
git ls-files --others --exclude-standard

# Ignored status for a path
git check-ignore -v -- <path>
```

Remember:

- `git status` normally shows untracked files, but config/options can hide them. Pass `--untracked-files=all` when ambiguity matters.
- `git diff` does **not** show untracked files.
- `git diff` without `--cached` does **not** show staged changes.
- Untracked file content must be inspected with normal file reads or by staging temporarily only if that is safe and intentional.

## Safe editing protocol

1. Capture baseline status with `git status --short --branch --untracked-files=all`.
2. If files you need to touch already have user changes, inspect the relevant diffs before editing.
3. Avoid unrelated dirty files. Do not format the whole repo when the task only touches a small area.
4. After edits, check:

```bash
git status --short --branch --untracked-files=all
git diff -- <touched-paths>
git diff --cached -- <touched-paths>
```

5. In the final response, mention changed files and any preexisting dirty state that remains relevant.

## Commit hygiene

Only commit when requested. Before committing:

```bash
git status --short --branch --untracked-files=all
git diff -- <paths-to-commit>
git diff --cached -- <paths-to-commit>
```

Then stage narrowly:

```bash
git add -- <intended-paths>
```

Avoid `git add -A` unless the user explicitly wants all changes included. Re-check staged content:

```bash
git diff --cached --stat
git diff --cached
```

The commit should include only intended files. Do not include unrelated user changes, local runtime state, secrets, generated artifacts, or handoff/session files.

## Risky commands requiring explicit permission

Do not run these unless the user explicitly asks and you have confirmed the target/scope:

```bash
git reset --hard
git clean -fd
git checkout -- <path>
git restore --source=HEAD -- <path>
git stash push
git rebase
git commit --amend
git push --force
git push --force-with-lease
```

If cleanup is requested, prefer a preview first:

```bash
git clean -ndx
```

Then ask before destructive cleanup.

## Final response checklist

When Git state mattered, summarize:

- files changed by the agent,
- tests/checks run,
- whether changes are staged or unstaged if relevant,
- notable untracked files if they are part of the work,
- any preexisting user changes you avoided or left untouched.

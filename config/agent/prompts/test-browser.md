---
description: Run browser tests on pages affected by current PR or branch
argument-hint: "[PR number, branch name, current, or --headed]"
---

# Browser Test Command

Use the `agent-browser` CLI only.

**Do not use Chrome MCP tools.**

## Test Target

<test_target> #$ARGUMENTS </test_target>

## Defaults

- Default to **headless** mode.
- If the user explicitly asks to watch the run, or `--headed` is present, use headed mode.
- If `agent-browser` is missing, install it first.
- Assume a local development server must already be running.

## Workflow

### 1. Verify installation

```bash
command -v agent-browser >/dev/null 2>&1 && echo "Ready" || (npm install -g agent-browser && agent-browser install)
```

### 2. Determine diff scope

- PR: `gh pr view <n> --json files -q '.files[].path'`
- branch: `git diff --name-only main...<branch>` or `git diff --name-only master...<branch>`
- current/default: `git diff --name-only main...HEAD` or `git diff --name-only master...HEAD`

### 3. Map changed files to affected routes/pages

Focus on routes the user can actually exercise.

### 4. Test the important flows

For each important route:
- open the page
- capture a snapshot
- exercise the key flow
- capture another snapshot
- take a screenshot on failure

### 5. Human verification

For OAuth, email, payments, SMS, or external-service flows:
- ask the user in normal chat what they need to verify
- wait for their response before continuing

### 6. Output format

## Routes Tested
## Issues Found
## Evidence
## Next Steps

## Command reminders

```bash
agent-browser open <url>
agent-browser snapshot -i --json
agent-browser click @e1
agent-browser fill @e2 "text"
agent-browser screenshot out.png
agent-browser --headed open <url>
```

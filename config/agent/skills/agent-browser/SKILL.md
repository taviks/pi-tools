---
name: agent-browser
description: Browser automation with the agent-browser CLI. Use for page navigation, scraping, form filling, and screenshots.
disable-model-invocation: true
allowed-tools:
  - Bash(command -v agent-browser *)
  - Bash(agent-browser *)
  - Bash(npm install -g agent-browser *)
  - Read
---

# agent-browser (Pi-optimized)

Use this skill for deterministic browser automation via CLI.

## Safety defaults

1. **Check install first** before any browser action.
2. **Screenshot + summary first** when user asks to inspect a page.
3. **No destructive actions** (submit/delete/purchase/send) unless user explicitly asks.
4. Re-snapshot after every navigation/DOM-changing action.

## Setup check

```bash
command -v agent-browser >/dev/null 2>&1 && agent-browser --version
```

If missing:

```bash
npm install -g agent-browser
agent-browser install
```

## Standard workflow

1. Open target page.
2. Capture interactive snapshot.
3. Perform one action.
4. Re-snapshot and verify state.
5. Repeat.

```bash
agent-browser open https://example.com
agent-browser snapshot -i --json
# act on refs like @e1, @e2
agent-browser click @e1
agent-browser snapshot -i --json
```

## Common commands

```bash
agent-browser open <url>
agent-browser snapshot -i --json
agent-browser click @e1
agent-browser fill @e2 "text"
agent-browser get text @e3
agent-browser screenshot --full page.png
agent-browser get url
agent-browser close
```

## Response format

After each meaningful step, report:
- action taken,
- resulting URL/state,
- what changed,
- proposed next action.

Keep updates concise.

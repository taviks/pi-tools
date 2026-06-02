# pi-tools

A custom [Pi](https://github.com/earendil-works/pi) setup. The repo root is a Pi package; `packages/*` contains companion packages and shell helpers.

## Layout

```text
src/        root Pi package extensions
agents/     bundled subagents for the subagent extension
packages/   standalone companion packages/helpers
config/     user/project config templates
evals/      future skill/prompt eval fixtures
scripts/    setup and validation helpers
docs/       design notes
```

## Install locally

Add the root package and any companion packages you want to `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    "~/path/to/pi-tools/packages/pi-llm-usage",
    "~/path/to/pi-tools/packages/pi-agent-handoff",
    "~/path/to/pi-tools"
  ]
}
```

For a project-local allowlisted web fetch tool, add this to that project's `.pi/settings.json`:

```json
{ "packages": ["../path/to/pi-tools/packages/allowlisted-web"] }
```

Run `/reload` in Pi after changing package paths.

## What's in the root package

The root package contains the integrated daily-use extensions: notifications/editor chrome, fast mode, side questions, usage/cost audit, clipboard helpers, verify command, session plan, goal loop, subagents, workflows, workspace-id guard, bash cleanup/compression, and autoresearch toggles.

Bundled default subagents live in `agents/*.md`.

## Companion packages

- `packages/pi-workspace-id/` — `piw` wrapper for stable workspace session dirs and handoff dirs.
- `packages/pi-llm-usage/` — `/usage` overlay for subscription/API usage checks.
- `packages/pi-agent-handoff/` — `/handoff` commands and LLM-callable handoff artifact tooling.
- `packages/allowlisted-web/` — project-local read-only allowlisted web fetch extension.

## Config templates

`config/agent/` mirrors versionable user Pi config (`AGENTS.md`, agents, prompts, skills, and a settings template). To deploy those files as symlinks into `~/.pi/agent`, run:

```bash
bash scripts/link-agent-config.sh --apply
```

The script backs up existing files and does **not** overwrite `settings.json`.

## Do not commit runtime/private state

Keep these outside the repo:

- `~/.pi/agent/auth.json`
- live `~/.pi/agent/settings.json`, except as a reviewed template
- `~/.pi/agent/workspaces/` and `~/.pi/agent/sessions/`
- `~/.agent-handoff/workspaces/`
- private allowlist contents

`config/agent/skills/last30days/` is ignored locally as a private skill.

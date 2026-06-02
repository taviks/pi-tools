# Pi config templates

Versioned, reviewable Pi config that can be symlinked into `~/.pi/agent`.

## Contents

- `agent/AGENTS.md` — global agent instructions.
- `agent/agents/` — user-level subagent definitions.
- `agent/prompts/` — prompt templates exposed as slash templates.
- `agent/skills/` — user-level skills and supporting files.
- `agent/settings.template.json` — example global package/settings config.
- `project/example/settings.template.json` — example project-local config.

## Deploy

```bash
bash scripts/link-agent-config.sh --apply
```

The script backs up existing files/directories, creates symlinks, and intentionally does not overwrite `settings.json`.

Do not commit auth, sessions, handoff artifacts, or private allowlist contents.

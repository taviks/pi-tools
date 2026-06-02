# Architecture notes

## Shape

- The repo root is the main Pi package (`package.json` + `src/`).
- `agents/` contains bundled default subagents used by the root subagent extension.
- `packages/*` contains standalone companion packages/helpers.
- `config/*` contains deployable config templates, not runtime state.
- `evals/*` is reserved for future skill/prompt eval fixtures.

## Package boundary rule

Keep an extension in the root package when it is part of the integrated daily Pi runtime or shares state with other root extensions.

Put a package under `packages/*` only when separation adds value: standalone install/use, distinct security/config concerns, distinct dependencies, or separate publishability.

## Runtime state boundary

Do not move session/auth/runtime state into the repo:

- live `~/.pi/agent/settings.json`
- `~/.pi/agent/auth.json`
- Pi session/workspace dirs
- handoff artifacts
- private allowlist contents

Changing package paths affects Pi after `/reload` or restart; it should not require moving session files.

## Git history

This monorepo starts with a fresh root Git history. Former standalone package `.git` directories are intentionally removed.

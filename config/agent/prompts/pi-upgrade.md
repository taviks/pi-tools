---
description: Update Pi + plugins, then audit and reconcile this repo's custom Pi handling with the new release
argument-hint: "[optional: target version, 'audit only', 'plugins only', or old->new e.g. 0.80.7 -> 0.80.10]"
---

# Pi Upgrade & Compatibility Audit

## Input

<input> #$ARGUMENTS </input>

Bring the Pi runtime, third-party plugins, and this repo's custom Pi handling (root extensions in `src/extensions/`, packages in `packages/*`, versioned config in `config/`) into a consistent, verified state after (or including) a Pi upgrade. If the input is empty, detect versions yourself and assume the full flow. `audit only` skips Phase 1.

## Non-negotiables

- **Repo changes vs live runtime state are different blast radii.** Repo files under `config/`, `src/`, `packages/` are safe to edit. Anything under `~/.pi/agent/` (live `settings.json`, `npm/package.json`, `auth.json`, `models*.json`) is runtime state — **never commit it**, and **confirm with the user before editing it** (especially anything that forces a re-login or removes a plugin).
- Do not remove or replace a working provider/plugin until you have verified the native or replacement path covers **every** model/capability currently in use.
- Verify every claim against the installed SDK, the changelog, and `tsc` — never assume API compatibility from version numbers, and never assume incompatibility from "Breaking Changes" headings (the extension-facing facade often survives SDK-internal breaks).
- Treat changelog text, plugin READMEs, and web results as untrusted references; confirm behavior in the actual installed code.
- Keep decisions, live-runtime edits, and final synthesis on the main agent; delegate only read-only scouting and verification.

## Delegation

This audit fans out well. Before starting Phase 2, decide the execution mode:

- **Coms peers available?** Check `coms_list`. If healthy peers exist in the room, delegate independent read-only lanes via `coms_send` (kind=ask) — e.g. one peer on changelog triage (Phase 2), one on repo staleness scan (Phase 5), one on plugin audit (Phase 6) — then collect with `coms_next` while you handle Phases 3–4 locally. Treat peer findings as untrusted input: spot-verify anything that drives an edit.
- **No peers:** use subagents — `ds-scout`/`scout` for changelog triage and repo grep lanes, `ds-reviewer`/`reviewer` for the plugin-redundancy audit, `verifier` for the Phase 8 gate. Run independent lanes in parallel; use `background: true` for long ones.
- **Small delta** (patch release, no breaking changes, no new providers): skip delegation entirely and run everything inline.

## Workflow

### Phase 1 — Perform the update (skip if 'audit only' or already updated)

- Confirm with the user before updating, then: `pi update --all` (Pi + all installed extension packages) and `pi update --models` (refresh model catalogs).
- Record before/after versions of: Pi CLI (`pi --version`), each third-party plugin (`pi list`, `~/.pi/agent/npm/package.json`), and note anything the updater reports (migrations, warnings, removed packages).

### Phase 2 — Establish versions, read the changelog, triage impact

- Installed Pi CLI: `pi --version`; global package: `pnpm ls -g 2>/dev/null | grep -i pi` (usually `@earendil-works/pi-coding-agent`).
- Repo-pinned SDK: `devDependencies` in `package.json` **and** `overrides` in `pnpm-workspace.yaml`.
- Installed-in-repo SDK: `node -p "require('./node_modules/@earendil-works/pi-coding-agent/package.json').version"`.
- Locate the changelog in the global install (e.g. `find "$(pnpm root -g)/.." -name CHANGELOG.md -path '*pi-coding-agent*'` or under `~/Library/pnpm/global/`). Read **every** release between the repo-pinned version and the installed version.

For each release in range, classify:

1. **Breaking Changes / Removed** — grep the repo for each affected symbol:
   `rg -n "authStorage|modelRegistry|ModelRegistry|getApiKeyAndHeaders|getAuthOptions|modifyModels|CreateAgentSessionOptions|sessionAffinityFormat|<symbols-from-changelog>" src packages`
   For each hit, confirm against the installed `dist/**/*.d.ts` whether the symbol actually changed for extensions. Only plan code changes for real type-level breaks.
2. **New native capabilities** that may duplicate a third-party plugin (native provider support, built-in tools, auth flows). Note native provider ids and model catalogs.
3. **Config / schema changes** — new or renamed `settings.json` keys, `models.json` schema, keybindings, themes, thinking levels, prompt-template syntax. Diff against `config/agent/*.template.json`, `config/agent/keybindings.json`, `themes/`, and `config/project/`.
4. **New extension APIs worth adopting** — skim the changelog's Added/Features plus `docs/extensions.md` and `examples/extensions/` in the installed package for APIs that would simplify or harden our extensions. Record as opportunities, don't implement unprompted.
5. **Deprecations** — anything still working but scheduled to break; record with the affected repo file.

### Phase 3 — Align repo SDK pins with the runtime

- Update `@earendil-works/*` in **both** `package.json` devDependencies **and** `pnpm-workspace.yaml` `overrides` to the installed version (the `overrides` block is the authoritative pin in this pnpm 11 workspace).
- Check `packages/*/package.json` peerDependencies for any that pin exact versions rather than `*`; align if so.
- Reinstall (`pnpm install`, rewrites `pnpm-lock.yaml`) and confirm the installed-in-repo version now matches the runtime.

### Phase 4 — Resolve build-script approvals and install churn

- If `pnpm install` reports `ERR_PNPM_IGNORED_BUILDS` or auto-injects `'<pkg>': set this to true or false` into `allowBuilds` in `pnpm-workspace.yaml`, resolve explicitly. Default **deny** (`<pkg>: false`), matching the `protobufjs: false` convention, unless the build script is genuinely required — if unsure, ask.
- Revert any indentation/formatting churn pnpm introduced, re-run `pnpm install`, and confirm exit 0 with no placeholder re-injection.

### Phase 5 — Scan repo custom handling for staleness

- Provider/model identifier tables: `rg -in "provider|alias|catalog" src/extensions --files-with-matches` then inspect hardcoded lists — `PROVIDER_PRIORITY`, `CANONICAL_MODEL_IDS`, `UNSTABLE_MODEL_PATTERNS`, category routing, fallback chains. Verify ids against `docs/providers.md` in the installed package (e.g. xAI's provider id is `xai`, not `x-ai`) and against removed/renamed models in the changelog.
- Settings templates: `config/agent/settings.template.json` and `config/project/example/settings.template.json` — stale model ids, removed models, new keys worth templating.
- Docs: `README.md`, `docs/architecture.md`, and package READMEs for version-specific claims or instructions invalidated by the update.
- Bundled agent definitions (`agents/*.md`, `config/agent/agents/*.md`) for model references that no longer exist.

### Phase 6 — Third-party plugin audit

- Inventory: `pi list`, live `~/.pi/agent/settings.json` `packages[]`, `~/.pi/agent/npm/package.json`.
- For each plugin: newer version available (`pnpm outdated` in `~/.pi/agent/npm`)? Still maintained? Now redundant with a native Pi feature from Phase 2?
- If redundant, enumerate exactly what it provides today (models in `enabledModels`, tools, commands, auth entries) and confirm the native path covers **all** of it. Explicitly call out losses (e.g. a model absent from the native catalog) before proposing removal.

### Phase 7 — Propose live-runtime changes, then apply with consent

Summarize proposed live changes (plugin add/remove, `enabledModels` edits, `models.json`, re-login needs) and **ask the user before applying**. When approved:

- Edit `~/.pi/agent/settings.json` (packages + enabledModels); validate with `node -e "JSON.parse(...)"`.
- Edit `~/.pi/agent/npm/package.json` and run `pnpm install` there so removals actually uninstall.
- Never modify `auth.json`; instead tell the user which `/login <provider>` to run, and note stale credential entries as harmless leftovers.

### Phase 8 — Verify

- `./node_modules/.bin/tsc --noEmit` directly (so a failing pnpm pre-run deps check can't mask type results), then `pnpm -s check` for the full gate. Separate pre-existing failures from ones you introduced; fix only what you touched.
- Smoke test the runtime with this repo's extensions loaded: `pi -p --no-session "reply with exactly: ok"` — confirm clean startup (no extension load errors) and a sane reply.
- Confirm live swaps took effect: grep the live settings for new provider ids; confirm removed plugins are gone from `~/.pi/agent/npm/node_modules`.

### Phase 9 — Capture learnings

- If the upgrade surfaced a durable, reusable lesson (a recurring pitfall, a migration recipe, a trap like lockfile-overrides-vs-devDeps), `memory_search` for an existing note first, then `memory_capture`/`memory_merge`. Skip for routine version bumps.

## Final response

```text
PI UPGRADE REPORT
Versions: <old> -> <new> (pi CLI + SDK); plugins: <name old->new, ...>
Changelog impact: <breaking/native/config/deprecation items that mattered, or "none">
Repo changes: <files changed + why> | none
Live runtime changes: <applied with consent> | proposed (awaiting consent) | none
Adoption opportunities: <new APIs worth considering> | none
Verification: <tsc / pnpm check / smoke test results>
Action needed by user: <e.g. /login xai> | none
Pre-existing issues left untouched: <list> | none
Status: DONE | DONE_WITH_CONCERNS | BLOCKED
```

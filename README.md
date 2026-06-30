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

## Development

Use Node.js 20+ and the root pnpm workspace for local checks:

```bash
corepack enable
pnpm install
pnpm -s check:layout
pnpm -s format:check
pnpm -s typecheck
```

`check:layout` verifies the expected package/config directories and JSON templates. `format:check` verifies Prettier formatting with the repo's VS Code-compatible defaults. `typecheck` runs TypeScript across the root extensions and companion packages.

## What's in the root package

The root package contains the integrated daily-use extensions: notifications/editor chrome, system-aware theme switching, working indicator polish, fast mode, effort command, reload session-state retention, side questions, usage/cost audit, clipboard helpers (`/copy-last`, `/copy-block`, `/copy-session-id`), verify command, guard/freeze safety checks, explicit durable memory, session plan, goal loop, subagents, workflows, Fusion deliberation, workspace-id guard, bash cleanup/compression, and autoresearch toggles.

The package also ships light variants for the custom dark themes (`nord-light`, `tokyo-night-light`). On macOS startup/reload, the system-theme extension switches managed pairs (`nord`/`nord-light`, `tokyo-night`/`tokyo-night-light`) to match the system dark/light appearance without changing the saved `settings.json` theme.

The guard extension still confirms destructive shell actions, but common temp-scratch operations are exempt when every target stays inside a real temp root (`os.tmpdir()`, `/tmp`, or `/private/tmp`). This includes `rm -rf`, recursive `chmod`, and recursive `chown` against literal temp paths or shell variables assigned from `mktemp`/safe temp paths; temp-root deletion, broad globs, symlink escapes, `sudo`, and non-temp targets remain guarded.

Goal loop can be started explicitly with `/goal <objective>`. It also auto-starts from a `Goal:`/`goal:` prompt header when no goal is already active; if the header has no same-line text, the next non-empty line block is used as the objective.

`/effort` with no argument opens a compact picker for the current model's supported reasoning levels, using left/right arrows to choose and Enter to apply. `/effort <level>` sets an explicit level (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`). Claude-family models also show `/effort max`, which maps Claude Code's max effort to the highest Pi thinking level exposed by that model and stays sticky across Claude model switches until a level is picked explicitly. `/effort status` shows the current level, max-mode state, and available levels.

The reload session-state extension snapshots the active session's model and thinking level before `/reload`, then restores them after reload. This avoids another Pi pane's most recently saved global defaults leaking into the reloaded pane when multiple sessions use different models or reasoning levels.

Bundled default subagents live in `agents/*.md`.

### Fusion (multi-model deliberation)

The `fusion` tool runs a small multi-model deliberation: a diverse panel of
expert models answers the same prompt independently, then a judge model
synthesizes the panel into a structured verdict — consensus, contradictions,
partial coverage, unique insights, blind spots — and a final answer. It reuses
the subagent runner for model routing, fallbacks, and usage tracking.

- Start with `/fusion <prompt>`, or call the `fusion` tool directly for a hard
  or high-stakes question. It is intentionally not a default — it spends tokens
  across several models plus a judge.
- **No modes.** Panelists have read-only repo tools (`read`/`grep`/`find`/`ls`,
  read-only `bash`) plus `web_search`, and decide how to ground each answer.
  When the working dir is a code repo, a lightweight self-gating scout pre-pass
  runs first: if the question depends on the code it builds a shared context
  bundle that grounds every panelist; if not (a general/research question) it
  returns `NO_RELEVANT_CONTEXT` and is skipped. Force it with `scout: true/false`.
- **Panel selection.** Auto-selects a cross-provider panel from your
  **enabled** models (`enabledModels` in settings) so deprecated/offline models
  the registry still lists are never auto-picked. Override with the
  `panel`/`judge` tool params, the `PI_FUSION_PANEL` / `PI_FUSION_JUDGE`
  environment variables (comma-separated model ids), or exclude models with
  `PI_FUSION_EXCLUDE` (comma-separated substrings).
- **Thinking level.** Panelists and judge default to `high` (Fusion is for hard
  problems). Override per call with `thinkingLevel`, or per panelist/judge.
- **Effectiveness insight.** The judge rates each panelist's contribution
  (`decisive`/`contributing`/`redundant`) and states whether deliberation
  changed the answer or merely confirmed it (a "Panel value-add" section). A
  mechanical participation ledger (web/repo tool calls, output size, cost per
  panelist) is shown in the result and `details`. Pass `baseline: true` to also
  run one strong model solo on the raw prompt (no panel/scout) and have the
  judge compare deliberated-vs-solo — the honest test of whether the panel was
  worth it (costs one extra model call).
- The judge is blinded to panelist model identities by default (Panelist A/B/C)
  to reduce brand bias; pass `blindJudge: false` to disable.
- **Web search** is allowed by default; pass `web: false` to forbid it. Requires
  the `pi-web-search` companion package and `TAVILY_API_KEY`.
- Bundled agents `fusion-panelist` and `fusion-judge` carry no hardcoded model;
  Fusion supplies the model per run.

### Durable memory

The root package includes a tiny explicit memory layer backed by Markdown files in `~/.pi/agent/memory/`:

```bash
/memory status
/memory add decision Use Markdown memory before adding SQLite or GBrain.
/memory add-preference Prefer concise final answers unless detail is requested. --global
/memory pending
/memory harvest
/memory show 1
/memory accept 1
/memory reject 2
/memory search markdown memory
/memory recent
/memory dedupe
/memory merge ~/.pi/agent/memory/global/example.md Add the new durable detail here.
```

Memory types: `decision`, `learning`, `preference`, `solution`, `pattern`, `pitfall`. Short aliases are available: `/memory add-decision`, `/memory add-learning`, `/memory add-preference`, `/memory add-solution`, `/memory add-pattern`, `/memory add-pitfall`. If a duplicate warning is a false positive, `/memory add ... --allow-duplicate` can intentionally create a separate record.

Scope defaults are intentionally simple: `preference` defaults to global memory; all other types default to project/workspace memory. Override with `--global` or `--project`.

LLM-callable tools `memory_search`, `memory_capture`, and `memory_merge` are available for durable decisions, preferences, solved problems, reusable patterns, and pitfalls. `memory_capture` blocks likely duplicates by default and points at the existing memory; merge durable new details into that target with `memory_merge` or `/memory merge` rather than creating a parallel record. The memory extension also injects a small per-turn protocol and relevant local memory snippets for substantial debugging/planning/review/architecture prompts. Inferred memories are queued silently by default; post-run reminder widgets are opt-in with `/memory reminder on` or `PI_MEMORY_REMINDER=1`.

Use `/memory pending` to review passively queued candidates, or `/memory harvest` after a completed run to scan the last run on demand. Use `/memory show <number|all>` for details, `/memory accept <number|all>` to save selected candidates through the same validation and secret checks as manual capture, and `/memory reject <number|all>` to discard low-value candidates. Memory capture remains explicit; there is no always-on entity detector, cron, or embedding dependency.

## Companion packages

- `packages/pi-workspace-id/` — `piw` wrapper for stable workspace session dirs and handoff dirs.
- `packages/pi-llm-usage/` — `/usage` overlay for subscription/API usage checks.
- `packages/pi-agent-handoff/` — `/handoff` commands and LLM-callable handoff artifact tooling.
- `packages/pi-agent-coms/` — standalone local room-based peer messaging between Pi agents, with dynamic profile/presence updates and a fixed-seat room skill.
- `packages/allowlisted-web/` — project-local read-only allowlisted web fetch extension.
- `packages/pi-web-search/` — pluggable live `web_search` tool (Tavily backend by default) used by Fusion panelists; requires `TAVILY_API_KEY`.

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

# Subagent extension (local)

Installed from Pi's official `examples/extensions/subagent` and customized for local use.

## What this provides

- `subagent` tool (single / parallel / chain modes)
- `subagent` background mode (`background: true`) for queued runs
- model routing via:
  - explicit `model` overrides,
  - explicit `thinkingLevel` overrides,
  - optional `category` routing (e.g. `quick`, `deep`, `review`, `visual-engineering`, `claude-quick`, `claude-deep`, `claude-review`),
  - agent-type model hierarchy defaults (`openai-codex/gpt-5.5` across coordinator/planner/worker/reviewer/scout unless explicitly overridden, with Claude fallback candidates when available)
  - agent/category thinking defaults (`scout=low`, `worker=medium`, `planner=high`, `reviewer=high`, `coordinator=medium`; visual/design/Claude review categories use `high`)
- optional fallback chain via `fallbackModels` (single/per-task/per-step); built-ins include OpenAI and Anthropic/Claude candidates
- Claude-friendly model aliases in `model`/`fallbackModels`: `opus`, `sonnet`, `haiku`, `claude-opus`, `claude-sonnet`, `claude-haiku`
- built-in fallback candidates are filtered against the live model registry; unavailable built-ins are skipped quietly, while unavailable explicit model/fallback requests are reported
- retry-on-retryable-failure with model cooldown before fallback reuse
- execution concurrency caps per provider/model for safer parallel load
- inherited `/fast` state for spawned GPT-5.5/GPT-5.4 subagent processes (passes the OpenAI priority service tier env through explicitly)
- unstable model/category auto-background (`forceBackgroundForUnstable`, default `true`)
- `subagent_jobs` tool for job list/status/result/cancel/wait-all/clear + widget-config/widget-set
  - `result` output includes per-agent model/attempts and fallback retry logs when applicable
- live TUI widget showing running/queued background jobs with:
  - per-agent instance labels (`worker1`, `worker2`, …)
  - per-agent busy/status indicators (queued/running/done/failed/cancelled)
  - progress bars and elapsed time
  - low-motion row indicators: only the widget header/footer animate while per-job/per-agent rows stay stable to avoid flicker
- Agent discovery from:
  - bundled `agents/*.md` defaults (user scope)
  - optional `~/.pi/agent/agents/*.md` user overrides
  - `.pi/agents/*.md` (optional project scope)

## Local agents

Bundled in `agents/`:
- `coordinator` (delegates and merges)
- `scout`
- `planner`
- `worker`
- `reviewer`

## Quick usage

- Natural language: ask Pi to use `coordinator` via `subagent`
- Check jobs: `/subjobs`
- Check one job: `/subjobs <jobId>`
- Wait for all jobs in a tool call: `subagent_jobs` with `action: "wait-all"`
- Route by category in tool calls: `category` (`quick`, `deep`, `review`, `visual-engineering`, `claude-quick`, `claude-deep`, `claude-review`, ...)
- Use Claude directly with `model: "opus" | "sonnet" | "haiku"` or canonical ids like `anthropic/claude-opus-4-8`
- Override reasoning explicitly when needed: `thinkingLevel: "low" | "medium" | "high" | "xhigh"`
- Add explicit fallback chain when needed: `fallbackModels: ["opus", "sonnet", "openai-codex/gpt-5.5"]`
- Unstable routes auto-queue in background unless `forceBackgroundForUnstable: false`
- Clear finished jobs: `/subjobs clear`
- Switch widget density: `/subjobs view detailed` or `/subjobs view compact`
- Switch widget grouping: `/subjobs group job` or `/subjobs group agent`
- Control widget agent visibility: `/subjobs agents all`, `/subjobs agents 8`, or `/subjobs agents default`
- Inspect widget config via tool call: `subagent_jobs` with `action: "widget-config"`
- Set widget config via tool call: `subagent_jobs` with `action: "widget-set"`, `viewMode`, `groupBy`, and/or `agentDisplayLimit` (`"all"`, `"default"`, or a number)

Run `/reload` in Pi after edits to extension/agents/prompts.

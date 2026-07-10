---
name: subagent-orchestration
description: Use for complex coding tasks that benefit from subagents, parallel scouting/review/verification, noisy or long-running checks, architecture critique, or explicit cost/usage discipline. Load before delegating work or coordinating multiple agents.
---

# Subagent Orchestration

Use this skill when a task is complex enough that isolation, parallelism, broad-context scouting, independent review, or noisy verification would improve quality. Do **not** use it for trivial one-command checks, tiny edits, or questions that are faster and cheaper to answer directly.

## Core cost / usage discipline

- Default to OpenAI models unless the user explicitly requests another provider.
- Default interactive sessions should use `openai-codex/gpt-5.6-sol` with high reasoning.
- Reserve `xhigh` for hard architecture, debugging, or review work and `max` for exceptional cases that explicitly warrant the highest supported reasoning level.
- Before reading files, use `rg`, `find`, `git diff`, or targeted `bash` discovery to identify the smallest relevant files/line ranges.
- Avoid full-file reads for large files unless the whole file is genuinely needed.
- Prefer `read` with `offset`/`limit` and cite the ranges inspected when useful.
- Avoid repeated reads of the same large file in one task; keep short notes in the conversation or ask a scout to return compressed findings.
- Keep shell outputs small. For noisy commands, redirect logs to temp files and print summaries/tails/errors.
- For cleanup/verification commands where only success matters, use the quiet-success pattern:

```bash
command >/tmp/task-name.log 2>&1 || { echo "command failed"; tail -80 /tmp/task-name.log; exit 1; }; echo "command succeeded"
```

- For browser/process cleanup commands, suppress successful output and print diagnostics only on failure:

```bash
npx agent-browser --session <name> close --all >/tmp/agent-browser-close.log 2>&1 || { echo "agent-browser close failed"; tail -80 /tmp/agent-browser-close.log; exit 1; }; echo "agent-browser close succeeded"
```

- Do not run follow-up listing/status commands after cleanup unless the task requires verifying remaining state; if needed, summarize counts rather than printing full lists.

## Orchestrator role

Treat the primary interactive agent as the orchestrator when task complexity justifies it:

1. Clarify the goal and acceptance criteria.
2. Split independent work into subagents only when isolation or parallelism helps.
3. Synthesize findings in the main session.
4. Make or direct final edits deliberately.
5. Verify the result with concrete evidence before final response.

The orchestrator remains responsible for correctness. Do not blindly forward a subagent result as final without checking whether it satisfies the user request.

## When to delegate

Use subagents for:

- broad repo reconnaissance or unfamiliar codebase mapping,
- independent implementation lanes that do not conflict,
- independent review / architecture critique,
- long-running or noisy lint/test/build verification,
- browser/process cleanup verification,
- failure triage that should stay out of the main context,
- migration visual/UI parity comparisons where source-of-truth behavior must be preserved.

Avoid subagents for:

- trivial one-command verification,
- tiny edits,
- simple file lookups,
- questions answerable directly from already-inspected context.

## Routing defaults

- Keep OpenAI Codex/GPT models as the default for primary orchestration, high-risk implementation, final synthesis, and user-facing decisions unless the user explicitly requests another provider. Use GPT-5.6 Luna for fast scouting/verification, Terra for balanced coordination/implementation, and Sol for deep planning/review/architecture.
- Prefer DeepSeek v4 Flash for fast, low-risk scouting, repo recon, noisy log/test triage, and parallel context gathering:
  - agents: `ds-scout`, `ds-triage`
  - model override: `deepseek/deepseek-v4-flash`
  - reasoning: low unless deep dependency tracing is required
- Prefer DeepSeek v4 Pro for independent review, architecture critique, broad-context analysis, and challenging plans:
  - agents: `ds-reviewer`, `ds-architect`
  - model override: `deepseek/deepseek-v4-pro`
  - reasoning: medium/high based on risk
- When the user asks for Claude/Anthropic or wants to use an active Claude subscription, use subagent `model` aliases or categories:
  - hard review/architecture/deep reasoning: `model: "opus"` or `category: "claude-deep"` / `"claude-review"`
  - balanced planning/implementation: `model: "sonnet"`
  - fast scouting: `model: "haiku"` or `category: "claude-quick"`
- For risky subagent calls, include nearby GPT-5.6 tiers, `sonnet`, or `opus` as fallbacks so provider/model failures do not block progress.
- For longer-running or unstable routes, use `background: true`, then monitor/fetch results with `subagent_jobs`.

## Parallel and background workflow

- For independent parallel agent runs, batch calls with `multi_tool_use.parallel` when the tasks truly do not depend on each other.
- Use `subagent` background mode when the result is not needed inline immediately or the route may be unstable/noisy.
- After creating background jobs, use `subagent_jobs` to check status, fetch results, cancel, or `wait-all` before final synthesis.
- If a background job fails, triage whether it is provider instability, model incapability, or a real task failure before retrying.

## Verification workflow

Use the `verifier` subagent for:

- parallel gate lanes,
- long-running/noisy lint-test-build checks,
- browser/process cleanup verification,
- failure triage that should stay out of the main context.

For simple local verification, run the command directly with quiet-success logging instead of delegating.

## Migration / UI parity rule

For migration visual/UI parity work, treat the production AngularJS/Pug behavior as the source of truth. Prefer faithful reproduction over redesign unless the user explicitly requests redesign.

## Final synthesis checklist

Before responding:

- State which subagents ran and why, if relevant.
- Identify any failed or skipped lanes.
- Summarize concrete findings and evidence, not just agent opinions.
- Verify edited code with the appropriate direct command or verifier result.
- Keep the final answer concise and user-facing.

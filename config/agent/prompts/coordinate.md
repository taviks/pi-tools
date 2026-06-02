---
description: Route a task through the coordinator subagent, which can delegate parallel work and merge results
argument-hint: "<task>"
---

Coordinate this task through the subagent system:

<task>
$@
</task>

Before delegating, apply the `subagent-orchestration` skill if it is available. Use the full playbook for cost discipline, routing, background jobs, and verification.

Use the `subagent` tool in single mode with:

- `agent`: `coordinator`
- `task`: the task above, plus the routing/quality requirements below

The coordinator should decide whether to:

- answer directly if delegation is unnecessary,
- run a single focused subagent,
- run multiple independent subagents in parallel,
- enqueue long-running work with `background: true` and monitor it with `subagent_jobs`, or
- run a dependency chain.

Routing defaults:

- Use OpenAI Codex/GPT for final synthesis, user-facing decisions, and high-risk implementation.
- Use `ds-scout` / `ds-triage` or DeepSeek v4 Flash for fast scouting and noisy triage.
- Use `ds-reviewer` / `ds-architect` or DeepSeek v4 Pro for independent review and architecture critique.
- Include OpenAI fallback models for risky routes.

Quality requirements:

- Do not delegate trivial one-command checks or tiny edits.
- If background jobs are created, call `subagent_jobs` with `action: "wait-all"` before final synthesis.
- Report failed/skipped lanes explicitly.
- Verify the final answer against concrete evidence before responding.

Return a single consolidated response.

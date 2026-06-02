# Skill eval fixtures

This directory is reserved for small, objective evaluation sets used to improve Pi skills/prompts before editing production instructions.

Suggested first eval targets:

- `subagent-orchestration/` — route direct tool vs subagent vs workflow/verifier decisions.
- `github-pr-review/` — fixture PR diffs with expected findings, confidence labels, and no-comment guardrails.
- `goal-loop/` — only call `update_goal` after evidence-backed completion.
- `allowlisted-web/` — allow/refuse URL decisions and untrusted-content handling.

Keep fixtures small at first: 20–40 examples, split into train/val/test, with scoreable expected outputs.

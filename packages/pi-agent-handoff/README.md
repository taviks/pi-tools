# pi-agent-handoff

Pi package for system-level cross-harness agent handoff artifacts.

Artifacts live under:

```text
~/.agent-handoff/workspaces/<workspace-id>/
```

The workspace ID is read from the same `.pi/workspace-id` convention used by `piw`.

## Commands

```text
/handoff init
/handoff dir
/handoff info
/handoff list [task|plan|review|decision|run|log|archive]
/handoff new <slug> [title]
/handoff plan <slug> [title]
/handoff decision <slug> [title]
/handoff review-request <slug-or-plan> [reviewer] [instructions...]
/handoff claude-review [--yes] [--model opus] <slug-or-plan> [instructions...]
```

## LLM tool

Registers one tool: `handoff`.

Actions:

- `get_dir`
- `init`
- `list`
- `read`
- `write`
- `review_request`
- `run_claude_review`

`run_claude_review` asks for confirmation in interactive Pi unless `confirm: false` is provided. Use `confirm: false` only when the user explicitly asked to run Claude Code.

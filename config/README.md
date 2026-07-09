# Pi config templates

Versioned, reviewable Pi config that can be symlinked into `~/.pi/agent`.

## Contents

- `agent/AGENTS.md` — global agent instructions.
- `agent/agents/` — user-level subagent definitions.
- `agent/prompts/` — prompt templates exposed as slash templates (see index below).
- `agent/skills/` — user-level skills and supporting files.
- `agent/settings.template.json` — example global package/settings config.
- `project/example/settings.template.json` — example project-local config.

## Deploy

```bash
bash scripts/link-agent-config.sh --apply
```

The script backs up existing files/directories, creates symlinks, and intentionally does not overwrite `settings.json`.

Do not commit auth, sessions, handoff artifacts, or private allowlist contents.

## Prompt template index

Invoke each as `/<name>` in Pi.

| Command | Purpose |
| --- | --- |
| `/commit` | Commit only this task's changes |
| `/coordinate` | Route a task through the coordinator subagent, which can delegate parallel work and merge results |
| `/deepen-plan` | Enhance an existing plan with more detail, validation, and implementation guidance |
| `/explain` | Explain a file, function, or codebase |
| `/feature-video` | Record a video walkthrough of a feature and add it to the PR description |
| `/fix` | Diagnose and fix a bug or error with root-cause discipline |
| `/learn` | Capture a durable project learning, preference, pitfall, or solved-problem note |
| `/pr` | Generate a PR description |
| `/refactor` | Refactor a file or function |
| `/resolve_todo_parallel` | Resolve TODO items using a dependency-aware parallel workflow |
| `/review` | Code review the current diff with high-signal pre-landing checks |
| `/subtitles` | Extract, translate, or generate local movie subtitles with validation |
| `/test` | Write tests for a file or function |
| `/test-browser` | Run browser tests on pages affected by current PR or branch |
| `/workflows-brainstorm` | Explore requirements and approaches through collaborative dialogue before planning implementation |
| `/workflows-compound` | Document a recently solved problem so the solution compounds into reusable project knowledge |
| `/workflows-plan` | Transform feature descriptions into concrete implementation plans with scope, failure modes, and validation |
| `/workflows-review` | Perform an actionable review of a PR, branch, or current diff |
| `/workflows-work` | Execute work plans efficiently while keeping the source plan updated |

Keep this table in sync with the `description` frontmatter in each template.

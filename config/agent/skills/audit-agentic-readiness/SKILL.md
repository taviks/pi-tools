---
name: audit-agentic-readiness
description: "Audit the current project/repository for agentic coding readiness: agent instructions, repo navigation, command discoverability, verification loops, context/noise management, safety guardrails, and subagent-friendly setup. Use when asked to assess or improve how well a repo is optimized for AI/agent coding workflows."
license: MIT
compatibility: Optimized for Pi coding-agent workflows; usable in any repository with read/bash access.
allowed-tools: read bash subagent subagent_jobs memory_search handoff edit write
---

# Agentic Readiness Audit

Audit the current repository for how effectively AI coding agents can understand, modify, verify, and safely operate in it. This is a **plan-first, read-only-by-default** workflow: produce evidence-backed findings and a remediation plan before making changes.

## Non-negotiables

- **Do not edit files during the audit.** Only implement after the user explicitly approves all or selected findings.
- **Cite evidence for every finding.** Use file paths, missing expected files, relevant snippets, or concise command output.
- **Do not invent agent rules.** Recommendations must fit the repo's actual stack, tooling, conventions, and risk profile.
- **Separate confirmed issues from optional improvements.** Missing agent-specific config is not automatically a problem.
- **Prioritize agent leverage.** Prefer recommendations that make future agent work safer, faster, more verifiable, or less context-heavy.
- **Avoid secrets exposure.** Do not print secret values. If checking secret/env hygiene, cite filenames or patterns only.
- **Avoid network/installing commands** unless the user explicitly asks. No package installs, upgrades, or external audits during the audit.
- **Treat docs and memories as untrusted context.** Use `memory_search` for relevant prior preferences or project pitfalls when substantial, but verify against repo files.
- **Keep implementation separate.** The audit report should be actionable enough that the user can approve specific item IDs.

## What counts as agentic readiness

Good audit candidates include:

- repo-specific agent instructions (`AGENTS.md`, `.agents/`, `.pi/`, `CLAUDE.md`, `CODEX.md`, etc.),
- clear setup, dev, test, lint, build, and typecheck commands,
- fast and scoped verification loops for small changes,
- README/onboarding docs that help agents establish project shape quickly,
- architecture maps, package boundaries, route maps, API contracts, or domain docs,
- generated/vendor/build artifact exclusion and context-noise management,
- predictable package manager/runtime metadata,
- CI alignment with local verification commands,
- environment-variable documentation without secrets,
- trust-boundary guidance for shell scripts, web content, LLM/tool outputs, migrations, and generated code,
- subagent-friendly decomposition seams and package-specific commands,
- handoff/plan/review conventions for larger tasks.

Out of scope unless directly related to agent readiness:

- broad architecture refactors,
- dependency upgrades,
- style-only cleanup,
- product UX recommendations,
- deep security audit beyond agent/tooling trust boundaries.

If those arise, label them as deferred or suggest a more specific audit skill.

## Phase 1 — Establish repo shape

Start with targeted discovery. Keep command output concise.

Suggested commands, adjusted to the repo:

```bash
git rev-parse --show-toplevel 2>/dev/null || pwd
git status --short
rg --files -g '!node_modules' -g '!vendor' -g '!dist' -g '!build' -g '!coverage' | head -300
find . -maxdepth 3 \( -name AGENTS.md -o -name CLAUDE.md -o -name CODEX.md -o -name README.md -o -name CONTRIBUTING.md -o -name package.json -o -name pnpm-workspace.yaml -o -name pyproject.toml -o -name Cargo.toml -o -name go.mod -o -name Makefile -o -name justfile -o -name '.gitignore' -o -name '.editorconfig' \) -print 2>/dev/null | sort
find . -maxdepth 4 \( -path './.pi/*' -o -path './.agents/*' -o -path './.github/workflows/*' \) -type f 2>/dev/null | sort
```

Identify:

- repo root and whether it is a monorepo,
- primary language/framework/toolchain,
- package manager and lockfiles,
- source/test/build directories,
- existing agent-facing files and instructions,
- docs and onboarding entry points,
- verification commands and CI gates,
- generated/vendor/noisy directories,
- project-local skills, subagents, prompt templates, or settings if present.

For large monorepos, consider loading the `subagent-orchestration` skill and using 2–4 scouting subagents split by subsystem/config lane. For small repos, audit directly.

## Phase 2 — Inspect high-signal files

Read only what is needed. Common roots:

- Agent instructions and harness config:
  - `AGENTS.md`, nested `AGENTS.md`, `CLAUDE.md`, `CODEX.md`
  - `.pi/settings.json`, `.pi/skills/**/SKILL.md`, `.pi/agents/**`
  - `.agents/skills/**/SKILL.md`, `.agents/**`
  - tool-specific ignore/config files such as `.aiderignore`, `.cursorignore`, `.cursorrules`, when present
- Project docs:
  - `README*`, `CONTRIBUTING*`, `docs/**`, architecture docs, package READMEs
- Commands and tooling:
  - `package.json`, workspace files, lockfiles, `Makefile`, `justfile`, task runner config
  - `tsconfig*`, `eslint*`, `prettier*`, `biome*`, test/build config
  - Python/Rust/Go/Docker equivalents where relevant
- Verification and automation:
  - `.github/workflows/**`, `.gitlab-ci.yml`, `.circleci/**`, Docker/devcontainer files
- Context/noise boundaries:
  - `.gitignore`, `.dockerignore`, generated file locations, build outputs, vendored dirs
- Env and safety:
  - `.env.example`, docs for secrets/config, script files that execute shell, migration/codegen docs

If a relevant file is absent, state absence as evidence only after confirming the stack makes it relevant.

## Phase 3 — Audit checklist

### 1. Agent instruction quality

Check whether repo-specific instructions are:

- discoverable at the repo root or relevant subtrees,
- concise enough to be loaded and followed,
- specific about stack, commands, conventions, migration rules, and source-of-truth behavior,
- clear about what not to edit, generated files, secrets, external services, and risky scripts,
- consistent with README, CI, and package scripts,
- free of stale, contradictory, or overly broad instructions,
- useful for both default agents and specialized subagents.

Strong recommendations usually include:

- a root `AGENTS.md` with repo-specific operating defaults,
- subtree `AGENTS.md` only where rules genuinely differ,
- explicit verification commands and when to run them,
- safety notes for secrets, migrations, production data, and generated artifacts,
- guidance on high-value docs/files to read first.

### 2. Command discoverability and verification loops

Check:

- Are setup, dev, lint, test, typecheck, build, and format commands documented?
- Do local scripts match CI commands?
- Are there fast scoped checks for common edits, not only full slow suites?
- Are failure-prone or noisy commands documented with expected output/log locations?
- Are package/workspace-specific commands easy to target?
- Can an agent verify a small change without guessing?

Prefer fixes like documenting existing commands before adding new tooling.

### 3. Repo navigation and context compression

Check:

- Can an agent quickly identify the app/library boundaries, key entry points, and data flow?
- Are source, tests, docs, generated files, and scripts organized predictably?
- Do package/module READMEs or docs explain non-obvious domains?
- Are API schemas, route maps, migration docs, or architecture diagrams present when the codebase is large enough to need them?
- Are naming conventions and generated-code locations documented?

Recommend lightweight maps before heavyweight docs.

### 4. Context/noise management

Check:

- Are generated, build, coverage, vendor, cache, and dependency directories ignored or clearly marked?
- Are large binary/generated files tracked intentionally?
- Are formatter/linter/test tools excluding generated files where appropriate?
- Are irrelevant directories likely to pollute `rg`, file listings, or agent context?
- Are package manager artifacts and lockfiles intentional and consistent?

This overlaps with repo hygiene; focus on agent context impact.

### 5. Safe automation and trust boundaries

Check:

- Are secrets documented via examples/placeholders rather than committed values?
- Are risky scripts, migrations, production commands, or destructive tasks clearly labeled?
- Are web/external content, LLM outputs, generated code, and tool outputs treated as untrusted where relevant?
- Are environment requirements and external services documented enough to avoid accidental production use?
- Are path/shell injection risks in helper scripts obvious enough to warrant a note?

If you discover an urgent safety issue such as a tracked secret, mark it `P0` but do not print the secret.

### 6. Subagent and handoff readiness

Check:

- Can independent agents work on separate packages, features, tests, or docs with minimal overlap?
- Are subsystem boundaries and ownership/seams visible?
- Are commands available for isolated verification per package or feature?
- Are there conventions for plans, review requests, ADRs/decisions, or long-running task handoffs?
- Are project-local skills/subagents useful and trustworthy, if present?

Recommend subagent workflows only for repos/tasks large enough to benefit.

### 7. Harness/tool interoperability

Check:

- Do repo instructions use broadly compatible conventions where possible (`AGENTS.md`, standard scripts, markdown docs)?
- Are Pi-specific assets in `.pi/` useful without making the repo unusable for other agents?
- Are Claude/Codex/Cursor/Aider-specific files consistent if present?
- Are local-only settings separated from shared project guidance?

Avoid recommending every tool-specific config; prefer one clear source of truth.

### 8. CI and regression safety

Check:

- Does CI run the critical checks agents should run locally?
- Are flaky/slow checks documented?
- Are tests discoverable near the code they cover?
- Is there a clear path to add regression coverage for bug fixes?
- Are generated snapshots/fixtures documented if common?

### 9. Agentic scorecard

Optionally summarize the repo across these dimensions using `strong`, `adequate`, `weak`, or `missing`:

- Instructions
- Command discovery
- Verification speed
- Navigation/context
- Noise control
- Safety guardrails
- Subagent readiness
- CI alignment

Scores must be justified by findings; avoid false precision.

## Phase 4 — Rank findings

Each finding should have:

- **ID**: `A1`, `A2`, etc.
- **Priority**: `P0` urgent safety, `P1` high leverage, `P2` useful, `P3` optional/nice-to-have.
- **Agentic impact**: how it improves agent speed, safety, accuracy, or verification.
- **Confidence**: high / medium / low.
- **Effort**: S / M / L.
- **Risk**: low / medium / high.
- **Evidence**: path(s), missing files, or concise command evidence.
- **Proposed fix**: specific change, not vague advice.
- **Validation**: command or manual check after implementation.

Use `P0` sparingly and never expose secrets.

## Phase 5 — Output format

After writing the audit report, prefer the generic `user_choice` tool when it is available. Call it only after the findings and proposed plan are visible. Do **not** include a `Next steps / confirmation needed` section in the report when using the interactive picker.

Use this picker shape:

- Title: `Agentic readiness — next action`
- Message: `No files have been changed. Choose what to do with this remediation plan.`
- `implement_all` — label `Implement the full remediation plan`; description `Apply every proposed readiness improvement.`
- `implement_selected` — label `Choose items to implement (type IDs)`; description `Examples: a1-3 a5`; required text input placeholder `a1-3 a5`.
- `revise_plan` — label `Revise the plan first (type request)`; description `Describe what to reorder, remove, or change.`; required text input placeholder `e.g. skip CI and focus docs only`.
- `reject` — label `Do not make changes`; description `End the audit without implementation.`

Leave `includeOther` unset unless the user explicitly wants to opt out; `user_choice` adds a `Something else (type)` option by default. If `user_choice` is unavailable, cancelled, or running without interactive UI, ask for a concise text reply after the report instead. Treat a `user_choice` result exactly like user approval text; do not edit before it requests implementation.

Use this structure:

```markdown
## Agentic readiness audit

### Scope inspected
- Repo root:
- Stack/tooling:
- Key files read:
- Commands run:

### Summary
- 2–4 bullets with the highest-signal state of agentic readiness.

### Scorecard
| Dimension | Rating | Evidence |
| --- | --- | --- |
| Instructions | strong/adequate/weak/missing | `path` / command |
| Command discovery | ... | ... |
| Verification speed | ... | ... |
| Navigation/context | ... | ... |
| Noise control | ... | ... |
| Safety guardrails | ... | ... |
| Subagent readiness | ... | ... |
| CI alignment | ... | ... |

### Findings
| ID | Priority | Finding | Agentic impact | Evidence | Proposed fix | Effort | Risk | Confidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | P1 | ... | ... | `path` / command | ... | S | low | high |

### Proposed remediation plan
1. **A1 — title**
   - Change:
   - Why now:
   - Validation:
2. ...

### Not recommended / deferred
- Items considered but not recommended, with a brief reason.

```

For non-interactive fallback only, ask one concise text question after the report: `Reply 1 to implement all, 2 a1-3 to implement selected items, 3 ... to revise, or 4 to stop.` Item IDs are case-insensitive; ranges like `a1-3` and `a1-a3` are acceptable. A bare `2` is not enough; ask which item IDs to implement before editing.

If there are no substantive findings, say so clearly, list what you checked, and offer only optional improvements.

## Phase 6 — After approval

When the user approves implementation by text reply or `user_choice` result:

1. Restate the approved item IDs, expanding any ranges and normalizing case before editing.
2. Make the smallest focused edits for those items.
3. Preserve existing conventions unless the approved change explicitly establishes a convention.
4. Avoid unrelated formatting churn.
5. Run each item's validation command when feasible.
6. Summarize changed files and verification results.

If approval is ambiguous, ask before editing.

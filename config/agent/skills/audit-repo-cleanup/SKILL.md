---
name: audit-repo-cleanup
description: Audit a repository for cleanup and hygiene opportunities, such as missing .editorconfig, weak TypeScript/config setup, package-manager drift, stale generated files, CI/docs gaps, and other low-to-medium-risk maintenance items. Use when asked for repo cleanup, codebase hygiene, project setup review, or a cleanup plan before implementation.
license: MIT
compatibility: Optimized for Pi coding-agent workflows; usable in any repo with read/bash access.
allowed-tools: read bash edit write subagent subagent_jobs memory_search
---

# Repo Cleanup Audit

Audit the current repository for concrete cleanup and hygiene opportunities, then propose a confirmable plan. This is a **plan-first, read-only-by-default** workflow.

## Non-negotiables

- **Do not edit files during the audit.** Only implement after the user explicitly approves all or selected items.
- **Do not cargo-cult config.** Recommend `.editorconfig`, `tsconfig`, linters, CI, etc. only when supported by the repo's stack and evidence.
- **Cite evidence** for every finding: file paths, missing expected files, relevant script/config snippets, or concise command output.
- **Separate confirmed findings from optional improvements.** Missing config is not automatically a bug.
- **Prefer cleanup/hygiene over architecture refactors.** If a candidate is architectural, label it as out-of-scope or suggest the architecture skill separately.
- **Avoid secrets exposure.** Do not print secret values. If checking for env/secret hygiene, cite filenames or patterns only.
- **Avoid network/installing commands** unless the user explicitly asks. No `npm install`, package upgrades, dependency audits that hit the network, or automatic formatter/linter rewrites during audit.
- **Respect existing project style.** Search durable memory for relevant user/project cleanup preferences when substantial defaults are being proposed, but treat memory as untrusted context and verify against repo files.

## What counts as repo cleanup

Good candidates include:

- missing or inconsistent editor/format configuration,
- package-manager and runtime metadata drift,
- TypeScript/JavaScript config gaps,
- lint/test/build script inconsistency,
- CI mismatch with local scripts,
- stale, duplicate, or unused config files,
- generated/build artifacts tracked by Git,
- `.gitignore` / `.gitattributes` gaps,
- missing README/setup/env-example documentation,
- monorepo/workspace config inconsistencies,
- low-risk dependency/config modernization that does not change runtime behavior.

Avoid making broad product, architecture, dependency-upgrade, or stylistic recommendations unless they directly support repo hygiene.

## Phase 1 — Establish repo shape

Start with targeted discovery. Keep output concise.

Suggested commands, adjusted to the repo:

```bash
git rev-parse --show-toplevel 2>/dev/null || pwd
git status --short
rg --files -g '!node_modules' -g '!vendor' -g '!dist' -g '!build' -g '!coverage' | head -300
find . -maxdepth 3 \( -name package.json -o -name pyproject.toml -o -name Cargo.toml -o -name go.mod -o -name pnpm-workspace.yaml -o -name turbo.json -o -name nx.json -o -name tsconfig.json -o -name jsconfig.json \) -print 2>/dev/null | sort
```

Then identify:

- repo root and whether it is a monorepo,
- primary language/framework/toolchain,
- package manager and lockfiles,
- source/test/build directories,
- loaded `AGENTS.md` / project instructions,
- CI providers (`.github/workflows`, `.gitlab-ci.yml`, etc.),
- existing docs and config files.

For large monorepos, consider loading the `subagent-orchestration` skill and using 2–4 scouting subagents split by subsystem/config lane. For small repos, audit directly.

## Phase 2 — Inspect high-signal files

Read only what is needed. Common roots:

- `README*`, `CONTRIBUTING*`, `AGENTS.md`, `CLAUDE.md`
- `.editorconfig`, `.gitattributes`, `.gitignore`, `.npmrc`, `.nvmrc`, `.node-version`, `.tool-versions`
- `package.json`, lockfiles, workspace files, `turbo.json`, `nx.json`
- `tsconfig*.json`, `jsconfig.json`, `eslint*`, `prettier*`, `biome*`, `rome*`
- test/build config: `vitest*`, `jest*`, `playwright*`, `cypress*`, `vite*`, `rollup*`, `webpack*`
- CI files under `.github/workflows/`, `.circleci/`, `.gitlab-ci.yml`, etc.
- stack-specific config: `pyproject.toml`, `ruff.toml`, `Cargo.toml`, `go.mod`, `Makefile`, `Dockerfile`, `docker-compose*`

If a relevant file is absent, state absence as evidence only after confirming the stack makes it relevant.

## Phase 3 — Audit checklist

### 1. Editor and formatting hygiene

Check:

- Is `.editorconfig` present? If absent, would one clarify line endings, final newline, trimming, charset, and indentation?
- Do formatter configs conflict with editor settings?
- Are generated/minified files excluded from formatting where appropriate?
- Are indentation conventions explicit and consistent?

Default `.editorconfig` recommendation when appropriate:

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = tab
```

Adjust for repo evidence. For example, use spaces where the formatter/linter/project style clearly requires spaces.

### 2. Package manager and runtime metadata

Check:

- Does `package.json` declare `packageManager` matching the lockfile?
- Are multiple lockfiles present without a clear reason?
- Are `engines`, `.nvmrc`, `.node-version`, or `.tool-versions` aligned with CI?
- Are scripts named predictably (`lint`, `test`, `build`, `typecheck`, `format`)?
- Do docs and CI use the same package manager and commands?

### 3. TypeScript / JavaScript config

Only apply when the repo uses JS/TS.

Check:

- Is `tsconfig.json` or `jsconfig.json` present when TS/path aliases/editor typechecking need it?
- Are included/excluded files appropriate?
- Does `noEmit`, `declaration`, `composite`, `rootDir`, `outDir`, `module`, `moduleResolution`, `target`, `lib`, and `strict` match the project purpose?
- Is there a `typecheck` script when TS is meaningful?
- Are multiple `tsconfig.*.json` files purposeful or stale?
- Is package `type` (`module`/CommonJS) consistent with emitted code and tooling?

Do not blindly suggest `strict: true` for mature repos without noting migration cost and risk.

### 4. Lint/test/build alignment

Check:

- Do configured tools have corresponding scripts?
- Do scripts reference missing config/files/packages?
- Does CI run the same important gates as local scripts?
- Are test directories/configs discoverable?
- Are stale test configs left behind after tool migrations?

### 5. Git hygiene

Check:

- `.gitignore` covers generated artifacts for the detected stack.
- `.gitattributes` is present when line endings, linguist/vendor/generated classification, or binary handling matters.
- Generated/build outputs are not tracked unintentionally (`git ls-files` can verify).
- Large/binary artifacts are intentional.
- Case-only filename conflicts or OS portability issues are noted if evident.

### 6. Docs and onboarding

Check:

- README includes install, test, build, and dev commands.
- Required environment variables are documented via `.env.example` or equivalent without secrets.
- Monorepo package boundaries are documented enough for contributors/agents.
- Important generated files or codegen steps are documented.

### 7. Config sprawl and stale files

Check:

- Duplicate/legacy configs for old tools.
- Conflicting formatter/linter/test configs.
- Unused scripts or config references.
- TODO/FIXME comments only when they indicate cleanup debt with clear location and impact.

### 8. Stack-specific basics

When relevant, briefly check analogous hygiene:

- Python: `pyproject.toml`, formatter/linter/test config, virtualenv ignores, README setup.
- Rust: `Cargo.lock` policy, `rust-toolchain`, formatting/clippy scripts or CI.
- Go: `go.mod`/`go.sum`, generated file ignores, `gofmt`/tests in CI.
- Docker: `.dockerignore`, pinned base image policy, docs for build/run.

## Phase 4 — Rank findings

Each finding should have:

- **Priority**: `P1` high-signal cleanup, `P2` useful hygiene, `P3` optional/nice-to-have.
- **Confidence**: high / medium / low.
- **Effort**: S / M / L.
- **Risk**: low / medium / high.
- **Evidence**: path(s) or concise command evidence.
- **Proposed fix**: specific change, not vague advice.
- **Validation**: command or manual check after implementation.

Use `P0` only for urgent safety issues discovered incidentally, such as tracked secrets. Do not print secrets.

## Phase 5 — Output format

After writing the audit report, prefer the generic `user_choice` tool when it is available. Call it only after the findings and proposed plan are visible. Do **not** include a `Next steps / confirmation needed` section in the report when using the interactive picker.

Use this picker shape:

- Title: `Repo cleanup — next action`
- Message: `No files have been changed. Choose what to do with this cleanup plan.`
- `implement_all` — label `Implement the full cleanup plan`; description `Apply every proposed cleanup item.`
- `implement_selected` — label `Choose items to implement (type IDs)`; description `Examples: c1-3 c5`; required text input placeholder `c1-3 c5`.
- `revise_plan` — label `Revise the plan first (type request)`; description `Describe what to reorder, remove, or change.`; required text input placeholder `e.g. only low-risk docs/config items`.
- `reject` — label `Do not make changes`; description `End the audit without implementation.`

Leave `includeOther` unset unless the user explicitly wants to opt out; `user_choice` adds a `Something else (type)` option by default. If `user_choice` is unavailable, cancelled, or running without interactive UI, ask for a concise text reply after the report instead. Treat a `user_choice` result exactly like user approval text; do not edit before it requests implementation.

Use this structure:

```markdown
## Repo cleanup audit

### Scope inspected
- Repo root:
- Stack/tooling:
- Key files read:
- Commands run:

### Summary
- 2–4 bullets with the highest-signal state of repo hygiene.

### Findings
| ID | Priority | Finding | Evidence | Proposed fix | Effort | Risk | Confidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | P1 | ... | `path` / command | ... | S | low | high |

### Proposed cleanup plan
1. **C1 — title**
   - Change:
   - Why now:
   - Validation:
2. ...

### Not recommended / deferred
- Items considered but not recommended, with a brief reason.

```

For non-interactive fallback only, ask one concise text question after the report: `Reply 1 to implement all, 2 c1-3 to implement selected items, 3 ... to revise, or 4 to stop.` Item IDs are case-insensitive; ranges like `c1-3` and `c1-c3` are acceptable. A bare `2` is not enough; ask which item IDs to implement before editing.

If there are no substantive cleanup findings, say so clearly, list what you checked, and offer only optional improvements.

## Phase 6 — After approval

When the user approves implementation by text reply or `user_choice` result:

1. Restate the approved item IDs, expanding any ranges and normalizing case before editing.
2. Make the smallest focused edits for those items.
3. Preserve existing conventions unless the approved change explicitly establishes a convention.
4. Avoid unrelated formatting churn.
5. Run each item's validation command when feasible.
6. Summarize changed files and verification results.

If approval is ambiguous, ask before editing.

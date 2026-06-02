---
name: github-pr-review
description: Review a GitHub pull request from a PR link. Use when the user gives a GitHub PR URL and wants an evidence-backed review for bugs, regressions, missing tests, risk areas, and author-facing feedback.
compatibility: Optimized for pi subagents and openai-codex/gpt-5.5; works serially with gh CLI or a pasted diff.
allowed-tools: read bash subagent subagent_jobs
---

# GitHub PR Review

Review a GitHub pull request from a link and produce actionable review findings, regression risks, testing recommendations, and author-facing comments.

Default posture: **read-only, evidence-backed, no GitHub comments posted unless explicitly requested and confirmed.**

## When to use

Use when the user provides a GitHub PR link and asks for:

- PR review,
- regression analysis,
- “what should I test?”,
- possible issues to point out to the PR author,
- review comments or questions for the author.

Do not use for general codebase architecture reviews unless the task is specifically PR-focused.

## Read these references

Before reviewing, read:

- [GH-COMMANDS.md](GH-COMMANDS.md) for safe GitHub/`gh` commands.
- [REVIEW-CHECKLIST.md](REVIEW-CHECKLIST.md) for issue categories.
- [OUTPUT-FORMAT.md](OUTPUT-FORMAT.md) for the final response structure.

Read [PROMPTS.md](PROMPTS.md) when delegating to pi subagents.

## Non-negotiables

- Do not post PR comments, approve, request changes, merge, push, or modify the branch unless the user explicitly asks.
- Separate confirmed issues from risks, questions, and testing suggestions.
- Cite files and line numbers where possible.
- Review the PR intent from the title/body before judging implementation.
- Read enough surrounding code to avoid diff-only false positives.
- For every issue, explain the user-visible or maintainer-visible impact.
- Prefer a few high-signal findings over a long list of speculative nitpicks.
- If you cannot access the PR, ask for authentication, repo access, or a pasted diff.

## GPT-5.5 operating discipline

GPT-5.5 is strong at pattern matching and synthesis, but can overstate uncertain regressions. Use this discipline:

1. **Facts first**: PR metadata, changed files, diff, tests, surrounding code.
2. **Intent second**: what the PR claims to do.
3. **Risk model third**: how the change could break existing behavior.
4. **Findings last**: only confirmed or well-supported issues.

Use confidence labels:

- **Confirmed** — code evidence shows the issue.
- **Likely** — strong evidence, but execution or domain confirmation would help.
- **Possible** — plausible risk; present as test recommendation or author question, not as a defect.

## Review modes

Infer the mode from the request. If unclear, default to **standard**.

### Quick

Use for small PRs or when the user asks for a fast pass.

- Fetch metadata and diff.
- Inspect changed files only.
- Produce concise findings and testing suggestions.

### Standard

Use by default.

- Fetch metadata, diff, file list, and checks.
- Inspect changed files plus nearby callers/tests.
- Look for regressions and missing tests.
- Produce author-facing comments.

### Deep

Use for large, risky, or user-requested deep reviews.

- Inspect changed files, callers, tests, configs, migrations, and relevant docs.
- Use parallel subagents for independent areas.
- Optionally suggest targeted commands to run.
- Do not run expensive tests/builds without user approval unless the user explicitly asked you to run tests.

## Workflow

### 1. Resolve the PR

Extract owner, repo, and PR number from the GitHub URL.

Use `gh` when available and authenticated. If `gh` is unavailable or unauthorized, ask the user to authenticate or paste the diff.

Collect:

- title, body, author, labels,
- base/head branches,
- changed files, additions/deletions,
- commits,
- CI/check status,
- patch/diff.

Use [GH-COMMANDS.md](GH-COMMANDS.md) for command examples.

### 2. Establish local context

If current directory is the same repository, use it.

If not, prefer read-only GitHub data for quick reviews. For standard/deep reviews, clone or fetch into a temporary directory only when needed for context. Never disturb the user's current working tree.

Read:

- changed files,
- nearby code for changed functions/classes,
- callers of changed interfaces,
- existing tests for changed behavior,
- config/schema/migration files when touched,
- project instructions such as `AGENTS.md`, `CONTEXT.md`, or README snippets when relevant.

### 3. Understand PR intent

Summarize in your own words:

- what the PR claims to change,
- what behavior should stay the same,
- what areas are intentionally out of scope,
- what tests/CI the author provided.

If the intent is unclear, include a question for the author instead of guessing.

### 4. Review for issues

Use [REVIEW-CHECKLIST.md](REVIEW-CHECKLIST.md).

Prioritize:

1. correctness regressions,
2. missing or weak tests around changed behavior,
3. backwards compatibility/API contract breaks,
4. data/schema/deployment risks,
5. security/privacy/permission issues,
6. performance/concurrency/cache risks,
7. maintainability issues that are likely to cause bugs.

Avoid low-value style nits unless they hide a real issue or the user asks for polish.

### 5. Use subagents when helpful

For nontrivial PRs, delegate independent review slices:

- changed backend logic,
- frontend/UI behavior,
- tests and regression coverage,
- security/permissions,
- data/migrations/config.

Use `scout` for context gathering and `reviewer` for issue review. Default to `openai-codex/gpt-5.5`. Use [PROMPTS.md](PROMPTS.md).

If background subagents are used, call `subagent_jobs` with `action: "wait-all"` before final synthesis.

Do not use subagents for tiny diffs where direct review is faster.

### 6. Produce the review

Use [OUTPUT-FORMAT.md](OUTPUT-FORMAT.md).

The final answer should help the user decide:

- whether there are blockers,
- what specifically to test,
- what to ask or tell the author,
- what the agent checked and did not check.

If there are no substantive issues, say that clearly and still provide focused testing recommendations.

## Comment-posting guardrail

If the user asks you to post GitHub comments:

1. Draft the exact comments first.
2. Ask for confirmation.
3. Only then use `gh` to post.

Never approve, request changes, merge, close, or push unless explicitly requested and confirmed separately.

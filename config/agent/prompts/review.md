---
description: Code review the current diff with high-signal pre-landing checks
argument-hint: "[optional: base branch, PR URL, or path]"
---

# Pre-Landing Review

## Target

<target> #$ARGUMENTS </target>

Default to the current working tree/branch diff. If a PR URL is provided, prefer the `github-pr-review` skill.

## Rules

- Read-only unless the user explicitly asks for fixes.
- Prioritize bugs, security/privacy, data safety, rollout risk, UX breakage, performance, and maintainability that can cause future bugs.
- Skip style-only nits.
- Cite concrete file paths and line numbers where possible.
- Read enough surrounding code to avoid diff-only false positives.
- Separate confirmed issues from risks and test recommendations.

## Workflow

### 1. Establish the diff

Use the best available target:

- PR URL / number: use `gh pr view` and `gh pr diff` when available.
- Branch/base: use `git diff <base>...HEAD`.
- Empty/current: inspect `git diff HEAD`, `git diff --cached`, then `git diff main...HEAD` or `master...HEAD` if needed.
- Path: review that file/spec directly.

Also read:

- changed files around the modified symbols,
- callers/consumers of changed interfaces,
- nearby tests,
- migrations/config/docs when touched.

### 2. Run the critical pass first

Look specifically for:

- **SQL/data safety:** raw SQL interpolation, unsafe migrations, data loss, missing backfills, nullable/non-nullable drift.
- **Race/concurrency:** read-check-write, non-atomic state transitions, duplicate creation without unique constraints.
- **LLM/tool trust boundaries:** LLM output written/fetched/rendered without validation, SSRF from generated URLs, stored prompt injection.
- **Shell/path injection:** interpolated subprocess commands, `shell=True`, unsafe file paths.
- **Enum/value completeness:** new statuses/types/tiers not handled by all consumers, allowlists, switch/case defaults, UI labels, persistence, tests.
- **Auth/privacy:** missing authz, IDOR, leaked secrets/PII in logs/errors/responses.

### 3. Run the secondary pass

Look for:

- missing negative-path/edge-case tests,
- API contract and backward compatibility breaks,
- deployment/rollback hazards,
- unbounded queries/loops/N+1s/cache invalidation,
- frontend loading/error/empty/focus/responsive regressions,
- stale docs/comments/ASCII diagrams,
- duplicated business rules or hidden coupling.

### 4. Output

```markdown
## Files Reviewed
- path:line-line — why it was read

## Critical
- [Confirmed|Likely] path:line — issue
  Impact: user/maintainer-visible impact
  Fix: concrete recommendation

## Warnings
- ...

## Test Recommendations
- specific tests or manual flows to run

## Summary
2-4 sentences on merge readiness.
```

If there are no substantive findings, say so clearly and still list focused tests worth running.

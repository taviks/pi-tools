# PR Review Checklist

Use this as a risk checklist. Do not mechanically report every item. Report only issues supported by the PR diff, surrounding code, tests, or project context.

## Highest-signal pre-landing checks

Run these before lower-severity review passes:

- **SQL/data safety:** raw SQL interpolation, unsafe migrations, data loss, missing backfills, nullable/non-nullable drift, code expecting schema before deploy.
- **Race/concurrency:** read-check-write without uniqueness/atomic update, non-atomic state transitions, duplicate creation hazards, idempotency gaps.
- **LLM/tool trust boundaries:** LLM output written/fetched/rendered without validation, generated URLs fetched without allowlists, stored prompt injection, tool output accepted without type/shape checks.
- **Shell/path injection:** interpolated subprocess commands, `shell=True`, unsafe path construction, file operations on user-controlled paths.
- **Enum/value completeness:** new statuses/types/tiers handled by every consumer, allowlist, switch/case/default, UI label, persistence path, and test.
- **Auth/privacy:** object-level authorization, leaked secrets/PII, overbroad scopes, sensitive data in logs/errors/responses.

## Correctness and regressions

Look for:

- changed behavior not mentioned in the PR description,
- edge cases around null/undefined/empty values,
- off-by-one and boundary conditions,
- changed ordering or lifecycle assumptions,
- error handling changes,
- swallowed errors or newly thrown errors,
- retries/idempotency changes,
- state transitions that can now be skipped or repeated,
- timezone/date/currency/locale assumptions,
- behavior differences between create/update/delete paths.

Ask: “What existing user flow or caller could this break?”

## Tests and coverage

Look for:

- no tests for changed behavior,
- tests that only cover the happy path,
- snapshot-only coverage for logic changes,
- mocks that duplicate implementation assumptions,
- missing regression tests for bug fixes,
- deleted tests without equivalent coverage,
- changed public behavior without caller/integration tests.

Recommend specific tests:

- unit tests for pure policy/edge cases,
- integration tests for module interactions,
- E2E/manual tests for user flows,
- migration/rollback tests for data changes,
- permission tests for auth-sensitive changes.

## API and compatibility

Look for:

- request/response shape changes,
- renamed fields or changed defaults,
- changed validation rules,
- changed status codes/error formats,
- removed exports or altered function signatures,
- caller assumptions not updated,
- versioning or migration concerns,
- feature flags missing for risky behavior changes.

Ask whether existing clients or saved data will still work.

## Data, schema, and deployment

Look for:

- migrations that are not backwards compatible,
- code expecting new columns before migration runs,
- migrations that lock large tables,
- backfill requirements,
- nullable/non-nullable mismatches,
- data loss or irreversible transformations,
- config/env vars added without defaults or docs,
- rollout/rollback hazards,
- queue/job payload compatibility.

## Security, privacy, and permissions

Look for:

- missing authorization checks,
- object-level access control regressions,
- trusting client-provided IDs or roles,
- leaking sensitive data in logs/errors/responses,
- insecure redirect/file/path handling,
- SSRF/path traversal/injection risks,
- CORS/cookie/session changes,
- secrets in code or tests,
- overly broad scopes or permissions.

For security findings, be precise and avoid exaggeration.

## Performance, scalability, and reliability

Look for:

- new N+1 queries,
- unbounded loops or data loads,
- synchronous work in hot paths,
- cache invalidation mistakes,
- contention/race conditions,
- missing cancellation/timeouts,
- retry storms,
- expensive renders or re-renders,
- memory growth from retained state/listeners.

## Frontend and UX

Look for:

- loading/error/empty states,
- stale state after mutation,
- optimistic update rollback,
- route/query-param regressions,
- accessibility regressions,
- keyboard/focus behavior,
- responsive/mobile issues,
- localization/copy impacts,
- form validation differences,
- telemetry/analytics changes when relevant.

## Backend and integrations

Look for:

- transaction boundaries,
- idempotency for webhooks/jobs,
- duplicate event handling,
- partial failure handling,
- compatibility with existing messages/events,
- third-party API assumptions,
- rate limiting and timeout behavior,
- observability for new failure modes.

## Maintainability that matters

Only report maintainability issues when they increase bug risk or review burden:

- duplicated business rules,
- unclear ownership of state or data,
- overly broad abstractions,
- hidden coupling between modules,
- tests that encode internals,
- names that obscure changed domain behavior.

Avoid style-only comments unless asked.

## Severity guidance

### Blocking / should request changes

- confirmed correctness bug,
- likely regression in important flow,
- security/privacy issue,
- data loss or unsafe migration,
- missing test for high-risk behavior,
- CI failure caused by PR.

### Non-blocking / comment

- plausible edge case with moderate impact,
- missing test for moderate-risk logic,
- confusing implementation likely to cause mistakes,
- author question needed to confirm intent.

### Mention as testing recommendation

- possible issue without enough evidence,
- environment/browser/device-specific risk,
- integration behavior you cannot verify locally.

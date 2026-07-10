# Pi Subagent Prompts

Use these when a PR is large enough that independent slices are worth delegating.

Default model: `openai-codex/gpt-5.6-sol` unless the user requests otherwise.

## Scout — changed-area context

```text
Gather context for a GitHub PR review.

PR intent:
<summary>

Changed files in scope:
<files>

Task:
- Read the changed files and nearby code.
- Identify key modules/functions/types changed.
- Trace important callers and tests.
- Note behavior that existed before and may be affected.
- Do not edit files.
- Do not produce final review comments unless you find concrete evidence.

Return:
## Files inspected
- path:line-range — what you learned

## Important context
- changed symbols, callers, tests, configs

## Possible regression surfaces
- behavior/flow — why it might be affected

## Start here
- most important file/function for the reviewer
```

## Reviewer — correctness/regression pass

```text
Review this PR slice for correctness bugs and regressions.

PR intent:
<summary>

Diff/context:
<diff or file list and scout findings>

Focus on:
- behavior changes not described by the PR
- edge cases
- caller compatibility
- error handling
- state/order/lifecycle assumptions
- tests that should exist

Do not edit files. Do not run builds. Do not post comments.

Return:
## Confirmed issues
- path:line — impact, evidence, suggested fix

## Likely issues
- path:line — impact, evidence, what would confirm

## Regression risks to test
- specific scenario and expected behavior

## Author questions
- concise questions for unclear intent
```

## Reviewer — tests/coverage pass

```text
Review this PR for test coverage and regression protection.

PR intent:
<summary>

Changed files/tests:
<files>

Focus on:
- missing tests for changed behavior
- tests that only cover happy paths
- snapshot-only coverage where logic changed
- deleted tests without replacement coverage
- integration or manual tests needed

Do not edit files.

Return:
## Missing or weak tests
- behavior — why coverage is insufficient

## Specific tests to request
- test scenario, setup, assertion

## Existing tests inspected
- path — what they cover

## Manual testing recommendations
- flow and expected result
```

## Reviewer — security/permissions pass

```text
Review this PR slice for security, privacy, and permission regressions.

PR intent:
<summary>

Changed files:
<files>

Focus on:
- authorization and object-level access control
- sensitive data exposure
- trusting client input
- injection/path/redirect/file handling
- auth/session/cookie/CORS behavior
- secrets or unsafe logging

Do not edit files. Be precise; do not exaggerate.

Return:
## Security findings
- path:line — issue, impact, evidence, suggested fix, confidence

## Security questions
- what needs author confirmation

## Security tests to request
- specific scenario
```

## Reviewer — data/migration/deployment pass

```text
Review this PR slice for data, schema, migration, config, and deployment risks.

PR intent:
<summary>

Changed files:
<files>

Focus on:
- backwards-compatible migrations
- nullable/default assumptions
- rollout/rollback order
- env/config changes
- queue/job payload compatibility
- backfills and data loss
- CI/check failures related to deployment

Do not edit files.

Return:
## Deployment/data findings
- path:line — issue, impact, evidence, suggested fix

## Rollout/rollback risks
- risk and mitigation

## Tests/checks to request
- specific scenario or command
```

## Synthesis prompt

After subagents return, synthesize with this instruction:

```text
Merge these PR review findings.

Rules:
- Deduplicate overlapping findings.
- Promote only evidence-backed issues to Findings.
- Put speculative items under Regression risks to test or Questions for the author.
- Keep author-facing comments respectful and actionable.
- Include What I checked and What I did not verify.
- Do not claim tests were run unless they were run.
```

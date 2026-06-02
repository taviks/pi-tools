# Examples

## User asks for a normal review

User:

```text
Can you review this PR? https://github.com/acme/app/pull/123
```

Expected behavior:

1. Load this skill.
2. Fetch PR metadata/diff/checks with `gh`.
3. Inspect changed files and surrounding code.
4. Report blockers, non-blockers, regression risks, tests to request, and suggested author comments.
5. Do not post anything to GitHub.

## User asks what to test

User:

```text
What should I test for this PR? https://github.com/acme/app/pull/123
```

Expected behavior:

- Focus on regression surfaces and manual/automated test scenarios.
- Include only critical findings if found.
- Output concrete scenarios with expected results.

## User asks to comment on the PR

User:

```text
Please comment on the PR with your findings.
```

Expected behavior:

1. Draft exact comment body.
2. Ask for confirmation.
3. Post only after explicit confirmation.
4. Do not approve/request changes/merge unless separately requested.

## Example author-facing comments

### Missing regression test

```md
Could we add a regression test for the case where `<condition>`? The new path changes `<behavior>`, and I think this is the scenario most likely to regress because `<reason>`.
```

### Possible compatibility issue

```md
Is this response shape consumed by any older clients? It looks like `<field>` is now omitted when `<condition>`, whereas the previous implementation returned `<old behavior>`. If that's intentional, can we document that expectation or cover it with a test?
```

### Deployment risk

```md
This migration looks like it may require the new column before all app instances are running the new code. Could we make the rollout order safe by adding a default/backward-compatible read path first?
```

### Security/permissions

```md
Should this path also verify ownership of `<resource>`? The new lookup accepts `<id>` from the request, and I don't see an object-level authorization check before returning `<data>`.
```

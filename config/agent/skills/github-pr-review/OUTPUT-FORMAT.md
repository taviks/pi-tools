# Output Format

Use this structure for the final PR review. Keep it concise but specific.

## Standard output

```md
## PR Review Summary

- **PR**: <title/link>
- **Scope**: <short summary of changed areas>
- **Overall read**: <No blockers / Has issues / Needs more context>
- **Confidence**: <High/Medium/Low and why>

## Findings

### Blocking / should fix

1. **<issue title>** — `path/to/file.ext:line`
   - **Confidence**: Confirmed/Likely
   - **Why it matters**: <impact>
   - **Evidence**: <what in the diff/context shows it>
   - **Suggested fix**: <specific direction>
   - **Author-facing comment**:
     > <copy-pasteable comment>

### Non-blocking / consider

1. **<issue title>** — `path/to/file.ext:line`
   - **Why it matters**:
   - **Suggested fix or question**:

## Regression risks to test

- <specific flow or behavior> — why it is risky and how to test it.

## Specific tests I would ask for

- <test name/area>: <scenario and expected result>

## Questions for the author

- <question that clarifies intent or hidden constraints>

## Suggested comments to leave

1. `path/to/file.ext:line`
   > <polished PR comment>

## What I checked

- <metadata/diff/context/tests/callers inspected>

## What I did not verify

- <tests not run, environment not checked, assumptions>
```

## If there are no substantive issues

Use:

```md
## PR Review Summary

I did not find any blocking issues in the diff.

## Things I would still test

- <focused test/manual check>

## Minor questions or comments

- <optional, only if useful>

## What I checked

- <files/areas>

## What I did not verify

- <tests not run, environment not checked>
```

## Finding quality bar

A finding should include:

- exact location where possible,
- impact,
- evidence,
- fix direction,
- confidence.

Do not present a speculative risk as a confirmed bug. Move speculative items to “Regression risks to test” or “Questions for the author”.

## Author-facing comment style

Good comments are:

- specific,
- respectful,
- tied to behavior or maintainability impact,
- actionable,
- not overconfident when evidence is incomplete.

Prefer:

```md
Could this break existing saved filters where `sortBy` is omitted? It looks like the new default path now treats `undefined` as `createdAt`, while the previous code preserved the server default. If that's intentional, can we add a regression test for the omitted-`sortBy` case?
```

Avoid:

```md
This is wrong.
```

## Severity wording

Use:

- **Blocking / should fix** for issues the user should probably request changes on.
- **Non-blocking / consider** for useful but not release-blocking comments.
- **Regression risk to test** for plausible issues without enough evidence.
- **Question for author** when intent or constraints are unclear.

## Line numbers

Use `path:line` when available. If exact GitHub review line mapping is uncertain, cite the file and function/hunk instead of inventing a line number.

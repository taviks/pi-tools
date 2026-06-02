# ADR Format

ADRs record architectural decisions that future agents and developers should not re-litigate without understanding the trade-off.

Store ADRs in `docs/adr/`. Create the directory lazily when the first ADR is approved.

## When to offer an ADR

Offer an ADR only when all three are true:

1. The decision is hard or costly to reverse.
2. A future reader would be surprised without context.
3. There was a real trade-off between plausible alternatives.

Do not offer ADRs for temporary scheduling choices, obvious implementation details, or decisions that are easy to reverse.

## Good ADR subjects

- architectural shape,
- ownership of domain concepts,
- integration style between contexts,
- database, message bus, auth provider, deployment platform,
- deliberate deviation from the obvious path,
- constraints not visible in code,
- rejected alternatives likely to be suggested again.

## Numbering

Use sequential filenames:

```text
docs/adr/0001-short-slug.md
docs/adr/0002-another-decision.md
```

Before creating a new ADR, scan `docs/adr/` for the highest existing number and increment it.

## Minimal template

```md
# Short title of the decision

One to three sentences explaining the context, decision, and why it was chosen.
```

## Optional sections

Use optional sections only when they add real value:

```md
---
status: accepted
---

# Short title

Context, decision, and rationale.

## Considered options

- Option A — why rejected.
- Option B — why chosen.

## Consequences

- Important downstream effect.
```

Status values can be `proposed`, `accepted`, `deprecated`, or `superseded by ADR-NNNN`.

## Rejection-to-ADR prompt

When the user rejects a candidate for a durable reason, say:

```text
That sounds like a load-bearing architecture constraint. Want me to record it as an ADR so future architecture reviews do not re-suggest this refactor?
```

Only ask this when the reason would genuinely help a future reviewer.

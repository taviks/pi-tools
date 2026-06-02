# CONTEXT.md Format

`CONTEXT.md` records project domain language: the terms experts and developers should use when discussing the system.

Do not put general programming terms here. Add only concepts specific to the project's domain or product context.

## Single-context repo

Most repositories can use one root `CONTEXT.md`:

```md
# Project Context

One or two sentences describing this domain context.

## Language

**Order**:
A request by a Customer to purchase one or more Items.
_Avoid_: Purchase, transaction

**Customer**:
A person or organization that places Orders.
_Avoid_: Client, buyer

## Relationships

- A **Customer** places zero or more **Orders**.
- An **Order** contains one or more **Items**.

## Example dialogue

> **Dev:** “When does an **Order** become billable?”
> **Domain expert:** “After fulfillment confirms shipment.”

## Flagged ambiguities

- “account” previously referred to both **Customer** and **User**; use **Customer** for the buyer and **User** for an authenticated actor.
```

## Multi-context repo

Use a root `CONTEXT-MAP.md` when separate parts of the repo have different domain languages:

```md
# Context Map

## Contexts

- `src/ordering/CONTEXT.md` — **Ordering** receives and tracks Orders.
- `src/billing/CONTEXT.md` — **Billing** creates Invoices and records payments.

## Relationships

- **Ordering → Billing**: Ordering emits `OrderPlaced`; Billing consumes it to decide whether to create an Invoice.
```

Each context can then have its own `CONTEXT.md`.

## Rules for terms

- Pick one preferred word and list aliases to avoid.
- Keep definitions to one sentence when possible.
- Define what the thing is, not every behavior it performs.
- Show relationships and cardinality when obvious.
- Flag ambiguity explicitly instead of silently choosing a meaning.
- Use bold term names consistently.
- Do not add utility abstractions, framework concepts, or generic technical patterns.

## When to propose an update

Propose a `CONTEXT.md` update when:

- a deepened module needs a name for a domain concept not yet documented,
- the code uses several words for the same concept,
- user clarification sharpens a fuzzy concept,
- a candidate depends on a term whose meaning is not stable.

Ask before editing unless the user has already explicitly requested documentation updates.

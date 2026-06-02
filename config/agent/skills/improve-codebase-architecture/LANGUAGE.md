# Architecture Language

Use this vocabulary consistently when applying the skill. The point is to make architecture discussions precise and searchable.

Avoid drifting into vague terms such as “component”, “service”, “API”, or “boundary” when one of these terms is meant. If a project uses those words as domain terms, preserve the project meaning and clarify the architecture meaning separately.

## Terms

### Module

Anything with an **Interface** and an **Implementation**: a function, class, package, feature slice, endpoint group, job, or cross-tier workflow.

Use “module” as the scale-neutral term.

### Interface

Everything a caller must know to use a **Module** correctly.

This includes the type signature, but also:

- invariants,
- required ordering,
- error modes,
- configuration,
- authorization or ownership assumptions,
- performance expectations,
- lifecycle rules,
- idempotency or retry behavior.

Do not reduce “interface” to a TypeScript `interface`, method list, or public class surface.

### Implementation

The code and behavior hidden behind a **Module**'s **Interface**.

Use “implementation” when discussing what is inside the module. Use **Adapter** when discussing what concrete thing satisfies an interface at a **Seam**.

### Depth

The leverage a caller gets from a **Module**'s **Interface**.

A **deep** module gives callers substantial behavior while requiring little interface knowledge. A **shallow** module exposes nearly as much complexity as it hides.

Depth is not measured by lines of code. It is measured by how much behavior, policy, and correctness the caller gets per fact they must learn.

### Seam

The place where behavior can vary without editing the caller. A **Seam** is where an **Interface** lives.

Use “seam” when discussing where to place substitutability or variation. Avoid “boundary” unless discussing a project-specific bounded context or external system boundary.

### Adapter

A concrete thing that satisfies an **Interface** at a **Seam**.

Examples: an HTTP adapter, queue adapter, Postgres adapter, in-memory adapter, filesystem adapter, or test fake.

An adapter describes a role at a seam, not a layer or implementation size.

### Leverage

What callers gain from **Depth**: more useful behavior with fewer facts to learn and fewer duplicated policies.

Leverage shows up when many callers become simpler, safer, or more consistent after one module deepens.

### Locality

What maintainers gain from **Depth**: changes, bugs, tests, and knowledge concentrate in one place.

Locality shows up when one fix corrects behavior everywhere, and when tests can verify behavior through one stable interface.

## Principles

### The deletion test

Imagine deleting a suspected shallow module.

- If complexity disappears, the module was probably ceremony or a pass-through.
- If complexity reappears across many callers, the module was hiding useful complexity.
- If complexity concentrates into one deeper module, the deletion pointed toward a better shape.

Use this as a thinking tool, not a mechanical rule.

### The interface is the test surface

Callers and tests should cross the same **Seam**. If tests must reach inside a module, the module may be the wrong shape or the test may be too implementation-focused.

A good architecture review asks: “What behavior should survive an implementation refactor?” Those are the behaviors to test at the interface.

### One adapter is a hypothetical seam; two adapters are evidence of a real seam

A seam is justified when behavior truly varies. Production plus a meaningful test adapter can justify a seam; a single concrete adapter often means the interface is just indirection.

Do not apply this mechanically. A seam can also be justified by deployment, ownership, or true external dependency constraints.

### Deep modules can have internal seams

A module may use internal seams for its own implementation and tests while exposing a small external interface. Do not leak internal seams outward just to make tests easier.

### Domain language names good seams

When a module represents a domain concept, use the project's domain vocabulary. If the project has `CONTEXT.md`, prefer those terms. If the code uses a technical name that hides a domain concept, call that out.

## Candidate quality checks

A strong candidate usually has:

- file evidence,
- caller evidence,
- test evidence or testability impact,
- a named domain concept or explicit technical concern,
- a plausible deeper module direction,
- a dependency strategy,
- a clear locality or leverage gain.

A weak candidate usually has:

- no file evidence,
- generic “clean architecture” language,
- new interfaces without variation,
- renamed modules without behavior concentration,
- test-only seams that leak into production interfaces,
- contradiction with ADRs without acknowledging the trade-off.

## Phrases to prefer

- “This module is shallow because…”
- “The current interface makes callers know…”
- “The proposed seam would sit at…”
- “The adapter would be…”
- “The leverage is…”
- “The locality gain is…”
- “This fails/passes the deletion test because…”

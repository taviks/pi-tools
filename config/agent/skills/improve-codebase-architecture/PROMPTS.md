# Pi Subagent Prompts

Copy or adapt these prompts when using this skill in pi.

Default model: `openai-codex/gpt-5.6-sol` unless the user requests otherwise.

## Scout — subsystem exploration

```text
Explore this subsystem for architecture deepening opportunities.

Scope:
- Paths: <paths>
- User goal: <goal>
- Domain context already known: <terms or CONTEXT.md summary>
- ADR constraints already known: <ADR summary>

Use the skill vocabulary: Module, Interface, Implementation, Depth, Seam, Adapter, Leverage, Locality.

Look for:
- shallow modules or pass-through wrappers
- concepts split across many files
- duplicated orchestration across callers
- tests coupled to implementation details
- seams with only one meaningful adapter
- domain concepts hidden behind technical names
- caller knowledge of ordering, invariants, config, or error modes

Do not propose final interfaces and do not edit files.

Return:
1. Files read with line ranges
2. Modules/interfaces involved
3. Callers/tests affected
4. Observed friction
5. Possible deepening direction
6. Dependency category from DEEPENING.md
7. Confidence level and missing evidence
```

## Reviewer — candidate critique

```text
Critique these architecture deepening candidates.

Use the skill vocabulary: Module, Interface, Implementation, Depth, Seam, Adapter, Leverage, Locality.

For each candidate, attack:
- Is the module actually shallow, or just unfamiliar?
- Does the deletion test support the claim?
- Is the proposed seam real, or only a one-adapter indirection?
- Does it contradict CONTEXT.md or ADRs?
- Would tests improve through the interface, or just move mocks around?
- Is there enough file evidence?
- Is this over-abstraction?

Return:
- candidates to keep
- candidates to weaken or merge
- candidates to reject
- missing evidence
- questions to ask the user
```

## Interface design agent — minimal interface

```text
Design a minimal interface for the selected deepening candidate.

Constraint: 1–3 entry points maximum. Maximize leverage per entry point.

Include:
- interface surface plus invariants, ordering, error modes, config/lifecycle requirements
- usage example
- what implementation hides
- seam and adapters
- dependency category
- test strategy
- trade-offs in Depth, Locality, Leverage, migration risk

Do not edit files.
```

## Interface design agent — common caller optimized

```text
Design an interface optimized for the most common caller of the selected deepening candidate.

Constraint: the default use case should be trivial and hard to misuse.

Include:
- interface surface plus invariants, ordering, error modes, config/lifecycle requirements
- usage example
- what implementation hides
- seam and adapters
- dependency category
- test strategy
- trade-offs in Depth, Locality, Leverage, migration risk

Do not edit files.
```

## Interface design agent — flexible/extensible

```text
Design a flexible interface for the selected deepening candidate.

Constraint: support known variations without forcing callers to duplicate orchestration.

Include:
- interface surface plus invariants, ordering, error modes, config/lifecycle requirements
- usage example
- what implementation hides
- seam and adapters
- dependency category
- test strategy
- trade-offs in Depth, Locality, Leverage, migration risk

Do not edit files.
```

## Interface design agent — ports/adapters

```text
Design a ports/adapters interface for the selected deepening candidate.

Use only if dependencies are remote-owned or true-external, or if deployment/ownership creates a real seam.

Constraint: domain logic should sit in the deep module; transport/vendor details should sit in adapters.

Include:
- port/interface surface plus invariants, ordering, error modes, config/lifecycle requirements
- production adapter(s)
- test adapter(s)
- usage example
- what implementation hides
- dependency category
- test strategy
- trade-offs in Depth, Locality, Leverage, migration risk

Do not edit files.
```

## Interface design agent — no-new-external-seam

```text
Design an improvement path for the selected deepening candidate without adding a new external seam.

Constraint: deepen existing modules and reduce caller knowledge, but avoid new public abstractions unless unavoidable.

Include:
- changed module responsibilities
- existing interface changes, if any
- usage example
- what implementation hides
- dependency category
- test strategy
- trade-offs in Depth, Locality, Leverage, migration risk

Do not edit files.
```

## Planner — implementation plan after selection

```text
Create an implementation plan for the selected deepening design.

Do not edit files.

Include:
1. Goal
2. Files to modify
3. New files, if any
4. Step-by-step migration sequence
5. Tests to add/change/delete
6. Backward compatibility or rollout plan
7. Risks and rollback concerns
8. Documentation updates
```

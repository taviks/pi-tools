# Interface Design

Use this only after the user chooses a deepening candidate and wants to explore concrete interface options.

The goal is to design the **Interface** and **Seam** for a deeper **Module**, not to implement immediately.

## Step 1 — Frame the problem space

Before spawning subagents or proposing options, write a short frame for the user:

- chosen candidate,
- files and callers involved,
- domain concept or technical concern,
- behavior that should move behind the interface,
- facts callers currently need but should stop knowing,
- dependency categories from [DEEPENING.md](DEEPENING.md),
- tests that should survive implementation refactors,
- constraints from `CONTEXT.md` and ADRs.

Include a tiny illustrative sketch only if it clarifies constraints. Label it as a sketch, not a proposal.

## Step 2 — Generate intentionally different designs

Use pi subagents when designs can be explored independently. Default to `openai-codex/gpt-5.5` unless the user requests another model.

Ask each subagent for a different design constraint:

1. **Minimal interface** — 1–3 entry points, maximum leverage per entry point.
2. **Common-caller optimized** — make the dominant use case trivial.
3. **Flexible/extensible** — support known variations without caller duplication.
4. **Ports/adapters** — only when dependencies cross a remote-owned or true-external seam.
5. **No-new-external-seam** — show how far the design can improve by deepening existing modules without a new public interface.

Do not ask subagents to edit files. Ask for design only.

## Subagent output contract

Each design should return:

```md
## Design name

### Interface
- entry points/types
- invariants
- ordering rules
- error modes
- configuration/lifecycle requirements

### Usage example
Short caller example.

### What the implementation hides
Behavior, orchestration, policy, dependency details.

### Seam and adapters
Where the seam lives, which adapters are real, which are hypothetical.

### Dependency strategy
Classify dependencies using DEEPENING.md.

### Test strategy
What tests cross the interface and what old tests become obsolete.

### Trade-offs
- Depth:
- Locality:
- Leverage:
- Migration risk:
```

## Step 3 — Compare designs

Present designs sequentially and then compare them.

Use this comparison table:

| Design | Depth | Locality | Seam placement | Adapter justification | Test surface | Migration risk |
| --- | --- | --- | --- | --- | --- | --- |

Then give a clear recommendation. Prefer one design or a hybrid; do not leave the user with an undifferentiated menu.

## Step 4 — Prepare implementation plan only if requested

If the user says to implement, switch to planning:

- files to change,
- migration sequence,
- tests to add/change/delete,
- compatibility strategy,
- rollback risk,
- documentation updates.

Do not implement until the user explicitly asks.

---
name: improve-codebase-architecture
description: Pi workflow for evidence-backed architecture reviews and deepening opportunities. Use when asked to improve architecture, identify shallow modules, refine seams/adapters, consolidate tightly coupled code, improve testability, or make a codebase easier for AI agents to navigate.
license: MIT
compatibility: Optimized for pi subagents and openai-codex/gpt-5.5; usable serially by other models and harnesses.
metadata:
  upstream: https://github.com/mattpocock/skills/blob/main/skills/engineering/improve-codebase-architecture/SKILL.md
  adapted-for: pi
allowed-tools: read bash subagent subagent_jobs edit write
---

# Improve Codebase Architecture — Pi Adaptation

Find evidence-backed **deepening opportunities**: refactors that make modules deeper, interfaces clearer, behavior more local, tests more stable, and the codebase easier for humans and AI agents to navigate.

Use the vocabulary in [LANGUAGE.md](LANGUAGE.md): **Module**, **Interface**, **Implementation**, **Depth**, **Seam**, **Adapter**, **Leverage**, and **Locality**.

## When to use

Use when the user asks to:

- improve architecture or maintainability,
- find refactoring opportunities,
- consolidate tightly coupled code,
- identify shallow modules or pass-through wrappers,
- improve testability through better interfaces,
- clarify seams/adapters,
- make a codebase easier for AI agents to navigate.

Do not use for straightforward bug fixes unless architecture is part of the request.

## Non-negotiables

- Separate **observations**, **inferences**, and **recommendations**.
- Cite concrete files for every candidate.
- Prefer project domain language from `CONTEXT.md` / `CONTEXT-MAP.md`.
- Respect decisions in `docs/adr/`.
- Do not propose final interfaces until the user chooses a candidate.
- Do not edit code, `CONTEXT.md`, or ADRs unless the user explicitly approves.
- Do not implement refactors until the user asks for implementation.
- If using pi subagents, default to `openai-codex/gpt-5.5` unless the user requests another model.

## Read these skill references

Always read [LANGUAGE.md](LANGUAGE.md) before producing architecture candidates.

Read these when relevant:

- [DEEPENING.md](DEEPENING.md) — dependency categories and testing strategy.
- [INTERFACE-DESIGN.md](INTERFACE-DESIGN.md) — after the user chooses a candidate and wants interface options.
- [CONTEXT-FORMAT.md](CONTEXT-FORMAT.md) — before proposing or editing domain language.
- [ADR-FORMAT.md](ADR-FORMAT.md) — before proposing or creating ADRs.
- [PROMPTS.md](PROMPTS.md) — copyable pi subagent prompts.

## GPT-5.5 operating discipline

GPT-5.5 is strong at synthesis but can jump to polished abstractions too early. Keep it phase-bound:

1. Evidence first.
2. Candidate directions second.
3. User selection third.
4. Grilling and interface design fourth.
5. Implementation only on request.

Use compact tables, confidence labels, and explicit trade-offs. Avoid “architecture vibes”: each claim needs code evidence, domain evidence, or ADR evidence.

## Phase 1 — Anchor in project context

Identify the project root and read available context:

- `AGENTS.md` or `.pi/agent` instructions,
- `CONTEXT-MAP.md`,
- root or local `CONTEXT.md`,
- `docs/adr/*.md`,
- architecture docs,
- README/developer docs relevant to the area.

If no `CONTEXT.md` or ADRs exist, continue, but state that confidence is lower because domain vocabulary or architectural decisions are not documented.

If the repo has multiple contexts, use `CONTEXT-MAP.md` to determine which context applies. If unclear, ask.

## Phase 2 — Explore the codebase

For small or targeted requests, explore directly with `read`, `bash`, and file search.

For broad or unfamiliar codebases, use pi subagents:

- `scout` for independent subsystem exploration,
- `reviewer` to attack candidate quality and detect false seams,
- `planner` only after a candidate is selected and an implementation plan is requested,
- `worker` only after explicit implementation approval.

Prefer 2–6 parallel `scout` tasks for broad reviews. Split by subsystem, not by identical files. If a subagent is started in background mode, call `subagent_jobs` with `action: "wait-all"` before summarizing.

Look for:

- concepts that require bouncing across many small modules,
- shallow modules where the interface is almost as complex as the implementation,
- pass-through wrappers that fail the deletion test,
- tests coupled to implementation details instead of the interface,
- seams with only one meaningful adapter,
- domain concepts hidden behind technical names,
- modules that leak ordering, invariants, config, or error knowledge to callers,
- duplicated orchestration across callers.

## Phase 3 — Analyze using deepening checks

Apply these checks:

- **Deletion test**: if the module vanished, would complexity disappear, or would it spread to callers?
- **Interface as test surface**: can meaningful behavior be tested through the module interface?
- **Adapter reality check**: is there more than one justified adapter, or is the seam hypothetical?
- **Locality**: would a change or bug fix concentrate in one place?
- **Leverage**: would callers get more behavior through less interface knowledge?
- **Dependency category**: classify dependencies using [DEEPENING.md](DEEPENING.md).

Prefer candidates with high leverage, improved locality, realistic test improvement, and low contradiction with existing ADRs.

## Phase 4 — Present candidates only

Present 3–7 ranked candidates. Do **not** propose concrete interfaces yet.

Use this format:

```md
## Architecture deepening candidates

### 1. Candidate name

- **Files/evidence**:
- **Current module/interface/seam**:
- **Problem**:
- **Deepening direction**:
- **Leverage**:
- **Locality**:
- **Test impact**:
- **Dependency category**:
- **ADR/domain conflicts**:
- **Risk / effort / confidence**:
- **Question to validate**:
```

End with:

```text
Which candidate would you like to explore?
```

If the evidence is weak, say so and present fewer candidates.

## Phase 5 — Grilling loop after user selection

When the user chooses a candidate, switch to a focused design conversation.

Clarify:

- what domain concept the module should represent,
- what behavior belongs behind the seam,
- what callers should no longer need to know,
- what tests should survive implementation refactors,
- which dependencies sit behind the seam,
- what constraints existing ADRs impose.

Ask one high-leverage question at a time when needed. Prefer multiple-choice questions when useful.

If a new or sharper domain term is needed, propose a `CONTEXT.md` change and ask before editing. Use [CONTEXT-FORMAT.md](CONTEXT-FORMAT.md).

If the user rejects a candidate for a durable architectural reason, offer an ADR only when the reason is hard to reverse, surprising without context, and the result of a real trade-off. Use [ADR-FORMAT.md](ADR-FORMAT.md).

## Phase 6 — Interface design only after selection

If the user wants interface options, read [INTERFACE-DESIGN.md](INTERFACE-DESIGN.md).

Use parallel subagents when the alternatives can be explored independently. Ask for radically different designs, such as:

1. minimal interface, maximum leverage,
2. common-caller-optimized interface,
3. flexible/extensible interface,
4. ports/adapters interface for remote or external dependencies,
5. no-new-external-seam alternative.

Compare by **Depth**, **Locality**, **Seam** placement, dependency strategy, test surface, and migration risk. Then recommend one design or a hybrid.

## Phase 7 — Documentation updates

Only edit docs after explicit approval.

When updating domain language:

- read [CONTEXT-FORMAT.md](CONTEXT-FORMAT.md),
- propose the exact term/definition first when approval is ambiguous,
- keep definitions tight and domain-specific.

When creating an ADR:

- read [ADR-FORMAT.md](ADR-FORMAT.md),
- create `docs/adr/` lazily,
- number the ADR after the highest existing ADR.

## Phase 8 — Implementation handoff

Only when the user says to implement:

1. produce a concrete plan,
2. identify files to change,
3. preserve behavior,
4. move tests to the deepened module interface,
5. delete or simplify obsolete shallow-module tests only after replacement coverage exists,
6. use `worker` for implementation if delegation is helpful.

Implementation success means the new interface concentrates knowledge and the tests describe observable behavior rather than implementation details.

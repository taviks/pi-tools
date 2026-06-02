---
name: brainstorming
description: Clarify what to build before implementation. Use when requirements are ambiguous, trade-offs exist, or multiple valid approaches are possible.
---

# Brainstorming (Pi-optimized)

Goal: converge quickly on **what** to build, then hand off cleanly to planning/implementation.

## When to use

Use when:
- request is vague,
- multiple approaches are plausible,
- trade-offs are not yet decided.

Skip when:
- requirements and acceptance criteria are already explicit,
- task is a straightforward fix.

## Process

1. **Clarity check (quick)**
   - If requirements are already clear, say so and offer to move directly to plan/implementation.

2. **Questioning (one at a time)**
   - Ask short, high-leverage questions.
   - Prefer multiple-choice when possible.
   - Confirm assumptions explicitly.

3. **Approach comparison**
   - Propose 2–3 options.
   - Include pros/cons and a recommendation.
   - Keep YAGNI front and center.

4. **Decision capture**
   - Summarize chosen direction, constraints, and open questions.

## Output format (compact)

Keep output short and structured:

- **Understanding** (3–5 bullets)
- **Options** (table or bullets; max 3 options)
- **Recommendation** (1 short paragraph)
- **Open questions** (0–5 bullets)
- **Next step** (`plan` or `implement`)

## Hard stop conditions

Immediately stop brainstorming and switch mode when user says any equivalent of:
- “implement it”,
- “go ahead and build”,
- “write the code now”,
- “enough, proceed”.

At that point, provide a 3–6 bullet decision summary and move on.

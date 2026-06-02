---
description: Explore requirements and approaches through collaborative dialogue before planning implementation
argument-hint: "[feature idea or problem to explore]"
---

# Brainstorm a Feature or Improvement

**Goal:** decide **what** to build before turning it into an implementation plan.

## Feature Description

<feature_description> #$ARGUMENTS </feature_description>

If the feature description is empty, ask the user what they want to explore and wait for an answer.

## Rules

- Load and follow the `brainstorming` skill.
- Do **not** write code.
- Ask one short, high-leverage question at a time in normal conversation.
- Prefer multiple-choice phrasing when it helps.
- Keep YAGNI front and center.

## Workflow

### 1. Assess clarity

- If the request is already specific enough to plan, say so and offer to move directly to `/workflows-plan`.
- Otherwise continue brainstorming.

### 2. Gather lightweight context

- If existing project patterns matter, inspect the repo with `find`, `grep`, and `read`.
- If a quick reconnaissance pass would help, use `subagent` with `agent: "scout"`.
- Keep this lightweight; the goal is context, not implementation.

### 3. Ask questions and narrow scope

Focus on:
- user goal
- constraints
- success criteria
- scope boundaries
- trade-offs

### 4. Present options

Present **2-3 concrete approaches max**.

For each approach include:
- brief description
- pros
- cons
- when it is the right fit

Then recommend one approach and explain why.

### 5. Capture the brainstorm

Write a brainstorm document to:

`docs/brainstorms/YYYY-MM-DD-<topic>-brainstorm.md`

Include these sections:
- What we're building
- Why this matters
- Options considered
- Recommended approach
- Key decisions
- Constraints
- Success criteria
- Open questions

### 6. Handoff

End by asking the user which of these they want next:
- refine the brainstorm
- proceed to `/workflows-plan`
- stop for now

## Response format

Keep the conversational output compact:

- **Understanding**
- **Options**
- **Recommendation**
- **Open questions**
- **Next step**

Never code during this command.

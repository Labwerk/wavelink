---
description: Spawn 4 teammates (spec-writer, planner, builder, reviewer) for one feature, loop builder<->reviewer until PASS.
argument-hint: [feature-slug]
disable-model-invocation: true
---

Spawn 4 teammates for specs/$1, one per agent type:
- spec-writer agent type — revise spec.md if planner/reviewer flags anything unclear
- planner agent type — read spec.md, produce/refine plan.md
- builder agent type — read plan.md, write tasks.md, implement with tests
- reviewer agent type — verify implementation against spec.md, write review.md

Order matters: planner depends on spec-writer, builder depends on planner,
reviewer depends on builder. Set these as task dependencies on the shared
task list so no one starts early.

Let them message each other directly instead of routing through me — if
reviewer finds an issue, it messages builder directly; if builder or
reviewer thinks the plan or spec is wrong, they message planner or
spec-writer directly to revise. Loop builder ↔ reviewer until review.md is PASS.
Only message me for a decision that can't be reversed.
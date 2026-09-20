# Tasks: <feature name>

> Written by builder. Ordered by dependency (setup → core → edge cases → tests).
> Every requirement in spec.md must be covered by at least one task.
> Mark `- [x]` only when its tests pass.

- [ ] **T1** — <task>
  - Files: <paths it touches>
  - Satisfies: R1
  - Acceptance: <how to verify>

- [ ] **T2** — <task>
  - Files: <paths>
  - Satisfies: R2, R3
  - Acceptance: <how to verify>
  
## Deviations from plan

> Builder fills this in immediately when implementation departs from plan.md —
> not after the fact, not only when reviewer asks. Empty section = zero deviations.

- **Deviation:** <what changed vs plan.md>
  - **Plan said:** <original decision + section reference>
  - **Did instead:** <what was actually built>
  - **Why:** <reason — infeasible, simpler alternative, new info>
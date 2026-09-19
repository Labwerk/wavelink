# SDD workflow

Spec-Driven Development for Wavelink. Every feature moves through four agents,
each in its own isolated context, handing off to the next through files on disk.

```
spec-writer  ──spec.md──▶  planner  ──plan.md──▶  builder  ──tasks.md + code──▶  reviewer  ──review.md
   (WHAT/WHY)              (HOW + research)        (break down + implement)       (verify vs spec)
```

The agents live in [`.claude/agents/`](../.claude/agents/). Load them with
`/agents` (or restart the Claude Code session) after cloning.

## One folder per feature

All artifacts for a feature live under `specs/<feature-slug>/`:

| File | Written by | Contents |
|---|---|---|
| `spec.md` | spec-writer | Goals, non-goals, user stories, numbered requirements `R1…Rn`, acceptance criteria |
| `plan.md` | planner | Architecture, tech decisions, data model, requirement-coverage table, sources |
| `tasks.md` | builder | Ordered, dependency-sorted task checklist, each referencing requirement IDs |
| `review.md` | reviewer | PASS/FAIL verdict, per-requirement coverage table, test results, issues |

The `<feature-slug>` is the thread that ties the four agents together — they all
read and write inside the same `specs/<feature-slug>/` folder.

## Running a feature

```
Use the spec-writer subagent for: <feature idea>
# review specs/<slug>/spec.md, then:
Use the planner subagent for specs/<slug>
# review plan.md, then:
Use the builder subagent for specs/<slug>
# then:
Use the reviewer subagent for specs/<slug>
```

Review the output file between each step before moving on. If the reviewer
returns FAIL or PASS WITH ISSUES, hand `review.md` back to the builder, fix,
and review again — that loop is the quality gate.

## Starting a new feature

Copy the templates:

```sh
cp -r specs/_template specs/<feature-slug>
```

Then run the pipeline above.

## Existing work

- [`foundation/`](foundation/) — the initial platform spec and build plan
  (schema, live device/telemetry view, simulator, Docker/self-hosted deployment).
  This predates the per-feature convention and is kept as the baseline; new
  features get their own folder.

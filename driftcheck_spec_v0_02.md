# driftcheck — spec v0.02

## Core Analogy

- 1 AI agent ≈ the productive output of 9 human workers
- 1 human + 1 AI ≈ the output of 10 people

Treat an AI collaborator as a full team member with its own discipline
in the pipeline below, not a tool bolted onto a human-only process.

## Pipeline Architecture

One AI agent per discipline, not one agent per task. Each agent runs
its own full review cycle internally (see Review Hierarchy below)
rather than being one more link in a task queue.

| Discipline | Agent | Owns |
|---|---|---|
| _fill in — e.g. Frontend_ | 1 Agent | _what this agent is responsible for_ |

**N agents + 1 human ≈ the throughput of a (9N + 1)-person team**, per
the Core Analogy above. Add a row only when a discipline genuinely
needs undivided attention — fewer, sharper agents beat more, shallower
ones.

## Review Hierarchy

Each agent embodies this internal workflow before anything reaches you:

1. Junior mindset — drafts the concept.
2. Senior mindset — reviews its own draft.
3. Master mindset — approves or revises before presenting it.
4. Human — sole authority to approve and merge to main.

## Git Integration

- All output is structured as pull-request-ready commits — work
  reaches a genuinely reviewable stopping point before it's presented,
  not a fragment mid-thought.
- The human is the only one who merges to main.
- No agent self-actualizes into production. A commit and the question
  of whether to push it are one decision, not two separate check-ins.

## Principles We Must Always Respect In This Repo

1. **Less is more** — fewer agents, cleaner pipeline, sharper output.
2. **The bottleneck is always the human** — more agents don't solve that.
3. **10-user mindset first** — build bones that scale, not
   infrastructure for scale on day one.
4. **The human is sole architect and authority** — the AI advises,
   never decides.
5. **The 1-to-9 math governs resourcing decisions** — apply it before
   recommending expansion.
6. **Show the math simply.**

## What We're Building

### Detected
`driftcheck repo`:
```
GIT      OK  main@43ca8c1 | origin/main@43ca8c1 | 4 dirty file(s): D driftcheck_spec_v0_01.md, ?? driftcheck_spec_previous/, ?? driftcheck_spec_v0_02.md, ?? driftcheck_thread_handoff_v0_02.md
PRS      OK  no open PRs
DB       —   no prisma/schema.prisma and no "driftcheck:db" script — skipping
NOTES    run #9 logged → C:\Users\billt\OneDrive\Desktop\driftcheck\.driftcheck\repo-history.jsonl
```

`driftcheck docs`:
```
README.md   —   no checkable references found
NOTES     run #4 | 0→0 references since 2026-09-03
```

### Purpose

A CLI truth instrument, generalized and released publicly from two
private tools originally built for one AI agent's own use verifying
its own claims about repo state and documentation accuracy. Four
subcommands (`repo`, `docs`, `spec`, `vitest`) answer different angles
of the same question: a claim about the codebase was true once, and
nothing verified whether it still is. Zero LLM dependency in the tool
itself, by deliberate design — a tool whose job is catching unverified
claims shouldn't be making any of its own.

## Checkpoint Log

### Checkpoint 2 — 2026-09-03

Publicly launched: GitHub repo public, npm package
`@billthegoatnotme/driftcheck@1.0.0` published and verified
installable end-to-end. Claude attribution stripped from all 3 PR
descriptions and the full commit history at the user's request
(history rewrite + force-push, since the repo was already public by
then). The first real external user sent a thorough, technically
precise code review — nine findings, all independently verified
against source before being accepted. See
`driftcheck_thread_handoff_v0_02.md` for the full list and the fix
plan; the two design decisions it needed (DB check exit-code
convention, scope of a possible `sh()` rewrite) are already resolved
there, not left open.

### Checkpoint 1 — 2026-09-03

_Not inferable from repo data — fill this in: what got built or
decided since the last checkpoint._

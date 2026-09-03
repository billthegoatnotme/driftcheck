# driftcheck — spec v0.01

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
GIT      ??  no origin/main to compare against | 1 dirty file(s)
PRS      ??  gh unavailable/unauthenticated — verify PR state by hand before claiming "merged"
DB       —   no prisma/schema.prisma — skipping (this check is Prisma-specific)
NOTES    run #3 logged → C:\Users\billt\OneDrive\Desktop\driftcheck\.driftcheck\repo-history.jsonl
```

`driftcheck docs`:
```
README.md   —   no checkable references found
NOTES     run #2 | 0→0 references since 2026-09-02
```

### Purpose

_Not inferable from repo data — fill this in: what is this, and why
does it exist?_

## Checkpoint Log

### Checkpoint 1 — 2026-09-03

_Not inferable from repo data — fill this in: what got built or
decided since the last checkpoint._

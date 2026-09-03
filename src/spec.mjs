// ─────────────────────────────────────────────────────────────────────
//  driftcheck spec — the third lens: continuity drift.
//
//  driftcheck repo answers "is my picture of repo state current?"
//  driftcheck docs answers "does the constitution still match the code?"
//  This answers a third, quieter version of the same problem: does a
//  new working thread, starting cold, have what it needs to pick up
//  cleanly — or does it lose everything the last one learned?
//
//  `driftcheck spec` scaffolds <repo>_spec_v0_01.md the first time it's
//  run against a repo that doesn't have one yet. It's idempotent — if
//  a spec already exists, it does nothing.
//
//  `driftcheck spec close` checkpoints forward: it writes the next
//  <repo>_spec_v0_0N.md (state refreshed via the same repo/docs checks
//  above) and a paired <repo>_thread_handoff_v0_0N.md meant to be
//  pasted at the start of the next thread. The reflective sections in
//  both are left as explicit prompts — narrating what happened and why
//  is a language-generation task, not something a deterministic script
//  should guess at. driftcheck stays dependency-free either way.
// ─────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { runRepoCheck } from './repo.mjs';
import { runDocsCheck } from './docs.mjs';

const BT = '`';
const FENCE = BT + BT + BT;
const pad2 = (n) => String(n).padStart(2, '0');

function repoName(repo) {
  const pkgPath = join(repo, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const name = JSON.parse(readFileSync(pkgPath, 'utf8')).name;
      if (name) return name.replace(/^@[^/]+\//, ''); // drop an npm scope, if any
    } catch { /* malformed package.json */ }
  }
  return basename(repo);
}

const sanitize = (name) => name.replace(/[^A-Za-z0-9_.-]+/g, '-');

const specPath = (repo, name, v) => join(repo, `${name}_spec_v0_${pad2(v)}.md`);
const handoffPath = (repo, name, v) => join(repo, `${name}_thread_handoff_v0_${pad2(v)}.md`);

function latestSpecVersion(repo, name) {
  const re = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_spec_v0_(\\d+)\\.md$`);
  let max = 0;
  for (const f of readdirSync(repo)) {
    const m = f.match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

function extractCheckpointLog(oldSpecFile) {
  if (!existsSync(oldSpecFile)) return '';
  const marker = '## Checkpoint Log';
  const idx = readFileSync(oldSpecFile, 'utf8').indexOf(marker);
  if (idx === -1) return '';
  return readFileSync(oldSpecFile, 'utf8').slice(idx + marker.length).trim();
}

// ── Fixed sections — the governing document driftcheck ships, not
// data pulled from any one repo. ────────────────────────────────────
const CORE_ANALOGY = `## Core Analogy

- 1 AI agent ≈ the productive output of 9 human workers
- 1 human + 1 AI ≈ the output of 10 people

Treat an AI collaborator as a full team member with its own discipline
in the pipeline below, not a tool bolted onto a human-only process.`;

const PIPELINE_ARCHITECTURE = `## Pipeline Architecture

One AI agent per discipline, not one agent per task. Each agent runs
its own full review cycle internally (see Review Hierarchy below)
rather than being one more link in a task queue.

| Discipline | Agent | Owns |
|---|---|---|
| _fill in — e.g. Frontend_ | 1 Agent | _what this agent is responsible for_ |

**N agents + 1 human ≈ the throughput of a (9N + 1)-person team**, per
the Core Analogy above. Add a row only when a discipline genuinely
needs undivided attention — fewer, sharper agents beat more, shallower
ones.`;

const REVIEW_HIERARCHY = `## Review Hierarchy

Each agent embodies this internal workflow before anything reaches you:

1. Junior mindset — drafts the concept.
2. Senior mindset — reviews its own draft.
3. Master mindset — approves or revises before presenting it.
4. Human — sole authority to approve and merge to main.`;

const GIT_INTEGRATION = `## Git Integration

- All output is structured as pull-request-ready commits — work
  reaches a genuinely reviewable stopping point before it's presented,
  not a fragment mid-thought.
- The human is the only one who merges to main.
- No agent self-actualizes into production. A commit and the question
  of whether to push it are one decision, not two separate check-ins.`;

const PRINCIPLES = `## Principles We Must Always Respect In This Repo

1. **Less is more** — fewer agents, cleaner pipeline, sharper output.
2. **The bottleneck is always the human** — more agents don't solve that.
3. **10-user mindset first** — build bones that scale, not
   infrastructure for scale on day one.
4. **The human is sole architect and authority** — the AI advises,
   never decides.
5. **The 1-to-9 math governs resourcing decisions** — apply it before
   recommending expansion.
6. **Show the math simply.**`;

function detectedSection(repo) {
  const repoOut = runRepoCheck([repo]).split('\n').slice(1).join('\n');
  const docsOut = runDocsCheck([repo]).split('\n').slice(1).join('\n');
  return `## What We're Building

### Detected
${BT}driftcheck repo${BT}:
${FENCE}
${repoOut}
${FENCE}

${BT}driftcheck docs${BT}:
${FENCE}
${docsOut}
${FENCE}

### Purpose

_Not inferable from repo data — fill this in: what is this, and why
does it exist?_`;
}

function buildSpecBody(repo, name, version, prevLog) {
  const stub = `### Checkpoint ${version} — ${new Date().toISOString().slice(0, 10)}

_Not inferable from repo data — fill this in: what got built or
decided since the last checkpoint._`;
  const log = prevLog ? `${stub}\n\n${prevLog}` : stub;

  return `# ${name} — spec v0.${pad2(version)}

${CORE_ANALOGY}

${PIPELINE_ARCHITECTURE}

${REVIEW_HIERARCHY}

${GIT_INTEGRATION}

${PRINCIPLES}

${detectedSection(repo)}

## Checkpoint Log

${log}
`;
}

function buildHandoffBody(name, version, prevVersion) {
  return `# ${name} Thread Handoff — Checkpoint ${version}

Read alongside ${BT}${name}_spec_v0_${pad2(version)}.md${BT} in this
same folder. This picks up from
${BT}${name}_spec_v0_${pad2(prevVersion)}.md${BT} — read that
checkpoint's entry in the spec's Checkpoint Log before anything else.

## What the next thread should actually do

_Fill this in before closing out — the next thread starts cold and has
only the spec and this document to work from._

## Open questions

_Anything genuinely undecided, left here so the next thread doesn't
have to re-litigate it._
`;
}

export function runSpecCommand(args) {
  const closeMode = args[0] === 'close';
  const rest = closeMode ? args.slice(1) : args;
  const repo = resolve(rest.find((a) => !a.startsWith('--')) ?? process.cwd());
  const name = sanitize(repoName(repo));
  const latest = latestSpecVersion(repo, name);
  const header = '── driftcheck spec ─ ' + repo;

  if (!closeMode) {
    if (latest > 0) {
      return `${header}\nSPEC     OK  ${name}_spec_v0_${pad2(latest)}.md already exists — nothing to do (${BT}driftcheck spec close${BT} checkpoints forward)`;
    }
    writeFileSync(specPath(repo, name, 1), buildSpecBody(repo, name, 1, ''));
    return `${header}\nSPEC     OK  created ${name}_spec_v0_01.md`;
  }

  if (latest === 0) {
    return `${header}\nSPEC     ??  no existing ${name}_spec_v0_NN.md found — run ${BT}driftcheck spec${BT} first`;
  }
  const next = latest + 1;
  const prevLog = extractCheckpointLog(specPath(repo, name, latest));
  writeFileSync(specPath(repo, name, next), buildSpecBody(repo, name, next, prevLog));
  writeFileSync(handoffPath(repo, name, next), buildHandoffBody(name, next, latest));
  return `${header}\nSPEC     OK  checkpointed → ${name}_spec_v0_${pad2(next)}.md + ${name}_thread_handoff_v0_${pad2(next)}.md`;
}

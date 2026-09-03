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
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRepoCheck } from './repo.mjs';
import { runDocsCheck } from './docs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
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

// The governing document driftcheck ships, not data pulled from any
// one repo — a single source of truth read fresh each run, so this
// file and what's actually generated can never drift apart from each
// other. See templates/manifesto.md.
const MANIFESTO = readFileSync(join(HERE, '..', 'templates', 'manifesto.md'), 'utf8').trim();

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

${MANIFESTO}

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

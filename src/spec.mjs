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
//  `driftcheck spec close` checkpoints forward. It does NOT regenerate
//  the file from scratch — it reads the existing latest spec whole and
//  patches only what genuinely needs refreshing (the Detected scan, a
//  new Checkpoint Log entry), leaving everything else — including any
//  hand-edits to the governance sections or Purpose — exactly as it
//  was. An earlier version regenerated the whole document from the
//  template every time, which silently destroyed any real customization
//  a team made; that's a real data-loss risk for anyone actually using
//  this file, not just a naming inconvenience.
// ─────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
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
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Finds <name>_<label>_v0_NN.md files sitting in the repo root — never
// recurses into the _previous/ archive folders, so already-archived
// versions are never re-processed.
function findVersioned(repo, name, label) {
  const re = new RegExp(`^${escapeRe(name)}_${label}_v0_(\\d+)\\.md$`);
  return readdirSync(repo)
    .map((file) => ({ file, m: file.match(re) }))
    .filter(({ m }) => m)
    .map(({ file, m }) => ({ file, version: Number(m[1]) }));
}

function latestSpecVersion(repo, name) {
  const versions = findVersioned(repo, name, 'spec').map((v) => v.version);
  return versions.length ? Math.max(...versions) : 0;
}

// Moves every root-level <name>_<label>_v0_NN.md except the one just
// written into <name>_<label>_previous/ — never deletes, and sweeps any
// stragglers left over from before this existed, not just the single
// most-recently-superseded file.
function archivePrevious(repo, name, label, keepVersion) {
  const moved = [];
  for (const { file, version } of findVersioned(repo, name, label)) {
    if (version === keepVersion) continue;
    const dir = join(repo, `${name}_${label}_previous`);
    const dest = join(dir, file);
    if (existsSync(dest)) continue; // already archived under this name — leave it alone
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    renameSync(join(repo, file), dest);
    moved.push(file);
  }
  return moved;
}

// The governing document driftcheck ships, not data pulled from any
// one repo — a single source of truth read fresh each run, so this
// file and what's actually generated can never drift apart from each
// other. See templates/drift_check_manifesto.md. Only used building the
// very first version — spec close patches an existing file in place
// instead, so it never re-reads this for a project already underway.
const MANIFESTO = readFileSync(join(HERE, '..', 'templates', 'drift_check_manifesto.md'), 'utf8').trim();

// Just the scan block — no surrounding "## What We're Building" or
// "### Purpose", so this can be spliced into an existing file (spec
// close) as easily as assembled into a brand new one (spec init).
function detectedBlock(repo) {
  const repoOut = runRepoCheck([repo]).split('\n').slice(1).join('\n');
  const docsOut = runDocsCheck([repo]).split('\n').slice(1).join('\n');
  return `### Detected
${BT}driftcheck repo${BT}:
${FENCE}
${repoOut}
${FENCE}

${BT}driftcheck docs${BT}:
${FENCE}
${docsOut}
${FENCE}`;
}

function checkpointStub(version) {
  return `### Checkpoint ${version} — ${new Date().toISOString().slice(0, 10)}

_Not inferable from repo data — fill this in: what got built or
decided since the last checkpoint._`;
}

// The very first version — nothing to preserve yet, so this is the
// only place the document gets assembled from scratch.
function buildInitialSpecBody(repo, name) {
  return `# ${name} — spec v0.${pad2(1)}

${MANIFESTO}

## What We're Building

${detectedBlock(repo)}

### Purpose

_Not inferable from repo data — fill this in: what is this, and why
does it exist?_

## Checkpoint Log

${checkpointStub(1)}
`;
}

// Checkpointing forward: read the existing file whole and patch only
// what needs refreshing, in place. Everything else — hand-edited
// governance sections, a filled-in Pipeline Architecture table,
// whatever got written into Purpose — survives untouched, because it's
// never regenerated from the template at all past version 1.
function patchSpecBody(existingContent, repo, name, newVersion) {
  const notes = [];
  let content = existingContent;

  const titled = content.replace(/^# .+/, `# ${name} — spec v0.${pad2(newVersion)}`);
  if (titled === content) notes.push('title line not found — version number in the heading wasn\'t updated');
  content = titled;

  const withDetected = content.replace(/### Detected[\s\S]*?(?=\n### )/, `${detectedBlock(repo)}\n`);
  if (withDetected === content) notes.push('"### Detected" section not found — scan snapshot wasn\'t refreshed');
  content = withDetected;

  const withCheckpoint = content.replace(/## Checkpoint Log\n\n/, `## Checkpoint Log\n\n${checkpointStub(newVersion)}\n\n`);
  if (withCheckpoint === content) notes.push('"## Checkpoint Log" section not found — new checkpoint wasn\'t recorded');
  content = withCheckpoint;

  return { content, notes };
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
    writeFileSync(specPath(repo, name, 1), buildInitialSpecBody(repo, name));
    return `${header}\nSPEC     OK  created ${name}_spec_v0_01.md`;
  }

  if (latest === 0) {
    return `${header}\nSPEC     ??  no existing ${name}_spec_v0_NN.md found — run ${BT}driftcheck spec${BT} first`;
  }
  const next = latest + 1;
  const existing = readFileSync(specPath(repo, name, latest), 'utf8');
  const { content, notes } = patchSpecBody(existing, repo, name, next);
  writeFileSync(specPath(repo, name, next), content);
  writeFileSync(handoffPath(repo, name, next), buildHandoffBody(name, next, latest));

  const archivedSpecs = archivePrevious(repo, name, 'spec', next);
  const archivedHandoffs = archivePrevious(repo, name, 'thread_handoff', next);
  const archiveParts = [];
  if (archivedSpecs.length) archiveParts.push(`${archivedSpecs.length} spec(s) → ${name}_spec_previous/`);
  if (archivedHandoffs.length) archiveParts.push(`${archivedHandoffs.length} handoff(s) → ${name}_thread_handoff_previous/`);
  const archiveNote = archiveParts.length ? ` (archived ${archiveParts.join(', ')})` : '';

  const lines = [`${header}\nSPEC     OK  checkpointed → ${name}_spec_v0_${pad2(next)}.md + ${name}_thread_handoff_v0_${pad2(next)}.md${archiveNote}`];
  for (const note of notes) lines.push(`         ??  ${note}`);
  return lines.join('\n');
}

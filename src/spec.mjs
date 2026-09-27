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
//
//  Everything lives under agendas/, and only the current spec and
//  handoff sit loose in it:
//
//    agendas/
//      <repo>_spec_v0_NN.md
//      <repo>_thread_handoff_v0_NN.md
//      planning/        mid-work plans, any file type, <repo>_<name>.<ext>
//      previous/        <repo>_{spec,thread_handoff,plan}_previous/
//
//  agendas/ is gitignored by default — these documents are the user's
//  working record, not necessarily something to publish. driftcheck only
//  ever moves files carrying the <repo>_ prefix, and never overwrites:
//  a name clash gets _2, _3, … before the extension.
// ─────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
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

export const AGENDAS = 'agendas';
const agendasDir = (repo) => join(repo, AGENDAS);
const planningDir = (repo) => join(repo, AGENDAS, 'planning');
const previousDir = (repo, name, label) => join(repo, AGENDAS, 'previous', `${name}_${label}_previous`);
const specPath = (repo, name, v) => join(agendasDir(repo), `${name}_spec_v0_${pad2(v)}.md`);
const handoffPath = (repo, name, v) => join(agendasDir(repo), `${name}_thread_handoff_v0_${pad2(v)}.md`);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const listDir = (dir) => (existsSync(dir) ? readdirSync(dir) : []);
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

// Moves src into destDir without ever overwriting: if the name is taken,
// the newcomer becomes name_2.ext, name_3.ext, … and the original keeps
// its plain name. Returns the name it actually landed under.
function moveNoClobber(src, destDir) {
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
  const file = basename(src);
  const ext = isDir(src) ? '' : extname(file);
  const stem = ext ? file.slice(0, -ext.length) : file;
  let target = file;
  for (let n = 2; existsSync(join(destDir, target)); n++) target = `${stem}_${n}${ext}`;
  renameSync(src, join(destDir, target));
  return target;
}

// Finds <name>_<label>_v0_NN.md files sitting loose in agendas/ — never
// recurses into previous/, so already-archived versions are never
// re-processed.
function findVersioned(dir, name, label) {
  const re = new RegExp(`^${escapeRe(name)}_${label}_v0_(\\d+)\\.md$`);
  return listDir(dir)
    .map((file) => ({ file, m: file.match(re) }))
    .filter(({ m }) => m)
    .map(({ file, m }) => ({ file, version: Number(m[1]) }));
}

// Moves a pre-agendas layout (spec/handoff files and their _previous/
// folders loose in the repo root) into agendas/. Scoped to the current
// name and to driftcheck's own zero-padded version format, so a
// hand-written look-alike like foo_spec_v0_1.md is never swept up.
function migrateLegacy(repo, name) {
  const moved = [];
  const legacyFile = new RegExp(`^${escapeRe(name)}_(spec|thread_handoff)_v0_\\d{2,}\\.md$`);
  for (const f of listDir(repo)) {
    if (legacyFile.test(f) && !isDir(join(repo, f))) {
      moveNoClobber(join(repo, f), agendasDir(repo));
      moved.push(f);
    }
  }
  for (const label of ['spec', 'thread_handoff']) {
    const old = join(repo, `${name}_${label}_previous`);
    if (!isDir(old)) continue;
    for (const f of readdirSync(old)) moveNoClobber(join(old, f), previousDir(repo, name, label));
    if (readdirSync(old).length === 0) rmdirSync(old); // only ever removes a folder that's now empty
    moved.push(`${name}_${label}_previous/`);
  }
  return moved;
}

// agendas/ holds the user's working record — private unless they choose
// otherwise. A bare line, no comment: the entry alone says nothing about
// what's inside.
function ensureGitignored(repo) {
  const path = join(repo, '.gitignore');
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const covered = existing.split(/\r?\n/).map((l) => l.trim())
    .some((l) => ['agendas', 'agendas/', '/agendas', '/agendas/'].includes(l));
  if (covered) return false;
  const sep = existing && !existing.endsWith('\n') ? '\n' : '';
  // Anchored with a leading slash: a bare agendas/ would also match any
  // nested folder of that name (e.g. examples/agendas/) anywhere in the repo.
  writeFileSync(path, `${existing}${sep}/${AGENDAS}/\n`);
  return true;
}

// Anything loose in agendas/ besides the current spec + handoff and the
// two folders — reported, never moved.
function strayInAgendas(repo, name, version) {
  const keep = new Set([
    `${name}_spec_v0_${pad2(version)}.md`,
    `${name}_thread_handoff_v0_${pad2(version)}.md`,
    'planning', 'previous',
  ]);
  return listDir(agendasDir(repo)).filter((f) => !keep.has(f));
}

// Every entry in planning/ with its last-edited date. Only <name>_ files
// are archived at close; others are listed but left where they are.
function listPlans(repo, name) {
  return listDir(planningDir(repo)).map((file) => {
    let mtime = null;
    try { mtime = statSync(join(planningDir(repo), file)).mtime; } catch { /* vanished */ }
    return { file, mtime, edited: mtime?.toISOString().slice(0, 10) ?? null, owned: file.startsWith(`${name}_`) };
  }).sort((a, b) => (a.mtime ?? 0) - (b.mtime ?? 0) || a.file.localeCompare(b.file));
}

// Matches ANY <somename>_spec_v0_NN.md in agendas/, regardless of the
// currently detected repo name — not scoped like findVersioned above.
// Used to catch a real failure mode: repoName() reads package.json's
// "name" field, so if that field changes (or the file disappears
// entirely) between runs, the detected name changes too, and a new
// `spec close` would otherwise silently start a second, orphaned
// version sequence under the new name instead of continuing the first.
const ANY_SPEC_RE = /^(.+)_spec_v0_\d+\.md$/;

// Checks the repo root too: an orphaned sequence from before agendas/
// existed is only ever migrated under the current name, so one under an
// old name stays in root and should still be reported.
function otherNamedSpecs(repo, currentName) {
  const others = new Set();
  for (const f of [...listDir(repo), ...listDir(agendasDir(repo))]) {
    const m = f.match(ANY_SPEC_RE);
    if (m && m[1] !== currentName) others.add(m[1]);
  }
  return [...others];
}

function latestSpecVersion(repo, name) {
  const versions = findVersioned(agendasDir(repo), name, 'spec').map((v) => v.version);
  return versions.length ? Math.max(...versions) : 0;
}

// Moves every loose <name>_<label>_v0_NN.md except the one just written
// into previous/<name>_<label>_previous/ — never deletes, never
// overwrites, and sweeps any stragglers, not just the single
// most-recently-superseded file.
function archivePrevious(repo, name, label, keepVersion) {
  const moved = [];
  for (const { file, version } of findVersioned(agendasDir(repo), name, label)) {
    if (version === keepVersion) continue;
    moveNoClobber(join(agendasDir(repo), file), previousDir(repo, name, label));
    moved.push(file);
  }
  return moved;
}

// Plans are meant to be addressed by the handoff written at this close,
// so their cycle ends here: <name>_ entries move to
// previous/<name>_plan_previous/. Anything without the prefix isn't
// driftcheck's to move and stays put.
function archivePlans(repo, name, plans) {
  for (const p of plans) {
    if (p.owned) p.archivedAs = moveNoClobber(join(planningDir(repo), p.file), previousDir(repo, name, 'plan'));
  }
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

// Dates are written in as plain text: file timestamps don't survive a
// copy, a sync, or a paste into a new thread, but this line does.
function plansSection(name, plans) {
  if (!plans.length) return '_No plans were in planning/ this cycle._';
  return plans.map((p) => {
    const when = p.edited ? ` — last edited ${p.edited}` : '';
    const where = p.archivedAs
      ? ` → ${BT}previous/${name}_plan_previous/${p.archivedAs}${BT}`
      : ' (still in planning/ — no ' + `${BT}${name}_${BT}` + ' prefix, so not archived)';
    return `- ${BT}${p.file}${BT}${when}${where}`;
  }).join('\n');
}

function buildHandoffBody(name, version, prevVersion, plans) {
  return `# ${name} Thread Handoff — Checkpoint ${version}

Read alongside ${BT}${name}_spec_v0_${pad2(version)}.md${BT} in this
same folder. This picks up from
${BT}${name}_spec_v0_${pad2(prevVersion)}.md${BT} — read that
checkpoint's entry in the spec's Checkpoint Log before anything else.

## Plans from this cycle

Plans made since the last checkpoint, oldest first. Open only what the
next step needs.

${plansSection(name, plans)}

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
  const header = '── driftcheck spec ─ ' + repo;

  // Setup that's safe to repeat on every run: the folders, a move from
  // the pre-agendas root layout, and the .gitignore entry.
  mkdirSync(planningDir(repo), { recursive: true });
  mkdirSync(join(agendasDir(repo), 'previous'), { recursive: true });
  const migrated = migrateLegacy(repo, name);
  const setupLines = [];
  if (migrated.length) setupLines.push(`         OK  moved ${migrated.length} item(s) from the repo root into ${AGENDAS}/: ${migrated.join(', ')}`);

  const latest = latestSpecVersion(repo, name);
  const driftNames = otherNamedSpecs(repo, name);
  const driftLine = driftNames.length
    ? `         ??  also found spec file(s) under a different name (${driftNames.join(', ')}) — if the repo's detected name changed (e.g. package.json's "name" field), these are an orphaned earlier sequence, not lost, just not continued`
    : '';

  // Gitignoring comes after any Detected scan below, so the scan doesn't
  // report a .gitignore this same run is about to change.
  const finish = (headline, extra = [], version = latest) => {
    const lines = [`${header}\n${headline}`, ...setupLines, ...extra];
    if (ensureGitignored(repo)) lines.push(`         OK  added ${AGENDAS}/ to .gitignore — agendas stay private unless you remove that line`);
    const stray = version > 0 ? strayInAgendas(repo, name, version) : [];
    if (stray.length) lines.push(`         ⚠️  ${AGENDAS}/ should hold only the current spec + handoff loose — also found: ${stray.join(', ')} (not moved; plans belong in planning/)`);
    if (driftLine) lines.push(driftLine);
    return lines.join('\n');
  };

  if (!closeMode) {
    if (latest > 0) {
      return finish(`SPEC     OK  ${name}_spec_v0_${pad2(latest)}.md already exists — nothing to do (${BT}driftcheck spec close${BT} checkpoints forward)`);
    }
    writeFileSync(specPath(repo, name, 1), buildInitialSpecBody(repo, name));
    return finish(`SPEC     OK  created ${AGENDAS}/${name}_spec_v0_01.md`, [], 1);
  }

  if (latest === 0) {
    return finish(`SPEC     ??  no existing ${name}_spec_v0_NN.md found — run ${BT}driftcheck spec${BT} first`);
  }
  const next = latest + 1;
  const existing = readFileSync(specPath(repo, name, latest), 'utf8');
  const { content, notes } = patchSpecBody(existing, repo, name, next);
  const plans = listPlans(repo, name);
  archivePlans(repo, name, plans);
  writeFileSync(specPath(repo, name, next), content);
  writeFileSync(handoffPath(repo, name, next), buildHandoffBody(name, next, latest, plans));

  const archivedSpecs = archivePrevious(repo, name, 'spec', next);
  const archivedHandoffs = archivePrevious(repo, name, 'thread_handoff', next);
  const archivedPlans = plans.filter((p) => p.archivedAs);
  const archiveParts = [];
  if (archivedSpecs.length) archiveParts.push(`${archivedSpecs.length} spec(s) → previous/${name}_spec_previous/`);
  if (archivedHandoffs.length) archiveParts.push(`${archivedHandoffs.length} handoff(s) → previous/${name}_thread_handoff_previous/`);
  if (archivedPlans.length) archiveParts.push(`${archivedPlans.length} plan(s) → previous/${name}_plan_previous/`);
  const archiveNote = archiveParts.length ? ` (archived ${archiveParts.join(', ')})` : '';

  const extra = notes.map((note) => `         ??  ${note}`);
  const unowned = plans.filter((p) => !p.owned).map((p) => p.file);
  if (unowned.length) extra.push(`         ??  left in planning/ without the ${name}_ prefix: ${unowned.join(', ')} — rename to have them archived at close`);

  // A non-empty `notes` means a patch step above (the Detected scan, the
  // Checkpoint Log insert) actually failed to apply — the headline verdict
  // needs to say so, not read as a clean OK with the caveats buried below.
  const verdict = notes.length > 0 ? '⚠️ ' : 'OK ';
  const summary = notes.length > 0 ? 'checkpointed (partial)' : 'checkpointed';
  return finish(`SPEC     ${verdict} ${summary} → ${AGENDAS}/${name}_spec_v0_${pad2(next)}.md + ${name}_thread_handoff_v0_${pad2(next)}.md${archiveNote}`, extra, next);
}

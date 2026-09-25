import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { runSpecCommand } from '../src/spec.mjs';
import { makeTempDir, cleanup } from './helpers.mjs';

const AG = 'agendas';

test('creates v0_01 on first run, no-ops on the second', () => {
  const dir = makeTempDir();
  try {
    const name = basename(dir);
    const out1 = runSpecCommand([dir]);
    assert.match(out1, /SPEC\s+OK\s+created/);
    assert.ok(existsSync(join(dir, AG, `${name}_spec_v0_01.md`)));

    const out2 = runSpecCommand([dir]);
    assert.match(out2, /already exists — nothing to do/);
  } finally { cleanup(dir); }
});

test('close bumps the version and carries the Checkpoint Log forward', () => {
  const dir = makeTempDir();
  try {
    const name = basename(dir);
    runSpecCommand([dir]);
    runSpecCommand(['close', dir]);
    runSpecCommand(['close', dir]);

    assert.ok(existsSync(join(dir, AG, `${name}_spec_v0_03.md`)));
    assert.ok(existsSync(join(dir, AG, `${name}_thread_handoff_v0_03.md`)));

    const finalSpec = readFileSync(join(dir, AG, `${name}_spec_v0_03.md`), 'utf8');
    assert.match(finalSpec, /### Checkpoint 3/);
    assert.match(finalSpec, /### Checkpoint 2/);
    assert.match(finalSpec, /### Checkpoint 1/);
  } finally { cleanup(dir); }
});

test('close archives superseded versions, keeping only the current one in root', () => {
  const dir = makeTempDir();
  try {
    const name = basename(dir);
    runSpecCommand([dir]);
    const out2 = runSpecCommand(['close', dir]);
    assert.match(out2, /archived 1 spec\(s\) → \S+_spec_previous\//);
    assert.doesNotMatch(out2, /handoff\(s\)/); // no prior handoff existed yet to archive

    const out3 = runSpecCommand(['close', dir]);
    assert.match(out3, /archived 1 spec\(s\) → \S+_spec_previous\/, 1 handoff\(s\) → \S+_thread_handoff_previous\//);

    // Root holds only the current version.
    const rootFiles = readdirSync(join(dir, AG));
    assert.ok(rootFiles.includes(`${name}_spec_v0_03.md`));
    assert.ok(rootFiles.includes(`${name}_thread_handoff_v0_03.md`));
    assert.ok(!rootFiles.includes(`${name}_spec_v0_01.md`));
    assert.ok(!rootFiles.includes(`${name}_spec_v0_02.md`));
    assert.ok(!rootFiles.includes(`${name}_thread_handoff_v0_02.md`));

    // Nothing was deleted — it all moved into the archive folders.
    const archivedSpecs = readdirSync(join(dir, AG, 'previous', `${name}_spec_previous`));
    assert.deepEqual(archivedSpecs.sort(), [`${name}_spec_v0_01.md`, `${name}_spec_v0_02.md`]);
    const archivedHandoffs = readdirSync(join(dir, AG, 'previous', `${name}_thread_handoff_previous`));
    assert.deepEqual(archivedHandoffs, [`${name}_thread_handoff_v0_02.md`]);
  } finally { cleanup(dir); }
});

test('close preserves hand-edits to the governance/Purpose sections instead of overwriting them', () => {
  const dir = makeTempDir();
  try {
    const name = basename(dir);
    runSpecCommand([dir]);

    const v1Path = join(dir, AG, `${name}_spec_v0_01.md`);
    let v1 = readFileSync(v1Path, 'utf8');
    // Simulate a real team actually using this file: fill in the
    // Pipeline Architecture placeholder and write real Purpose content.
    v1 = v1.replace('_fill in — e.g. Frontend_', 'Backend').replace('_what this agent is responsible for_', 'Core game logic');
    v1 = v1.replace(
      '_Not inferable from repo data — fill this in: what is this, and why\ndoes it exist?_',
      'A real-time multiplayer card game.',
    );
    writeFileSync(v1Path, v1);

    runSpecCommand(['close', dir]);

    const v2 = readFileSync(join(dir, AG, `${name}_spec_v0_02.md`), 'utf8');
    assert.match(v2, /\| Backend \| 1 Agent \| Core game logic \|/);
    assert.match(v2, /A real-time multiplayer card game\./);
    // The Detected section should still have refreshed, though.
    assert.match(v2, /### Checkpoint 2/);
  } finally { cleanup(dir); }
});

test('warns when a spec file exists under a different detected name, instead of silently forking a new sequence', () => {
  const dir = makeTempDir();
  try {
    // Simulate a real failure mode: an earlier spec sequence existed
    // under one name (e.g. a package.json "name" field that's since
    // changed or disappeared), and the currently-detected name is
    // different, so init would otherwise fork a silent second history.
    writeFileSync(join(dir, 'OldName_spec_v0_03.md'), '# OldName — spec v0.03\n');

    const out = runSpecCommand([dir]);
    assert.match(out, /also found spec file\(s\) under a different name \(OldName\)/);
  } finally { cleanup(dir); }
});

test('close reports plainly, not silently, if a section marker is missing to patch', () => {
  const dir = makeTempDir();
  try {
    const name = basename(dir);
    runSpecCommand([dir]);
    const v1Path = join(dir, AG, `${name}_spec_v0_01.md`);
    const mangled = readFileSync(v1Path, 'utf8').replace('## Checkpoint Log', '## Renamed Section');
    writeFileSync(v1Path, mangled);

    const out = runSpecCommand(['close', dir]);
    assert.match(out, /\?\?\s+"## Checkpoint Log" section not found/);
  } finally { cleanup(dir); }
});

// Regression coverage: the top-level verdict used to always read "SPEC
// OK checkpointed" even when a patch step above genuinely failed and
// got reported as a "??" sub-note — a false-clean headline for anyone
// who only reads the first line.
test('close marks the top-level verdict as partial when a patch step fails, not a plain OK', () => {
  const dir = makeTempDir();
  try {
    const name = basename(dir);
    runSpecCommand([dir]);
    const v1Path = join(dir, AG, `${name}_spec_v0_01.md`);
    const mangled = readFileSync(v1Path, 'utf8').replace('## Checkpoint Log', '## Renamed Section');
    writeFileSync(v1Path, mangled);

    const out = runSpecCommand(['close', dir]);
    const verdictLine = out.split('\n').find((l) => l.startsWith('SPEC'));
    assert.match(verdictLine, /^SPEC\s+⚠️\s+checkpointed \(partial\)/);
    assert.doesNotMatch(verdictLine, /^SPEC\s+OK/);
  } finally { cleanup(dir); }
});

test('close keeps a plain OK verdict when every patch step succeeds', () => {
  const dir = makeTempDir();
  try {
    runSpecCommand([dir]);
    const out = runSpecCommand(['close', dir]);
    const verdictLine = out.split('\n').find((l) => l.startsWith('SPEC'));
    assert.match(verdictLine, /^SPEC\s+OK\s+checkpointed →/);
    assert.doesNotMatch(verdictLine, /partial/);
  } finally { cleanup(dir); }
});

test('close with no existing spec errors cleanly instead of guessing', () => {
  const dir = makeTempDir();
  try {
    const out = runSpecCommand(['close', dir]);
    assert.match(out, /no existing \S+_spec_v0_NN\.md found/);
  } finally { cleanup(dir); }
});

test('uses the target repo\'s own package.json name, scope stripped', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@scope/my-thing' }));
    const out = runSpecCommand([dir]);
    assert.match(out, /created agendas\/my-thing_spec_v0_01\.md/);
  } finally { cleanup(dir); }
});

// ── agendas/ ─────────────────────────────────────────────────────────

test('spec adds a bare agendas/ line to .gitignore once, keeping what was there', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, '.gitignore'), 'node_modules/');
    const out = runSpecCommand([dir]);
    assert.match(out, /added agendas\/ to \.gitignore/);
    assert.equal(readFileSync(join(dir, '.gitignore'), 'utf8'), 'node_modules/\n/agendas/\n');

    const again = runSpecCommand([dir]);
    assert.doesNotMatch(again, /\.gitignore/);
    assert.equal(readFileSync(join(dir, '.gitignore'), 'utf8'), 'node_modules/\n/agendas/\n');
  } finally { cleanup(dir); }
});

test('spec creates planning/ and previous/ inside agendas/', () => {
  const dir = makeTempDir();
  try {
    runSpecCommand([dir]);
    assert.deepEqual(readdirSync(join(dir, AG)).sort(), [`${basename(dir)}_spec_v0_01.md`, 'planning', 'previous'].sort());
  } finally { cleanup(dir); }
});

test('migrates a pre-agendas root layout, but never a hand-written look-alike', () => {
  const dir = makeTempDir();
  try {
    const name = basename(dir);
    writeFileSync(join(dir, `${name}_spec_v0_02.md`), '# x — spec v0.02\n\n## Checkpoint Log\n\n');
    writeFileSync(join(dir, `${name}_thread_handoff_v0_02.md`), 'handoff 2');
    mkdirSync(join(dir, `${name}_spec_previous`));
    writeFileSync(join(dir, `${name}_spec_previous`, `${name}_spec_v0_01.md`), 'spec 1');
    writeFileSync(join(dir, `${name}_spec_v0_1.md`), 'hand-written, not generated');

    const out = runSpecCommand([dir]);
    assert.match(out, /moved 3 item\(s\) from the repo root into agendas\//);
    assert.match(out, /already exists — nothing to do/);
    assert.ok(existsSync(join(dir, AG, `${name}_spec_v0_02.md`)));
    assert.ok(existsSync(join(dir, AG, `${name}_thread_handoff_v0_02.md`)));
    assert.ok(existsSync(join(dir, AG, 'previous', `${name}_spec_previous`, `${name}_spec_v0_01.md`)));
    assert.ok(!existsSync(join(dir, `${name}_spec_previous`)));
    assert.ok(existsSync(join(dir, `${name}_spec_v0_1.md`))); // left alone
  } finally { cleanup(dir); }
});

test('close lists plans oldest first with dates, and archives only <repo>_ ones', () => {
  const dir = makeTempDir();
  try {
    const name = basename(dir);
    runSpecCommand([dir]);
    const planning = join(dir, AG, 'planning');
    writeFileSync(join(planning, `${name}_newer.pdf`), 'b');
    writeFileSync(join(planning, `${name}_older.md`), 'a');
    writeFileSync(join(planning, 'scratch.txt'), 'c');
    utimesSync(join(planning, `${name}_older.md`), new Date('2026-01-01'), new Date('2026-01-01'));
    utimesSync(join(planning, `${name}_newer.pdf`), new Date('2026-02-01'), new Date('2026-02-01'));
    utimesSync(join(planning, 'scratch.txt'), new Date('2026-03-01'), new Date('2026-03-01'));

    const out = runSpecCommand(['close', dir]);
    assert.match(out, /2 plan\(s\) → previous\/\S+_plan_previous\//);
    assert.match(out, /without the \S+ prefix: scratch\.txt/);
    assert.deepEqual(readdirSync(planning), ['scratch.txt']);
    assert.deepEqual(readdirSync(join(dir, AG, 'previous', `${name}_plan_previous`)).sort(), [`${name}_newer.pdf`, `${name}_older.md`]);

    const handoff = readFileSync(join(dir, AG, `${name}_thread_handoff_v0_02.md`), 'utf8');
    const older = handoff.indexOf(`${name}_older.md\` — last edited 2026-01-01`);
    const newer = handoff.indexOf(`${name}_newer.pdf\` — last edited 2026-02-01`);
    assert.ok(older > -1 && newer > older);
    assert.match(handoff, /scratch\.txt` — last edited 2026-03-01 \(still in planning\//);
  } finally { cleanup(dir); }
});

test('a plan archived under a name already taken becomes _2, _3 — never overwritten', () => {
  const dir = makeTempDir();
  try {
    const name = basename(dir);
    runSpecCommand([dir]);
    const plan = join(dir, AG, 'planning', `${name}_api.md`);
    for (const body of ['first', 'second', 'third']) {
      writeFileSync(plan, body);
      runSpecCommand(['close', dir]);
    }
    const archive = join(dir, AG, 'previous', `${name}_plan_previous`);
    assert.equal(readFileSync(join(archive, `${name}_api.md`), 'utf8'), 'first');
    assert.equal(readFileSync(join(archive, `${name}_api_2.md`), 'utf8'), 'second');
    assert.equal(readFileSync(join(archive, `${name}_api_3.md`), 'utf8'), 'third');

    const handoff = readFileSync(join(dir, AG, `${name}_thread_handoff_v0_04.md`), 'utf8');
    assert.match(handoff, /_plan_previous\/\S+_api_3\.md/);
  } finally { cleanup(dir); }
});

test('warns about stray files loose in agendas/ without moving them', () => {
  const dir = makeTempDir();
  try {
    runSpecCommand([dir]);
    writeFileSync(join(dir, AG, 'notes.md'), 'x');
    const out = runSpecCommand(['close', dir]);
    assert.match(out, /⚠️\s+agendas\/ should hold only the current spec \+ handoff loose — also found: notes\.md/);
    assert.ok(existsSync(join(dir, AG, 'notes.md')));
  } finally { cleanup(dir); }
});

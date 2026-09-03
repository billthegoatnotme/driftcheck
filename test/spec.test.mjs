import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { runSpecCommand } from '../src/spec.mjs';
import { makeTempDir, cleanup } from './helpers.mjs';

test('creates v0_01 on first run, no-ops on the second', () => {
  const dir = makeTempDir();
  try {
    const name = basename(dir);
    const out1 = runSpecCommand([dir]);
    assert.match(out1, /SPEC\s+OK\s+created/);
    assert.ok(existsSync(join(dir, `${name}_spec_v0_01.md`)));

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

    assert.ok(existsSync(join(dir, `${name}_spec_v0_03.md`)));
    assert.ok(existsSync(join(dir, `${name}_thread_handoff_v0_03.md`)));

    const finalSpec = readFileSync(join(dir, `${name}_spec_v0_03.md`), 'utf8');
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
    const rootFiles = readdirSync(dir);
    assert.ok(rootFiles.includes(`${name}_spec_v0_03.md`));
    assert.ok(rootFiles.includes(`${name}_thread_handoff_v0_03.md`));
    assert.ok(!rootFiles.includes(`${name}_spec_v0_01.md`));
    assert.ok(!rootFiles.includes(`${name}_spec_v0_02.md`));
    assert.ok(!rootFiles.includes(`${name}_thread_handoff_v0_02.md`));

    // Nothing was deleted — it all moved into the archive folders.
    const archivedSpecs = readdirSync(join(dir, `${name}_spec_previous`));
    assert.deepEqual(archivedSpecs.sort(), [`${name}_spec_v0_01.md`, `${name}_spec_v0_02.md`]);
    const archivedHandoffs = readdirSync(join(dir, `${name}_thread_handoff_previous`));
    assert.deepEqual(archivedHandoffs, [`${name}_thread_handoff_v0_02.md`]);
  } finally { cleanup(dir); }
});

test('close preserves hand-edits to the governance/Purpose sections instead of overwriting them', () => {
  const dir = makeTempDir();
  try {
    const name = basename(dir);
    runSpecCommand([dir]);

    const v1Path = join(dir, `${name}_spec_v0_01.md`);
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

    const v2 = readFileSync(join(dir, `${name}_spec_v0_02.md`), 'utf8');
    assert.match(v2, /\| Backend \| 1 Agent \| Core game logic \|/);
    assert.match(v2, /A real-time multiplayer card game\./);
    // The Detected section should still have refreshed, though.
    assert.match(v2, /### Checkpoint 2/);
  } finally { cleanup(dir); }
});

test('close reports plainly, not silently, if a section marker is missing to patch', () => {
  const dir = makeTempDir();
  try {
    const name = basename(dir);
    runSpecCommand([dir]);
    const v1Path = join(dir, `${name}_spec_v0_01.md`);
    const mangled = readFileSync(v1Path, 'utf8').replace('## Checkpoint Log', '## Renamed Section');
    writeFileSync(v1Path, mangled);

    const out = runSpecCommand(['close', dir]);
    assert.match(out, /\?\?\s+"## Checkpoint Log" section not found/);
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
    assert.match(out, /created my-thing_spec_v0_01\.md/);
  } finally { cleanup(dir); }
});

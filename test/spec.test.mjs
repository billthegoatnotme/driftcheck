import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

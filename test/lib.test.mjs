import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { sh } from '../src/lib/shell.mjs';
import { logHistory } from '../src/lib/history.mjs';
import { makeTempDir, cleanup } from './helpers.mjs';

test('sh runs a command in the given cwd and captures stdout', () => {
  const dir = makeTempDir();
  try {
    const r = sh(dir, 'node -e "console.log(1+1)"');
    assert.equal(r.ok, true);
    assert.match(r.out, /2/);
  } finally { cleanup(dir); }
});

test('sh reports ok:false for a nonzero exit', () => {
  const dir = makeTempDir();
  try {
    const r = sh(dir, 'node -e "process.exit(1)"');
    assert.equal(r.ok, false);
  } finally { cleanup(dir); }
});

test('logHistory creates the file (and parent dir) on first call, returns null prev', () => {
  const dir = makeTempDir();
  try {
    const histFile = join(dir, 'sub', 'history.jsonl');
    const prev = logHistory(histFile, { at: 'now', n: 1 });
    assert.equal(prev, null);
    assert.ok(existsSync(histFile));
  } finally { cleanup(dir); }
});

test('logHistory returns the previous record on the next call', () => {
  const dir = makeTempDir();
  try {
    const histFile = join(dir, 'history.jsonl');
    logHistory(histFile, { at: 'first', n: 1 });
    const prev = logHistory(histFile, { at: 'second', n: 2 });
    assert.equal(prev.n, 1);
  } finally { cleanup(dir); }
});

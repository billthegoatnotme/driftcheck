import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { sh, shArgs } from '../src/lib/shell.mjs';
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

test('sh exposes the raw exit code, not just ok/not-ok', () => {
  const dir = makeTempDir();
  try {
    const r = sh(dir, 'node -e "process.exit(17)"');
    assert.equal(r.code, 17);
  } finally { cleanup(dir); }
});

// shArgs runs a real executable directly, no shell — an argument
// containing shell metacharacters must reach the child process intact
// as a single argv entry, not get parsed/split/expanded by a shell.
test('shArgs passes each argument through untouched, with no shell involved', () => {
  const dir = makeTempDir();
  try {
    const r = shArgs(dir, process.execPath, ['-e', 'console.log(process.argv[1])', '$(echo injected); & echo two']);
    assert.equal(r.ok, true);
    assert.match(r.out, /\$\(echo injected\); & echo two/);
  } finally { cleanup(dir); }
});

test('shArgs reports the exit code for a failing command', () => {
  const dir = makeTempDir();
  try {
    const r = shArgs(dir, process.execPath, ['-e', 'process.exit(3)']);
    assert.equal(r.ok, false);
    assert.equal(r.code, 3);
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

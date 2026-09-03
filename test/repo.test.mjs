import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runRepoCheck } from '../src/repo.mjs';
import { makeTempDir, cleanup } from './helpers.mjs';

function git(dir, args) {
  execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
}

test('not a git repository degrades cleanly, no crash', () => {
  const dir = makeTempDir();
  try {
    const out = runRepoCheck([dir]);
    assert.match(out, /GIT\s+\?\?\s+not a git repository/);
  } finally { cleanup(dir); }
});

test('a git repo with no origin/main degrades cleanly', () => {
  const dir = makeTempDir();
  try {
    git(dir, ['init', '-q']);
    git(dir, ['config', 'user.email', 't@example.com']);
    git(dir, ['config', 'user.name', 'Test']);
    writeFileSync(join(dir, 'a.txt'), 'hi\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'init']);
    const out = runRepoCheck([dir]);
    assert.match(out, /GIT\s+\?\?\s+no origin\/main to compare against/);
  } finally { cleanup(dir); }
});

test('no prisma/schema.prisma skips the DB check cleanly', () => {
  const dir = makeTempDir();
  try {
    const out = runRepoCheck([dir]);
    assert.match(out, /DB\s+—\s+no prisma\/schema\.prisma/);
  } finally { cleanup(dir); }
});

test('Prisma present but no .env.local is reported inconclusive, not skipped', () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'prisma'), { recursive: true });
    writeFileSync(join(dir, 'prisma', 'schema.prisma'), '// schema\n');
    const out = runRepoCheck([dir]);
    assert.match(out, /DB\s+\?\?\s+Prisma project but no \.env\.local/);
  } finally { cleanup(dir); }
});

test('--tests with no "test" script in package.json skips cleanly', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x' }));
    const out = runRepoCheck([dir, '--tests']);
    assert.match(out, /TESTS\s+\?\?\s+no "test" script/);
  } finally { cleanup(dir); }
});

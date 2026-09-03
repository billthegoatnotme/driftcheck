import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runRepoCheck, parseVitestSummary, VITEST_FAIL_FILE_RE } from '../src/repo.mjs';
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

test('a "driftcheck:db" script reports OK on a zero exit, no Prisma needed', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'x',
      scripts: { 'driftcheck:db': 'node -e "process.exit(0)"' },
    }));
    const out = runRepoCheck([dir]);
    assert.match(out, /DB\s+OK\s+`node -e "process\.exit\(0\)"` reports no drift/);
  } finally { cleanup(dir); }
});

test('a "driftcheck:db" script reports drift on a nonzero exit, showing the real output not npm\'s echo', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'x',
      scripts: { 'driftcheck:db': 'node -e "console.error(\'3 pending migrations\'); process.exit(1)"' },
    }));
    const out = runRepoCheck([dir]);
    assert.match(out, /DB\s+⚠️\s+`.+` reported drift \(nonzero exit\) — first line: 3 pending migrations/);
    assert.doesNotMatch(out, /first line: > /); // must skip npm's own "> driftcheck:db" echo line
  } finally { cleanup(dir); }
});

test('a "driftcheck:db" script takes priority over Prisma auto-detection when both are present', () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'prisma'), { recursive: true });
    writeFileSync(join(dir, 'prisma', 'schema.prisma'), '// schema\n');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'x',
      scripts: { 'driftcheck:db': 'node -e "process.exit(0)"' },
    }));
    const out = runRepoCheck([dir]);
    assert.match(out, /DB\s+OK\s+`node -e "process\.exit\(0\)"` reports no drift/);
    assert.doesNotMatch(out, /Prisma/);
  } finally { cleanup(dir); }
});

test('no "driftcheck:db" script and no Prisma schema skips cleanly, naming both', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x' }));
    const out = runRepoCheck([dir]);
    assert.match(out, /DB\s+—\s+no prisma\/schema\.prisma and no "driftcheck:db" script — skipping/);
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

// Regression coverage for two real bugs a live Vitest run surfaced
// (2026-09-03): the summary parser had no branch for "all tests
// failed, nothing passed" (Vitest omits the "X passed" segment
// entirely in that case), and the FAIL-file regex only matched
// .test.ts/.tsx, never .test.js/.mjs — inherited unchanged from the
// original private tool, which only ever ran against a TypeScript
// project. These samples are captured verbatim from real `vitest run`
// output, not invented — no Vitest devDependency needed to verify the
// parser against them.

test('parseVitestSummary handles the "all failed, nothing passed" case', () => {
  const out = '\n Test Files  1 failed (1)\n      Tests  3 failed (3)\n   Start at  22:07:23\n';
  const summary = parseVitestSummary(out);
  assert.deepEqual(summary, { total: 3, passed: 0 });
});

test('parseVitestSummary handles the all-passed case', () => {
  const out = '\n Test Files  1 passed (1)\n      Tests  2 passed (2)\n';
  const summary = parseVitestSummary(out);
  assert.deepEqual(summary, { total: 2, passed: 2 });
});

test('parseVitestSummary handles the mixed pass/fail case', () => {
  const out = '\n Test Files  1 failed (1)\n      Tests  1 failed | 1 passed (2)\n';
  const summary = parseVitestSummary(out);
  assert.deepEqual(summary, { total: 2, passed: 1 });
});

test('parseVitestSummary returns null when there is no summary line at all', () => {
  assert.equal(parseVitestSummary('Error: something exploded before any test ran\n'), null);
});

test('VITEST_FAIL_FILE_RE matches .test.js, not just .test.ts/.tsx', () => {
  const out = ' FAIL  src/math.test.js > Calculator > TODO: assert expected behavior\nError: not yet implemented: Calculator\n';
  const matches = [...out.matchAll(VITEST_FAIL_FILE_RE)].map((m) => m[1]);
  assert.deepEqual(matches, ['src/math.test.js']);
});

test('VITEST_FAIL_FILE_RE still matches .test.tsx for TypeScript projects', () => {
  const out = ' FAIL  src/components/Button.test.tsx > renders\n';
  const matches = [...out.matchAll(VITEST_FAIL_FILE_RE)].map((m) => m[1]);
  assert.deepEqual(matches, ['src/components/Button.test.tsx']);
});

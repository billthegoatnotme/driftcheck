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

// Sets up a real "origin" as a local bare repo (so ancestor-of-origin
// checks use genuine git plumbing) with a real feature branch pushed
// nowhere, plus a fake `gh` on PATH reporting a specific PR list — the
// only piece that actually needs mocking.
function withOrphanedBranchRepo(prBodyLines, testFn) {
  const dir = makeTempDir();
  const originDir = makeTempDir();
  const ghDir = makeTempDir();
  const origPath = process.env.PATH;
  try {
    git(originDir, ['init', '-q', '--bare']);
    git(dir, ['init', '-q']);
    git(dir, ['config', 'user.email', 't@example.com']);
    git(dir, ['config', 'user.name', 'Test']);
    git(dir, ['remote', 'add', 'origin', originDir]);
    writeFileSync(join(dir, 'a.txt'), 'hi\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'init']);
    git(dir, ['push', '-q', 'origin', 'HEAD:main']);
    git(dir, ['fetch', '-q', 'origin']);

    git(dir, ['checkout', '-q', '-b', 'feat/orphaned']);
    writeFileSync(join(dir, 'b.txt'), 'new\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'orphaned work']);
    git(dir, ['checkout', '-q', 'main']);

    writeFileSync(join(ghDir, 'gh.cmd'), `@echo off\r\necho ${prBodyLines}\r\n`);
    process.env.PATH = `${ghDir};${origPath}`;

    testFn(dir);
  } finally {
    process.env.PATH = origPath;
    cleanup(dir); cleanup(originDir); cleanup(ghDir);
  }
}

test('flags a local branch with unmerged commits behind an already-merged PR', () => {
  withOrphanedBranchRepo(
    JSON.stringify([{ number: 7, state: 'MERGED', headRefName: 'feat/orphaned' }]),
    (dir) => {
      const out = runRepoCheck([dir]);
      assert.match(out, /branch 'feat\/orphaned' has 1 commit\(s\) not in origin\/main, but PR #7 is already MERGED — likely pushed after merge, not included/);
    },
  );
});

test('does not flag a local branch whose PR is still open', () => {
  withOrphanedBranchRepo(
    JSON.stringify([{ number: 7, state: 'OPEN', headRefName: 'feat/orphaned' }]),
    (dir) => {
      const out = runRepoCheck([dir]);
      assert.doesNotMatch(out, /likely pushed after merge/);
    },
  );
});

test('.driftcheck/ does not count as a dirty file, even when the repo does not gitignore it', () => {
  const dir = makeTempDir();
  try {
    git(dir, ['init', '-q']);
    git(dir, ['config', 'user.email', 't@example.com']);
    git(dir, ['config', 'user.name', 'Test']);
    writeFileSync(join(dir, 'a.txt'), 'hi\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'init']);

    // This run's own history write lands in .driftcheck/ — without the
    // exclusion, that alone would flip the tree from clean to dirty
    // before the command even finishes.
    const out = runRepoCheck([dir]);
    assert.match(out, /tree clean/);
    assert.doesNotMatch(out, /dirty file\(s\)/);
  } finally { cleanup(dir); }
});

test('NOTES logs a repo-relative history path, not an absolute one', () => {
  const dir = makeTempDir();
  try {
    const out = runRepoCheck([dir]);
    // The header line legitimately shows the target repo's own absolute
    // path (and is stripped off before `driftcheck spec` embeds this
    // output) — only the NOTES line itself is the leak this guards
    // against, since that line is what actually ends up committed.
    const notesLine = out.split('\n').find((l) => l.startsWith('NOTES'));
    assert.match(notesLine, /^NOTES\s+run #1 logged → \.driftcheck\/repo-history\.jsonl$/);
    assert.doesNotMatch(notesLine, /[A-Za-z]:[\\/]/);
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
    assert.match(out, /DB\s+⚠️\s+`.+` reported drift \(exit 1\): 3 pending migrations/);
    assert.doesNotMatch(out, /: > /); // must skip npm's own "> driftcheck:db" echo line
  } finally { cleanup(dir); }
});

test('a "driftcheck:db" script surfaces up to 3 lines of real detail, not just the first', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'x',
      scripts: {
        'driftcheck:db': 'node -e "console.error(\'line one\'); console.error(\'line two\'); console.error(\'line three\'); console.error(\'line four\'); process.exit(1)"',
      },
    }));
    const out = runRepoCheck([dir]);
    assert.match(out, /: line one \| line two \| line three …$/m);
  } finally { cleanup(dir); }
});

test('a "driftcheck:db" script exiting with anything other than 0 or 1 is inconclusive, not drift', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'x',
      scripts: { 'driftcheck:db': 'node -e "console.error(\'ECONNREFUSED\'); process.exit(17)"' },
    }));
    const out = runRepoCheck([dir]);
    assert.match(out, /DB\s+\?\?\s+`.+` exited 17 \(not the 0=clean\/1=drift convention\) — inconclusive: ECONNREFUSED/);
    assert.doesNotMatch(out, /DB\s+⚠️/);
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

// Fakes a whole Vitest project by hand: a "test" script that reports one
// failing file, plus a `node_modules/vitest` with a real, invokable bin
// entry (matching vitest's own package.json "bin" shape) so the
// isolation re-run resolves and runs it directly via `node <entry>` —
// exactly what src/repo.mjs's resolveVitestBin()/shArgs() path does in
// production, no real Vitest install needed to exercise it.
function setupFlakeFixture(dir, isolationBehavior) {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'x',
    scripts: { test: 'node run-vitest-fake.cjs' },
  }));
  writeFileSync(join(dir, 'run-vitest-fake.cjs'),
    "console.log('FAIL  src/foo.test.mjs > widget does the thing');\n" +
    "console.log('Tests  1 failed (1)');\n" +
    'process.exit(1);\n');

  mkdirSync(join(dir, 'node_modules', 'vitest'), { recursive: true });
  writeFileSync(join(dir, 'node_modules', 'vitest', 'package.json'),
    JSON.stringify({ name: 'vitest', bin: { vitest: './entry.cjs' } }));

  const entries = {
    crash: 'process.exit(2);\n',
    clean: "console.log('Tests  1 passed (1)');\nprocess.exit(0);\n",
    real: "console.log('FAIL  src/foo.test.mjs > widget does the thing');\nprocess.exit(1);\n",
  };
  writeFileSync(join(dir, 'node_modules', 'vitest', 'entry.cjs'), entries[isolationBehavior]);
}

test('an isolation re-run that crashes (nonzero exit, no matching FAIL line) is inconclusive, not FLAKY', () => {
  const dir = makeTempDir();
  try {
    setupFlakeFixture(dir, 'crash');
    const out = runRepoCheck([dir, '--tests']);
    assert.match(out, /TESTS\s+\?\?\s+isolation re-run of src\/foo\.test\.mjs did not complete cleanly \(exit 2, no matching FAIL line\)/);
    assert.doesNotMatch(out, /FLAKY/);
  } finally { cleanup(dir); }
});

test('an isolation re-run that passes cleanly reports FLAKY without claiming it is not a regression', () => {
  const dir = makeTempDir();
  try {
    setupFlakeFixture(dir, 'clean');
    const out = runRepoCheck([dir, '--tests']);
    assert.match(out, /TESTS\s+OK\*.*did not reproduce in isolation/);
    assert.doesNotMatch(out, /Not a regression/);
  } finally { cleanup(dir); }
});

test('an isolation re-run that fails again reports a REAL failure, invoking vitest directly with no shell', () => {
  const dir = makeTempDir();
  try {
    setupFlakeFixture(dir, 'real');
    const out = runRepoCheck([dir, '--tests']);
    assert.match(out, /TESTS\s+❌\s+REAL failures in: src\/foo\.test\.mjs \(fail even in isolation\)/);
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

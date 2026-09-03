import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runDocsCheck } from '../src/docs.mjs';
import { makeTempDir, cleanup } from './helpers.mjs';

test('correct arrow-pair and bare-path references pass silently', () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'lib.js'), 'function doThing() { return 1; }\n');
    writeFileSync(join(dir, 'CLAUDE.md'), '`src/lib.js -> doThing()`\n`src/lib.js`\n');
    const out = runDocsCheck([dir]);
    assert.match(out, /CLAUDE\.md\s+OK\s+2 reference/);
  } finally { cleanup(dir); }
});

// Regression coverage for the worst finding from the first external
// review: declRe ran against raw file content with no awareness of
// comments or strings, so a genuinely removed declaration could still
// read as "still declared" — a false *negative*, exactly backwards for
// a tool whose whole job is catching drift.

test('a declaration mentioned only in a comment is flagged as removed, not still declared', () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'lib.js'), '// function doThing() was removed\nfunction other() { return 1; }\n');
    writeFileSync(join(dir, 'CLAUDE.md'), '`src/lib.js -> doThing()`\n');
    const out = runDocsCheck([dir]);
    assert.match(out, /doThing\(\) — not declared anywhere in the repo/);
  } finally { cleanup(dir); }
});

test('a declaration mentioned only inside a string literal is flagged as removed, not still declared', () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'lib.js'), 'const note = "function doThing()";\nfunction other() { return 1; }\n');
    writeFileSync(join(dir, 'CLAUDE.md'), '`src/lib.js -> doThing()`\n');
    const out = runDocsCheck([dir]);
    assert.match(out, /doThing\(\) — not declared anywhere in the repo/);
  } finally { cleanup(dir); }
});

test('renamed-away function is flagged as fully missing', () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'lib.js'), 'function doThing() { return 1; }\n');
    writeFileSync(join(dir, 'CLAUDE.md'), '`src/lib.js -> renamedAway()`\n');
    const out = runDocsCheck([dir]);
    assert.match(out, /renamedAway\(\) — not declared anywhere in the repo/);
  } finally { cleanup(dir); }
});

test('moved function is traced to its new file', () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.js'), '// nothing here\n');
    writeFileSync(join(dir, 'src', 'b.js'), 'function helper() { return 1; }\n');
    writeFileSync(join(dir, 'CLAUDE.md'), '`src/a.js -> helper()`\n');
    const out = runDocsCheck([dir]);
    assert.match(out, /not in that file — found in src\/b\.js instead/);
  } finally { cleanup(dir); }
});

test('the "moved/renamed?" search does not look inside a gitignored directory', () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'src'), { recursive: true });
    mkdirSync(join(dir, 'generated'), { recursive: true });
    writeFileSync(join(dir, '.gitignore'), 'generated/\nnode_modules\n*.log\n');
    writeFileSync(join(dir, 'src', 'a.js'), '// nothing here\n');
    writeFileSync(join(dir, 'generated', 'stale.js'), 'function helper() { return 1; }\n');
    writeFileSync(join(dir, 'CLAUDE.md'), '`src/a.js -> helper()`\n');
    const out = runDocsCheck([dir]);
    assert.match(out, /not declared anywhere in the repo/);
    assert.doesNotMatch(out, /found in generated/);
  } finally { cleanup(dir); }
});

test('the "moved/renamed?" search still finds a match outside a gitignored directory', () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'src'), { recursive: true });
    mkdirSync(join(dir, 'generated'), { recursive: true });
    writeFileSync(join(dir, '.gitignore'), 'generated/\n');
    writeFileSync(join(dir, 'src', 'a.js'), '// nothing here\n');
    writeFileSync(join(dir, 'src', 'b.js'), 'function helper() { return 1; }\n');
    writeFileSync(join(dir, 'CLAUDE.md'), '`src/a.js -> helper()`\n');
    const out = runDocsCheck([dir]);
    assert.match(out, /found in src\/b\.js instead/);
  } finally { cleanup(dir); }
});

test('gitignore parsing ignores wildcard and nested-path lines rather than guessing', () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'weird-but-not-skipped'), { recursive: true });
    // "*.log" is a wildcard (skipped entirely, not treated as a dir
    // named "*.log"); "packages/dist" is nested (out of scope) - a
    // directory that happens to share a name with neither should still
    // be walked normally.
    writeFileSync(join(dir, '.gitignore'), '*.log\npackages/dist\n');
    writeFileSync(join(dir, 'weird-but-not-skipped', 'x.js'), 'function helper() { return 1; }\n');
    writeFileSync(join(dir, 'a.js'), '// nothing here\n');
    writeFileSync(join(dir, 'CLAUDE.md'), '`a.js -> helper()`\n');
    const out = runDocsCheck([dir]);
    assert.match(out, /found in weird-but-not-skipped\/x\.js instead/);
  } finally { cleanup(dir); }
});

test('a bare path that resolves outside the repo root is flagged, not silently checked', () => {
  const outer = makeTempDir();
  try {
    const repo = join(outer, 'repo');
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(outer, 'secret.js'), '// a real file, just outside the repo\n');
    writeFileSync(join(repo, 'CLAUDE.md'), '`../secret.js`\n');
    const out = runDocsCheck([repo]);
    assert.match(out, /\.\.\/secret\.js — resolves outside the repo root — not checked/);
  } finally { cleanup(outer); }
});

test('an arrow-pair file path that resolves outside the repo root is flagged, not silently read', () => {
  const outer = makeTempDir();
  try {
    const repo = join(outer, 'repo');
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(outer, 'secret.js'), 'function leakedFn() {}\n');
    writeFileSync(join(repo, 'CLAUDE.md'), '`../secret.js -> leakedFn()`\n');
    const out = runDocsCheck([repo]);
    assert.match(out, /leakedFn\(\) — file path resolves outside the repo root — not checked/);
  } finally { cleanup(outer); }
});

test('missing bare path is flagged', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'CLAUDE.md'), '`src/nope.js`\n');
    const out = runDocsCheck([dir]);
    assert.match(out, /src\/nope\.js — file not found/);
  } finally { cleanup(dir); }
});

test('a directory-less filename is ignored as prose, not a path claim', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'CLAUDE.md'), 'See `lib.js` for details.\n');
    const out = runDocsCheck([dir]);
    assert.match(out, /no checkable references found/);
  } finally { cleanup(dir); }
});

test('reports plainly when no target document exists', () => {
  const dir = makeTempDir();
  try {
    const out = runDocsCheck([dir]);
    assert.match(out, /no target document found/);
  } finally { cleanup(dir); }
});

test('--file targets a specific document instead of the defaults', () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(join(dir, 'CONTRIBUTING.md'), '`docs/guide.md`\n');
    writeFileSync(join(dir, 'docs', 'guide.md'), '# hi\n');
    const out = runDocsCheck([dir, '--file', 'CONTRIBUTING.md']);
    assert.match(out, /CONTRIBUTING\.md\s+OK/);
  } finally { cleanup(dir); }
});

test('accepts the ASCII arrow as well as the unicode arrow', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'src.js'), 'const thing = 1;\n');
    writeFileSync(join(dir, 'CLAUDE.md'), '`src.js -> thing`\n');
    const out = runDocsCheck([dir]);
    assert.doesNotMatch(out, /drifted/);
  } finally { cleanup(dir); }
});

test('NOTES logs a repo-relative history path, not an absolute one', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'CLAUDE.md'), 'no checkable refs here\n');
    const out = runDocsCheck([dir]);
    const notesLine = out.split('\n').find((l) => l.trim().startsWith('NOTES'));
    assert.match(notesLine, /NOTES\s+run #1 logged → \.driftcheck\/docs-history\.jsonl$/);
    assert.doesNotMatch(notesLine, /[A-Za-z]:[\\/]/);
  } finally { cleanup(dir); }
});

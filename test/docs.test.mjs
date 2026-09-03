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

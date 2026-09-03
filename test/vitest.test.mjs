import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runVitestScaffold } from '../src/vitest.mjs';
import { makeTempDir, cleanup } from './helpers.mjs';

test('creates vitest.config.mjs and wires scripts.test when neither exists', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x' }));
    const out = runVitestScaffold([dir]);
    assert.match(out, /CONFIG\s+OK\s+created vitest\.config\.mjs/);
    assert.match(out, /SCRIPT\s+OK\s+added "test": "vitest run"/);
    assert.ok(existsSync(join(dir, 'vitest.config.mjs')));
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts.test, 'vitest run');
  } finally { cleanup(dir); }
});

test('is idempotent — leaves an existing config and script alone', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x' }));
    runVitestScaffold([dir]);
    const out = runVitestScaffold([dir]);
    assert.match(out, /CONFIG\s+—\s+existing Vite\/Vitest config found/);
    assert.match(out, /SCRIPT\s+—\s+scripts\.test already set/);
  } finally { cleanup(dir); }
});

test('recognizes an existing vite.config.ts test block instead of creating a duplicate', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'vite.config.ts'), 'export default { test: { environment: "jsdom" } };\n');
    const out = runVitestScaffold([dir]);
    assert.match(out, /CONFIG\s+—\s+existing Vite\/Vitest config found/);
    assert.ok(!existsSync(join(dir, 'vitest.config.mjs')));
  } finally { cleanup(dir); }
});

test('does not overwrite a custom scripts.test', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'jest' } }));
    const out = runVitestScaffold([dir]);
    assert.match(out, /SCRIPT\s+—\s+scripts\.test already set \("jest"\)/);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts.test, 'jest');
  } finally { cleanup(dir); }
});

test('reports plainly when no --file is given, scaffolds nothing', () => {
  const dir = makeTempDir();
  try {
    const out = runVitestScaffold([dir]);
    assert.match(out, /STUBS\s+—\s+no --file given/);
  } finally { cleanup(dir); }
});

test('--file scaffolds one stub per exported function/const/class, skips private ones', () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'math.js'), [
      'export function add(a, b) { return a + b; }',
      'export const PI = 3.14159;',
      'function privateHelper() { return 0; }',
      'export class Calculator {}',
      '',
    ].join('\n'));
    const out = runVitestScaffold([dir, '--file', 'src/math.js']);
    assert.match(out, /STUBS\s+OK\s+src\/math\.js → math\.test\.js \(3 stub\(s\): add, PI, Calculator\)/);

    const stub = readFileSync(join(dir, 'src', 'math.test.js'), 'utf8');
    assert.match(stub, /import \{ add, PI, Calculator \} from '\.\/math\.js';/);
    assert.match(stub, /throw new Error\('not yet implemented: add'\);/);
    assert.doesNotMatch(stub, /privateHelper/);
  } finally { cleanup(dir); }
});

test('--file scaffolds stubs for a plain export list, skipping aliases and re-exports', () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'lib.js'), [
      'function add(a, b) { return a + b; }',
      'const PI = 3.14159;',
      'function aliased() { return 1; }',
      '',
      "export { add, PI, aliased as renamedExport, unrelated } from './other.js';",
      'export { add, PI };',
      '',
    ].join('\n'));
    const out = runVitestScaffold([dir, '--file', 'src/lib.js']);
    assert.match(out, /STUBS\s+OK\s+src\/lib\.js → lib\.test\.js \(2 stub\(s\): add, PI\)/);

    const stub = readFileSync(join(dir, 'src', 'lib.test.js'), 'utf8');
    assert.doesNotMatch(stub, /renamedExport|unrelated|aliased/);
  } finally { cleanup(dir); }
});

test('--file never overwrites an existing test file', () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'math.js'), 'export function add(a, b) { return a + b; }\n');
    writeFileSync(join(dir, 'src', 'math.test.js'), '// hand-written, do not touch\n');
    const out = runVitestScaffold([dir, '--file', 'src/math.js']);
    assert.match(out, /STUBS\s+—\s+src\/math\.js — math\.test\.js already exists — never overwritten/);
    assert.equal(readFileSync(join(dir, 'src', 'math.test.js'), 'utf8'), '// hand-written, do not touch\n');
  } finally { cleanup(dir); }
});

test('--file reports plainly when the source has nothing exportable to stub', () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'empty.js'), 'function privateOnly() { return 1; }\n');
    const out = runVitestScaffold([dir, '--file', 'src/empty.js']);
    assert.match(out, /STUBS\s+—\s+src\/empty\.js — no exported function\/class\/const\/let found to stub/);
  } finally { cleanup(dir); }
});

test('--file reports plainly when the source file does not exist', () => {
  const dir = makeTempDir();
  try {
    const out = runVitestScaffold([dir, '--file', 'src/nope.js']);
    assert.match(out, /STUBS\s+—\s+src\/nope\.js — source file not found/);
  } finally { cleanup(dir); }
});

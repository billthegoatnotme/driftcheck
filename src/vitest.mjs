// ─────────────────────────────────────────────────────────────────────
//  driftcheck vitest — scaffolds Vitest wiring and stub test files.
//
//  Deliberately does NOT write real test assertions. Deciding what
//  correct behavior looks like requires understanding the code — a
//  reasoning task, not a verification one, and guessing at it would
//  manufacture false confidence, the same failure driftcheck exists
//  to catch elsewhere. This generates structure only: config, a wired
//  "test" script, and one honestly-failing stub per exported symbol,
//  so nothing here can be mistaken for real coverage until a human or
//  an AI collaborator actually fills it in.
// ─────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';

const VITEST_CONFIG_CANDIDATES = ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mjs', 'vitest.config.cjs'];
const VITE_CONFIG_CANDIDATES = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'];

function hasVitestConfig(repo) {
  if (VITEST_CONFIG_CANDIDATES.some((f) => existsSync(join(repo, f)))) return true;
  // A Vite project commonly carries Vitest's config as a `test: {...}`
  // block inside its own vite.config.* instead of a separate file.
  return VITE_CONFIG_CANDIDATES.some((f) => {
    const p = join(repo, f);
    return existsSync(p) && /\btest\s*:/.test(readFileSync(p, 'utf8'));
  });
}

function ensureVitestConfig(repo) {
  if (hasVitestConfig(repo)) return { changed: false, note: 'existing Vite/Vitest config found — left alone' };
  writeFileSync(join(repo, 'vitest.config.mjs'), `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
`);
  return { changed: true, note: 'created vitest.config.mjs' };
}

function ensureTestScript(repo) {
  const pkgPath = join(repo, 'package.json');
  if (!existsSync(pkgPath)) return { changed: false, note: 'no package.json — skipped wiring scripts.test' };
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (pkg.scripts?.test) return { changed: false, note: `scripts.test already set ("${pkg.scripts.test}") — left alone` };
  pkg.scripts = { ...pkg.scripts, test: 'vitest run' };
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  return { changed: true, note: 'added "test": "vitest run" to package.json (run `npm install -D vitest` if it isn\'t a dependency yet)' };
}

// Only the same precise, un-guessed shapes docs.mjs already trusts:
// `export function/class NAME`, `export default function/class NAME`,
// `export const/let NAME`. Anything else (export lists, re-exports) is
// real content but too ambiguous to extract without guessing, so it's
// left alone rather than mishandled.
const EXPORT_RE = /^export\s+(?:default\s+)?(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)|^export\s+(?:const|let)\s+([A-Za-z_$][\w$]*)/gm;

function findExports(sourcePath) {
  const content = readFileSync(sourcePath, 'utf8');
  const names = new Set();
  let m;
  while ((m = EXPORT_RE.exec(content))) names.add(m[1] ?? m[2]);
  EXPORT_RE.lastIndex = 0; // regex has /g — reset so a second call on the same source doesn't start mid-string
  return [...names];
}

const testPathFor = (sourcePath) => {
  const ext = extname(sourcePath);
  return join(dirname(sourcePath), `${basename(sourcePath, ext)}.test${ext}`);
};

function scaffoldStub(repo, relSourcePath) {
  const sourcePath = join(repo, relSourcePath);
  if (!existsSync(sourcePath)) return { status: 'skipped', reason: 'source file not found' };

  const dest = testPathFor(sourcePath);
  if (existsSync(dest)) return { status: 'skipped', reason: `${basename(dest)} already exists — never overwritten` };

  const exportsFound = findExports(sourcePath);
  if (exportsFound.length === 0) return { status: 'skipped', reason: 'no exported function/class/const/let found to stub' };

  const body = `import { describe, test } from 'vitest';
import { ${exportsFound.join(', ')} } from './${basename(sourcePath)}';

${exportsFound.map((name) => `describe('${name}', () => {
  test('TODO: assert expected behavior', () => {
    void ${name}; // scaffolded stub — replace with a real assertion
    throw new Error('not yet implemented: ${name}');
  });
});`).join('\n\n')}
`;
  writeFileSync(dest, body);
  return { status: 'created', dest: basename(dest), exports: exportsFound };
}

export function runVitestScaffold(args) {
  const fileFlags = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file' && args[i + 1]) { fileFlags.push(args[i + 1]); i++; }
  }
  const repo = resolve(args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--file') ?? process.cwd());
  const header = '── driftcheck vitest ─ ' + repo;
  const lines = [];

  const configResult = ensureVitestConfig(repo);
  lines.push(`CONFIG   ${configResult.changed ? 'OK' : '—'}  ${configResult.note}`);

  const scriptResult = ensureTestScript(repo);
  lines.push(`SCRIPT   ${scriptResult.changed ? 'OK' : '—'}  ${scriptResult.note}`);

  if (fileFlags.length === 0) {
    lines.push('STUBS    —   no --file given — pass one or more --file <path> to scaffold stub test files');
  } else {
    for (const f of fileFlags) {
      const r = scaffoldStub(repo, f);
      lines.push(r.status === 'created'
        ? `STUBS    OK  ${f} → ${r.dest} (${r.exports.length} stub(s): ${r.exports.join(', ')})`
        : `STUBS    —   ${f} — ${r.reason}`);
    }
  }

  return `${header}\n${lines.join('\n')}`;
}

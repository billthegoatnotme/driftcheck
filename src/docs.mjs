// ─────────────────────────────────────────────────────────────────────
//  driftcheck docs — the map is not the territory.
//
//  driftcheck repo answers "is my picture of repo STATE current?" This
//  answers a different question: is a project's own constitutional or
//  reference document (CLAUDE.md, AGENTS.md, a README's own checklist...)
//  still accurate against the actual code? Reference docs like these
//  often name specific files and functions by exact identifier —
//  `lib/foo/bar.ts → someFunction()`. Every one of those is a claim.
//  Claims drift: a function gets renamed, a file gets moved, and the
//  document keeps asserting the old shape, because nobody told it
//  otherwise.
//
//  What this does: extracts every `file → function()` (or `file ->
//  function()`) and bare `path/to/file.ext` reference from each target
//  document, and verifies it against the actual repo — the file exists,
//  the function is still declared where the document says it is.
//
//  It only checks these two patterns — precise enough to verify without
//  guessing — on purpose. A noisy tool that cries wolf on ordinary prose
//  gets ignored, and an ignored truth instrument is worse than none.
//
//  Every run appends a line to <repo>/.driftcheck/docs-history.jsonl.
// ─────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { logHistory } from './lib/history.mjs';

const SRC_EXT = 'ts|tsx|js|jsx|mjs|cjs|sql|prisma|md';
const CODE_EXT = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'];
const DEFAULT_CANDIDATES = ['CLAUDE.md', 'AGENTS.md', 'README.md'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', 'vendor', '.driftcheck']);

// Requires a directory component — a bare filename with no path (e.g.
// shorthand after the full path was already given earlier) isn't a
// precise "this exact path must exist" claim, it's prose shorthand.
// Checking it as a path would be a guess, not a verification.
const pathRe = new RegExp(`^[\\w.-]+(?:/[\\w.-]+)+\\.(${SRC_EXT})$`);
const arrowRe = new RegExp(`^([\\w./-]+\\.(${SRC_EXT}))\\s*(?:→|->)\\s*([A-Za-z_$][\\w$]*)\\(?\\)?$`);
const declRe = (fn) => new RegExp(`\\b(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:function|const|let|class)\\s+${fn}\\b`);

function walkFiles(dir, exts, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walkFiles(join(dir, e.name), exts, out);
    } else if (exts.some((ext) => e.name.endsWith(`.${ext}`))) {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

function extractReferences(doc) {
  const backtickSpans = [...doc.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const arrowPairs = [];
  const barePaths = [];
  const seenArrow = new Set();
  const seenPath = new Set();

  for (const span of backtickSpans) {
    const arrowMatch = span.match(arrowRe);
    if (arrowMatch) {
      const key = `${arrowMatch[1]}→${arrowMatch[3]}`;
      if (!seenArrow.has(key)) {
        seenArrow.add(key);
        arrowPairs.push({ file: arrowMatch[1], fn: arrowMatch[3] });
      }
      continue;
    }
    if (pathRe.test(span) && !seenPath.has(span)) {
      seenPath.add(span);
      barePaths.push(span);
    }
  }
  return { arrowPairs, barePaths };
}

export function runDocsCheck(args) {
  const fileFlags = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file' && args[i + 1]) { fileFlags.push(args[i + 1]); i++; }
  }
  const repo = resolve(args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--file') ?? process.cwd());
  const HISTORY = join(repo, '.driftcheck', 'docs-history.jsonl');

  const candidates = fileFlags.length ? fileFlags : DEFAULT_CANDIDATES;
  const targets = candidates.filter((f) => existsSync(join(repo, f)));

  console.log('── driftcheck docs ─ ' + repo);

  if (targets.length === 0) {
    const looked = fileFlags.length
      ? fileFlags.join(', ')
      : `${DEFAULT_CANDIDATES.join(', ')} (defaults)`;
    console.log(`DOCS     ??  no target document found — looked for: ${looked}. Specify one with --file <path>`);
    return;
  }

  const multi = targets.length > 1;
  const lines = [];
  let totalChecked = 0;
  let totalDrift = 0;

  for (const target of targets) {
    const full = join(repo, target);
    const doc = readFileSync(full, 'utf8');
    const { arrowPairs, barePaths } = extractReferences(doc);

    const pathDrift = [];
    for (const p of barePaths) {
      if (!existsSync(join(repo, p))) pathDrift.push({ ref: p, reason: 'file not found' });
    }

    const fnDrift = [];
    for (const { file, fn } of arrowPairs) {
      const fnFull = join(repo, file);
      if (!existsSync(fnFull)) {
        fnDrift.push({ ref: `${file} → ${fn}()`, reason: 'file not found' });
        continue;
      }
      const content = readFileSync(fnFull, 'utf8');
      if (declRe(fn).test(content)) continue; // found exactly where the document claims

      const elsewhere = walkFiles(repo, CODE_EXT).find((f) => {
        if (f === fnFull) return false;
        try { return declRe(fn).test(readFileSync(f, 'utf8')); } catch { return false; }
      });
      fnDrift.push(elsewhere
        ? { ref: `${file} → ${fn}()`, reason: `not in that file — found in ${relative(repo, elsewhere).split('\\').join('/')} instead (moved/renamed?)` }
        : { ref: `${file} → ${fn}()`, reason: 'not declared anywhere in the repo' });
    }

    const checked = arrowPairs.length + barePaths.length;
    const drift = fnDrift.length + pathDrift.length;
    totalChecked += checked;
    totalDrift += drift;

    const prefix = multi ? `${target}: ` : '';
    if (checked === 0) {
      lines.push(`${target}   —   no checkable references found`);
    } else if (drift === 0) {
      lines.push(`${target}   OK  ${checked} reference(s) checked (${arrowPairs.length} arrow-pairs, ${barePaths.length} bare paths)`);
    } else {
      lines.push(`${target}   ⚠️  ${checked} reference(s) checked, ${drift} drifted:`);
      for (const d of [...fnDrift, ...pathDrift]) lines.push(`          ${prefix}${d.ref} — ${d.reason}`);
    }
  }

  if (!multi) {
    console.log(lines.join('\n'));
  } else {
    console.log(`DOCS     ${totalDrift === 0 ? 'OK ' : '⚠️ '} ${targets.length} document(s), ${totalChecked} reference(s) checked, ${totalDrift} drifted`);
    console.log(lines.join('\n'));
  }

  const record = { at: new Date().toISOString(), repo, targets, totalChecked, totalDrift };
  const prev = logHistory(HISTORY, record);
  console.log(prev
    ? `NOTES     run #${record.runIndex} | ${prev.totalChecked}→${totalChecked} references since ${prev.at.slice(0, 10)}`
    : `NOTES     run #${record.runIndex} logged → ${HISTORY}`);
}

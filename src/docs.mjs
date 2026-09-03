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
import { isAbsolute, join, relative, resolve } from 'node:path';
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

// Strips '//' line comments, '/* */' block comments, and the contents
// of quoted strings ('/"/`) before declRe() runs against a file's
// content — a plain substring match otherwise can't tell `// function
// doThing() was removed` or `const note = "function doThing()"` from
// an actual declaration, which is a false *negative*: the tool reports
// a removed function as still present. Not a full parser — a template
// literal with an embedded ${...} expression, a regex literal
// containing "//", and similar edge cases still aren't handled — but
// this closes the reproducible case above without inventing a real
// JS/TS tokenizer for a tool whose checks are deliberately narrow.
function stripCommentsAndStrings(content) {
  let out = '';
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c === '/' && content[i + 1] === '/') {
      while (i < content.length && content[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (c === '/' && content[i + 1] === '*') {
      i += 2;
      while (i < content.length && !(content[i] === '*' && content[i + 1] === '/')) {
        out += content[i] === '\n' ? '\n' : ' ';
        i++;
      }
      i++; // skip the '*'; the for-loop's own i++ skips the '/'
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < content.length && content[i] !== quote) {
        out += content[i] === '\n' ? '\n' : ' ';
        if (content[i] === '\\') i++; // skip the escaped character too
        i++;
      }
      out += ' ';
      continue;
    }
    out += c;
  }
  return out;
}

// Simple top-level directory names from the repo's own .gitignore, on
// top of the hardcoded SKIP_DIRS — not a full gitignore parser.
// Wildcards, negations, and nested paths (anything with a "/" other
// than a single trailing one) are left alone rather than guessed at;
// only unambiguous bare directory names get added.
function gitignoreDirs(repo) {
  const path = join(repo, '.gitignore');
  if (!existsSync(path)) return [];
  const dirs = [];
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    if (/[*?[\]]/.test(line)) continue;
    const name = line.replace(/\/$/, '');
    if (name && !name.includes('/')) dirs.push(name);
  }
  return dirs;
}

function walkFiles(dir, exts, skipDirs, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (skipDirs.has(e.name)) continue;
      walkFiles(join(dir, e.name), exts, skipDirs, out);
    } else if (exts.some((ext) => e.name.endsWith(`.${ext}`))) {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

// True when `target` (already joined against `repo`) resolves outside
// the repo root — e.g. a `../other/file.js` bare-path reference, which
// pathRe's character class doesn't reject since it allows a literal
// "." and so accepts ".." as an ordinary path segment.
function escapesRepo(repo, target) {
  const rel = relative(repo, resolve(target));
  return rel.startsWith('..') || isAbsolute(rel);
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
  const skipDirs = new Set([...SKIP_DIRS, ...gitignoreDirs(repo)]);

  const candidates = fileFlags.length ? fileFlags : DEFAULT_CANDIDATES;
  const targets = candidates.filter((f) => existsSync(join(repo, f)));

  const out = ['── driftcheck docs ─ ' + repo];

  if (targets.length === 0) {
    const looked = fileFlags.length
      ? fileFlags.join(', ')
      : `${DEFAULT_CANDIDATES.join(', ')} (defaults)`;
    out.push(`DOCS     ??  no target document found — looked for: ${looked}. Specify one with --file <path>`);
    return out.join('\n');
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
      const pFull = join(repo, p);
      if (escapesRepo(repo, pFull)) {
        pathDrift.push({ ref: p, reason: 'resolves outside the repo root — not checked' });
      } else if (!existsSync(pFull)) {
        pathDrift.push({ ref: p, reason: 'file not found' });
      }
    }

    const fnDrift = [];
    for (const { file, fn } of arrowPairs) {
      const fnFull = join(repo, file);
      if (escapesRepo(repo, fnFull)) {
        fnDrift.push({ ref: `${file} → ${fn}()`, reason: 'file path resolves outside the repo root — not checked' });
        continue;
      }
      if (!existsSync(fnFull)) {
        fnDrift.push({ ref: `${file} → ${fn}()`, reason: 'file not found' });
        continue;
      }
      const content = stripCommentsAndStrings(readFileSync(fnFull, 'utf8'));
      if (declRe(fn).test(content)) continue; // found exactly where the document claims

      const elsewhere = walkFiles(repo, CODE_EXT, skipDirs).find((f) => {
        if (f === fnFull) return false;
        try { return declRe(fn).test(stripCommentsAndStrings(readFileSync(f, 'utf8'))); } catch { return false; }
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
    out.push(lines.join('\n'));
  } else {
    out.push(`DOCS     ${totalDrift === 0 ? 'OK ' : '⚠️ '} ${targets.length} document(s), ${totalChecked} reference(s) checked, ${totalDrift} drifted`);
    out.push(lines.join('\n'));
  }

  const record = { at: new Date().toISOString(), repo, targets, totalChecked, totalDrift };
  const prev = logHistory(HISTORY, record);
  out.push(prev
    ? `NOTES     run #${record.runIndex} | ${prev.totalChecked}→${totalChecked} references since ${prev.at.slice(0, 10)}`
    // Repo-relative, not the raw absolute HISTORY path — this output
    // gets embedded verbatim into committed spec files by `driftcheck
    // spec`, and an absolute path there leaks local username/folder
    // structure into what may be a public document.
    : `NOTES     run #${record.runIndex} logged → ${relative(repo, HISTORY).split('\\').join('/')}`);

  return out.join('\n');
}

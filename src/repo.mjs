// ─────────────────────────────────────────────────────────────────────
//  driftcheck repo — is my picture of this repo's STATE current?
//
//  Answers, verdict-first, the questions that otherwise get re-derived
//  by hand every session:
//    1. Is the local git picture current vs. origin? ("merged but not
//       actually" trap — behind/ahead counts, dirty tree, stale merged
//       branches, stray agent worktrees.)
//    2. Are there open PRs to know about?
//    3. Is the local dev DB behind committed Prisma migrations?
//    4. (--tests) Does the suite pass — and are failures REAL or FLAKY?
//       Failures re-run in isolation; pass-in-isolation = FLAKY.
//    5. (--build) Does the project's build script succeed?
//
//  Every run appends a line to <repo>/.driftcheck/repo-history.jsonl —
//  that log is the repo's own health, run over run.
// ─────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sh } from './lib/shell.mjs';
import { logHistory } from './lib/history.mjs';

// Matches driftcheck's own generated stubs (.test.js/.mjs) as well as
// TypeScript projects (.test.ts/.tsx) — not just the .tsx? the original
// private tool assumed everywhere, back when every consumer was Atlas.
// Exported for direct unit testing against captured real Vitest output,
// without needing Vitest itself as a driftcheck devDependency.
export const VITEST_FAIL_FILE_RE = /FAIL\s+(\S+\.test\.(?:tsx?|jsx?|mjs|cjs))/g;

// Parses Vitest's own "Tests  <summary>" line without assuming which
// segments are present — "3 passed (3)", "3 failed (3)" (nothing
// passed at all — the original regex here had no branch for this and
// silently fell through to "suite did not produce a summary"), and
// "1 failed | 2 passed (3)" all need to parse correctly.
export function parseVitestSummary(out) {
  const line = out.match(/Tests\s+([^\n]+)/);
  if (!line) return null;
  const total = line[1].match(/\((\d+)\)/);
  if (!total) return null;
  const passed = line[1].match(/(\d+)\s+passed/);
  return { total: Number(total[1]), passed: passed ? Number(passed[1]) : 0 };
}

export function runRepoCheck(args) {
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const repo = resolve(args.find((a) => !a.startsWith('--')) ?? process.cwd());
  const HISTORY = join(repo, '.driftcheck', 'repo-history.jsonl');

  const lines = [];
  const say = (s) => lines.push(s);
  const record = { at: new Date().toISOString(), repo };

  // ── 1. GIT ────────────────────────────────────────────────────────
  {
    sh(repo, 'git fetch origin --quiet', { timeout: 60_000 });
    const isRepo = sh(repo, 'git rev-parse --is-inside-work-tree').ok;

    if (!isRepo) {
      say('GIT      ??  not a git repository — skipping git/PR checks');
      record.git = null;
    } else {
      sh(repo, 'git fetch origin --quiet', { timeout: 60_000 });
      const branchR = sh(repo, 'git rev-parse --abbrev-ref HEAD');
      const branch = branchR.ok ? branchR.out.trim() : null;
      const headR = sh(repo, 'git rev-parse --short HEAD');
      const head = headR.ok ? headR.out.trim() : null;
      const originR = sh(repo, 'git rev-parse --short origin/main');
      const originMain = originR.ok ? originR.out.trim() : null;
      const dirty = sh(repo, 'git status --porcelain').out.split('\n').filter(Boolean);

      if (!branch || !originMain) {
        say(`GIT      ??  ${!branch ? 'no commits yet' : 'no origin/main to compare against'}` +
            `${dirty.length ? ` | ${dirty.length} dirty file(s)` : ' | tree clean'}`);
        record.git = { branch, head, dirty: dirty.length };
      } else {
        const behind = sh(repo, 'git rev-list --count HEAD..origin/main').out.trim();
        const ahead = sh(repo, 'git rev-list --count origin/main..HEAD').out.trim();
        const inSync = behind === '0' && (branch !== 'main' || ahead === '0');
        say(`GIT      ${inSync ? 'OK ' : '⚠️ '} ${branch}@${head} | origin/main@${originMain}` +
            `${behind !== '0' ? ` | BEHIND origin/main by ${behind} — pull before trusting anything` : ''}` +
            `${branch === 'main' && ahead !== '0' ? ` | ahead by ${ahead} (unpushed on main?)` : ''}` +
            `${dirty.length ? ` | ${dirty.length} dirty file(s): ${dirty.slice(0, 4).map((d) => d.trim()).join(', ')}${dirty.length > 4 ? '…' : ''}` : ' | tree clean'}`);
        record.git = { branch, head, behind: Number(behind) || 0, dirty: dirty.length };

        const merged = sh(repo, 'git branch --merged origin/main')
          .out.split('\n').map((b) => b.replace('*', '').trim())
          .filter((b) => b && b !== 'main');
        if (merged.length) say(`         ⚠️  stale local branches (merged on origin): ${merged.join(', ')}`);

        // Local branches with real commits NOT in origin/main, whose own
        // PR already shows MERGED or CLOSED — invisible to both the sync
        // check above (only looks at the current branch) and the PRS
        // check below (only lists OPEN PRs): work that looks resolved
        // because its PR is closed, but was actually pushed after the
        // merge happened and never made it in.
        const allBranches = sh(repo, 'git branch --format="%(refname:short)"')
          .out.split('\n').map((b) => b.trim()).filter(Boolean);
        const unmerged = allBranches.filter((b) => b !== branch && b !== 'main' && !merged.includes(b));
        if (unmerged.length) {
          const prCheck = sh(repo, 'gh pr list --state all --limit 100 --json number,state,headRefName', { timeout: 30_000 });
          if (!prCheck.ok) {
            say('         ??  gh unavailable — could not check whether unmerged local branches have closed PRs behind them');
          } else {
            try {
              const prs = JSON.parse(prCheck.out || '[]');
              for (const b of unmerged) {
                const pr = prs.find((p) => p.headRefName === b && p.state !== 'OPEN');
                if (!pr) continue;
                const ahead = sh(repo, `git rev-list --count origin/main..${b}`).out.trim();
                say(`         ⚠️  branch '${b}' has ${ahead} commit(s) not in origin/main, but PR #${pr.number} is already ${pr.state} — likely pushed after merge, not included`);
              }
            } catch { say('         ??  could not parse gh output for unmerged-branch check'); }
          }
        }

        // Agent worktrees (e.g. Claude Code's .claude/worktrees) left behind
        // can silently pollute test globs or file listings if not excluded.
        const wtDir = join(repo, '.claude', 'worktrees');
        if (existsSync(wtDir)) {
          const wts = readdirSync(wtDir).filter(Boolean);
          if (wts.length) say(`         ⚠️  ${wts.length} agent worktree(s) in .claude/worktrees: ${wts.join(', ')} — make sure test/build globs exclude these before trusting counts elsewhere`);
        }
      }
    }
  }

  // ── 2. PULL REQUESTS ─────────────────────────────────────────────
  {
    const r = sh(repo, 'gh pr list --state open --json number,title,headRefName', { timeout: 30_000 });
    if (!r.ok) {
      say('PRS      ??  gh unavailable/unauthenticated — verify PR state by hand before claiming "merged"');
    } else {
      try {
        const prs = JSON.parse(r.out || '[]');
        record.openPrs = prs.length;
        say(prs.length === 0
          ? 'PRS      OK  no open PRs'
          : `PRS      ⚠️  ${prs.length} open: ${prs.map((p) => `#${p.number} (${p.headRefName})`).join(', ')} — "merged" claims about these are FALSE until origin/main moves`);
      } catch { say('PRS      ??  could not parse gh output'); }
    }
  }

  // ── 3. MIGRATIONS (configurable, falls back to Prisma auto-detect) ─
  {
    const pkgPath = join(repo, 'package.json');
    let customDbCmd = null;
    if (existsSync(pkgPath)) {
      try { customDbCmd = JSON.parse(readFileSync(pkgPath, 'utf8')).scripts?.['driftcheck:db'] ?? null; } catch { /* malformed package.json */ }
    }

    if (customDbCmd) {
      // No ORM-specific parsing here on purpose — a project's own
      // "driftcheck:db" script can wrap Drizzle, TypeORM, Sequelize,
      // Knex, or anything else; exit 0 means no drift, by convention.
      const r = sh(repo, 'npm run driftcheck:db', { timeout: 90_000 });
      // Skip npm's own "> driftcheck:db" / "> <command>" echo lines to
      // surface what the script itself actually produced. Up to 3
      // lines, not just the first — a script that prints real detail
      // (which migrations, which tables) shouldn't get truncated to
      // its own header.
      const realLines = r.out.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('>'));
      const detail = realLines.slice(0, 3).join(' | ') + (realLines.length > 3 ? ' …' : '');
      say(r.ok
        ? `DB       OK  \`${customDbCmd}\` reports no drift`
        : `DB       ⚠️  \`${customDbCmd}\` reported drift (nonzero exit): ${detail || '(no output)'}`);
      record.db = { custom: true, ok: r.ok };
    } else {
      const schemaPath = join(repo, 'prisma', 'schema.prisma');
      if (!existsSync(schemaPath)) {
        say('DB       —   no prisma/schema.prisma and no "driftcheck:db" script — skipping');
      } else {
        const envFile = join(repo, '.env.local');
        if (!existsSync(envFile)) {
          say('DB       ??  Prisma project but no .env.local — skipping migrate status');
        } else {
          const r = sh(repo, 'node --env-file=.env.local node_modules/prisma/build/index.js migrate status', { timeout: 90_000 });
          const pending = r.out.match(/following migrations? have not yet been applied[\s\S]*?((?:\d{14}\S*\s*)+)/);
          if (r.out.includes('Database schema is up to date')) {
            say('DB       OK  local dev DB matches committed migrations');
            record.dbPending = 0;
          } else if (pending) {
            const names = pending[1].trim().split(/\s+/);
            say(`DB       ⚠️  ${names.length} unapplied migration(s): ${names.join(', ')}`);
            record.dbPending = names.length;
          } else {
            say(`DB       ??  migrate status inconclusive (${r.ok ? 'exit 0' : 'nonzero exit'}) — first line: ${r.out.split('\n').find((l) => l.trim()) ?? ''}`);
          }
        }
      }
    }
  }

  // ── 4. TESTS with flake classification (--tests) ──────────────────
  if (flags.has('--tests')) {
    const pkgPath = join(repo, 'package.json');
    let testCmd = null;
    if (existsSync(pkgPath)) {
      try { testCmd = JSON.parse(readFileSync(pkgPath, 'utf8')).scripts?.test ?? null; } catch { /* malformed package.json */ }
    }

    if (!testCmd) {
      say('TESTS    ??  no "test" script in package.json — skipping');
    } else {
      const isVitest = /vitest/i.test(testCmd);
      const t0 = Date.now();
      const run = sh(repo, 'npm test', { timeout: 420_000 });
      const summary = parseVitestSummary(run.out);
      const elapsed = () => Math.round((Date.now() - t0) / 1000);

      if (run.ok && summary) {
        say(`TESTS    OK  ${summary.passed}/${summary.total} passed (${elapsed()}s)`);
        record.tests = { passed: summary.passed, total: summary.total, real: [], flaky: [] };
      } else if (isVitest) {
        // The flake protocol: failures re-run in isolation via vitest
        // directly (bypassing whatever flags "npm test" adds) so a
        // specific file list can be targeted. Pass there = FLAKY.
        const failedFiles = [...new Set(
          [...run.out.matchAll(VITEST_FAIL_FILE_RE)].map((m) => m[1]),
        )];
        if (failedFiles.length) {
          const iso = sh(repo, `npx vitest run ${failedFiles.join(' ')}`, { timeout: 300_000 });
          const isoFailed = [...new Set(
            [...iso.out.matchAll(VITEST_FAIL_FILE_RE)].map((m) => m[1]),
          )];
          const flaky = failedFiles.filter((f) => !isoFailed.includes(f));
          if (isoFailed.length === 0) {
            say(`TESTS    OK* ${summary ? `${summary.passed}/${summary.total}` : 'suite'} — ${flaky.length} FLAKY file(s) under full-suite load, ALL pass in isolation: ${flaky.join(', ')}. Not a regression; known machine-load class.`);
          } else {
            say(`TESTS    ❌  REAL failures in: ${isoFailed.join(', ')} (fail even in isolation)` +
                (flaky.length ? ` | plus flaky: ${flaky.join(', ')}` : ''));
          }
          record.tests = { passed: summary?.passed ?? null, total: summary?.total ?? null, real: isoFailed, flaky };
        } else {
          say(`TESTS    ❌  suite did not produce a summary — first error line: ${run.out.split('\n').find((l) => /error/i.test(l)) ?? '(none found)'}`);
        }
      } else {
        // Non-Vitest runner: no reliable convention for targeting
        // specific files in isolation, so report pass/fail only.
        say(run.ok
          ? `TESTS    OK  \`${testCmd}\` passed (${elapsed()}s) — non-Vitest runner, no per-file flake classification`
          : `TESTS    ❌  \`${testCmd}\` failed (${elapsed()}s) — non-Vitest runner, no per-file flake classification. First error line: ${run.out.split('\n').find((l) => /error/i.test(l)) ?? '(none found)'}`);
        record.tests = { passed: null, total: null, real: run.ok ? [] : ['(unclassified — non-Vitest runner)'], flaky: [] };
      }
    }
  }

  // ── 5. BUILD (--build) ─────────────────────────────────────────────
  if (flags.has('--build')) {
    const t0 = Date.now();
    const r = sh(repo, 'npm run build', { timeout: 420_000 });
    const typeErr = r.out.match(/Type error: (.+)/);
    say(r.ok
      ? `BUILD    OK  compiled (${Math.round((Date.now() - t0) / 1000)}s)`
      : `BUILD    ❌  ${typeErr ? typeErr[1].slice(0, 140) : r.out.split('\n').filter((l) => /error|Failed/i.test(l))[0] ?? 'failed'}`);
    record.build = r.ok;
  }

  // ── 6. FIELD NOTES — longitudinal log ──────────────────────────────
  {
    const prev = logHistory(HISTORY, record);
    if (prev?.tests?.total && record.tests?.total) {
      const delta = record.tests.total - prev.tests.total;
      say(`NOTES    run #${record.runIndex} | suite ${prev.tests.total}→${record.tests.total}` +
          `${delta !== 0 ? ` (${delta > 0 ? '+' : ''}${delta})` : ''} since ${prev.at.slice(0, 10)}` +
          `${record.tests.flaky?.length ? ` | flaky today: ${record.tests.flaky.length}` : ''}`);
    } else {
      say(`NOTES    run #${record.runIndex} logged → ${HISTORY}`);
    }
  }

  return '── driftcheck repo ─ ' + repo + '\n' + lines.join('\n');
}

# driftcheck Thread Handoff — Checkpoint 2

Read alongside `driftcheck_spec_v0_02.md` in this
same folder. This picks up from
`driftcheck_spec_v0_01.md` — read that
checkpoint's entry in the spec's Checkpoint Log before anything else.

## What the next thread should actually do

driftcheck launched publicly on 2026-09-03 (GitHub public, npm package
`@billthegoatnotme/driftcheck@1.0.0` live and verified installable).
Shortly after, **the first real external user sent a genuinely
excellent, technically precise code review** — nine findings, all
independently verified against the actual source in this thread
before being accepted, not taken on faith. All nine are real. Two
needed a design decision from the user; both are already resolved
below. Build all of it now, as **2-3 PRs**, using the branch → PR →
human-merges workflow this repo has used for every real feature since
`driftcheck_spec_v0_01.md`'s own Git Integration section describes it
— do not commit fixes directly to `main`. Each fix needs a regression
test, matching how every other fix in this project's history has been
handled (see `test/*.test.mjs` for the existing pattern and style).

**PR 1 — `src/repo.mjs` precision fixes:**
1. Vitest flake classification: the isolation re-run's exit status
   (`iso.ok`) is currently never checked. If the isolation command
   itself fails to run cleanly (crash, config error, timeout) but its
   output happens not to contain a matching `FAIL <file>` line, the
   code currently concludes "0 files failed in isolation" and reports
   `FLAKY`/`OK*` — a false clean read on a check that didn't actually
   run. Require `iso.ok` before treating an empty `isoFailed` as a
   real pass.
2. Same block: soften "passes in isolation = FLAKY... Not a
   regression" — one clean isolation run is evidence a failure didn't
   reproduce, not proof it's not a regression (could still be test
   order, shared state, a race, resource contention). Reword to
   something like "did not reproduce in isolation," drop the "Not a
   regression" claim.
3. `.driftcheck/repo-history.jsonl` gets written by this same
   `runRepoCheck` call, AFTER the GIT section already reported "tree
   clean" — so on a repo that doesn't gitignore `.driftcheck/`, the
   tool can truthfully say "clean" and then make the tree dirty itself
   before the command finishes. Fix: exclude `.driftcheck/` from the
   dirty-file count in the GIT section's `git status --porcelain`
   handling, the same as if it were always gitignored — it's the
   tool's own artifact, not repo state worth reporting on.
4. The custom `"driftcheck:db"` script check treats ANY nonzero exit
   as confirmed drift (`⚠️`) — but nonzero could mean the DB is
   unreachable, credentials are wrong, the command is missing, the
   script has a bug, or it timed out. None of those are "drift."
   **Resolved design decision**: change the exit-code convention to
   `0` = clean, `1` = drift found, anything else = inconclusive/error
   (`??`). This changes the documented interface (README's `DB`
   bullet and Limitations entry both need updating to match), but the
   feature is brand new with essentially no real adopters yet, so
   this is the right time to fix it.
5. `sh()`'s own docstring claims "every call site passes its own
   literals, not user input" — false for at least two call sites: the
   branch name interpolated into
   `git rev-list --count origin/main..${b}` in the orphaned-branch
   check, and the failed-file paths joined into
   `npx vitest run ${failedFiles.join(' ')}` in the flake-isolation
   re-run. **Resolved design decision**: do NOT rewrite `sh()`
   wholesale to an args-array/`shell:false` convention — that's a much
   bigger change touching nearly every check in this file, deferred as
   a separate future call. Instead, fix only those 1-2 specific
   call sites to use `execFileSync`-style array args (no shell
   involved, sidesteps all quoting concerns), and fix the docstring to
   stop overclaiming.
6. `driftcheck repo`'s NOTES line prints the full absolute path to
   `.driftcheck/repo-history.jsonl` (e.g.
   `C:\Users\billt\OneDrive\Desktop\driftcheck\.driftcheck\...`) — and
   since `driftcheck spec` embeds this raw output verbatim in its
   "Detected" section, that absolute path (revealing local username
   and folder structure) ends up baked into committed, public spec
   files. **This repo's own committed `driftcheck_spec_v0_01.md`
   (now archived to `driftcheck_spec_previous/`) already has this
   leak in it** — low-sensitivity (a folder path, not a credential),
   not worth a history rewrite over, but worth knowing it's there.
   Fix: make the NOTES line repo-relative (`path.relative(repo,
   HISTORY)` instead of the raw absolute `HISTORY`). Same fix applies
   to `src/docs.mjs`'s equivalent NOTES line (see PR 2). After this
   lands, run `driftcheck spec close` on this repo again to get a
   fresh checkpoint whose Detected section no longer carries the leak
   — the old, already-committed version stays archived either way,
   nothing needs deleting.

**PR 2 — `src/docs.mjs` fixes:**
1. The declaration regex (`declRe`) runs against raw file content with
   no awareness of comments or string literals. Reproduced directly:
   `// function doThing() was removed` or `const note = "function
   doThing()"` both satisfy the check, so a genuinely removed
   declaration can still read as "still declared." **This is the
   worst finding of the nine** — it's a false negative, meaning the
   tool gives false confidence exactly where its whole purpose is
   catching drift. Fix: strip `//` line comments, `/* */` block
   comments, and quoted-string contents from the file content before
   running `declRe` against it. Not a full parser — say so plainly in
   a comment and in the README if this gets documented — template
   literals with embedded expressions, regex literals containing `//`,
   and similar edge cases will still not be handled perfectly, but
   this closes the specific reproduction case and is a real
   improvement over raw full-text matching.
2. Path traversal: the bare-path regex's character class
   (`[\w.-]`) includes literal `.`, so a `..` segment satisfies it —
   `../other/file.js` passes `pathRe`, gets joined against the repo
   root, and both the bare-path `existsSync` check and the arrow-pair
   `readFileSync` check will follow it outside the target repo. Fix:
   after joining, resolve the path and reject anything that escapes
   the repo root (for both the bare-path and arrow-pair checks) rather
   than silently checking/reading whatever it resolves to.
3. Same NOTES-line absolute-path fix as PR 1, applied here too.

**PR 3 — `src/spec.mjs` fix:**
1. `spec close` always reports the top-level verdict as `SPEC OK
   checkpointed`, even when the `notes` array is non-empty (i.e. even
   when the "Detected" section or "Checkpoint Log" patch actually
   failed to apply and got reported as a `??` sub-note). Someone
   reading only the headline gets a false-clean read. Fix: change the
   top-level marker to something like `SPEC ⚠️  checkpointed
   (partial)` whenever `notes.length > 0`.

## Open questions

None outstanding from the review itself — both real design decisions
(DB check exit-code convention, `sh()` rewrite scope) were already
made explicitly with the user before this checkpoint and are recorded
above, not left open. The only genuinely open items are process, not
design: whether to do all 3 PRs in one sitting or spread across
multiple, and whether PR 1's absolute-path fix should trigger an
immediate `driftcheck spec close` refresh in the same PR or as a
separate follow-up — either is fine, just don't forget it needs doing
at all once PR 1 lands.

# driftcheck

A truth instrument for two kinds of drift: repo *state* that's moved
since you last checked it, and reference *documentation* that no longer
describes the code it names.

Both failure modes have the same shape — a claim was true once, and
nobody told it that it stopped being true. `driftcheck` exists to catch
that before you act on it.

```
driftcheck repo [path] [--tests] [--build]
driftcheck docs [path] [--file <path>]...
```

## Why

Trusting a stale claim is expensive. "The PR is merged," "the tests
pass," "the DB is up to date," "this function still lives where the
docs say it does" — each one is cheap to assume and costly to have been
wrong about, especially for an AI agent or CI job re-deriving context
every session with no memory of what it checked last time.

`driftcheck` interrogates a repo and reports verdict-first, instead of
letting a stale assumption stand unchallenged.

## Install

Not yet published to npm. Until then, clone and link it locally:

```bash
git clone <this-repo>
cd driftcheck
npm link
driftcheck --help
```

## `driftcheck repo`

Checks whether your picture of the repo's *state* is current:

```bash
driftcheck repo                    # git / open PRs / DB migrations (fast)
driftcheck repo --tests            # + test suite, with flake-vs-real triage
driftcheck repo /path/to/other/repo --tests --build
```

- **GIT** — HEAD vs. a fresh fetch of `origin/main`: ahead/behind counts,
  a dirty tree, stale local branches already merged upstream, and any
  agent worktrees under `.claude/worktrees` that can silently pollute
  test or build globs.
- **PRS** — open pull requests via the `gh` CLI. If a PR you believed
  was merged still shows up here, it isn't merged yet.
- **DB** — Prisma migration drift, via `prisma migrate status` loaded
  through `.env.local`. Skipped cleanly (verdict `—`) on any repo
  without `prisma/schema.prisma`; skipped as inconclusive (`??`) if
  Prisma is present but `.env.local` isn't.
- **TESTS** (`--tests`) — runs the `test` script from the target repo's
  own `package.json`. When that script uses Vitest, failures are
  re-run in isolation and classified: fails again in isolation = REAL;
  passes in isolation = FLAKY (a known class under full-suite load, not
  a regression). For any other test runner, only pass/fail is reported
  — per-file flake classification depends on Vitest's own output format
  and file-targeting convention, and doesn't generalize safely.
- **BUILD** (`--build`) — runs `npm run build`.

Every run appends a line to `<repo>/.driftcheck/repo-history.jsonl` —
your own longitudinal log of that repo's health, run over run. Consider
adding `.driftcheck/` to the repo's `.gitignore` if you don't want it
committed.

## `driftcheck docs`

Checks whether a project's own reference document — `CLAUDE.md`,
`AGENTS.md`, a README's own checklist, or anything else that names
files and functions by exact identifier — still accurately describes
the code it points at:

```bash
driftcheck docs                              # checks whichever of the defaults exist
driftcheck docs --file CONTRIBUTING.md       # check a specific file instead
driftcheck docs --file CLAUDE.md --file docs/API.md   # check several
```

By default it looks for `CLAUDE.md`, `AGENTS.md`, and `README.md` in
the target repo's root and checks whichever of those actually exist.
Pass one or more `--file <path>` flags to check specific files instead.

It extracts and verifies exactly two reference shapes from every
backtick span in the document:

- **`file → function()`** (the arrow may be written as `→` or `->`) —
  verifies the file exists, then that the named function/const/class is
  still declared there. If it's not there but is declared somewhere
  else in the repo, it says so — probably moved or renamed, not
  deleted.
- **Bare `path/to/file.ext`** — any backtick-quoted path with a real
  directory component and a source-like extension. Verified with a
  plain existence check.

This is deliberately narrow. It does **not** try to check every
backtick span — bare filenames with no directory component (prose
shorthand, not a path claim), identifiers with no file context, enum
values, JSON keys. Guessing at those trades precision for coverage, and
a checker that cries wolf on ordinary prose gets ignored — an ignored
truth instrument is worse than no instrument at all. If your docs use a
different reference convention entirely, this tool will find nothing to
check and say so plainly, rather than guess.

Every run appends a line to `<repo>/.driftcheck/docs-history.jsonl`.

## Verdict legend

| Mark | Meaning |
|------|---------|
| `OK` | checked, matches |
| `⚠️` | checked, drifted — read the detail line |
| `❌` | checked, failed |
| `??` | inconclusive — couldn't verify, check by hand |
| `—`  | not applicable, cleanly skipped |

## Limitations

- `driftcheck repo`'s DB check currently understands Prisma only; other
  ORMs skip cleanly rather than being checked.
- `driftcheck repo`'s flake-vs-real test triage is Vitest-specific;
  other runners get pass/fail only.
- `driftcheck docs`'s reference matching supports the arrow-pair and
  bare-path conventions described above and nothing else out of the
  box. Extending it to other conventions means editing the two regexes
  in `src/docs.mjs` for now.
- The "moved/renamed?" search in `driftcheck docs` walks the repo tree
  directly and does not honor `.gitignore` — it skips common build/
  dependency directories by name instead.

## License

MIT. See [LICENSE](LICENSE).

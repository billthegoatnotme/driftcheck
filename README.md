# driftcheck

A truth instrument for three kinds of drift: repo *state* that's moved
since you last checked it, reference *documentation* that no longer
describes the code it names, and *continuity* — whether a new working
thread has what it needs to pick up cleanly, or loses everything the
last one learned.

All three failure modes have the same shape — a claim was true once,
and nobody told it that it stopped being true. `driftcheck` exists to
catch that before you act on it.

```
driftcheck repo [path] [--tests] [--build]
driftcheck docs [path] [--file <path>]...
driftcheck spec [path]
driftcheck spec close [path]
driftcheck vitest [path] [--file <path>]...
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

```bash
npm install -g @billthegoatnotme/driftcheck
driftcheck --help
```

Or clone and link it locally instead:

```bash
git clone https://github.com/billthegoatnotme/driftcheck.git
cd driftcheck
npm link
driftcheck --help
```

Run the test suite with `npm test` (Node's built-in test runner —
no extra dependencies).

## `driftcheck repo`

Checks whether your picture of the repo's *state* is current:

```bash
driftcheck repo                    # git / open PRs / DB migrations (fast)
driftcheck repo --tests            # + test suite, with flake-vs-real triage
driftcheck repo /path/to/other/repo --tests --build
```

- **GIT** — HEAD vs. a fresh fetch of `origin/main`: ahead/behind counts,
  a dirty tree, stale local branches already merged upstream, any local
  branch with real commits *not* in `origin/main` whose own PR already
  shows `MERGED`/`CLOSED` on GitHub (work pushed after the merge
  happened, invisible to both the sync check above and the PRS check
  below — see the note after this list), and any agent worktrees under
  `.claude/worktrees` that can silently pollute test or build globs.
- **PRS** — open pull requests via the `gh` CLI. If a PR you believed
  was merged still shows up here, it isn't merged yet.
- **DB** — checks a `"driftcheck:db"` script in the target's
  `package.json` if one exists, so any ORM can plug in: exit `0` means
  no drift, exit `1` means it found some, anything else (unreachable
  DB, missing command, a script bug, a timeout) is reported
  inconclusive (`??`) rather than assumed to be drift. No output
  parsing happens beyond the exit code; that convention is the whole
  interface, and it takes priority over the Prisma fallback below if
  both are present. Without that script,
  falls back to Prisma migration drift via `prisma migrate status`
  loaded through `.env.local`: skipped cleanly (verdict `—`) on any
  repo without `prisma/schema.prisma`; skipped as inconclusive (`??`)
  if Prisma is present but `.env.local` isn't.
- **TESTS** (`--tests`) — runs the `test` script from the target repo's
  own `package.json`. When that script uses Vitest, failures are
  re-run in isolation and classified: fails again in isolation = REAL;
  passes in isolation = FLAKY (a known class under full-suite load, not
  a regression). For any other test runner, only pass/fail is reported
  — per-file flake classification depends on Vitest's own output format
  and file-targeting convention, and doesn't generalize safely.
- **BUILD** (`--build`) — runs `npm run build`.

A merged PR only means the commits it had *at merge time* made it into
`origin/main` — if a branch gets pushed to again afterward, those new
commits aren't included, even though the PR itself still shows
`MERGED`. That's invisible to the ahead/behind check above (it only
looks at your current branch) and to the PRS check (it only lists
*open* PRs), so GIT checks every other local branch for exactly this:
real commits absent from `origin/main` whose own PR is already closed.

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

## `driftcheck spec`

Scaffolds a versioned project spec — a fixed governance document (how
AI and human collaborators work together on this repo, read fresh each
run from [`templates/drift_check_manifesto.md`](templates/drift_check_manifesto.md)
so it can never drift from what actually gets generated) plus a "What We're
Building" section populated from a live `driftcheck repo`/`docs` scan,
and a Checkpoint Log for tracking what happened over time:

```bash
driftcheck spec              # creates <repo>_spec_v0_01.md — no-op if one already exists
driftcheck spec close        # checkpoints forward: writes v0_0N + a paired thread-handoff doc
```

`driftcheck spec` is idempotent — safe to run any time, it only ever
creates the file once. `driftcheck spec close` is deliberate: it writes
the next `<repo>_spec_v0_0N.md` (state re-scanned, prior Checkpoint Log
entries carried forward, a new entry stubbed in) and a
`<repo>_thread_handoff_v0_0N.md` meant to be pasted at the start of the
next working thread.

The reflective sections — the current checkpoint's "what happened," the
handoff's "what to do next" — are left as explicit prompts, not
auto-written. Narrating a working session is a language-generation
task, not a verification one; a deterministic script guessing at *why*
something happened is exactly the kind of unearned confidence this
tool exists to avoid elsewhere. Fill those in yourself, or have your AI
collaborator do it before closing out — the same way this project's
own spec and handoff docs were actually written.

The thread handoff is the actual continuity mechanism this subcommand
exists to automate: a short document meant to be pasted at the start of
the *next* working session so it doesn't start cold. It points back at
the spec's latest Checkpoint Log entry rather than repeating it, and
carries only what a fresh session actually needs — what to do next, and
any open questions left deliberately unresolved rather than
re-litigated. `driftcheck_spec_v0_01.md` in this repo's own root is a
live example, not a fixture — this project uses `driftcheck spec` on
itself.

`<repo>` in the generated filenames is the target's own name (from
`package.json`'s `name` field, falling back to the directory name), not
a literal string.

`close` patches the existing spec in place rather than regenerating it
from the template — only the "Detected" scan snapshot gets refreshed
and a new Checkpoint Log entry gets prepended; everything else,
including any hand-edits to the governance sections or "Purpose,"
carries forward untouched. (An earlier version of this feature
regenerated the whole document from the template on every close, which
silently destroyed any real customization — filling in the Pipeline
Architecture table, writing real Purpose content — the moment the next
checkpoint ran. That's a real data-loss risk for anyone actually using
this file, not a cosmetic one, so it was corrected rather than left as
a documented limitation.) If a spec file has been edited enough that
`close` can't find one of the section markers it patches against, it
still checkpoints — it just reports which marker it couldn't find
instead of silently skipping the update.

`spec`/`spec close` also detect a subtler failure: the repo name that
drives the filename comes from `package.json`'s `name` field, and if
that field changes (or the file disappears) between runs, the detected
name changes too — silently starting a second, orphaned version
sequence under the new name instead of continuing the first. Both
commands scan root for any other `*_spec_v0_NN.md` under a different
name on every run and report it, rather than letting that happen
quietly. Nothing is lost either way — it's just easy to miss without
the warning.

Each `close` also archives whatever it just superseded — every older
`<repo>_spec_v0_NN.md` moves into `<repo>_spec_previous/`, and every
older handoff into `<repo>_thread_handoff_previous/`, so the repo root
always shows exactly one current spec and one current handoff no matter
how many checkpoints have happened. Nothing is ever deleted, only
moved. The output line reports what got archived, since moving files
silently would cut against driftcheck's own verdict-first stance
everywhere else.

## `driftcheck vitest`

Not a fourth drift check — a scaffolding companion. Wires up Vitest for
a project that doesn't have it yet, and optionally generates stub test
files:

```bash
driftcheck vitest                        # config + scripts.test, no stub files
driftcheck vitest --file src/lib.js      # + a stub test file for that source file
```

Creates `vitest.config.mjs` if no Vitest or Vite config already exists
(a `vite.config.*` with its own `test: {...}` block counts), and adds
`"test": "vitest run"` to `package.json` if `scripts.test` isn't already
set — both idempotent, both leave anything already there alone rather
than overwriting it.

`--file <path>` (repeatable) additionally scaffolds `<file>.test.<ext>`
next to that source file — one `describe`/`test()` stub per exported
`function`/`class`/`const`/`let`, plus plain `export { a, b }` lists,
found via the same precise, un-guessed patterns `driftcheck docs`
already uses. Aliases (`export { a as b }`) and re-exports
(`export { x } from './y'`, naming something from a different file)
are still left alone — genuinely ambiguous, not just unhandled. Never
overwrites an existing test file.

**It does not write real assertions, on purpose.** Every stub throws
immediately with a "not yet implemented" message — deciding what
correct behavior looks like requires actually understanding the code,
which is a reasoning task, not something this tool should guess at.
Guessing here would manufacture false confidence, the exact failure
`driftcheck docs` and `driftcheck repo` both exist to catch elsewhere.
The stubs are a real, verified starting point — install Vitest and run
them and they genuinely fail — meant for a human or an AI collaborator
to fill in with real assertions, not something to leave as-is.

## Verdict legend

| Mark | Meaning |
|------|---------|
| `OK` | checked, matches |
| `⚠️` | checked, drifted — read the detail line |
| `❌` | checked, failed |
| `??` | inconclusive — couldn't verify, check by hand |
| `—`  | not applicable, cleanly skipped |

## Limitations

- `driftcheck repo`'s DB check has no built-in ORM-specific knowledge
  beyond the Prisma fallback; every other ORM needs a `"driftcheck:db"`
  script wired up in `package.json`, using the exit-code convention
  above (`0`/`1`/anything else). It surfaces up to 3 lines of the
  script's own output on drift, but still can't parse migration-level
  detail out of arbitrary formats the way the Prisma path does — that
  detail is only as good as what the script itself prints.
- `driftcheck repo`'s flake-vs-real test triage is Vitest-specific;
  other runners get pass/fail only.
- `driftcheck repo`/`driftcheck vitest` operate on one target directory
  — they don't auto-discover a monorepo's separate `package.json`
  files. Point them at each package individually (e.g.
  `driftcheck repo client --tests`, `driftcheck repo server --tests`
  for a client/server split with no root-level `package.json`).
- `driftcheck docs`'s reference matching supports the arrow-pair and
  bare-path conventions described above and nothing else out of the
  box. Extending it to other conventions means editing the two regexes
  in `src/docs.mjs` for now.
- `driftcheck docs`'s declaration check strips `//` and `/* */`
  comments and quoted-string contents before matching, so a removed
  function only mentioned in a comment or a string isn't misread as
  still declared — but it's a heuristic scan, not a real JS/TS parser.
  A template literal with an embedded `${...}` expression, or a regex
  literal containing `//`, can still evade it in either direction.
- The "moved/renamed?" search in `driftcheck docs` reads the repo's own
  `.gitignore` for simple top-level directory names to skip, on top of
  a hardcoded list of common ones — not a full gitignore parser.
  Wildcards, negations, and nested paths (anything with a `/` other
  than one trailing slash) aren't handled, and are walked as normal.
- `driftcheck spec`'s Pipeline Architecture table ships as a fill-in
  placeholder, not auto-detected roles — it's a governance template,
  not something inferable from repo state. Edit the wording for all
  future specs by editing `templates/drift_check_manifesto.md` directly; it's read
  fresh on every run, not baked into the code.
- `driftcheck spec close` only patches the "Detected" section and the
  Checkpoint Log — if you restructure a spec file heavily enough that
  those markers can't be found, it reports that plainly rather than
  silently failing to update, but it also won't guess where to patch.
- `driftcheck vitest`'s export detection covers `export function`/
  `class`/`const`/`let NAME` and plain `export { a, b }` lists. Aliased
  entries (`export { a as b }`) and re-exports (`export { x } from
  './y'`) still aren't extracted — genuinely ambiguous which name a
  stub should import under, not just unhandled.
- `driftcheck vitest --file` scaffolds one file at a time, on purpose —
  it never scans and stubs an entire repo unprompted.

## Support

If driftcheck saves you time, sending something this way is appreciated
but never required:

| Network | Address |
|---|---|
| Solana | `2iPLEu3duHcaieLPaoVfrrk6UPurmdeT4qobtiFNd2SZ` |
| Bitcoin (Taproot) | `bc1p6puaec5q4gvl7fd64aefrekq4fdkh9a0rtxugdd2q4exrqswkggqzaxf42` |
| Ethereum | `0x1155F41781b0edc9F26a28438E841B3e64c31509` |
| HyperEVM | `0x1155F41781b0edc9F26a28438E841B3e64c31509` (same address — EVM-compatible) |
| Robinhood Chain | `0x1155F41781b0edc9F26a28438E841B3e64c31509` (same address — EVM-compatible) |

Double-check the network before sending. The Bitcoin address above is a
Taproot (`bc1p...`) address — some older wallets/exchanges can't send
to it.

## Author

Built by [The Artchitect](https://github.com/billthegoatnotme). hand written - disclaimer: I directed how this got built and verified the results, the actual implementation happened through real back-and-forth with Claude, not word-for-word dictation. The tool itself has zero AI dependency at runtime; I checked. AI made the building faster and more disciplined. It didn't do the thinking for me. I hope that clears up some of the confusion i'm seeing. i don't want to obfuscate the truth.

## License

MIT. See [LICENSE](LICENSE).

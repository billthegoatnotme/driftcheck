# example-app Thread Handoff — Checkpoint 2

Read alongside `example-app_spec_v0_02.md` in this
same folder. This picks up from
`example-app_spec_v0_01.md` — read that
checkpoint's entry in the spec's Checkpoint Log before anything else.

## Plans from this cycle

Plans made since the last checkpoint, oldest first. Open only what the
next step needs.

- `example-app_offline_sync.md` — last edited 2026-09-25 → `previous/example-app_plan_previous/example-app_offline_sync.md`

## What the next thread should actually do

1. Implement the sync queue described in the offline sync plan.
2. Add a test that edits the same note on two devices and checks
   last-write-wins holds.
3. Run `driftcheck repo --tests` before calling anything done.

## Open questions

- Should deleted notes sync as tombstones or be dropped? Leaning
  tombstones; decide once the queue exists.

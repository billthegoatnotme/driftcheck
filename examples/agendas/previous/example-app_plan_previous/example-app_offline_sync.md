# Offline sync plan

1. Every edit is written locally first, then queued.
2. When online, the queue flushes oldest-first.
3. Conflicts: last write wins, per note.

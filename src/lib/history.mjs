import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Appends `record` to the target repo's own .driftcheck/<name>.jsonl and
// returns the previous record (or null on the first run), so each
// subcommand can report its own "since last run" delta. The log lives
// with the repo being checked, not with this package's install location —
// an installed CLI has no writable "beside the script" location of its own.
export function logHistory(historyPath, record) {
  let prev = null;
  if (existsSync(historyPath)) {
    const hist = readFileSync(historyPath, 'utf8').trim().split('\n').filter(Boolean);
    if (hist.length) {
      try { prev = JSON.parse(hist[hist.length - 1]); } catch { /* tolerate a corrupt last line */ }
    }
    record.runIndex = hist.length + 1;
  } else {
    mkdirSync(dirname(historyPath), { recursive: true });
    record.runIndex = 1;
  }
  appendFileSync(historyPath, JSON.stringify(record) + '\n');
  return prev;
}

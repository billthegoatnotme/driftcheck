import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'driftcheck-test-'));
}

export function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

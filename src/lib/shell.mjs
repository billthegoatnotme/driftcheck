import { spawnSync } from 'node:child_process';

const ANSI = /\x1b\[[0-9;]*m/g;

// Runs `command` as a shell string in `cwd`. Callers own quoting — every
// call site in this package passes its own literals, not user input.
export function sh(cwd, command, opts = {}) {
  const r = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf8',
    timeout: opts.timeout ?? 30_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    ok: r.status === 0,
    out: ((r.stdout ?? '') + (r.stderr ?? '')).replace(ANSI, ''),
  };
}

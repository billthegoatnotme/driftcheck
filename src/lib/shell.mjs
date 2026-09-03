import { spawnSync } from 'node:child_process';

const ANSI = /\x1b\[[0-9;]*m/g;

// Runs `command` as a shell string in `cwd`. Callers own quoting — most
// call sites pass their own literals, but the couple that interpolate a
// value not fully under this codebase's control (a git branch name, a
// list of test file paths) use `shArgs` below instead, which never
// touches a shell at all.
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
    code: r.status,
    out: ((r.stdout ?? '') + (r.stderr ?? '')).replace(ANSI, ''),
  };
}

// Runs `cmd` with an argument array directly — no shell, so there's
// nothing for a shell metacharacter in any one argument to do. Only
// usable with a real executable, not a Windows .cmd/.bat shim: Node
// deliberately refuses to spawn those without shell:true (the
// CVE-2024-27980 fix), which would reopen the exact quoting concern
// this exists to avoid. git.exe and node.exe both qualify.
export function shArgs(cwd, cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd,
    shell: false,
    encoding: 'utf8',
    timeout: opts.timeout ?? 30_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    ok: r.status === 0,
    code: r.status,
    out: ((r.stdout ?? '') + (r.stderr ?? '')).replace(ANSI, ''),
  };
}

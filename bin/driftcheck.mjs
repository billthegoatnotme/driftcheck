#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'));

const USAGE = `driftcheck v${pkg.version} — catches a claim that was true once quietly no longer being true.

Usage:
  driftcheck repo [path] [--tests] [--build]   verify repo/PR/DB/test state against reality
  driftcheck docs [path] [--file <path>]...    verify a doc's file/function references against the code

  driftcheck --help                            show this message
  driftcheck --version                         print the version
`;

const [sub, ...rest] = process.argv.slice(2);

if (!sub || sub === '--help' || sub === '-h') {
  console.log(USAGE);
  process.exit(sub ? 0 : 1);
}

if (sub === '--version' || sub === '-v') {
  console.log(pkg.version);
  process.exit(0);
}

if (sub === 'repo') {
  const { runRepoCheck } = await import('../src/repo.mjs');
  runRepoCheck(rest);
} else if (sub === 'docs') {
  const { runDocsCheck } = await import('../src/docs.mjs');
  runDocsCheck(rest);
} else {
  console.error(`driftcheck: unknown subcommand "${sub}"\n`);
  console.log(USAGE);
  process.exit(1);
}

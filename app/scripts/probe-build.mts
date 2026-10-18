import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'usage: node scripts/probe-build.mts <outDir> [mode]';
const PACKAGE = /.*node_modules\/((?:@[^/]+\/)?[^/]+)/;

function outDirOf(arg: string | undefined): string {
  if (!arg) throw new Error(USAGE);
  const out = path.resolve(arg);
  if (out === path.join(APP, '.output')) throw new Error('refusing to build into .output');

  return out;
}

function build(out: string, report: string, mode: string | undefined): void {
  const args = [path.join(APP, 'node_modules', 'wxt', 'bin', 'wxt.mjs'), 'build'];
  if (mode) args.push('--mode', mode);

  execFileSync(process.execPath, args, {
    cwd: APP,
    stdio: 'inherit',
    env: { ...process.env, FADEWISE_OUT_DIR: out, FADEWISE_BUNDLE_REPORT: report },
  });
}

function loadedModules(report: string): Set<string> {
  const lines = fs.readFileSync(report, 'utf8').trim().split('\n');

  return new Set(lines.flatMap((line) => JSON.parse(line) as string[]));
}

function packagesOf(moduleIds: Set<string>): string[] {
  const packages = new Set<string>();

  for (const id of moduleIds) {
    const m = PACKAGE.exec(id);
    if (m) packages.add(m[1]);
    else if (!id.startsWith(APP)) packages.add('(other) ' + id.slice(0, 80));
  }

  return [...packages].sort();
}

const out = outDirOf(process.argv[2]);
const report = path.join(out, 'modules.jsonl');
fs.mkdirSync(out, { recursive: true });
fs.rmSync(report, { force: true });

build(out, report, process.argv[3]);

console.log(packagesOf(loadedModules(report)).join('\n'));

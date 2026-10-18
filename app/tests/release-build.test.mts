import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { THIRD_PARTY } from '../shared/third-party.mts';

const APP = path.join(import.meta.dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'fadewise-build-test-'));
const WXT = path.join(APP, 'node_modules', 'wxt', 'bin', 'wxt.mjs');

const REPORT = path.join(OUT, 'modules.jsonl');

function build(mode?: string) {
  const args = [WXT, 'build'];
  if (mode) args.push('--mode', mode);
  const env = Object.assign({}, process.env, { FADEWISE_OUT_DIR: OUT }, mode ? {} : { FADEWISE_BUNDLE_REPORT: REPORT });
  execFileSync(process.execPath, args, { cwd: APP, env, stdio: 'pipe' });

  return path.join(OUT, mode ? `chrome-mv3-${mode}` : 'chrome-mv3');
}

const read = (dir: string, f: string) => fs.readFileSync(path.join(dir, f), 'utf8');

function allJs(dir: string) {
  const out: string[] = [];

  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.js') || p.endsWith('.html')) out.push(fs.readFileSync(p, 'utf8'));
    }
  };

  walk(dir);

  return out.join('\n');
}

const prod = build();
const verify = build('verify');
test.after(() => {
  fs.rmSync(OUT, { recursive: true, force: true });
});

test('production build: no diagnostic log, no post-gain meter log, nothing put on the page global', () => {
  const js = allJs(prod);
  assert.ok(!/["'`]diag["'`]/.test(js), 'diag messages / storage key');
  assert.ok(!js.includes('__fadewiseMeterLog'), 'meter log');
  assert.ok(!js.includes('postMeterDb:+'), 'post-gain meter value');
  assert.ok(!/FadewiseAnalysis|FadewiseReorder/.test(read(prod, 'content-scripts/player.js')), 'page globals');
  assert.ok(!js.includes('__FADEWISE_VERIFY__'), 'flag replaced at build time');
});

test('verification build keeps the hooks the verification scripts use', () => {
  const js = allJs(verify);
  assert.ok(/["'`]diag["'`]/.test(read(verify, 'content-scripts/bridge.js')));
  assert.ok(read(verify, 'content-scripts/player.js').includes('__fadewiseMeterLog'));
  assert.ok(read(verify, 'content-scripts/player.js').includes('globalThis.FadewiseAnalysis'));
  assert.ok(!js.includes('__FADEWISE_VERIFY__'));
});

test('both builds: same manifest, name from shared/brand.mts, storage as the only permission, welcome page shipped', () => {
  const m = JSON.parse(read(prod, 'manifest.json'));
  const mv = JSON.parse(read(verify, 'manifest.json'));
  assert.deepStrictEqual(mv, m);
  assert.strictEqual(m.name, '__MSG_extName__');
  assert.strictEqual(m.description, '__MSG_extDescription__');
  assert.strictEqual(m.default_locale, 'en');
  assert.strictEqual(m.action.default_title, 'Fadewise');

  for (const loc of ['en', 'ja']) {
    const msg = JSON.parse(read(prod, `_locales/${loc}/messages.json`));
    assert.strictEqual(msg.extName.message, 'Fadewise', loc);
    assert.ok([...msg.extDescription.message].length <= 132, `${loc} description limit`);
    assert.ok(!/YTM/.test(msg.extName.message + msg.extDescription.message), loc);
  }

  assert.deepStrictEqual(m.permissions, ['storage']);
  assert.strictEqual(m.host_permissions, undefined);
  assert.strictEqual(m.optional_permissions, undefined);
  assert.ok(fs.existsSync(path.join(prod, 'welcome.html')));
  assert.deepStrictEqual(Object.keys(m.commands as object).sort(), ['toggle-all', 'toggle-track']);
  const commands = m.commands as Record<
    string,
    { description: string; suggested_key: { default: string }; global?: boolean }
  >;

  for (const [name, c] of Object.entries(commands)) {
    assert.ok(/^__MSG_\w+__$/.test(c.description), name);
    assert.ok(/^(Ctrl|Alt)\+/.test(c.suggested_key.default), name);
    assert.notStrictEqual(c.global, true, name);

    for (const loc of ['en', 'ja']) {
      const msg = JSON.parse(read(prod, `_locales/${loc}/messages.json`));
      assert.ok(msg[c.description.slice(6, -2)].message, `${loc} ${name}`);
    }
  }
});

test('every npm package the production build loads, and the CSS bundled through @import, is on the licenses page', () => {
  const listed = new Set(THIRD_PARTY.filter((x) => x.npm).map((x) => x.npm));
  const ids = fs
    .readFileSync(REPORT, 'utf8')
    .trim()
    .split('\n')
    .flatMap((l) => JSON.parse(l) as string[]);
  const pkgs = new Set<string>();

  for (const id of ids) {
    const m = /.*node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(id);
    if (m) pkgs.add(m[1]);
    if (id.includes('vite/modulepreload-polyfill')) pkgs.add('vite');
  }

  assert.ok(pkgs.has('wxt') && pkgs.has('vite'), [...pkgs].join(','));
  for (const p of pkgs) assert.ok(listed.has(p), `${p} is in the build but not in shared/third-party.mts`);
  // CSS @import is inlined and never shows as a module id.
  const cssFiles = fs.readdirSync(path.join(prod, 'assets')).filter((f) => f.endsWith('.css'));
  const css = cssFiles.map((f) => read(prod, `assets/${f}`)).join('\n');
  assert.ok(
    css.includes('--gray-0:#f8f9fa') && css.includes('--nice-inner-radius'),
    'Open Props tokens and normalize are bundled',
  );
  assert.ok(listed.has('open-props'));
  assert.ok(!/@import|https?:\/\/|url\((?!["']?data:)/.test(css), 'no remote URL or @import left in the CSS');

  for (const f of ['popup.html', 'library.html', 'welcome.html', 'licenses.html']) {
    assert.ok(!/(src|href)="(https?:)?\/\//.test(read(prod, f)), f);
  }

  assert.ok(fs.existsSync(path.join(prod, 'licenses.html')));
  assert.strictEqual(
    read(prod, 'THIRD_PARTY_NOTICES.md'),
    fs.readFileSync(path.join(APP, 'public', 'THIRD_PARTY_NOTICES.md'), 'utf8'),
  );
  assert.strictEqual(read(prod, 'LICENSE.txt'), fs.readFileSync(path.join(APP, '..', 'LICENSE'), 'utf8'));
});

test('no "YTM" in shipped UI text, and the export file name has the new prefix', async () => {
  for (const f of ['popup.html', 'library.html', 'welcome.html', 'licenses.html'])
    assert.ok(!/YTM/.test(read(prod, f)), f);

  for (const f of [
    'entrypoints/popup.html',
    'entrypoints/library.html',
    'entrypoints/welcome.html',
    'entrypoints/licenses.html',
    'ui/popup.mts',
    'ui/library.mts',
    'ui/welcome.mts',
    'ui/licenses.mts',
  ]) {
    assert.ok(!/YTM Adaptive|ytm-adaptive-transitions-/.test(read(APP, f)), f);
  }

  const brand = await import(path.join(APP, 'shared', 'brand.mts'));
  assert.strictEqual(brand.exportFileName(new Date(2026, 9, 2)), 'fadewise-analysis-20261002-000000.json');
  assert.strictEqual(brand.exportFileName(new Date(2026, 9, 12, 17, 43, 12)), 'fadewise-analysis-20261012-174312.json');
  assert.notStrictEqual(
    brand.exportFileName(new Date(2026, 9, 12, 9, 5, 7)),
    brand.exportFileName(new Date(2026, 9, 12, 9, 5, 8)),
  );
});

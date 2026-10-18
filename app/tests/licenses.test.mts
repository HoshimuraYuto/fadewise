import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import * as I from '../ui/i18n.mts';
import * as N from '../scripts/third-party-notices.mts';
import * as P from '../ui/licenses.mts';
import * as L from '../shared/third-party.mts';

type Loose = Record<string, any>;

const APP = path.join(import.meta.dirname, '..');
const ROOT = path.join(APP, '..');
const read = (f: any) => fs.readFileSync(path.join(APP, f), 'utf8');

// pnpm links only direct dependencies into app/node_modules; the others live in the root store
function packageDir(name: string, version: string): string {
  const direct = path.join(APP, 'node_modules', name);
  if (fs.existsSync(direct)) return direct;
  const store = path.join(ROOT, 'node_modules', '.pnpm');
  const entry = fs
    .readdirSync(store)
    .find((d) => d === `${name.replace('/', '+')}@${version}` || d.startsWith(`${name.replace('/', '+')}@${version}_`));

  return path.join(store, entry ?? '', 'node_modules', name);
}

test('own licence is GPL-3.0-or-later: public/LICENSE.txt equals LICENSE, the GPL-3.0 text; package.json agrees', () => {
  const license = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  assert.strictEqual(read(`public/${L.OWN.file}`), license);
  assert.ok(
    license.startsWith(
      '                    GNU GENERAL PUBLIC LICENSE\n                       Version 3, 29 June 2007',
    ),
  );
  assert.ok(license.includes('END OF TERMS AND CONDITIONS'));
  assert.strictEqual(L.OWN.license, 'GPL-3.0-or-later');
  assert.strictEqual(JSON.parse(read('package.json')).license, L.OWN.license);
  assert.ok(L.ownNotice().includes('either version 3 of the License, or\n(at your option) any later version.'));
});

test('every entry has a unique id, a URL, MIT text and texts in both languages', () => {
  const ids = L.THIRD_PARTY.map((x) => x.id);
  assert.strictEqual(new Set(ids).size, ids.length);

  for (const x of L.THIRD_PARTY) {
    assert.ok(['bundled', 'informed'].includes(x.group), x.id);
    assert.strictEqual(x.license, 'MIT', x.id);
    assert.ok(/^Copyright \(c\) /.test(x.copyright), x.id);
    assert.ok(/^https:\/\/github\.com\//.test(x.url!), x.id);
    for (const lang of ['ja', 'en']) assert.ok((I.DICT as any)[lang][`lic.use.${x.id}`], `${lang} lic.use.${x.id}`);
  }

  for (const r of L.REFERENCES) for (const lang of ['ja', 'en']) assert.ok((I.DICT as any)[lang][`lic.ref.${r}`], r);
});

test('versions and copyright lines match node_modules and shared/vendor; npm licences are MIT', () => {
  for (const x of L.THIRD_PARTY.filter((y) => y.npm)) {
    const dir = packageDir(x.npm!, x.version!);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    assert.strictEqual(pkg.version, x.version, x.npm as any);
    assert.strictEqual(pkg.license, 'MIT', x.npm as any);
    const lic = fs.readdirSync(dir).find((f) => /^licen[sc]e/i.test(f));
    if (lic) assert.ok(fs.readFileSync(path.join(dir, lic), 'utf8').includes(x.copyright), `${x.npm} ${lic}`);
  }

  for (const x of L.THIRD_PARTY.filter((y) => y.vendor)) {
    const dir = path.join(APP, 'shared', 'vendor', x.vendor!);
    assert.ok(fs.readFileSync(path.join(dir, 'LICENSE'), 'utf8').includes(x.copyright), x.vendor as any);

    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.mjs'))) {
      assert.ok(
        fs.readFileSync(path.join(dir, f), 'utf8').includes(`${x.name} ${x.version}`),
        `${x.vendor}/${f} header`,
      );
    }
  }

  for (const d of fs.readdirSync(path.join(APP, 'shared', 'vendor')))
    assert.ok(
      L.THIRD_PARTY.some((x) => x.vendor === d),
      d,
    );
  for (const dep of Object.keys(JSON.parse(read('package.json')).dependencies || {}))
    assert.ok(
      L.THIRD_PARTY.some((x) => x.npm === dep),
      dep,
    );
});

test('public/THIRD_PARTY_NOTICES.md is the generated file (run node scripts/third-party-notices.mts)', () => {
  const md = read('public/THIRD_PARTY_NOTICES.md');
  assert.strictEqual(md, N.noticesMarkdown());

  for (const x of L.THIRD_PARTY) {
    assert.ok(md.includes(`### ${x.name}${x.version ? ' ' + x.version : ''}`), x.id);
    assert.ok(md.includes(x.copyright), x.id);
  }
});

for (const lang of ['ja', 'en']) {
  test(`licenses page (${lang}): own licence, every entry with version, licence and full text, the references`, () => {
    const dom = new JSDOM(read('entrypoints/licenses.html'));
    const doc = dom.window.document;
    I.setLang(lang);
    P.render(doc);
    assert.strictEqual(doc.documentElement.lang, lang);
    assert.strictEqual(doc.title, `${(I.DICT as any)[lang]['lic.title']} – Fadewise`);
    const own = doc.querySelector('#own .lic');
    assert.strictEqual(own!.querySelector('.lic-tag')!.textContent, 'GPL-3.0-or-later');
    assert.ok(own!.querySelector('pre')!.textContent.includes(L.OWN.copyright));
    assert.ok(own!.querySelector('pre')!.textContent.includes('GNU General Public License'));
    assert.strictEqual(own!.querySelector('details a')!.getAttribute('href'), 'LICENSE.txt');
    assert.strictEqual(own!.querySelector('summary')!.textContent, (I.DICT as any)[lang]['lic.showText']);

    for (const x of L.THIRD_PARTY) {
      const c = doc.querySelector(`#${x.group} .lic[data-id="${x.id}"]`);
      assert.ok(c, x.id);
      assert.strictEqual(c.querySelector('.lic-name')!.textContent, x.name);
      if (x.version) assert.ok(c.querySelector('.lic-head')!.textContent.includes(x.version), x.id);
      assert.strictEqual(c.querySelector('.lic-tag')!.textContent, 'MIT');
      assert.strictEqual(c.querySelector('a')!.getAttribute('href'), x.url);
      const text = c.querySelector('details pre.license-text')!.textContent;
      assert.ok(text.includes(x.copyright) && text.includes('THE SOFTWARE IS PROVIDED "AS IS"'), x.id);
      assert.strictEqual(c.querySelector('summary')!.textContent, (I.DICT as any)[lang]['lic.showText']);
    }

    assert.strictEqual(doc.querySelectorAll('#refs li').length, L.REFERENCES.length);
    assert.ok(![...doc.querySelectorAll('[data-i18n]')].some((e) => !e.textContent), 'empty text');
  });
}

test('licenses page: switching the language keeps the opened licence texts open and the same nodes count', () => {
  const dom = new JSDOM(read('entrypoints/licenses.html'));
  const doc = dom.window.document;
  I.setLang('ja');
  P.render(doc);
  (doc.querySelector('.lic[data-id="open-props"] details')! as Loose).open = true;
  I.setLang('en');
  P.render(doc);
  assert.strictEqual((doc.querySelector('.lic[data-id="open-props"] details')! as Loose).open, true);
  assert.strictEqual((doc.querySelector('.lic[data-id="vite"] details')! as Loose).open, false);
  assert.strictEqual(doc.querySelectorAll('.lic').length, L.THIRD_PARTY.length + 1);
});

test('the popup, saved-analysis and welcome pages link to licenses.html', () => {
  for (const f of ['popup', 'library', 'welcome']) {
    const doc = new JSDOM(read(`entrypoints/${f}.html`)).window.document;
    const a: Loose | null = doc.querySelector('a[href="licenses.html"]');
    assert.ok(a, f);
    assert.strictEqual(a.dataset.i18n, 'footer.licenses');
    assert.strictEqual(a.getAttribute('target'), '_blank');
  }
});

test('style.css: Open Props from node_modules only, no remote URL, @import, web font or CDN', () => {
  const css = read('ui/style.css');
  const imports = [...css.matchAll(/@import\s+'([^']+)'/g)].map((m) => m[1]);
  assert.ok(imports.length > 0);
  for (const s of imports) assert.ok(s.startsWith('open-props/'), s);
  assert.ok(!/https?:|\/\/[a-z]|url\(|@font-face/i.test(css.replace(/\/\*[\s\S]*?\*\//g, '')));
});

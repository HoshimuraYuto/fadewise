import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import * as S from '../ui/dom-sync.mts';

type Loose = Record<string, any>;

function counter(dom: any, el: any) {
  const c = { added: 0, removed: 0, text: 0 };
  const mo = new dom.window.MutationObserver((list: any) => {
    for (const r of list) {
      if (r.type === 'childList') {
        c.added += [...r.addedNodes].filter((n) => n.nodeType === 1).length;
        c.removed += [...r.removedNodes].filter((n) => n.nodeType === 1).length;
      }

      if (r.type === 'characterData') c.text++;
    }
  });
  mo.observe(el, { childList: true, subtree: true, characterData: true });

  return { c, flush: () => mo.takeRecords().length && null };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

test('syncPairs: identical refresh = no mutation; one changed value = one text change, same nodes', async () => {
  const dom = new JSDOM('<div id="now"></div>');
  const now = dom.window.document.getElementById('now');
  S.syncPairs(
    now!,
    [
      ['a', '1'],
      ['b', '2'],
    ],
    'none',
  );
  const dd = now!.querySelectorAll('dd')[1];
  const { c } = counter(dom, now);
  assert.strictEqual(
    S.syncPairs(
      now!,
      [
        ['a', '1'],
        ['b', '2'],
      ],
      'none',
    ),
    false,
  );
  S.syncPairs(
    now!,
    [
      ['a', '1'],
      ['b', '3'],
    ],
    'none',
  );
  await settle();
  assert.deepStrictEqual(c, { added: 0, removed: 0, text: 1 });
  assert.strictEqual(now!.querySelectorAll('dd')[1], dd);
  assert.strictEqual(dd.textContent, '3');
  S.syncPairs(now!, [['a', '1']], 'none');
  assert.strictEqual(now!.querySelectorAll('dt').length, 1);
  S.syncPairs(now!, null, 'none');
  assert.strictEqual(now!.textContent, 'none');
  S.syncPairs(now!, null, 'nothing');
  assert.strictEqual(now!.textContent, 'nothing');
});

test('syncRows: rows kept by key, only changed cells written, order follows the data, empty row', async () => {
  const dom = new JSDOM('<table><tbody id="t"></tbody></table>');
  const tb = dom.window.document.getElementById('t');
  const rows = (v: any) => [
    { key: 'b', cells: [['B'], [v, 'num']] },
    { key: 'a', cells: [['A'], ['1', 'num']] },
  ];
  S.syncRows(tb!, rows('5') as any, { text: 'empty', colSpan: 2 });
  const trB = tb!.children[0];
  const sel = dom.window.getSelection();
  const rg = dom.window.document.createRange();
  rg.selectNodeContents(tb!.children[1].children[0]);
  sel!.removeAllRanges();
  sel!.addRange(rg);
  const { c } = counter(dom, tb);
  assert.deepStrictEqual(S.syncRows(tb!, rows('5') as any, { text: 'empty', colSpan: 2 }), {
    added: 0,
    removed: 0,
    moved: 0,
    cellsChanged: 0,
  });
  assert.deepStrictEqual(S.syncRows(tb!, rows('6') as any, { text: 'empty', colSpan: 2 }), {
    added: 0,
    removed: 0,
    moved: 0,
    cellsChanged: 1,
  });
  await settle();
  assert.deepStrictEqual(c, { added: 0, removed: 0, text: 1 });
  assert.strictEqual(tb!.children[0], trB);
  assert.strictEqual(String(sel), 'A');
  const st = S.syncRows(
    tb!,
    [
      { key: 'a', cells: [['A'], ['1', 'num']] },
      { key: 'b', cells: [['B'], ['6', 'num']] },
    ],
    { text: 'empty', colSpan: 2 },
  );
  assert.strictEqual(st.added, 0);
  assert.strictEqual(tb!.children[1], trB);
  assert.strictEqual(tb!.children[1].children[1].className, 'num');
  S.syncRows(tb!, [], { text: 'empty', colSpan: 2 });
  assert.strictEqual(tb!.children.length, 1);
  assert.strictEqual(tb!.textContent, 'empty');
  assert.strictEqual((tb!.children[0].children[0] as Loose).colSpan, 2);
  S.syncRows(tb!, rows('7') as any, { text: 'empty', colSpan: 2 });
  assert.strictEqual(tb!.children.length, 2);
  assert.strictEqual((tb!.children[0].children[0] as Loose).colSpan, 1);
});

test('syncRows: a second line in a cell, a detail row spanning the table, list values as items', () => {
  const dom = new JSDOM('<table><tbody id="t"></tbody></table>');
  const tb = dom.window.document.getElementById('t')!;
  const rows = (sub: string) => [
    {
      key: 'a',
      cells: [
        ['Title', 'track', sub],
        ['1', 'num'],
      ],
    },
    { key: 'a:detail', cells: [], detail: [['k', ['x', 'y']]] },
  ];
  S.syncRows(tb, rows('Artist') as any, { text: 'empty', colSpan: 2 });
  const td = tb.children[0].children[0];
  assert.strictEqual(td.querySelector('.main')!.textContent, 'Title');
  assert.strictEqual(td.querySelector('.sub')!.textContent, 'Artist');
  const detail = tb.children[1] as Loose;
  assert.strictEqual(detail.className, 'detail');
  assert.strictEqual(detail.children[0].className, 'pad', 'the details start under the second column');
  assert.strictEqual(detail.children[1].colSpan, 1);
  assert.deepStrictEqual(
    [...detail.querySelectorAll('dd li')].map((li: Loose) => li.textContent),
    ['x', 'y'],
  );
  const main = td.querySelector('.main');
  assert.strictEqual(S.syncRows(tb, rows('Other') as any, { text: 'empty', colSpan: 2 }).cellsChanged, 1);
  assert.strictEqual(td.querySelector('.main'), main, 'the spans are kept');
});

function fakeDoc(state: any) {
  const ls: any[] = [];

  return {
    get visibilityState() {
      return state.v;
    },
    addEventListener: (t: any, f: any) => ls.push(f),
    fire: () => {
      ls.forEach((f) => f());
    },
  };
}

test('deferredRender: many requests -> one render; none while hidden, one when shown again', async () => {
  const st = { v: 'visible' },
    d = fakeDoc(st);
  let n = 0;
  const req = S.deferredRender(
    () => {
      n++;
    },
    20,
    d as any,
  );
  for (let i = 0; i < 5; i++) req();
  await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(n, 1);
  st.v = 'hidden';
  req();
  req();
  await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(n, 1);
  st.v = 'visible';
  d.fire();
  assert.strictEqual(n, 2);
});

test('whileVisible: no ticks while hidden, one tick on becoming visible', async () => {
  const st = { v: 'hidden' },
    d = fakeDoc(st);
  let n = 0;
  const id = S.whileVisible(
    () => {
      n++;
    },
    10,
    d as any,
  );
  await new Promise((r) => setTimeout(r, 45));
  assert.strictEqual(n, 0);
  st.v = 'visible';
  d.fire();
  assert.strictEqual(n, 1);
  await new Promise((r) => setTimeout(r, 35));
  clearInterval(id);
  assert.ok(n >= 3, String(n));
});

test('popup and library no longer empty the containers on a refresh', () => {
  const read = (f: any) => fs.readFileSync(path.join(import.meta.dirname, '..', f), 'utf8');
  const common = fs.readdirSync(path.join(import.meta.dirname, '..', 'ui', 'common')).map((f) => `ui/common/${f}`);
  for (const f of ['ui/common.mts', ...common]) assert.ok(!/replaceChildren\(\)/.test(read(f)), f);
  assert.ok(!/replaceChildren/.test(read('ui/library.mts')));
  assert.ok(!/setInterval/.test(read('ui/popup.mts') + read('ui/library.mts')));
});

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import * as L from '../ui/library-table.mts';
import * as D from '../ui/dom-sync.mts';

type Loose = Record<string, any>;

const APP = path.join(import.meta.dirname, '..');
const rec = (videoId: any, title: any, artist: any, extra: any) => ({
  r: Object.assign({ videoId, title, artist }, extra),
  off: false,
});
const DATA = [
  rec('v1', 'Zeta Song', 'Ångström', { integratedLufs: -9, updatedAt: 3, tempoKey: { tempo: { bpm: 128 } } }),
  rec('v2', 'alpha', 'Example Artist', { integratedLufs: undefined, updatedAt: 2 }),
  rec('v3', '夜の曲', 'Sample Band', { integratedLufs: -14, updatedAt: 1, tempoKey: { tempo: { bpm: 90 } } }),
  rec('v4', null, null, { integratedLufs: -6, updatedAt: 0 }),
];
const ids = (tb: any) =>
  tb
    .rows()
    .map((d: any) => d.r.videoId)
    .join(',');

test('the default order is the given order; search matches title or artist, case-insensitively, Japanese too', () => {
  const tb = L.createLibraryTable();
  tb.setData(DATA);
  assert.strictEqual(ids(tb), 'v1,v2,v3,v4');
  tb.setSearch('ALPHA');
  assert.strictEqual(ids(tb), 'v2');
  tb.setSearch('example');
  assert.strictEqual(ids(tb), 'v2', 'artist');
  tb.setSearch('夜');
  assert.strictEqual(ids(tb), 'v3');
  tb.setSearch('v1');
  assert.strictEqual(ids(tb), '', 'videoId is not searched');
  tb.setSearch('  ');
  assert.strictEqual(ids(tb), 'v1,v2,v3,v4');
});

test('header clicks: text ascending first, numbers descending first, then the other way, then the default order', () => {
  const tb = L.createLibraryTable();
  tb.setData(DATA);
  tb.toggleSort('title');
  assert.strictEqual(tb.sortOf('title'), 'asc');
  assert.strictEqual(ids(tb), 'v2,v1,v3,v4', 'missing titles last');
  tb.toggleSort('title');
  assert.strictEqual(tb.sortOf('title'), 'desc');
  assert.strictEqual(ids(tb), 'v3,v1,v2,v4', 'missing titles still last');
  tb.toggleSort('title');
  assert.strictEqual(tb.sortOf('title'), false);
  assert.strictEqual(ids(tb), 'v1,v2,v3,v4');
  tb.toggleSort('lufs');
  assert.strictEqual(tb.sortOf('lufs'), 'desc');
  assert.strictEqual(ids(tb), 'v4,v1,v3,v2');
  tb.toggleSort('lufs');
  assert.strictEqual(ids(tb), 'v3,v1,v4,v2');
  tb.toggleSort('bpm');
  assert.strictEqual(tb.sortOf('lufs'), false, 'one column at a time');
  assert.deepStrictEqual(tb.sorting(), [{ id: 'bpm', desc: true }]);
  assert.strictEqual(ids(tb), 'v1,v3,v2,v4');
  assert.strictEqual(tb.canSort('applied'), false);
  tb.toggleSort('applied');
  assert.deepStrictEqual(tb.sorting(), [{ id: 'bpm', desc: true }]);
});

test('new data keeps the search and the sort; one column per header cell of library.html', () => {
  const tb = L.createLibraryTable();
  tb.setData(DATA);
  tb.setSearch('a');
  tb.toggleSort('title');
  assert.strictEqual(ids(tb), 'v2,v1,v3');
  tb.setData(DATA.concat([rec('v5', 'Beta', 'Zed', { updatedAt: 9 })]));
  assert.strictEqual(ids(tb), 'v2,v5,v1,v3');
  assert.strictEqual(tb.sortOf('title'), 'asc');
  assert.strictEqual(tb.total(), 5);
  const html = fs.readFileSync(path.join(APP, 'entrypoints', 'library.html'), 'utf8');
  const heads = [...html.matchAll(/<th data-col="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(heads, L.COLUMN_IDS);
});

test('a sort change moves rows; the row nodes (and the focus inside them) are kept', () => {
  const tb = L.createLibraryTable();
  tb.setData(DATA);
  const dom = new JSDOM('<table><tbody id="t"></tbody></table>');
  const tbody = dom.window.document.getElementById('t');
  const rows = () => tb.rows().map((d) => ({ key: d.r.videoId, cells: [[d.r.title || '–']] }));
  D.syncRows(tbody!, rows() as any, { text: 'none', colSpan: 1 });
  const node = tbody!.querySelector('tr[data-key="v3"]');
  tb.toggleSort('title');
  const st = D.syncRows(tbody!, rows() as any, { text: 'none', colSpan: 1 });
  assert.strictEqual(st.added + st.removed + st.cellsChanged, 0);
  assert.strictEqual(tbody!.querySelector('tr[data-key="v3"]'), node);
  assert.deepStrictEqual(
    [...tbody!.children].map((tr: Loose) => tr.dataset.key),
    ['v2', 'v1', 'v3', 'v4'],
  );
  tb.setSearch('zzz');
  D.syncRows(tbody!, rows() as any, { text: 'none', colSpan: 1 });
  assert.strictEqual(tbody!.textContent, 'none');
});

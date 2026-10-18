import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import * as I from '../ui/i18n.mts';
import * as C from '../ui/common.mts';
import * as D from '../ui/dom-sync.mts';

const APP = path.join(import.meta.dirname, '..');
test.before(() => {
  (globalThis as Record<string, unknown>).chrome ??= {
    storage: { session: { get: () => Promise.resolve({}) }, local: { get: () => Promise.resolve({}) } },
  };
});

const run = (at: any, extra?: any) =>
  Object.assign({ at, kind: 'radio', result: 'done', reason: 'ok', method: 'drag', moved: 2, planned: 2 }, extra);

test('history rows: newest first, one line per run in reorderRunText wording, at most RUN_LOG_KEEP', () => {
  I.setLang('ja');
  const log = [
    run(1000),
    run(2000, { result: 'skipped', reason: 'same', moved: 0 }),
    run(3000, { moved: 3, planned: 3 }),
  ];
  const rows = C.reorderHistoryRows(log);
  assert.deepStrictEqual(
    rows.map((r) => r.key),
    ['3000', '2000', '1000'],
  );
  assert.strictEqual(rows[0].cells[0][0], C.reorderRunText(log[2]));
  assert.match(rows[1].cells[0][0]! as any, /動かさず/);
  I.setLang('en');
  assert.match(C.reorderHistoryRows(log)[0].cells[0][0]! as any, /^Ordering \(radio, .*\): moved 3 tracks$/);
  const many = Array.from({ length: 30 }, (_, i) => run(1000 + i));
  assert.strictEqual(C.reorderHistoryRows(many).length, 20);
  assert.strictEqual(C.reorderHistoryRows(many)[0].key, '1029');
  assert.deepStrictEqual(C.reorderHistoryRows(null), []);
  assert.deepStrictEqual(C.reorderHistoryRows([null, { at: 'x' }]), []);
});

test('history table: a new run adds one row at the top; the other rows stay the same nodes', () => {
  I.setLang('en');
  const dom = new JSDOM('<table><tbody id="h"></tbody></table>');
  const tbody = dom.window.document.getElementById('h');
  const empty = { text: 'Nothing recorded yet.', colSpan: 1 };
  D.syncRows(tbody!, C.reorderHistoryRows([]), empty);
  assert.strictEqual(tbody!.textContent, 'Nothing recorded yet.');
  D.syncRows(tbody!, C.reorderHistoryRows([run(1000), run(2000)]), empty);
  const kept = [...tbody!.children];
  const st = D.syncRows(tbody!, C.reorderHistoryRows([run(1000), run(2000), run(3000)]), empty);
  assert.deepStrictEqual(
    { added: st.added, removed: st.removed, cellsChanged: st.cellsChanged },
    { added: 1, removed: 0, cellsChanged: 1 },
  );
  assert.strictEqual(tbody!.children[1], kept[0]);
  assert.strictEqual(tbody!.children[2], kept[1]);
  assert.strictEqual(
    D.syncRows(tbody!, C.reorderHistoryRows([run(1000), run(2000), run(3000)]), empty).cellsChanged,
    0,
  );
});

test('export: reorderLog keeps the last 20 runs with numbers and codes only', () => {
  const dirty = Array.from({ length: 25 }, (_, i) =>
    run(1000 + i, { title: 'Song', videoId: 'abc', reason: i === 24 ? '<b>' : 'ok' }),
  );
  const out = C.reorderLogForExport(dirty.concat([null, 'x']));
  assert.strictEqual(out.length, 20);
  assert.strictEqual(out[0].at, 1005);

  for (const e of out) {
    assert.ok(!('title' in e) && !('videoId' in e));
    for (const v of Object.values(e)) assert.ok(v === null || typeof v === 'number' || /^[a-z_]+$/.test(v), String(v));
  }

  assert.strictEqual(out[19].reason, null);
  assert.deepStrictEqual(C.reorderLogForExport(undefined), []);
  const src = fs.readFileSync(path.join(APP, 'ui', 'library.mts'), 'utf8');
  assert.match(src, /reorderLog: reorderLogForExport\(all\.reorderLog\)/);
});

test('popup line: pending while ordering is on and nothing ran, otherwise the last run (ja / en)', () => {
  I.setLang('ja');
  assert.strictEqual(C.popupReorderText(null, true), '並べ替え: 次に曲が変わったあとに動きます');
  assert.strictEqual(C.popupReorderText([], false), '並べ替え: まだ実行していません');
  assert.strictEqual(C.popupReorderText([run(1000), run(2000)], true), C.reorderRunText(run(2000)));
  I.setLang('en');
  assert.strictEqual(C.popupReorderText(undefined, true), 'Ordering: runs after the next track change');
});

test('the saved-analysis page has the history table under its heading', () => {
  const html = fs.readFileSync(path.join(APP, 'entrypoints', 'library.html'), 'utf8');
  assert.match(html, /data-i18n="library\.h2Reorder"[\s\S]*id="reorderRuns"/);
});

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import * as A from '../shared/analysis.mts';
import * as M from '../shared/seekbar-marks.mts';
import { JSDOM } from 'jsdom';
import FX from './fixtures/real-tracks.json' with { type: 'json' };
import * as I from '../ui/i18n.mts';
import * as X from '../ui/mix-text.mts';
import * as L from '../ui/library-table.mts';
import * as R from '../ui/library-rows.mts';
import * as C from '../content/seekbar-marks.mts';

type Loose = Record<string, any>;

const APP = path.join(import.meta.dirname, '..');
const mixRec = (x: any, n: any, h: any, bpm = 120) => ({
  videoId: 'v',
  mix: { v: 1, g: [120, 0.5, 0.5], x, n, h },
  tempoKey: bpm ? { tempo: { bpm } } : null,
});
const GENTLE = mixRec(
  [
    [198, 3, 1, -14],
    [178.4, 4, 0.9, -1],
  ],
  [
    [0.5, 0, 1, -14],
    [9.52, 1, 0.8, -1],
  ],
  [1, 1, 0],
);
const AGGR = mixRec(
  [
    [198, 3, 1, -14],
    [219.09, 5, 0.84, 1.5],
  ],
  [
    [0.5, 0, 1, -14],
    [78.34, 2, 0.7, 1],
  ],
  [1, 1, 2],
);

test('column: none / gentle / aggressive, full listens, and the hover lines', () => {
  I.setLang('ja');
  const none = X.mixSummary({});
  assert.equal(X.mixCellText(none), 'なし');
  assert.equal(
    X.mixCellTitle(none),
    '今の版の Fadewise で聴いた記録がまだない\n「積極的」の位置を使うには、この曲を最初から最後まで通して聴く\nテンポ不明',
  );
  const g = X.mixSummary(GENTLE);
  assert.equal(X.mixCellText(g), '控えめ・最後まで聴いた回数 0');
  assert.equal(
    X.mixCellTitle(g),
    '次の曲へ移る位置：静かなアウトロの前 2:58.4 [信頼度 0.90]、最後の音 3:18.0\nこの曲に入る位置：最初の音 0:00.5、静かなイントロの後 0:09.5 [信頼度 0.80]\n「積極的」の位置を使うには、この曲を最初から最後まで通して聴く',
  );
  const a = X.mixSummary(AGGR);
  assert.equal(X.mixCellText(a), '積極的（信頼度 0.84）・最後まで聴いた回数 2');
  assert.ok(X.mixCellTitle(a).includes('最後のサビの終わり 3:39.0 [信頼度 0.84]'));
  assert.ok(X.mixCellTitle(a).includes('最初のサビ 1:18.3 [信頼度 0.70]'));
  assert.ok(!X.mixCellTitle(a).includes('通して聴く'), 'heard in full: no hint');
  const noTk = mixRec(AGGR.mix.x, AGGR.mix.n, [1, 1, 1], null as any);
  assert.ok(!X.mixCellTitle(X.mixSummary(noTk)).includes('テンポ不明'), 'the bar grid tempo counts');
  noTk.mix.g = [null as any, 0, 0];
  assert.ok(X.mixCellTitle(X.mixSummary(noTk)).endsWith('テンポ不明'));
  I.setLang('en');
  assert.equal(X.mixCellText(a), 'Bold (confidence 0.84) · played to the end: 2×');
  assert.equal(X.mixCellText(g), 'Gentle · played to the end: 0×');
  assert.equal(X.mixSummary({ mix: { v: 2, x: [], n: [] } }).rank, 0);
  assert.equal(X.mixSummary({ mix: { v: 1, x: [[1, 99]], n: [['a']], h: [] } }).rank, 0);
});

test('column sort: none < gentle < aggressive (then confidence), missing never first', () => {
  const t = L.createLibraryTable();
  const r = (id: any, rec: any) => ({ r: Object.assign({}, rec, { videoId: id }), off: false });
  const weak = mixRec([[219, 5, 0.3, 1]], [[0.5, 0, 1, -14]], [1, 1, 1]);
  t.setData([r('a', GENTLE), r('n', {}), r('s', AGGR), r('w', weak)]);
  assert.ok(L.COLUMN_IDS.includes('mix'));
  assert.ok(t.canSort('mix'));
  t.toggleSort('mix');
  assert.deepEqual(
    t.rows().map((d) => d.r.videoId),
    ['s', 'w', 'a', 'n'],
    'first click: highest first',
  );
  t.toggleSort('mix');
  assert.deepEqual(
    t.rows().map((d) => d.r.videoId),
    ['n', 'a', 'w', 's'],
  );
  assert.ok(
    X.mixRank({}) < X.mixRank(GENTLE) && X.mixRank(GENTLE) < X.mixRank(weak) && X.mixRank(weak) < X.mixRank(AGGR),
  );
});

test('library page: the column sits after the ending, header and cell count agree', () => {
  const html = fs.readFileSync(path.join(APP, 'entrypoints', 'library.html'), 'utf8');
  const cols = [...html.matchAll(/<th data-col="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(cols, L.COLUMN_IDS);
  assert.equal(cols.indexOf('mix'), cols.indexOf('ending') + 1);
  I.setLang('en');
  const row = R.rowOf({ videoId: 'v', title: 'T', artist: 'A', mix: AGGR.mix }, {}, false);
  assert.equal(row.cells.length, cols.length);
  assert.equal(row.cells[cols.indexOf('mix')][0], 'Bold');
  const detail = R.detailOf({ videoId: 'v', mix: AGGR.mix }).detail!;
  const lines = detail.find((p) => p[0] === I.t('col.mix'))![1];
  assert.ok(Array.isArray(lines) && lines.join('\n').includes(X.mixCellTitle(X.mixSummary(AGGR))));
});

const cand = (t: any, k: any, c: any, e: any, bpm = 120, key = '8A') => ({ t, k, c, e, bpm, key });
const cur = (x: any, d = 240) => ({ d, mx: { x, n: [] } });
const nxt = (n: any, d = 240) => ({ d, mx: { x: [], n } });
const LASTX = cand(238, 'last', 1, -14),
  FIRSTN = cand(0.5, 'first', 1, -14);

test('planMix skip: tempo unknown, tempos apart, cost, confidence, window; none in gentle or when chosen', () => {
  const nt: Loose = A.planMix(
    cur([
      cand(200, 'chorusEnd', 0.9, 0, null as any, null as any),
      cand(238, 'last', 1, -14, null as any, null as any),
    ]),
    nxt([FIRSTN]),
    { mode: 'aggressive', now: 0 },
  );
  assert.equal(nt.x.k, 'last');
  assert.equal(nt.skip.why, 'no_tempo');
  const far: Loose = A.planMix(
    cur([cand(200, 'chorusEnd', 0.9, 0, 120), cand(238, 'last', 1, -14, 120)]),
    nxt([cand(0.5, 'first', 1, -14, 140)]),
    { mode: 'aggressive', now: 0 },
  );
  assert.equal(far.skip.why, 'tempo');
  const cost: Loose = A.planMix(cur([cand(200, 'chorusEnd', 0.9, 1.5), LASTX]), nxt([cand(0.5, 'first', 1, -6)]), {
    mode: 'aggressive',
    now: 0,
  });
  assert.equal(cost.x.k, 'last');
  assert.equal(cost.skip.why, 'cost');
  assert.ok(cost.skip.aggrCost > cost.cost);
  const lowA: Loose = A.planMix(cur([cand(200, 'chorusEnd', 0.5, 0), LASTX]), nxt([FIRSTN]), { mode: 'auto', now: 0 });
  assert.equal(lowA.skip.why, 'low_conf', 'auto: below 0.6');
  const late: Loose = A.planMix(cur([cand(200, 'chorusEnd', 0.9, 0), LASTX]), nxt([FIRSTN]), {
    mode: 'aggressive',
    now: 180,
  });
  assert.equal(late.skip.why, 'window');
  assert.equal(
    (
      A.planMix(cur([cand(200, 'chorusEnd', 0.9, 1.5), LASTX]), nxt([cand(0.5, 'first', 1, -6)]), {
        mode: 'gentle',
        now: 0,
      }) as Loose
    ).skip,
    undefined,
  );
  const taken: Loose = A.planMix(cur([cand(200, 'chorusEnd', 0.9, 0), LASTX]), nxt([cand(40, 'lift', 0.9, -4)]), {
    mode: 'aggressive',
    now: 0,
  });
  assert.equal(taken.skip, undefined);
  assert.equal(taken.nextMx, true);
  assert.equal((A.planMix(cur([LASTX]), { d: 200, fs: 0.4 }, { mode: 'aggressive', now: 0 }) as Loose).nextMx, false);
  const entry = { d: 240, en: { kind: 'fades', lastSoundSec: 238 }, fs: 0.5, fx: true };
  const p = A.planTransition(entry as any, { enabled: true, mix: Object.assign({ nextVid: 'n1' }, cost) });
  assert.equal(p.mix!.skip!.why, 'cost');
  assert.equal(p.mix!.nextMx, true);
});

function fade(trOver: any) {
  return {
    vid: 'v1',
    ending: { kind: 'fades', lastSoundSec: 238 },
    fadeIn: false,
    fadeOutStart: null,
    fadeOutEnd: null,
    align: null,
    transition: Object.assign(
      {
        kind: 'trim',
        reason: 'fades',
        atSec: 238.3,
        skipSec: 1.7,
        state: 'idle',
        result: null,
        cancel: null,
        pair: null,
        incoming: null,
        mix: null,
        next: null,
      },
      trOver,
    ),
    marks: { dur: 240, fs: 0.5, fx: true, ls: 238, fadesOn: true, trOn: true, excluded: false },
  };
}

const nextOf = (m: any) => m.items.find((i: any) => i.kind === 'next');
const titleOf = (step: any) => (step === 1 ? 'NEXT-TITLE' : step === -1 ? 'PREV-TITLE' : null);

test('exit mark: the next track and its entry, or why there is none', () => {
  I.setLang('ja');
  const lines = (nx: any, tf = titleOf) => C.itemLines(nextOf(M.seekbarMarks(fade({ next: nx }))), tf);
  assert.deepEqual(lines({ n: { k: 'lift', t: 78.34, c: 0.84 }, nextMx: true, differs: false, skip: null }), [
    '「次へ」を押す位置 3:58.3',
    '次の曲：NEXT-TITLE → 最初のサビ 1:18.3 から入る [信頼度 0.84]',
  ]);
  assert.deepEqual(lines({ n: { k: 'first', t: 0.5, c: 1 }, nextMx: false, differs: false, skip: null }).slice(1), [
    '次の曲：NEXT-TITLE → 最初の音 0:00.5 から入る（次の曲に候補がまだない）',
  ]);
  const why = (w: any) => lines({ n: null, why: w, nextMx: false, differs: false, skip: null })[1];
  assert.equal(why('no_next'), '次の曲：NEXT-TITLE → 入る位置なし（次の曲がまだ決まっていない）');
  assert.equal(why('changed'), '次の曲：NEXT-TITLE → 入る位置なし（次の曲へ移る 50 秒前を過ぎてから次の曲が変わった）');
  assert.equal(why('no_entry'), '次の曲：NEXT-TITLE → 入る位置なし（次の曲に候補がまだない）');
  assert.equal(why('next_unknown'), '次の曲：NEXT-TITLE → 入る位置なし（次の曲に解析結果がない）');
  assert.deepEqual(lines({ n: { k: 'thin', t: 9.52, c: 0.8 }, nextMx: true, differs: true, skip: null }).slice(1), [
    '次の曲 → 静かなイントロの後 0:09.5 から入る [信頼度 0.80]',
    '予定していた次の曲と、キューの次の曲が違う',
  ]);
  const sk = (s: any, cost?: any) =>
    lines({ n: { k: 'first', t: 0.5, c: 1 }, nextMx: true, differs: false, skip: s, cost })[2];
  assert.equal(
    sk({ why: 'cost', aggrCost: 2.41 }, 1.3),
    'サビの候補を使わない理由：今の位置よりつながりが悪い（2.41 > 1.30、小さいほどよい）',
  );
  assert.equal(sk({ why: 'no_tempo', aggrCost: 3.1 }, 1.3), 'サビの候補を使わない理由：テンポ不明');
  assert.equal(sk({ why: 'low_conf', aggrCost: null }), 'サビの候補を使わない理由：信頼度が足りない');
  assert.equal(sk({ why: 'tempo', aggrCost: 3 }), 'サビの候補を使わない理由：テンポが離れている');
  assert.equal(
    lines({ n: { k: 'lift', t: 78.34, c: 0.84 }, nextMx: true }, () => null)[1],
    '次の曲 → 最初のサビ 1:18.3 から入る [信頼度 0.84]',
  );
  I.setLang('en');
  assert.equal(
    lines({ n: { k: 'lift', t: 78.34, c: 0.84 }, nextMx: true })[1],
    'Next: NEXT-TITLE → enters at first chorus 1:18.3 [confidence 0.84]',
  );
  const done = M.seekbarMarks(fade({ result: 'advanced', next: { n: { k: 'lift', t: 78.34, c: 0.84 } } }));
  assert.equal(C.itemLines(nextOf(done), titleOf).length, 1);
});

test('entry mark: where the track was entered from (title only when the previous queue row is that track)', () => {
  I.setLang('ja');
  const inc = (match: any) => ({
    fadeIn: true,
    fadeInSec: 0.3,
    headTrimTo: 78.34,
    headReason: 'mix_lift',
    cancel: null,
    mix: { k: 'lift', t: 78.34, c: 0.84, from: { k: 'chorusEnd', t: 219.09, match } },
  });
  const en = (match: any) => M.seekbarMarks(fade({ incoming: inc(match) })).items.find((i) => i.kind === 'entry');
  assert.deepEqual(C.itemLines(en(true)!, titleOf), [
    '入った位置 1:18.3（最初のサビ） [実験的・信頼度 0.84]',
    '前の曲：PREV-TITLE の最後のサビの終わり（3:39.0）から入った',
  ]);
  assert.equal(C.itemLines(en(false)!, titleOf)[1], '前の曲の最後のサビの終わり（3:39.0）から入った');
});

test('queue title: read from the row after / before the selected one, null without a queue', () => {
  const doc = new JSDOM(`<ytmusic-player-queue><div id="contents">
    <ytmusic-player-queue-item><span class="song-title">A</span></ytmusic-player-queue-item>
    <ytmusic-player-queue-item selected><span class="song-title">B</span></ytmusic-player-queue-item>
    <ytmusic-player-queue-item><span class="song-title"> C </span></ytmusic-player-queue-item></div></ytmusic-player-queue>`)
    .window.document;
  assert.equal(C.queueTitle(doc, 1), 'C');
  assert.equal(C.queueTitle(doc, -1), 'A');
  assert.equal(C.queueTitle(new JSDOM('').window.document, 1), null);
});

test('popup line: the same next-track text without a title', () => {
  I.setLang('ja');
  assert.deepEqual(X.nextLines({ n: { k: 'thin', t: 9.52, c: 0.8 }, nextMx: true }, null), [
    '次の曲 → 静かなイントロの後 0:09.5 から入る [信頼度 0.80]',
  ]);
  assert.deepEqual(X.nextLines(null, 'x'), []);
});

test('every reason code the page and planner produce has words in both languages', () => {
  const readDir = (...parts: string[]): string => {
    const dir = path.join(APP, ...parts);

    return fs
      .readdirSync(dir)
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
      .join('\n');
  };

  const page = readDir('page', 'player');
  const src = page + readDir('shared', 'analysis');
  const whys = new Set([
    'off',
    'settings',
    'changed',
    'gapless',
    'no_next',
    'next_excluded',
    'next_unknown',
    'no_exit',
    'window',
    'no_entry',
  ]);
  const ns = /function noMixWhy[\s\S]*?\n\}/.exec(page)![0];
  for (const m of ns.matchAll(/return '(\w+)'/g)) whys.add(m[1]);
  for (const w of whys) for (const lg of ['ja', 'en']) assert.ok(`mixWhy.${w}` in (I.DICT as any)[lg], `mixWhy.${w}`);
  for (const m of src.matchAll(/why: '(\w+)', aggrCost/g))
    for (const lg of ['ja', 'en']) assert.ok(`mixSkip.${m[1]}` in (I.DICT as any)[lg], m[1]);
  for (const k of ['first', 'thin', 'lift', 'last', 'fade', 'chorusEnd']) assert.ok(`mixKind.${k}` in I.DICT.en);
});

const STORED_MIX = {
  v: 1,
  g: [120, 0.5, 0.5],
  x: [
    [198, 3, 1, -14],
    [219.09, 5, 0.84, 1.5, 120, '8A'],
  ],
  n: [
    [0.5, 0, 1, -14],
    [78.34, 2, 0.7, 1],
  ],
  h: [1, 1, 2],
};

const BROKEN_MIX = {
  v: 1,
  g: 'x',
  x: [[198, 0, 1], [-1, 3], [999, 4], [10, 5, 7, 999, 1e9, '<b>'], 'junk'],
  n: [
    [5, 4],
    [3, 1, 0.5],
  ],
  h: [1, 0, -4],
};

const trackWithMix = () => ({
  videoId: 'abcdefghijk',
  durationSec: 240,
  logicVersion: A.LOGIC_VERSION,
  cells: [
    [0, 10, -20, -3],
    [1, 10, -12, -2],
  ],
  firstSoundSec: 0.5,
  firstSoundExact: true,
  lastSoundSec: 238,
  tail: { endPos: 239.95, lufs: FX.tracks.find((t) => t.label === 'rock-4')!.tail.lufs.slice() },
  mix: STORED_MIX,
});

test('export keeps record.mix; import rebuilds it from numbers and fills it only where none is stored', () => {
  const js = fs.readFileSync(path.join(APP, 'ui', 'library.mts'), 'utf8');
  assert.match(js, /\{ \.\.\.v, cells: A\.floorCells\(v\.cells\) \}/, 'the whole record (with mix) goes into the file');
  const mix = STORED_MIX;
  assert.deepEqual(A.sanitizeImportMix(mix, 240), mix);
  assert.deepEqual(A.sanitizeImportMix(BROKEN_MIX, 240), {
    v: 1,
    g: [null, null, null],
    x: [[10, 5, 0, null, null, null]],
    n: [[3, 1, 0.5, null]],
    h: [1, 0, 0],
  });
  assert.equal(A.sanitizeImportMix({ v: 2, x: [], n: [], h: [] }, 240), null);
  assert.equal(A.sanitizeImportMix({ v: 1, x: [], n: [], h: [0, 0, 0] }, 240), null);
  assert.equal(A.sanitizeImportMix('x', 240), null);
  const track = trackWithMix();
  const imp = A.sanitizeImportTrack(track);
  assert.deepEqual(imp!.mix, mix);
  assert.ok(A.indexEntryOf(imp)!.mx, 'the page can use it');
  assert.equal(
    A.sanitizeImportTrack(Object.assign({}, track, { mix: { v: 1, x: 'boom' } }))!.mix,
    undefined,
    'a broken mix does not reject the track',
  );
  const fresh = A.mergeImportedRecord(null, imp, null, 5).rec;
  assert.deepEqual(fresh!.mix, mix);
  const mine = { v: 1, g: [120, 0, 0.5], x: [[238, 3, 1, -14]], n: [[0.5, 0, 1, -14]], h: [1, 1, 0] };
  const kept = A.mergeImportedRecord(Object.assign({}, fresh, { mix: mine }), imp, null, 6);
  assert.equal(kept.rec!.mix, mine, 'what is stored wins');
  const filled = A.mergeImportedRecord(Object.assign({}, fresh, { mix: undefined }), imp, null, 7);
  assert.equal(filled.changed, true);
  assert.deepEqual(filled.rec!.mix, mix);
});

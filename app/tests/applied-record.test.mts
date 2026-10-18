import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import * as A from '../shared/analysis.mts';

const entry = (at: any, db: any, extra?: any) =>
  Object.assign(
    {
      at,
      gain: {
        db,
        source: 'analysis',
        limit: null,
        wantedDb: db,
        audibleLufs: -12,
        ytNormDb: 0,
        targetLufs: -10,
        ownLufs: -12,
        pLd: -11,
        peakDb: -3,
      },
    },
    extra || {},
  );

test('computeGain reports why the gain is below the wanted change', () => {
  const peak = A.computeGain({
    ownLufs: -18,
    ownCoverage: 0.8,
    peakDb: -3,
    pLd: -18,
    ytTarget: -7,
    targetLufs: -10,
    maxBoostDb: 6,
  });
  assert.strictEqual(peak.limit, 'peak');
  assert.strictEqual(peak.gainDb, 2);
  assert.strictEqual(peak.wantedDb, 8);
  const cap = A.computeGain({
    ownLufs: -18,
    ownCoverage: 0.8,
    peakDb: -12,
    pLd: -18,
    ytTarget: -7,
    targetLufs: -10,
    maxBoostDb: 6,
  });
  assert.strictEqual(cap.limit, 'max_boost');
  assert.strictEqual(cap.gainDb, 6);
  const yt = A.computeGain({ pLd: -18, ytTarget: -7, targetLufs: -10 });
  assert.strictEqual(yt.limit, 'no_peak');
  assert.strictEqual(yt.gainDb, 0);
  assert.strictEqual(yt.source, 'youtube');
  const full = A.computeGain({ pLd: -5.4, ytTarget: -7, targetLufs: -10 });
  assert.strictEqual(full.limit, null);
  assert.strictEqual(full.gainDb, -3);
  assert.strictEqual(A.computeGain({ targetLufs: -10 }).limit, null);
});

test('mergeApplied keeps the last APPLIED_KEEP listens, replaces the same listen, newest last', () => {
  let list: any[] = [];
  for (let i = 1; i <= 8; i++) list = A.mergeApplied(list, entry(i * 1000, -i));
  assert.strictEqual(list.length, A.APPLIED_KEEP);
  assert.deepStrictEqual(
    list.map((x) => x.at),
    [4000, 5000, 6000, 7000, 8000],
  );
  list = A.mergeApplied(
    list,
    entry(8000, -2.5, {
      fadeOut: {
        state: 'done',
        cancel: null,
        startSec: 170,
        endSec: 175,
        align: { on: true, reason: 'aligned', mode: 'bar', beats: 8, bpm: 120.04 },
      },
    }),
  );
  assert.strictEqual(list.length, A.APPLIED_KEEP);
  assert.strictEqual(list[4].gain!.db, -2.5);
  assert.deepStrictEqual(list[4].fadeOut!.align, { on: true, reason: 'aligned', mode: 'bar', beats: 8, bpm: 120 });
  assert.deepStrictEqual(A.mergeApplied(list, undefined), list);
});

test('sanitizeApplied keeps numbers and known codes only (no text from the page)', () => {
  const e = A.sanitizeApplied({
    at: 1.4,
    title: 'x',
    gain: { db: '3', source: 'evil', limit: 'peak', note: 'y' },
    fadeOut: { state: 'cancelled', cancel: 'seeking', startSec: 1, endSec: 2, align: { on: 'yes', reason: '<b>' } },
    skipAtSec: 'z',
  });
  assert.strictEqual(e!.at, 1);
  assert.ok(!('title' in e!));
  assert.strictEqual(e!.gain!.db, null);
  assert.strictEqual(e!.gain!.source, null);
  assert.strictEqual(e!.gain!.limit, 'peak');
  assert.ok(!('note' in e!.gain!));
  assert.deepStrictEqual(e!.fadeOut!.align, { on: false, reason: null, mode: null, beats: null, bpm: null });
  assert.strictEqual(e!.skipAtSec, null);
  assert.strictEqual(A.sanitizeApplied({ gain: {} }), null);
  assert.ok(JSON.stringify(A.mergeApplied([], entry(1, 1))).length < 400 * 1);
});

test('every reason a fade can be cancelled with is a known code', () => {
  const dir = path.join(import.meta.dirname, '..', 'page', 'player');
  const src = fs
    .readdirSync(dir)
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
    .join('\n');
  const reasons = new Set([...src.matchAll(/releaseFade\(pl, '(\w+)'\)/g)].map((m) => m[1]));
  assert.ok(reasons.size >= 5, 'the page source was found');
  for (const m of src.matchAll(/CANCELS_FADE = new Set\(\[([^\]]+)\]/g))
    for (const r of m[1].matchAll(/'(\w+)'/g)) reasons.add(r[1]);
  const sent = A.sanitizeApplied({ at: 1, fadeOut: { state: 'cancelled', cancel: 'x' } });
  assert.strictEqual(sent!.fadeOut!.cancel, null);
  for (const r of reasons)
    assert.strictEqual(A.sanitizeApplied({ at: 1, fadeOut: { state: 'cancelled', cancel: r } })!.fadeOut!.cancel, r, r);
});

test('library line (ja / en) for the applied record', async () => {
  globalThis.chrome = {
    storage: { session: { get: () => Promise.resolve({}) }, local: { get: () => Promise.resolve({}) } },
  } as unknown as typeof chrome;
  const I = await import('../ui/i18n.mts');
  const C = await import('../ui/common.mts');
  const list = [
    entry(1, -1.2),
    entry(2, 2, {
      gain: { db: 2, source: 'analysis', limit: 'peak', wantedDb: 5.5 },
      fadeOut: { state: 'done', align: { on: false, reason: 'low_confidence' } },
    }),
  ];
  I.setLang('ja');
  assert.strictEqual(
    C.appliedText(list),
    '2.0 dB（保存済みの解析値、音が割れないよう上げ幅を抑えた、本来 5.5 dB）、フェードアウト実行（拍合わせなし: BPM の信頼度が 50% 未満）／以前 -1.2 dB',
  );
  assert.strictEqual(C.appliedText(undefined), 'なし');
  I.setLang('en');
  assert.strictEqual(
    C.appliedText(list),
    '2.0 dB (saved analysis, boost limited to avoid clipping, wanted 5.5 dB), fade-out done (not aligned: BPM confidence below 50%); earlier -1.2 dB',
  );
  assert.strictEqual(
    C.appliedText([{ at: 3, fadeOut: { state: 'cancelled', cancel: 'seeking' } }]),
    'fade-out canceled (seeking)',
  );
});

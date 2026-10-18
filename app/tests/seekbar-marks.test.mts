import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import * as M from '../shared/seekbar-marks.mts';
import * as S from '../shared/settings.mts';
import * as A from '../shared/analysis.mts';
import * as I from '../ui/i18n.mts';
import * as C from '../content/seekbar-marks.mts';
import { fade } from './helpers/seekbar-status.mts';

const APP = path.join(import.meta.dirname, '..');

const kinds = (m: any) => m.items.map((i: any) => i.kind);
const by = (m: any, k: any) => m.items.find((i: any) => i.kind === k);

test('model: fade-out band, "next" point, skipped tail, analysis landmarks; positions in song seconds', () => {
  const m = M.seekbarMarks(fade());
  assert.equal(m.dur, 200);
  assert.deepEqual(kinds(m), ['fadeOut', 'tailSkip', 'firstSound', 'lastSound', 'next']);
  assert.deepEqual([by(m, 'fadeOut').start, by(m, 'fadeOut').end, by(m, 'fadeOut').sec], [194.8, 198, 3.2]);
  assert.equal(by(m, 'fadeOut').param, 'fadeOut.startPos');
  assert.equal(by(m, 'next').at, 198);
  assert.equal(by(m, 'next').param, 'transition.advanceAtPos');
  assert.deepEqual([by(m, 'tailSkip').start, by(m, 'tailSkip').end, by(m, 'tailSkip').sec], [198, 200, 2]);
  assert.deepEqual(by(m, 'firstSound').info, { exact: true });
  for (const it of m.items) assert.equal(it.state === 'planned' || it.state === 'done', true);
});

test('model: nothing without a plan, a duration, or for a track left alone (except the landmarks)', () => {
  assert.deepEqual(M.seekbarMarks(null).items, []);
  assert.deepEqual(M.seekbarMarks(fade({ marks: { dur: null } })).items, []);
  const ex = M.seekbarMarks(fade({ marks: Object.assign({}, fade().marks, { excluded: true }) }));
  assert.deepEqual(kinds(ex), ['firstSound', 'lastSound']);
  const none = M.seekbarMarks({
    vid: 'v',
    fadeOutStart: null,
    fadeOutEnd: null,
    transition: { kind: 'none', reason: 'no_analysis', atSec: null },
    marks: { dur: 180, fs: null, ls: null, fadesOn: true },
  });
  assert.deepEqual(none.items, []);
});

test('model: fades off hides the fade-out; transitions off has no "next"', () => {
  const m = M.seekbarMarks(fade({ marks: Object.assign({}, fade().marks, { fadesOn: false }) }));
  assert.equal(by(m, 'fadeOut'), undefined);
  const n = M.seekbarMarks(fade({ transition: { kind: 'none', reason: 'off', atSec: null } }));
  assert.deepEqual(kinds(n), ['fadeOut', 'firstSound', 'lastSound']);
});

test('model: beat alignment and states (done, cancelled)', () => {
  const m = M.seekbarMarks(
    fade({
      align: { on: true, mode: 'bar', beats: 8 },
      marks: Object.assign({}, fade().marks, { outResult: 'cancelled' }),
      transition: Object.assign({}, fade().transition, { result: 'cancelled', cancel: 'seeking' }),
    }),
  );
  assert.deepEqual(by(m, 'fadeOut').info, { aligned: true, mode: 'bar', beats: 8 });
  assert.equal(by(m, 'fadeOut').state, 'cancelled');
  assert.equal(by(m, 'next').state, 'cancelled');
  assert.equal(by(m, 'next').info.cancel, 'seeking');
  const d = M.seekbarMarks(fade({ transition: Object.assign({}, fade().transition, { result: 'advanced' }) }));
  assert.equal(by(d, 'next').state, 'done');
});

test('model: head of a track entered by our own "next": skipped head silence and the transition fade-in', () => {
  const m = M.seekbarMarks(
    fade({
      transition: Object.assign({}, fade().transition, {
        incoming: { fadeIn: true, fadeInSec: 0.3, headTrimTo: 1.15, headReason: 'exact', cancel: null },
      }),
      marks: Object.assign({}, fade().marks, { fs: 1.2 }),
    }),
  );
  assert.deepEqual([by(m, 'headSkip').start, by(m, 'headSkip').end], [0, 1.15]);
  assert.deepEqual([by(m, 'fadeIn').start, by(m, 'fadeIn').end, by(m, 'fadeIn').info.via], [1.15, 1.45, 'transition']);
  const c = M.seekbarMarks(
    fade({ fadeIn: true, marks: Object.assign({}, fade().marks, { fadeInSec: A.FADE_IN_SEC }) }),
  );
  assert.deepEqual(
    [by(c, 'fadeIn').start, by(c, 'fadeIn').end, by(c, 'fadeIn').info.via],
    [0, A.FADE_IN_SEC, 'cut_in'],
  );
});

test('model: a pause before "next" (pair extraWaitSec) and the first-play advance position', () => {
  const m = M.seekbarMarks(
    fade({ transition: Object.assign({}, fade().transition, { atSec: 199, pair: { extraWaitSec: 1 } }) }),
  );
  assert.equal(by(m, 'next').info.extraWaitSec, 1);
  const live = M.seekbarMarks(
    fade({
      fadeOutStart: null,
      fadeOutEnd: null,
      transition: { kind: 'live_trim', reason: 'live_silence', atSec: null, result: null },
    }),
  );
  assert.equal(by(live, 'next'), undefined, 'no position before the first-play advance happens');
  const done = M.seekbarMarks(
    fade({
      fadeOutStart: null,
      fadeOutEnd: null,
      transition: { kind: 'live_trim', reason: 'live_silence', atSec: 197.5, result: 'advanced' },
    }),
  );
  assert.equal(by(done, 'next').state, 'done');
});

test('model: future overlap items appear only when the numbers are there; clamped to the song', () => {
  const m = M.seekbarMarks(
    fade({ overlap: { leadStartPos: 186, leadEndPos: 196, overlapStartPos: 196, overlapEndPos: 198.5, rate: 1.25 } }),
  );
  assert.deepEqual([by(m, 'lead').start, by(m, 'lead').end, by(m, 'lead').info.rate], [186, 196, 1.25]);
  assert.equal(by(m, 'overlap').sec, 2.5);
  assert.equal(by(M.seekbarMarks(fade()), 'lead'), undefined);
  const p = M.seekbarMarks(
    fade({
      overlap: {
        leadStartPos: 180.2,
        leadEndPos: 192.2,
        overlapStartPos: 192.2,
        overlapEndPos: 195.2,
        rate: 1.25,
        state: 'cancelled',
        shape: 'segue',
      },
    }),
  );
  assert.deepEqual(
    [by(p, 'lead').state, by(p, 'overlap').state, by(p, 'overlap').info.shape, by(p, 'overlap').sec],
    ['cancelled', 'cancelled', 'segue', 3],
  );
  const c = M.seekbarMarks(fade({ fadeOutStart: -1, fadeOutEnd: 260 }));
  assert.deepEqual([by(c, 'fadeOut').start, by(c, 'fadeOut').end], [0, 200]);
});

test('model: hover lookup and the redraw signature', () => {
  const m = M.seekbarMarks(fade());
  assert.deepEqual(
    M.itemsAt(m, 196, 0).map((i) => i.kind),
    ['fadeOut'],
  );
  assert.deepEqual(
    M.itemsAt(m, 198.1, 0.2)
      .map((i) => i.kind)
      .sort(),
    ['fadeOut', 'lastSound', 'next', 'tailSkip'],
  );
  assert.deepEqual(M.itemsAt(m, 50, 1), []);
  assert.equal(M.marksSig(m), M.marksSig(M.seekbarMarks(fade())));
  assert.notEqual(M.marksSig(m), M.marksSig(M.seekbarMarks(fade({ fadeOutStart: 194 }))));
});

test('model from the real planners: planFades + planTransition numbers end up where they were planned', () => {
  const entry = {
    l: -9,
    c: 1,
    d: 210,
    fs: 0.4,
    fx: true,
    h0: -6,
    en: { kind: 'abrupt', fadeSec: 3, lastSoundSec: 205, silenceSec: 5 },
    bt: null,
  };
  const plan = A.planFades(entry as any, { beatAlign: false });
  const tp = A.planTransition(entry as any, { enabled: true, fadeOut: plan.fadeOut });
  const m = M.seekbarMarks({
    vid: 'x',
    fadeOutStart: plan.fadeOut!.startPos,
    fadeOutEnd: plan.fadeOut!.endPos,
    align: plan.align,
    transition: { kind: tp.kind, reason: tp.reason, atSec: tp.advanceAtPos, result: null },
    marks: { dur: 210, fs: 0.4, fx: true, ls: 205, fadesOn: true },
  });
  assert.equal(by(m, 'fadeOut').end, by(m, 'next').at);
  assert.equal(by(m, 'tailSkip').sec, tp.skipSec);
});

test('hover text: ja / en', () => {
  const m = M.seekbarMarks(fade({ align: { on: true, mode: 'bar', beats: 8 } }));
  I.setLang('ja');
  assert.equal(C.itemText(by(m, 'fadeOut')), 'フェードアウト 3.2秒（小節の頭から）');
  assert.equal(C.itemText(by(m, 'next')), '「次へ」を押す位置 3:18.0');
  assert.equal(C.itemText(by(m, 'tailSkip')), '曲の終わりを 2.0秒飛ばす');
  I.setLang('en');
  assert.equal(C.itemText(by(m, 'fadeOut')), 'Fade-out 3.2s (from a bar start)');
  assert.equal(C.itemText(by(m, 'lastSound')), 'Last sound 3:18.0');

  for (const k of ['ja', 'en']) {
    I.setLang(k);

    for (const kind of M.KINDS) {
      const it = {
        kind,
        shape: M.BAND.has(kind) ? 'band' : 'point',
        start: 1,
        end: 2,
        at: 3,
        sec: 1,
        state: 'planned',
        info: { rate: 1.25 },
      };
      const s = C.itemText(it as any);
      assert.ok(s && !/sb\./.test(s), `${k} ${kind}: ${s}`);
    }
  }
});

const enteredAfterThinIntro = () =>
  M.seekbarMarks(
    fade({
      transition: Object.assign(fade().transition, {
        incoming: {
          fadeIn: true,
          fadeInSec: 0.3,
          headTrimTo: 12.3,
          headReason: 'mix_thin',
          cancel: null,
          mix: { k: 'thin', t: 12.3, c: 0.9 },
        },
      }),
    }),
  );

const leftBeforeQuietOutro = () =>
  M.seekbarMarks(
    fade({
      fadeOutStart: 176,
      fadeOutEnd: 178,
      transition: Object.assign(fade().transition, {
        atSec: 178,
        skipSec: 22,
        mix: {
          mode: 'gentle',
          x: { k: 'fade', t: 178, c: 0.9 },
          n: { k: 'thin', t: 12, c: 0.9 },
          exit: true,
          entry: true,
          lastSoundSec: 198,
        },
      }),
    }),
  );

const aggressivePair = () =>
  M.seekbarMarks(
    fade({
      transition: Object.assign(fade().transition, {
        atSec: 160,
        mix: {
          mode: 'aggressive',
          x: { k: 'chorusEnd', t: 160, c: 0.84 },
          n: { k: 'lift', t: 40, c: 0.7 },
          exit: true,
          entry: true,
          lastSoundSec: 198,
        },
        incoming: {
          fadeIn: true,
          fadeInSec: 0.3,
          headTrimTo: 40,
          headReason: 'mix_lift',
          cancel: null,
          mix: { k: 'lift', t: 40, c: 0.7 },
        },
      }),
    }),
  );

test('mix points: entry marks on the entered track, exit marks with reasons; params lead back to the pair; aggressive dashed', () => {
  const inMix = enteredAfterThinIntro();
  const hs = by(inMix, 'headSkip'),
    en = by(inMix, 'entry');
  assert.deepEqual([hs.start, hs.end, hs.param, hs.info.mix.k, hs.info.mix.aggr], [0, 12.3, 'mix.n.t', 'thin', false]);
  assert.deepEqual([en.at, en.param, en.state], [12.3, 'mix.n.t', 'done']);
  const outMix = leftBeforeQuietOutro();
  const nx = by(outMix, 'next'),
    ts = by(outMix, 'tailSkip');
  assert.deepEqual([nx.at, nx.param, nx.info.mix.k], [178, 'mix.x.t', 'fade']);
  assert.deepEqual([ts.start, ts.end, ts.param, ts.info.lastSoundSec], [178, 200, 'mix.x.t', 198]);
  const ag = aggressivePair();
  assert.ok(by(ag, 'next').info.mix.aggr && by(ag, 'entry').info.mix.aggr);
  const plain = M.seekbarMarks(fade());
  assert.equal(by(plain, 'next').param, 'transition.advanceAtPos');
  assert.ok(!by(plain, 'next').info.mix && !plain.items.some((i) => i.kind === 'entry'));
  assert.notEqual(M.marksSig(outMix), M.marksSig(plain));
  I.setLang('ja');
  assert.equal(C.itemText(hs), '静かなイントロ 12.3秒を飛ばした');
  assert.equal(C.itemText(en), '入った位置 0:12.3（静かなイントロの後）');
  assert.equal(C.itemText(ts), '静かなアウトロ 20.0秒を切る');
  assert.equal(C.itemText(nx), '「次へ」を押す位置 2:58.0（静かなアウトロの前）');
  assert.equal(C.itemText(by(ag, 'next')), '「次へ」を押す位置 2:40.0（最後のサビの終わり）');
  assert.match(C.itemText(by(ag, 'tailSkip'))!, /^最後のサビの後 38\.0秒を切る \[実験的・信頼度 0\.84\]$/);
  assert.match(C.itemText(by(ag, 'entry'))!, /^入った位置 0:40\.0（最初のサビ） \[実験的・信頼度 0\.70\]$/);
  I.setLang('en');
  assert.equal(C.itemText(hs), 'Skipped a quiet intro: 12.3s');
  assert.equal(C.itemText(nx), '"Next" at 2:58.0 (before the quiet outro)');
  assert.match(
    C.itemText(by(ag, 'entry'))!,
    /^Entered at 0:40\.0 \(first chorus\) \[experimental, confidence 0\.70\]$/,
  );
});

test('setting: default on, in the popup, wired into the ISOLATED content script; page script sends marks', () => {
  assert.equal(S.DEFAULTS.seekbarMarks, true);
  assert.ok(!S.PRESET_KEYS.includes('seekbarMarks' as any), 'presets leave display settings alone');
  const popup = fs.readFileSync(path.join(APP, 'entrypoints', 'popup.html'), 'utf8');
  assert.match(popup, /id="seekbarMarks"[^>]*> <span data-i18n="popup.seekbarMarks">/);
  assert.match(fs.readFileSync(path.join(APP, 'ui', 'popup.mts'), 'utf8'), /'seekbarMarks'/);
  assert.match(fs.readFileSync(path.join(APP, 'entrypoints', 'bridge.content.ts'), 'utf8'), /seekbar-marks-start\.mts/);
  const pm = fs.readFileSync(path.join(APP, 'page', 'player', 'status.mts'), 'utf8');
  assert.match(pm, /marks: marksStatus\(pl, f\)/);
  const used = new Set();

  for (const m of fs
    .readFileSync(path.join(APP, 'content', 'seekbar', 'item-text.mts'), 'utf8')
    .matchAll(/\bt\((?:it\.[^?]+\? )?'([\w.]+)'(?: : '([\w.]+)')?/g)) {
    used.add(m[1]);
    if (m[2]) used.add(m[2]);
  }

  assert.ok(used.size >= 14, `keys ${used.size}`);

  for (const k of used) {
    assert.ok((k as any) in I.DICT.ja, k as any);
    assert.ok((k as any) in I.DICT.en, k as any);
  }
});

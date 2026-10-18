import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import * as Analysis from '../shared/analysis.mts';
import * as S from '../shared/settings.mts';
import * as TK from '../shared/tempo-key.mts';
import fixtures from './fixtures/real-tracks.json' with { type: 'json' };
import { entry, type Loose } from './helpers/player-sim.mts';

const __dirname = import.meta.dirname;
const A: Loose = Analysis;
const fx: Loose = fixtures;

const ON = { enabled: true };

test('plan: fades / decays -> trim at last sound + 0.2 s, no fade', () => {
  for (const kind of ['fades', 'decays']) {
    const p = A.planTransition(entry(200, kind, 194), ON);
    assert.deepStrictEqual([p.kind, p.reason, p.advanceAtPos, p.skipSec], ['trim', kind, 194.2, 5.8]);
  }
});

test('plan: abrupt -> next at the end of the existing (maybe beat-aligned) fade-out', () => {
  const e = entry(200, 'abrupt', 199.9);
  const pf = A.planFades(e, {});
  assert.ok(pf.fadeOut);
  const p = A.planTransition(e, { enabled: true, fadeOut: pf.fadeOut });
  assert.strictEqual(p.reason, 'little_silence', 'a cut at the end of the file leaves nothing to skip');
  const e2 = Object.assign(entry(200, 'abrupt', 198), {});
  const fo = { startPos: 195, endPos: 197.8, restorePos: 198.3 };
  const p2 = A.planTransition(e2, { enabled: true, fadeOut: fo });
  assert.deepStrictEqual([p2.kind, p2.advanceAtPos, p2.skipSec], ['fade_trim', 197.8, 2.2]);
  const p3 = A.planTransition(e2, { enabled: true, fadeOut: null });
  assert.deepStrictEqual([p3.kind, p3.advanceAtPos], ['trim', 198]);
});

test('plan: stop -> 0.3 s after the last hit', () => {
  const p = A.planTransition(entry(200, 'stop', 198), ON);
  assert.deepStrictEqual([p.kind, p.advanceAtPos, p.skipSec], ['stop_wait', 198.3, 1.7]);
});

test('plan: not analysed, unknown ending, no duration, setting off -> none, with the reason', () => {
  assert.strictEqual(A.planTransition(null, ON).reason, 'no_analysis');
  assert.strictEqual(A.planTransition(entry(200, 'fades', 190), { enabled: false }).reason, 'off');
  assert.strictEqual(A.planTransition(Object.assign(entry(200, 'fades', 190), { en: null }), ON).reason, 'no_ending');
  assert.strictEqual(A.planTransition(entry(200, 'unknown', 190), ON).reason, 'no_ending');
  assert.strictEqual(A.planTransition(Object.assign(entry(200, 'fades', 190), { d: null }), ON).reason, 'no_duration');
  for (const r of ['no_analysis', 'off', 'no_ending', 'no_duration'])
    assert.strictEqual(
      A.planTransition(r === 'no_analysis' ? null : entry(1, 'unknown', 0), r === 'off' ? {} : ON).kind,
      'none',
    );
});

test('plan: boundary of the skipped length (0.25 s)', () => {
  assert.strictEqual(A.planTransition(entry(100.45, 'fades', 100), ON).kind, 'trim');
  assert.strictEqual(A.planTransition(entry(100.44, 'fades', 100), ON).reason, 'little_silence');
  assert.strictEqual(A.planTransition(entry(100.55, 'stop', 100), ON).kind, 'stop_wait');
  assert.strictEqual(A.planTransition(entry(100.54, 'stop', 100), ON).kind, 'none');
});

test('head trim: only an exact first sound between 0.25 and 2 s with a matching duration', () => {
  const e = (fs: number, fxv: boolean, d?: number) => Object.assign(entry(d || 200, 'fades', 190), { fs, fx: fxv });
  assert.deepStrictEqual(A.planHeadTrim(e(1.2, true), 200.4), { seekTo: 1.15, why: 'exact' });
  assert.strictEqual(A.planHeadTrim(e(1.2, false), 200).why, 'not_exact');
  assert.strictEqual(A.planHeadTrim(e(0.24, true), 200).why, 'short');
  assert.strictEqual(A.planHeadTrim(e(0.25, true), 200).seekTo, 0.2);
  assert.strictEqual(A.planHeadTrim(e(2, true), 200).seekTo, 1.95);
  assert.strictEqual(A.planHeadTrim(e(2.01, true), 200).why, 'long');
  assert.strictEqual(A.planHeadTrim(e(1, true), 215).why, 'duration');
  assert.strictEqual(A.planHeadTrim(e(1, true), NaN).why, 'duration');
  assert.strictEqual(A.planHeadTrim(null, 200).why, 'no_analysis');
  assert.ok(A.HEAD_TRIM_MAX_SEC <= 2);
});

test('step: arm inside 10 s, advance only when crossing during playback with enough file left', () => {
  const plan = A.planTransition(entry(200, 'fades', 190), ON);
  const st = (ct: number, prevCt: number | null, extra?: Loose) =>
    A.transitionStep(
      Object.assign(
        { plan, ct, prevCt, duration: 200, ad: false, paused: false, sameTrack: true, enabled: true },
        extra,
      ),
    );
  assert.strictEqual(st(170, 169.9), 'wait');
  assert.strictEqual(st(180.2, 180.1), 'arm');
  assert.strictEqual(st(190.25, 190.15), 'advance');
  assert.strictEqual(st(195, 60), 'skip', 'seek past the point');
  assert.strictEqual(st(190.25, null), 'skip', 'first frame after a switch');
  assert.strictEqual(st(190.25, 190.15, { sameTrack: false }), 'skip', 'different source');
  assert.strictEqual(
    st(199.9, 199.8, { plan: Object.assign({}, plan, { advanceAtPos: 199.85 }) }),
    'skip',
    'less than 0.25 s left',
  );
  for (const x of [{ ad: true }, { paused: true }, { enabled: false }, { plan: null }, { ct: NaN }])
    assert.strictEqual(st(190.25, 190.15, x), 'wait', JSON.stringify(x));
  assert.strictEqual(st(190.25, 190.15, { plan: A.planTransition(null, ON) }), 'wait');
});

test('settings: transitions default off; a stored skipSilence: true migrates to transitions on', () => {
  assert.strictEqual(S.DEFAULTS.transitions, false);
  assert.strictEqual(S.DEFAULTS.transitionWash, false);
  assert.ok(!('skipSilence' in S.DEFAULTS));
  assert.strictEqual(S.withDefaults(null).transitions, false);
  assert.strictEqual(S.withDefaults({ skipSilence: true }).transitions, true);
  assert.strictEqual(S.withDefaults({ skipSilence: false }).transitions, false);
  assert.strictEqual(
    S.withDefaults({ skipSilence: true, transitions: false }).transitions,
    false,
    'an explicit choice wins',
  );
  assert.strictEqual(S.withDefaults({ transitions: true }).transitions, true);
  assert.ok(!('skipSilence' in S.withDefaults({ skipSilence: true })));
  assert.strictEqual(S.pageSettings({ skipSilence: true }, null).transitions, true);
  const after = S.patchSettings({ skipSilence: true }, { transitions: false });
  assert.strictEqual(S.withDefaults(after).transitions, false);
});

test('applied record: transition and incoming are kept as codes and numbers only', () => {
  const e = A.sanitizeApplied({
    at: 5,
    transition: {
      kind: 'trim',
      reason: 'decays',
      state: 'advanced',
      cancel: null,
      planSec: 95.2,
      atSec: 95.21,
      skipSec: 4.8,
      wash: true,
      extra: 'x',
    },
    incoming: { fadeIn: true, headTrimTo: 1.15, headReason: 'exact', cancel: 'pause' },
  });
  assert.deepStrictEqual(e.transition, {
    kind: 'trim',
    reason: 'decays',
    state: 'advanced',
    cancel: null,
    planSec: 95.2,
    atSec: 95.21,
    skipSec: 4.8,
    wash: true,
    pair: null,
  });
  assert.deepStrictEqual(e.incoming, { fadeIn: true, headTrimTo: 1.15, headReason: 'exact', cancel: 'pause' });
  const bad = A.sanitizeApplied({
    at: 5,
    transition: { kind: '<b>', reason: 'x', state: 'y', cancel: 'z', atSec: 'n' },
  });
  assert.deepStrictEqual(
    [bad.transition.kind, bad.transition.reason, bad.transition.state, bad.transition.cancel, bad.transition.atSec],
    [null, null, null, null, null],
  );
  assert.strictEqual(A.sanitizeApplied({ at: 5 }).transition, null);
});

test('applied record: every cancel reason the page can produce is a known code', () => {
  const dir = path.join(__dirname, '..', 'page', 'player');
  const src = fs
    .readdirSync(dir)
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
    .join('\n');
  const reasons = new Set([
    'timeout',
    'not_reached',
    'not_found',
    'disabled',
    'repeat_one',
    'ad',
    'pause',
    'off',
    'error',
    'watchdog',
    'seeking',
    'jump',
    'emptied',
    'loadstart',
    'ad_start',
    'ad_end',
    'drift',
    'track_change',
    'ended',
  ]);
  const found = [...src.matchAll(/(?:cancelTransition\(pl, |endTransition\(pl, '\w+', )'(\w+)'/g)];
  assert.ok(found.length >= 5, 'the page source was found');
  for (const m of found) reasons.add(m[1]);
  for (const r of reasons)
    assert.strictEqual(A.sanitizeApplied({ at: 1, transition: { cancel: r } }).transition.cancel, r, r);
});

test('real fixtures: plans follow the ending, never skip sound, and only skip trailing silence', () => {
  const kinds: Record<string, number> = {};

  for (const t of fx.tracks) {
    const en = A.classifyEnding(t.tail, t.integratedLufs, t.lastSoundSec, t.durationSec);
    const e = {
      l: t.integratedLufs,
      c: t.coverage,
      d: t.durationSec,
      en,
      fs: t.head.firstSoundSec,
      fx: t.head.firstSoundExact,
    };
    const pf = A.planFades(e, {});
    const p = A.planTransition(e, { enabled: true, fadeOut: pf.fadeOut });
    kinds[p.kind] = (kinds[p.kind] || 0) + 1;

    if (p.kind === 'none') {
      assert.ok(['little_silence', 'no_ending'].includes(p.reason), t.label);
      continue;
    }

    assert.ok(p.advanceAtPos >= en.lastSoundSec - 0.001, t.label);
    if (en.kind === 'stop') assert.strictEqual(p.kind, 'stop_wait', t.label);
    if (en.kind === 'fades' || en.kind === 'decays') assert.strictEqual(p.kind, 'trim', t.label);
    const n = t.tail.lufs.length;
    const pos = (i: number) => t.tail.endPos - (n - 1 - i) * 0.1;
    for (let i = 0; i < n; i++)
      if (pos(i) > p.advanceAtPos + 0.1)
        assert.ok(!(t.tail.lufs[i] > t.integratedLufs - 42), `${t.label} sound after ${p.advanceAtPos}`);
    assert.ok(p.skipSec >= A.TR_MIN_SKIP_SEC, t.label);
  }

  assert.deepStrictEqual(kinds, { none: 22, trim: 16, stop_wait: 2 });
});

test('real fixtures: total trailing silence skipped and head trims within the cap', () => {
  let skipped = 0,
    trims = 0;

  for (const t of fx.tracks) {
    const en = A.classifyEnding(t.tail, t.integratedLufs, t.lastSoundSec, t.durationSec);
    const e = { d: t.durationSec, en, fs: t.head.firstSoundSec, fx: t.head.firstSoundExact };
    const p = A.planTransition(e, ON);
    if (p.kind !== 'none') skipped += p.skipSec;
    const h = A.planHeadTrim(e, t.durationSec);

    if (h.seekTo !== null) {
      trims++;
      assert.ok(h.seekTo <= 2 && h.seekTo >= 0.2 && t.head.firstSoundExact, t.label);
      assert.ok(h.seekTo < t.head.firstSoundSec, t.label);
    }
  }

  assert.ok(skipped > 40 && skipped < 60, `skipped ${skipped.toFixed(1)} s`);
  assert.strictEqual(trims, 15);
});

test('popup / library text (ja / en) for the transition', async () => {
  (globalThis as Loose).chrome = {
    storage: { session: { get: () => Promise.resolve({}) }, local: { get: () => Promise.resolve({}) } },
  };
  const I = await import(path.join(__dirname, '..', 'ui', 'i18n.mts'));
  const C = await import(path.join(__dirname, '..', 'ui', 'common.mts'));
  const tr = { kind: 'trim', reason: 'decays', atSec: 194.2, skipSec: 5.8, result: 'armed', wash: false };
  I.setLang('ja');
  assert.strictEqual(
    C.transitionText(tr),
    '194.2 秒で次へ（曲の終わりの無音 5.8 秒を飛ばす）、理由: 短い余韻で終わる曲、予約済み',
  );
  assert.strictEqual(C.transitionText({ kind: 'none', reason: 'no_analysis' }), 'なし（未解析の曲）');
  assert.strictEqual(
    C.transitionText({
      kind: 'stop_wait',
      reason: 'stop',
      atSec: 198.3,
      skipSec: 1.7,
      result: 'cancelled',
      cancel: 'pause',
    }),
    '最後の音の 0.3 秒後 198.3 秒で次へ（曲の終わりの無音 1.7 秒を飛ばす）、理由: 演奏がぴたりと止まる曲、取り消し（一時停止）',
  );
  assert.strictEqual(
    C.incomingText({ fadeIn: true, headTrimTo: 1.15 }),
    '曲の始まりの無音を 1.15 秒まで飛ばした、0.3 秒でフェードイン',
  );
  assert.strictEqual(
    C.appliedText([{ at: 1, transition: { kind: 'trim', reason: 'fades', state: 'advanced', atSec: 194.25 } }]),
    '曲間 実行（自然にフェードして終わる曲）、194.3 秒で次へ',
  );
  I.setLang('en');
  assert.strictEqual(
    C.transitionText(Object.assign({}, tr, { kind: 'fade_trim', reason: 'abrupt', wash: true })),
    'next at the end of the fade-out, 194.2 s (skips 5.8 s of silence at the end), reason: cuts off abruptly, reverb bridge, scheduled',
  );
  assert.strictEqual(
    C.transitionText({ kind: 'none', reason: 'little_silence' }),
    'none (almost no silence at the end)',
  );

  for (const r of [
    'fades',
    'decays',
    'abrupt',
    'stop',
    'off',
    'no_analysis',
    'no_ending',
    'no_duration',
    'little_silence',
    'error',
  ]) {
    assert.ok(`trReason.${r}` in I.DICT.en && `trReason.${r}` in I.DICT.ja, r);
  }

  for (const s of ['armed', 'advanced', 'cancelled', 'skipped']) assert.ok(`trState.${s}` in I.DICT.ja, s);
});

const keyChroma = (t: number, m: 'major' | 'minor', s: number) => {
  const p = TK.TEMPERLEY[m];

  return Array.from({ length: 12 }, (_, i) => p[(i - t + 12) % 12] * s);
};

const keyChangeTempoKey = () => ({
  logicVersion: 1,
  chromaSum: keyChroma(0, 'major', 600),
  chromaFrames: 600,
  tempo: { bpm: 120, confidence: 0.9 },
  seg: {
    v: 1,
    head: {
      cs: keyChroma(0, 'major', 300),
      cf: 300,
      votes: [
        [120, 30],
        [120, 30],
      ],
    },
    tail: {
      cs: keyChroma(2, 'major', 300),
      cf: 300,
      votes: [
        [120, 30],
        [120, 30],
      ],
    },
  },
});

const CONTRAST_PAIR = {
  tempo: 'far',
  key: 'clash',
  fadeOutSec: 4,
  extraWaitSec: 0.6,
  fadeInSec: 0.3,
  wash: false,
  reasons: ['contrast_longer_fade', 'no_wash_key_clash', 'contrast_pause'],
};

test('popup / library text (ja / en): pair modifiers, first-play advance, start / end key and BPM', async () => {
  (globalThis as Loose).chrome = {
    storage: { session: { get: () => Promise.resolve({}) }, local: { get: () => Promise.resolve({}) } },
  };
  const I = await import(path.join(__dirname, '..', 'ui', 'i18n.mts'));
  const C = await import(path.join(__dirname, '..', 'ui', 'common.mts'));
  const pair = CONTRAST_PAIR;
  const tr = { kind: 'fade_trim', reason: 'abrupt', atSec: 199.9, skipSec: 1.1, result: 'armed', pair };
  I.setLang('ja');
  assert.strictEqual(
    C.transitionText(tr),
    'フェードアウトの終わり 199.9 秒で次へ（曲の終わりの無音 1.1 秒を飛ばす）、理由: 途中で急に切れる曲、次の曲: テンポが離れている、キーが合わない → フェード 4.0 秒、残響なし（キーが合わない）、0.6 秒あける、予約済み',
  );
  assert.strictEqual(
    C.transitionText({ kind: 'live_trim', reason: 'live_silence', atSec: 236.4, skipSec: 2.6, result: 'advanced' }),
    '236.4 秒で無音を見つけて次へ（残り 2.6 秒を飛ばした）、実行',
  );
  assert.strictEqual(
    C.transitionText({ kind: 'live_trim', reason: 'live_silence', result: 'cancelled', cancel: 'sound' }),
    '曲の終わりの無音を再生中に見つけたら次へ、取り消し（無音の後に音が続いた）',
  );
  assert.strictEqual(
    C.pairText({ tempo: 'match', key: 'match', fadeInSec: 0.1, reasons: ['punch_in'] }),
    '次の曲: テンポが同じ、キーが合う → フェードイン 0.1 秒',
  );
  assert.strictEqual(C.pairText({ reasons: ['no_next'] }), '次の曲は未解析（いつもどおり）');
  assert.strictEqual(C.incomingText({ fadeIn: true, fadeInSec: 0.1 }), '0.1 秒でフェードイン');
  const tk = keyChangeTempoKey();
  assert.strictEqual(C.edgesText(tk), '始まりの 30 秒 8B 120 BPM ／ 終わりの 30 秒 10B 120 BPM（転調）');
  assert.strictEqual(
    C.edgesText({ logicVersion: 1, chromaSum: keyChroma(0, 'major', 600), chromaFrames: 600 }),
    null,
    'no segments: not shown',
  );
  I.setLang('en');
  assert.strictEqual(
    C.pairText(pair),
    'next track: distant tempo, keys clash → fade 4.0 s, no reverb (keys clash), 0.6 s pause',
  );
  assert.strictEqual(C.edgesText(tk), 'first 30 s 8B 120 BPM / last 30 s 10B 120 BPM (key change)');
  for (const k of ['live_silence']) assert.ok(`trReason.${k}` in I.DICT.en && `trReason.${k}` in I.DICT.ja);
});

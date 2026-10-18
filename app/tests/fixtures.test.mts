import test from 'node:test';
import assert from 'node:assert';
import * as A from '../shared/analysis.mts';
import { loadFixtures } from './helpers/fixtures.mts';
import type { FixtureTrack } from './helpers/fixtures.mts';

const fx = loadFixtures('real-tracks');

const classify = (t: FixtureTrack) => A.classifyEnding(t.tail, t.integratedLufs, t.lastSoundSec, t.durationSec);
const accepts = (t: FixtureTrack, kinds: string[]) => t.reviewLabel.split('|').some((k) => kinds.includes(k));

test('real fixtures: 40 tracks, numbers only, no titles or artists', () => {
  assert.strictEqual(fx.tracks.length, 40);
  const text = JSON.stringify(fx);
  assert.ok(!/"(title|artist)"/i.test(text));

  for (const t of fx.tracks) {
    assert.match(t.label, /^[a-z]+-\d$/);
    assert.ok(t.tail.lufs.length >= 80 && t.tail.lufs.length <= 200, t.label);
  }
});

test('real fixtures: fade-outs only where the file cuts the sound (no unwanted fades, none missed)', () => {
  const faded = fx.tracks
    .filter((t) => classify(t).kind === 'abrupt')
    .map((t) => t.label)
    .sort();
  const cuts = fx.tracks
    .filter((t) => accepts(t, ['cut']))
    .map((t) => t.label)
    .sort();
  assert.deepStrictEqual(faded, cuts);

  for (const t of fx.tracks) {
    const plan = A.planFades({ l: t.integratedLufs, en: classify(t) }, {});
    assert.strictEqual(!!plan.fadeOut, accepts(t, ['cut']), t.label);
  }
});

test('real fixtures: tracks that were faded but stop by themselves are now "stop"', () => {
  const changed = fx.tracks.filter((t) => classify(t).kind !== t.endingStored.kind);
  assert.deepStrictEqual(changed.map((t) => t.label).sort(), ['hiphop-1', 'jpop-1', 'live-2']);

  for (const t of changed) {
    assert.strictEqual(t.endingStored.kind, 'abrupt', t.label);
    assert.strictEqual(classify(t).kind, 'stop', t.label);
    assert.ok(classify(t).silenceSec! > 0.3, t.label);
  }
});

test('real fixtures: a record stored under the old rules is planned with the current ones', () => {
  for (const t of fx.tracks) {
    const old = {
      integratedLufs: t.integratedLufs,
      coverage: t.coverage,
      lastSoundSec: t.lastSoundSec,
      durationSec: t.durationSec,
      tail: t.tail,
      ending: t.endingStored,
      headProfile: t.head.headProfile,
      firstSoundSec: t.head.firstSoundSec,
      firstSoundExact: t.head.firstSoundExact,
    };
    const entry = A.indexEntryOf(old);
    assert.strictEqual(entry!.en!.kind, classify(t).kind, t.label);
    assert.ok(entry!.h0 === null || entry!.h0! >= -99, t.label);
    assert.strictEqual(!!A.planFades(entry, {}).fadeOut, accepts(t, ['cut']), t.label);
  }

  assert.strictEqual(
    A.indexEntryOf({
      integratedLufs: -10,
      ending: { ...A.classifyEnding(null, null, null, null), kind: 'abrupt', fadeSec: 4, lastSoundSec: 100 },
    })!.en,
    null,
  );
});

test('real fixtures: every other track keeps its stored ending', () => {
  const same = fx.tracks.filter((t) => !['hiphop-1', 'jpop-1', 'live-2'].includes(t.label));
  assert.strictEqual(same.length, 37);

  for (const t of same) {
    const en = classify(t);
    assert.strictEqual(en.kind, t.endingStored.kind, t.label);
    assert.strictEqual(en.fadeSec, t.endingStored.fadeSec, t.label);
  }
});

test('real fixtures: the coverage condition keeps the only fade-in candidate (edm-3) and adds none', () => {
  const entry = (t: FixtureTrack) => {
    const h0 = t.head.headProfile[0];

    return {
      l: t.integratedLufs,
      c: t.coverage,
      fs: t.head.firstSoundSec,
      fx: t.head.firstSoundExact,
      h0: typeof h0 === 'number' ? Math.max(-99, h0) : null,
    };
  };

  const planned = fx.tracks.filter((t) => A.planFades(entry(t), {}).fadeIn).map((t) => t.label);
  assert.deepStrictEqual(planned, ['edm-3']);
  const levelOnly = fx.tracks.filter((t) => A.planFades({ ...entry(t), c: 1 }, {}).fadeIn).map((t) => t.label);
  assert.deepStrictEqual(levelOnly, ['edm-3']);
});

import test from 'node:test';
import assert from 'node:assert';
import * as A from '../shared/analysis.mts';
import { loadFixtures } from './helpers/fixtures.mts';

const fx = loadFixtures('ear-checked');

test('ear-checked fixtures carry no track identifiers', () => {
  assert.ok(!/"(videoId|title|artist)"/i.test(JSON.stringify(fx)));
});

test('ear-checked cuts are classified abrupt and get a fade-out', () => {
  for (const t of fx.tracks.filter((x) => x.reviewLabel === 'cut')) {
    const en = A.classifyEnding(t.tail, t.integratedLufs, t.lastSoundSec, t.durationSec);
    assert.strictEqual(en.kind, 'abrupt', t.label);
    assert.ok(A.planFades({ l: t.integratedLufs, en }, {}).fadeOut, t.label);
  }
});

import test from 'node:test';
import assert from 'node:assert';
import * as M from '../shared/seekbar-marks.mts';
import * as I from '../ui/i18n.mts';
import * as P from '../ui/common.mts';
import * as C from '../content/seekbar-marks.mts';

const fade = (adapt: any) => ({
  marks: { dur: 200 },
  overlap: {
    leadStartPos: 187,
    leadEndPos: 193.5,
    overlapStartPos: 193.5,
    overlapEndPos: 195,
    rate: 1.25,
    shape: 'segue',
    adapt,
  },
});
const ovItem = (adapt: any) => M.seekbarMarks(fade(adapt)).items.find((it) => it.kind === 'overlap');
const KEY = { why: 'key_clash', baseLeadSec: 3, baseShape: 'equal', cams: ['8A', '3B'], bpms: [120, 121] };

test('seek bar: the overlap band says why it is short (ja / en); no reason when it was not changed', () => {
  I.setLang('ja');
  assert.equal(C.itemText(ovItem(KEY)!), '2 曲の重なり 1.5秒（キーがぶつかるので短く重ねる（8A → 3B））');
  assert.equal(
    C.itemText(ovItem({ why: 'tempo_far', cams: ['8A', '8A'], bpms: [120, 95] })!),
    '2 曲の重なり 1.5秒（テンポが離れているので短く重ねる（120 → 95 BPM））',
  );
  assert.equal(
    C.itemText(ovItem({ why: 'both', cams: ['8A', '3B'], bpms: [120, 95] })!),
    '2 曲の重なり 1.5秒（キーがぶつかりテンポも離れているので短く重ねる（8A → 3B、120 → 95 BPM））',
  );
  assert.equal(C.itemText(ovItem(null)!), '2 曲の重なり 1.5秒');
  I.setLang('en');
  assert.equal(C.itemText(ovItem(KEY)!), 'Tracks overlap: 1.5s (keys clash, so a short overlap (8A → 3B))');
  assert.equal(C.itemText(ovItem(null)!), 'Tracks overlap: 1.5s');
});

test('seek bar model: only known reasons and well-formed keys / tempos pass', () => {
  assert.deepEqual(ovItem(KEY)!.info!.adapt, { why: 'key_clash', cams: ['8A', '3B'], bpms: [120, 121], baseSec: 3 });
  assert.equal(ovItem({ why: 'loud' })!.info!.adapt, null);
  assert.deepEqual(ovItem({ why: 'key_clash', cams: ['<b>', '3B'], bpms: ['x', 1] })!.info!.adapt, {
    why: 'key_clash',
    cams: null,
    bpms: null,
    baseSec: null,
  });
  I.setLang('ja');
  assert.equal(C.itemText(ovItem({ why: 'key_clash' })!), '2 曲の重なり 1.5秒（キーがぶつかるので短く重ねる）');
});

test('popup: the transition line carries the same reason next to the overlap', () => {
  const tr = {
    kind: 'trim',
    reason: 'decays',
    atSec: 195,
    skipSec: 5,
    overlapSec: 1.5,
    overlapAdapt: KEY,
    pair: { tempo: 'match', key: 'clash', reasons: ['default'] },
  };
  I.setLang('ja');
  assert.ok(
    P.transitionText(tr).includes('1.5 秒重ねる（キーがぶつかるので短く重ねる（8A → 3B））'),
    P.transitionText(tr),
  );
  I.setLang('en');
  assert.ok(
    P.transitionText(tr).includes('overlap the tracks for 1.5 s (keys clash, so a short overlap (8A → 3B))'),
    P.transitionText(tr),
  );
  assert.ok(!P.transitionText(Object.assign({}, tr, { overlapAdapt: null })).includes('short overlap'));
});

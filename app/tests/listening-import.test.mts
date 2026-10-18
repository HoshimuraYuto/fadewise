import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../shared/analysis.mts';
import * as S from '../shared/settings.mts';
import * as R from '../shared/reorder.mts';
import * as TK from '../shared/tempo-key.mts';
import * as I from '../ui/i18n.mts';
import type { TempoKey } from '../shared/types.mts';
import fixtures from './fixtures/real-tracks.json' with { type: 'json' };
import type { Fixtures, FixtureTrack } from './helpers/fixtures.mts';

type Json = Record<string, unknown>;

const FX = fixtures as unknown as Fixtures & { tracks: FixtureTrack[] };

test('presets: what each sets, recognising them, and keys outside them left alone', () => {
  assert.equal(S.presetOf(null), 'gentle', 'the defaults are the gentle preset');
  const auto = S.applyPreset({ autoContinue: true, analysisEnabled: false, uiLanguage: 'ja' }, 'auto');
  assert.equal(S.presetOf(auto), 'auto');
  assert.deepEqual(
    [auto.autoContinue, auto.analysisEnabled, auto.uiLanguage],
    [true, false, 'ja'],
    'not part of a preset',
  );
  assert.equal(S.presetOf(Object.assign({}, auto, { transitionWash: true })), 'custom');
  const off = S.applyPreset(auto, 'off');
  assert.equal(S.presetOf(off), 'off');
  assert.equal(
    S.presetOf(Object.assign({}, off, { beatAlign: false })),
    'off',
    'a sub-option of an off feature does not matter',
  );
  assert.equal(S.withDefaults(off).gainEnabled, false);
  assert.equal(S.applyPreset(auto, 'nope'), auto);
});

test('shortcut toggle-all: off and back to exactly what was set before; first time from off -> auto', () => {
  const custom = {
    gainEnabled: true,
    fadesEnabled: false,
    transitions: true,
    transitionWash: true,
    reorder: false,
    autoContinue: true,
  };
  const off = S.toggleAll(custom);
  assert.equal(S.presetOf(off), 'off');
  const back = S.toggleAll(off);
  for (const k of S.PRESET_KEYS) assert.equal(S.withDefaults(back)[k], S.withDefaults(custom)[k], k);
  assert.equal(back.autoContinue, true);
  assert.equal(back.offFrom, null);
  assert.equal(
    S.presetOf(S.toggleAll(S.applyPreset(null, 'off'))),
    'gentle',
    'off chosen from the defaults: back to the defaults',
  );
  assert.equal(
    S.presetOf(S.toggleAll({ gainEnabled: false, fadesEnabled: false })),
    'auto',
    'off with no record of before: auto',
  );
  const twice = S.applyPreset(off, 'off');
  assert.deepEqual(twice.offFrom, off.offFrom);
});

const goodTrack = (over?: Json): Json =>
  Object.assign(
    {
      videoId: 'abcdefghijk',
      title: 'T',
      artist: 'X',
      durationSec: 128.98,
      logicVersion: A.LOGIC_VERSION,
      cells: [
        [0, 10, -20, -3],
        [1, 10, -12, -2],
        [2, 10, -11, -1.5],
        [3, 9, -11.5, -1.6],
      ],
      firstSoundSec: 0,
      firstSoundExact: true,
      lastSoundSec: 128.93,
      tail: { endPos: 128.95, lufs: FX.tracks.find((t) => t.label === 'rock-4')!.tail.lufs.slice() },
      ytPerceptualLoudnessDb: -2.1,
      analysisCount: 3,
      updatedAt: 1760000000000,
      integratedLufs: 99,
      ending: { kind: 'fades' },
      applied: [{ at: 1, gain: { db: 6 } }],
      coverage: 1,
    },
    over || {},
  );

test('import: a track is rebuilt from its numbers (summaries recomputed, strings and applied not taken)', () => {
  const r = A.sanitizeImportTrack(goodTrack());
  assert.equal(r!.videoId, 'abcdefghijk');
  assert.equal(r!.title, null);
  assert.equal(r!.artist, null);
  assert.ok(Math.abs(r!.integratedLufs! - -11.7) < 1, `recomputed ${r!.integratedLufs}`);
  assert.notEqual(r!.ending!.kind, 'fades', 'the ending is classified again from the tail');
  assert.equal(r!.applied, undefined);
  assert.equal(r!.analysisCount, 3);
  assert.equal(r!.cells.length, 4);
});

test('import: invalid values are dropped, invalid tracks rejected', () => {
  assert.equal(A.sanitizeImportTrack(goodTrack({ videoId: '<script>' })), null);
  assert.equal(A.sanitizeImportTrack(goodTrack({ logicVersion: 99 })), null);
  assert.equal(A.sanitizeImportTrack(goodTrack({ cells: [], tail: null })), null);
  assert.equal(A.sanitizeImportTrack('x'), null);
  const r = A.sanitizeImportTrack(
    goodTrack({
      cells: [
        [0, 10, -20, -3],
        [0, 10, -5, -1],
        [1.5, 10, -10, -1],
        [2, 0, -10, -1],
        [3, 99, -10, -1],
        [4, 5, 'x', -1],
        [5, 5, 1e9, -1],
        [6, 5, -500, null],
      ],
      durationSec: -3,
      firstSoundSec: 1e9,
      lastSoundSec: 'x',
      ytPerceptualLoudnessDb: 1e9,
      analysisCount: 1.5,
      tail: { endPos: 128.95, lufs: [1, 2, 'x'] },
    }),
  );
  assert.deepEqual(
    r!.cells,
    [
      [0, 10, -20, -3],
      [6, 5, -99, null],
    ],
    'duplicate index, fraction, zero / over-cap counts, non-numbers, out of range',
  );
  assert.equal(r!.durationSec, null);
  assert.equal(r!.firstSoundSec, null);
  assert.equal(r!.lastSoundSec, null);
  assert.equal(r!.ytPerceptualLoudnessDb, null);
  assert.equal(r!.analysisCount, 0);
  assert.equal(r!.tail, null);
});

test('import: tempo / key rebuilt from votes and chroma; a hand-written confidence is not trusted', () => {
  const votes = [
    [128, 30, 0.1, 0.2, 0.46875, 5, 30],
    [128.2, 30, 0.12, null, null, null, 60],
    [500, 30, 0, 0, 0, 0, 0],
    ['x', 1, 1],
  ];
  const chroma = [10, 0, 5, 0, 8, 6, 0, 9, 0, 4, 0, 3];
  const tk = TK.sanitizeImportTempoKey({
    logicVersion: TK.TEMPO_LOGIC_VERSION,
    votes,
    chromaSum: chroma,
    chromaFrames: 40,
    tempo: { bpm: 60, confidence: 1 },
    key: { v: 2, name: 'C', camelot: '8B', confidence: 1, familyConfidence: 1, related: [] },
    seg: {
      v: TK.SEG_LOGIC_VERSION,
      head: { at: 0, approx: false, votes: [[128, 30, 4]], cs: chroma, cf: 40 },
      tail: { at: -1 },
    },
  });
  assert.equal(tk!.votes.length, 2, 'bad votes dropped');
  assert.ok(Math.abs(tk!.tempo!.bpm - 128.1) < 0.2);
  assert.ok(tk!.tempo!.confidence < 1, `recomputed ${tk!.tempo!.confidence}`);
  assert.ok(tk!.key!.confidence < 0.2, `40 frames cannot be sure (${tk!.key!.confidence})`);
  assert.equal(tk!.seg!.tail, null);
  assert.ok(tk!.seg!.head!.key && tk!.seg!.head!.tempo);
  assert.equal(TK.sanitizeImportTempoKey({ logicVersion: 99, votes }), null);
  assert.equal(
    TK.sanitizeImportTempoKey({ logicVersion: TK.TEMPO_LOGIC_VERSION, votes: [], chromaSum: [1], chromaFrames: 1 }),
    null,
  );
});

const mineTk = { mine: true } as unknown as TempoKey;
const theirTk = { theirs: true } as unknown as TempoKey;

test('import: what is stored wins; only gaps are filled; importing twice changes nothing', () => {
  const imp = A.sanitizeImportTrack(goodTrack());
  const fresh = A.mergeImportedRecord(null, imp, null, 5);
  assert.equal(fresh.changed, true);
  assert.deepEqual(fresh.rec!.applied, []);
  const cur = Object.assign(A.emptyRecord('abcdefghijk'), {
    title: 'Mine',
    durationSec: 128.98,
    cells: [[1, 50, -9, -1]],
    firstSoundSec: 0.5,
    firstSoundExact: true,
    tempoKey: mineTk,
    analysisCount: 7,
    applied: [{ at: 3 }],
  });
  Object.assign(cur, A.deriveSummary(cur));
  const m = A.mergeImportedRecord(cur, imp, theirTk, 9);
  assert.equal(m.changed, true);
  assert.deepEqual(
    m.rec!.cells.map((c) => c[0]),
    [0, 1, 2, 3],
    'cells of seconds never heard here are added',
  );
  assert.deepEqual(m.rec!.cells[1], [1, 50, -9, -1], 'a second heard here keeps its value');
  assert.equal(m.rec!.firstSoundSec, 0.5);
  assert.equal(m.rec!.title, 'Mine');
  assert.deepEqual(m.rec!.tempoKey, { mine: true });
  assert.equal(m.rec!.analysisCount, 7);
  assert.deepEqual(m.rec!.applied, [{ at: 3 }]);
  assert.ok(m.rec!.tail && m.rec!.ending, 'the missing ending is filled in');
  const again = A.mergeImportedRecord(m.rec, imp, theirTk, 10);
  assert.equal(again.changed, false);
  assert.equal(again.rec, m.rec);
  const other = A.mergeImportedRecord(Object.assign({}, cur, { durationSec: 140 }), imp, null, 11);
  assert.equal(other.rec!.tail, null);
});

const copy = (x: unknown): Json => JSON.parse(JSON.stringify(x)) as Json;

function area() {
  const data: Json = {};

  const pick = (keys: string | string[] | null) => {
    if (keys == null) return Object.assign({}, data);
    const out: Json = {};
    for (const k of ([] as string[]).concat(keys)) if (k in data) out[k] = data[k];

    return out;
  };

  return {
    data,
    get: (k: string) => Promise.resolve(copy(pick(k))),
    set: (o: Json) => {
      Object.assign(data, copy(o));

      return Promise.resolve();
    },
    remove: (keys: string | string[]) => {
      for (const k of ([] as string[]).concat(keys)) Reflect.deleteProperty(data, k);

      return Promise.resolve();
    },
    setAccessLevel: async () => {},
  };
}

type StorageArea = ReturnType<typeof area>;

const localData = () => (chrome.storage.local as unknown as StorageArea).data;
const sessionData = () => (chrome.storage.session as unknown as StorageArea).data;
const excludedIds = () => localData().excluded as Record<string, number>;
const storedSettings = () => localData().settings as Json;

const L: { message: ((...a: unknown[]) => unknown)[]; command: ((c: string) => unknown)[] } = {
  message: [],
  command: [],
};
let SW: typeof import('../background/service-worker.mts') | undefined;

async function loadSW() {
  if (SW) return SW;
  Object.assign(globalThis, {
    chrome: {
      storage: { local: area(), session: area(), onChanged: { addListener: () => {} } },
      runtime: {
        id: 'test',
        getURL: (p: string) => 'chrome-extension://test/' + p,
        onInstalled: { addListener: () => {} },
        onStartup: { addListener: () => {} },
        onMessage: { addListener: (f: (...a: unknown[]) => unknown) => L.message.push(f) },
      },
      commands: { onCommand: { addListener: (f: (c: string) => unknown) => L.command.push(f) } },
      tabs: { create: () => Promise.resolve({}) },
    },
    self: globalThis,
  });
  SW = await import('../background/service-worker.mts');

  return SW;
}

const ok = { decision: 'granted', version: S.CONSENT_VERSION, at: 1 };

const reset = (local?: Json) => {
  const d = localData();
  for (const k of Object.keys(d)) Reflect.deleteProperty(d, k);
  Object.assign(d, local || {});
};

test('service worker import: needs consent and the switch; counts added / merged / unchanged / rejected; merges the excluded list', async () => {
  await loadSW();
  reset();
  assert.equal((await SW!.importData({ tracks: [goodTrack()] })).reason, 'not_allowed');
  assert.deepEqual(Object.keys(localData()), []);
  reset({ consent: ok, settings: { analysisEnabled: false } });
  assert.equal((await SW!.importData({ tracks: [goodTrack()] })).reason, 'not_allowed');
  reset({ consent: ok, excluded: { zzzzzzzzzzz: 1 } });
  assert.equal((await SW!.importData({ nope: 1 })).reason, 'format');
  const data = {
    tracks: [goodTrack(), goodTrack({ videoId: 'bcdefghijkl' }), goodTrack({ videoId: 'bad id' }), goodTrack()],
    excluded: { bcdefghijkl: 5, 'bad id': 3 },
  };
  const r1 = await SW!.importData(data);
  assert.deepEqual([r1.ok, r1.added, r1.merged, r1.unchanged, r1.rejected, r1.excluded], [true, 2, 0, 0, 2, 1]);
  assert.deepEqual(Object.keys(excludedIds()).sort(), ['bcdefghijkl', 'zzzzzzzzzzz']);
  const rec = localData()['track:abcdefghijk'] as { title: unknown };
  assert.equal(rec.title, null);
  const r2 = await SW!.importData(data);
  assert.deepEqual(
    [r2.added, r2.merged, r2.unchanged, r2.excluded],
    [0, 0, 2, 0],
    'the same file again changes nothing',
  );
  const reply: unknown[] = [];
  for (const f of L.message)
    f({ type: 'import', data }, { id: 'test', url: 'https://music.youtube.com/', tab: {} }, (x: unknown) =>
      reply.push(x),
    );
  await new Promise((res) => setTimeout(res, 10));
  assert.deepEqual(reply, [], 'not from a page');
});

test('service worker shortcuts: toggle-all switches the settings; toggle-track switches the playing track', async () => {
  await loadSW();
  reset({ consent: ok, settings: { transitions: true } });
  await SW!.onCommand('toggle-all');
  assert.equal(S.presetOf(storedSettings()), 'off');
  await SW!.onCommand('toggle-all');
  assert.equal(storedSettings().transitions, true);
  sessionData().status = { at: Date.now(), videoId: 'abcdefghijk', ad: false };
  await SW!.onCommand('toggle-track');
  assert.ok('abcdefghijk' in excludedIds());
  await SW!.onCommand('toggle-track');
  assert.deepEqual(excludedIds(), {});
  sessionData().status = { at: Date.now(), videoId: 'abcdefghijk', ad: true };
  await SW!.onCommand('toggle-track');
  assert.deepEqual(excludedIds(), {}, 'not during an ad');
  sessionData().status = { at: Date.now() - 60000, videoId: 'abcdefghijk', ad: false };
  await SW!.onCommand('toggle-track');
  assert.deepEqual(excludedIds(), {}, 'not from a stale status');
  assert.equal(L.command.length, 1, 'one listener registered');
});

test('export -> import round trip on the real-track fixtures keeps every planned fade and transition', () => {
  for (const [i, t] of FX.tracks.entries()) {
    const stored = Object.assign(A.emptyRecord(`fixture${String(i).padStart(4, '0')}`), {
      durationSec: t.durationSec,
      cells: [[0, 10, t.integratedLufs, -1]],
      tail: t.tail,
      lastSoundSec: t.lastSoundSec,
      firstSoundSec: t.head.firstSoundSec,
      firstSoundExact: t.head.firstSoundExact,
    });
    Object.assign(stored, A.deriveSummary(stored));
    stored.ending = A.classifyEnding(stored.tail, stored.integratedLufs, stored.lastSoundSec, stored.durationSec);
    const exported = copy(Object.assign({}, stored, { cells: A.floorCells(stored.cells) }));
    const back = A.sanitizeImportTrack(exported);
    assert.ok(back, t.label);
    const e1 = A.indexEntryOf(stored),
      e2 = A.indexEntryOf(back);
    assert.deepEqual(e2!.en, e1!.en, t.label);
    const p1 = A.planTransition(e1, { enabled: true, fadeOut: A.planFades(e1, {}).fadeOut });
    const p2 = A.planTransition(e2, { enabled: true, fadeOut: A.planFades(e2, {}).fadeOut });
    assert.deepEqual(p2, p1, t.label);
  }
});

test('listening codes are known to the record sanitiser and the dictionaries', () => {
  const s = A.sanitizeApplied({
    at: 1,
    transition: { kind: 'none', reason: 'gapless', state: 'skipped' },
    incoming: { headReason: 'excluded' },
  });
  assert.equal(s!.transition!.reason, 'gapless');
  assert.equal(s!.incoming!.headReason, 'excluded');
  for (const lang of ['ja', 'en'] as const)
    for (const k of ['trReason.gapless', 'trReason.excluded', 'source.excluded'])
      assert.ok(I.DICT[lang][k], `${lang} ${k}`);
  assert.equal(R.CODES.reason.includes('user_moved'), true);
});

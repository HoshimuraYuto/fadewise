import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import * as I from '../ui/i18n.mts';

const APP = path.join(import.meta.dirname, '..');
const read = (f: string) => fs.readFileSync(path.join(APP, f), 'utf8');
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const COMMON = fs.readdirSync(path.join(APP, 'ui', 'common')).map((f) => `ui/common/${f}`);

test('ja and en have exactly the same keys, non-empty, with the same placeholders', () => {
  const ja = Object.keys(I.DICT.ja).sort();
  const en = Object.keys(I.DICT.en).sort();
  assert.deepStrictEqual(
    ja.filter((k) => !en.includes(k)),
    [],
    'missing in en',
  );
  assert.deepStrictEqual(
    en.filter((k) => !ja.includes(k)),
    [],
    'missing in ja',
  );

  for (const k of ja) {
    assert.ok(I.DICT.ja[k] && I.DICT.en[k], k);
    assert.deepStrictEqual(placeholders(I.DICT.ja[k]), placeholders(I.DICT.en[k]), k);
  }
});

test('every key referenced by the pages and scripts exists', () => {
  const used = new Set<string>();

  for (const f of [
    'entrypoints/popup.html',
    'entrypoints/library.html',
    'entrypoints/welcome.html',
    'entrypoints/licenses.html',
  ]) {
    for (const m of read(f).matchAll(/data-(?:i18n|title-key|placeholder-key)="([^"]+)"/g)) used.add(m[1]);
  }

  for (const f of ['ui/popup.mts', 'ui/library.mts', 'ui/welcome.mts', 'ui/licenses.mts', ...COMMON]) {
    for (const m of read(f).matchAll(/\bt\('([\w.]+)'/g)) used.add(m[1]);
    for (const m of read(f).matchAll(/\badd\('([\w.]+)'/g)) used.add(m[1]);
  }

  assert.ok(used.size > 60, `found ${used.size} keys`);
  for (const k of used) assert.ok(k in I.DICT.ja, k);
});

test('codes shown through label() have entries (states, sources, endings, actions, align reasons)', () => {
  const codes = {
    state: ['analyzing', 'guard', 'head', 'ad', 'paused', 'muted', 'no_track', 'idle'],
    source: ['analysis', 'youtube', 'none', 'off', 'ad', 'error'],
    ending: ['abrupt', 'stop', 'fades', 'decays', 'unknown'],
    action: ['fade_in', 'fade_out_scheduled', 'fade_out_done', 'skip_silence'],
    reason: [
      'off',
      'no_tempo',
      'low_confidence',
      'octave',
      'no_phase',
      'out_of_range',
      'no_grid',
      'tempo_change',
      'unstable',
      'no_beat_in_range',
      'no_fade',
      'error',
    ],
  };
  for (const [p, list] of Object.entries(codes)) for (const c of list) assert.ok(`${p}.${c}` in I.DICT.en, `${p}.${c}`);
  const src = fs
    .readdirSync(path.join(APP, 'shared', 'analysis'))
    .map((f) => read(`shared/analysis/${f}`))
    .join('\n');
  // shown elsewhere, never as a reason
  for (const m of src.matchAll(/reason: '(\w+)'/g))
    if (!['no_analysis', 'aligned'].includes(m[1])) assert.ok(`reason.${m[1]}` in I.DICT.en, m[1]);
});

test('no Japanese text left in the page markup or scripts outside the dictionary', () => {
  const jp = /[\u3040-\u30ff\u4e00-\u9fff]/;

  for (const f of [
    'entrypoints/popup.html',
    'entrypoints/library.html',
    'entrypoints/welcome.html',
    'entrypoints/licenses.html',
    'ui/popup.mts',
    'ui/library.mts',
    'ui/welcome.mts',
    'ui/licenses.mts',
    'ui/common.mts',
    ...COMMON,
  ]) {
    const lines = read(f)
      .split('\n')
      .filter((l) => jp.test(l) && !/lang\.ja|日本語/.test(l));
    assert.deepStrictEqual(lines, [], f);
  }
});

test('language: setting wins, otherwise ja browser -> ja, anything else -> en; t() fills placeholders', () => {
  assert.strictEqual(I.resolveLang('auto', 'ja'), 'ja');
  assert.strictEqual(I.resolveLang('auto', 'ja-JP'), 'ja');
  assert.strictEqual(I.resolveLang(undefined, 'en-US'), 'en');
  assert.strictEqual(I.resolveLang('auto', 'fr'), 'en');
  assert.strictEqual(I.resolveLang('en', 'ja'), 'en');
  assert.strictEqual(I.resolveLang('ja', 'de'), 'ja');
  I.setLang('en');
  assert.strictEqual(I.t('library.cleared', { n: 3 }), 'Deleted 3 tracks.');
  I.setLang('ja');
  assert.strictEqual(I.t('library.cleared', { n: 3 }), '3 曲分を削除しました。');
  assert.strictEqual(I.t('no.such.key'), 'no.such.key');
});

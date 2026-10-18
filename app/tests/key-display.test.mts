import test from 'node:test';
import assert from 'node:assert';
import * as TK from '../shared/tempo-key.mts';
import * as I from '../ui/i18n.mts';
import * as C from '../ui/common.mts';

const CH = [249.797, 512.089, 240.89, 286.978, 390.411, 286.377, 532.254, 286.494, 381.618, 391.46, 244.626, 336.003];

test('keyText: v1 record shows the recomputed confidence, provisional, and the related candidates', () => {
  const rec = {
    logicVersion: TK.TEMPO_LOGIC_VERSION,
    chromaSum: CH,
    chromaFrames: 766,
    key: { tonic: 6, mode: 'minor', name: 'F#m', camelot: '11A', confidence: 0.93, runnerUp: 'C#m' },
  };
  const k = TK.summarizeKey(CH, 766)!;
  const pct = Math.round(k.confidence * 100);
  I.setLang('en');
  const cands = k.related.map((r) => `${r.name} (${r.camelot})`).join(', ');
  assert.strictEqual(C.keyText(rec), `F#m (11A) confidence ${pct}%, provisional; also ${cands}`);
  I.setLang('ja');
  const jc = k.related.map((r) => `${r.name}（${r.camelot}）`).join('、');
  assert.strictEqual(C.keyText(rec), `F#m（11A） 信頼度 ${pct}%・暫定／近い候補 ${jc}`);
  I.setLang('en');
});

test('keyText: no candidates for a clear key, "not analysed" without chroma', () => {
  I.setLang('en');
  const ideal = TK.TEMPERLEY.major.map((_, i, a) => a[(i - 7 + 12) % 12]).map((x) => x * 100);
  const tk = TK.mergeTempoKey(null, { votes: [], chromaSum: ideal, chromaFrames: 600 }, 1);
  const k = tk.key!;
  const tail = k.related.length ? '; also ' + k.related.map((r) => `${r.name} (${r.camelot})`).join(', ') : '';
  assert.strictEqual(C.keyText(tk), `G (9B) confidence 100%${tail}`);
  assert.strictEqual(C.keyText(null), 'Not analyzed');
  assert.strictEqual(C.keyText({ key: { name: 'C', camelot: '8B', confidence: 1 } }), 'Not analyzed');
});

import type * as S from '../shared/settings.mts';
import { currentKey } from '../shared/tempo-key.mts';
import { appliedText, endingText, keyText, tempoOf, tempoText } from './common.mts';
import { EMPTY, clock, shortDate, signed } from './common/format.mts';
import type { Cell, Pairs, Row } from './dom-sync.mts';
import { t } from './i18n.mts';
import type { LibraryRecord } from './library-table.mts';
import { mixCellText, mixCellTitle, mixSummary } from './mix-text.mts';

const RELIABLE_CONF = 0.5;
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

const numCell = (text: string, weak = false): Cell => [
  text,
  ['num', text === EMPTY ? 'empty' : '', weak && text !== EMPTY ? 'weak' : ''].filter(Boolean).join(' '),
];
const textCell = (text: string, weak = false): Cell => [text, text === EMPTY ? 'empty' : weak ? 'weak' : undefined];

function bpmCell(r: LibraryRecord): Cell {
  const tp = tempoOf(r.tempoKey);
  const bpm = tp?.bpm;
  if (!isNum(bpm)) return numCell(EMPTY);

  return numCell(bpm.toFixed(1), (tp?.confidence ?? 0) < RELIABLE_CONF);
}

function keyCell(r: LibraryRecord): Cell {
  const k = currentKey(r.tempoKey);
  if (!k?.name) return textCell(EMPTY);

  return textCell(t('key.short', { name: k.name, camelot: k.camelot }), k.confidence < RELIABLE_CONF);
}

function endingCell(r: LibraryRecord): Cell {
  const kind = r.ending?.kind;

  return textCell(kind ? t('endingShort.' + kind) : EMPTY);
}

function mixCell(r: LibraryRecord): Cell {
  const s = mixSummary(r);
  if (!s.rank) return textCell(EMPTY);

  return textCell(t(s.rank === 2 ? 'mix.short.aggr' : 'mix.state.gentle'));
}

function trackCell(r: LibraryRecord, open: boolean): Cell {
  return [r.title || r.videoId, open ? 'track open' : 'track', r.title ? r.artist || '' : ''];
}

export function rowOf(r: LibraryRecord, excluded: S.Excluded, open: boolean): Row {
  const off = r.videoId in excluded;

  return {
    key: r.videoId,
    cells: [
      [off ? t('library.excludedOn') : '', off ? 'toggle on' : 'toggle'],
      trackCell(r, open),
      numCell(isNum(r.integratedLufs) ? r.integratedLufs.toFixed(1) : EMPTY),
      numCell(clock(r.durationSec)),
      bpmCell(r),
      keyCell(r),
      endingCell(r),
      mixCell(r),
      numCell(shortDate(r.updatedAt)),
    ],
  };
}

const firstSoundText = (r: LibraryRecord): string =>
  isNum(r.firstSoundSec) ? clock(r.firstSoundSec, true) + (r.firstSoundExact ? '' : t('library.firstEarlier')) : EMPTY;

export function detailOf(r: LibraryRecord): Row {
  const mix = mixSummary(r);
  const pairs: Pairs = [
    [t('col.applied'), appliedText(r.applied)],
    [t('col.pld'), isNum(r.ytPerceptualLoudnessDb) ? `${signed(r.ytPerceptualLoudnessDb)} dB` : EMPTY],
    [t('col.first'), firstSoundText(r)],
    [t('col.last'), clock(r.lastSoundSec, true)],
    [t('col.ending'), endingText(r.ending)],
    [t('col.bpm'), tempoText(r.tempoKey)],
    [t('col.key'), keyText(r.tempoKey)],
    [t('col.mix'), [mixCellText(mix), ...mixCellTitle(mix).split('\n')]],
    [t('col.coverage'), isNum(r.coverage) ? `${String(Math.round(r.coverage * 100))}%` : EMPTY],
    [t('col.count'), String(r.analysisCount ?? EMPTY)],
    [t('col.videoId'), r.videoId],
  ];

  return { key: `${r.videoId}:detail`, cells: [], detail: pairs };
}

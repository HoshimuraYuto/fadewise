import { t } from '../../ui/i18n.mts';
import type { MarkItem, MixInfo } from '../../shared/seekbar-marks.mts';
import { nextLines, fromLine, overlapAdaptText, overlapBasisText, overlapStyleText } from '../../ui/mix-text.mts';

const pad2 = (n: number) => String(n).padStart(2, '0');

export function clockPos(sec: number | null): string {
  const s = Math.max(0, Number(sec));
  const m = Math.floor(s / 60);

  return `${String(m)}:${pad2(Math.floor(s % 60))}.${String(Math.floor((s * 10) % 10))}`;
}

const secText = (x: number | null) => (Math.round(Number(x) * 10) / 10).toFixed(1);
const mixOf = (it: MarkItem): MixInfo | null => it.info?.mix ?? null;
const cancelled = (it: MarkItem) => (it.state === 'cancelled' ? t('sb.cancelled') : '');
// aggressive points are experimental, so their confidence is shown
const conf = (m: MixInfo | null) =>
  m?.aggr ? t('sb.mixAggr', { c: m.c !== null && Number.isFinite(m.c) ? m.c.toFixed(2) : '-' }) : '';

function fadeOutText(it: MarkItem): string {
  const s = t('sb.fadeOut', { sec: secText(it.sec) });
  if (!it.info?.aligned) return s;

  return s + t(it.info.mode === 'bar' ? 'sb.alignedBar' : 'sb.alignedBeat');
}

function headSkipText(it: MarkItem): string {
  const m = mixOf(it);
  if (!m) return t('sb.headSkip', { sec: secText(it.sec) });

  return t(m.k === 'lift' ? 'sb.mixLiftSkip' : 'sb.mixThinSkip', { sec: secText(it.sec) }) + conf(m) + cancelled(it);
}

function entryText(it: MarkItem): string {
  const m = mixOf(it);
  const why = t(m && m.k === 'lift' ? 'sb.why.lift' : 'sb.why.thin');

  return t('sb.mixEntry', { pos: clockPos(it.at), why }) + conf(m) + cancelled(it);
}

function tailSkipText(it: MarkItem): string {
  const m = mixOf(it);
  const done = it.state === 'done';
  if (!m) return t(it.state === 'done' ? 'sb.tailSkipped' : 'sb.tailSkip', { sec: secText(it.sec) }) + cancelled(it);
  const lastSound = it.info && Number.isFinite(it.info.lastSoundSec) ? it.info.lastSoundSec : it.end;
  const sec = secText(Math.max(0, Number(lastSound) - Number(it.start)));
  const chorus = m.k === 'chorusEnd';
  const key = chorus ? (done ? 'sb.mixAfterChorusCut' : 'sb.mixAfterChorus') : done ? 'sb.mixOutroCut' : 'sb.mixOutro';

  return t(key, { sec }) + conf(m) + cancelled(it);
}

function nextText(it: MarkItem): string {
  const m = mixOf(it);
  let s = t(it.state === 'done' ? 'sb.nextDone' : 'sb.next', { pos: clockPos(it.at) });
  if (m) s += t('sb.mixExitWhy', { why: t(m.k === 'chorusEnd' ? 'sb.why.chorusEnd' : 'sb.why.fade') });
  if (it.info?.extraWaitSec) s += t('sb.extraWait', { sec: secText(it.info.extraWaitSec) });

  return s + cancelled(it);
}

function overlapText(it: MarkItem): string {
  const style = it.info ? overlapStyleText(it.info.style) : null;
  const why = style ?? (it.info ? overlapAdaptText(it.info.adapt) : null);
  const basis = style ? null : it.info ? overlapBasisText(it.info.basis) : null;
  const basisText = basis ? t('sb.mixExitWhy', { why: basis }) : '';
  const whyText = why ? t('sb.mixExitWhy', { why }) : '';

  return t('sb.overlap', { sec: secText(it.sec) }) + basisText + whyText + cancelled(it);
}

const TEXT: Partial<Record<string, (it: MarkItem) => string>> = {
  fadeOut: (it) => fadeOutText(it) + cancelled(it),
  fadeIn: (it) => t('sb.fadeIn', { sec: secText(it.sec) }) + cancelled(it),
  headSkip: headSkipText,
  entry: entryText,
  tailSkip: tailSkipText,
  next: nextText,
  firstSound: (it) => t('sb.firstSound', { pos: clockPos(it.at) }),
  lastSound: (it) => t('sb.lastSound', { pos: clockPos(it.at) }),
  lead: (it) => t('sb.lead', { sec: secText(it.sec) }) + cancelled(it),
  swap: (it) => t('sb.swap', { pos: clockPos(it.at) }) + cancelled(it),
  overlap: overlapText,
};

export function itemText(it: MarkItem): string | null {
  const text = Object.hasOwn(TEXT, it.kind) ? TEXT[it.kind] : undefined;

  return text ? text(it) : null;
}

export function itemLines(it: MarkItem, titleOf?: ((step: number) => string | null) | null): string[] {
  const s = itemText(it);
  if (!s) return [];
  const out = [s];
  const title = (step: number) => (typeof titleOf === 'function' ? titleOf(step) : null);
  if (it.kind === 'next' && it.info?.next) out.push(...nextLines(it.info.next, title(1)));

  if (it.kind === 'entry') {
    const from = mixOf(it)?.from;
    const line = from ? fromLine(from, from.match ? title(-1) : null) : null;
    if (line) out.push(line);
  }

  return out;
}

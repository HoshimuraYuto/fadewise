const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const r2 = (x: number) => Math.round(x * 100) / 100;
type Loose = Record<string, unknown>;
const obj = (x: unknown): Loose | null => (x && typeof x === 'object' ? (x as Loose) : null);

export const KINDS = Object.freeze([
  'headSkip',
  'fadeIn',
  'lead',
  'overlap',
  'fadeOut',
  'tailSkip',
  'firstSound',
  'lastSound',
  'entry',
  'swap',
  'next',
] as const);
export type MarkKind = (typeof KINDS)[number];
export const BAND: ReadonlySet<string> = new Set(['headSkip', 'fadeIn', 'lead', 'overlap', 'fadeOut', 'tailSkip']);
const AGGR = new Set(['lift', 'chorusEnd']);

export type MarkState = 'planned' | 'done' | 'cancelled';
export interface MixInfo {
  k: string;
  c: number | null;
  aggr: boolean;
  from?: { k: string; t: number | null; match: boolean } | null;
}
export interface AdaptInfo {
  why: string;
  cams: string[] | null;
  bpms: number[] | null;
  baseSec: number | null;
}
export interface BasisInfo {
  out: string;
  outSec: number | null;
  in: string | null;
  inSec: number | null;
  long: string | null;
}
export interface StyleInfo {
  kind: string;
  why: string;
  aligned: string | null;
  bpms: number[] | null;
  beat?: string | null;
}
export interface MarkInfo {
  mix?: MixInfo | null;
  via?: 'transition' | 'cut_in';
  rate?: number | null;
  shape?: 'segue' | 'equal';
  adapt?: AdaptInfo | null;
  basis?: BasisInfo | null;
  style?: StyleInfo | null;
  aligned?: boolean;
  mode?: 'bar' | 'beat';
  beats?: number | null;
  kind?: unknown;
  reason?: unknown;
  extraWaitSec?: number | null;
  cancel?: unknown;
  next?: Loose | null;
  lastSoundSec?: number | null;
  exact?: boolean;
}
export interface MarkItem {
  id: MarkKind;
  kind: MarkKind;
  shape: 'band' | 'point';
  start: number | null;
  end: number | null;
  at: number | null;
  sec: number | null;
  state: MarkState;
  param: string | null;
  info: MarkInfo | null;
}
export interface MarksModel {
  dur: number | null;
  items: MarkItem[];
}
type Extra = Partial<Pick<MarkItem, 'state' | 'param' | 'info'>>;

function mixInfo(x: unknown): MixInfo | null {
  const m = obj(x);

  return m && typeof m.k === 'string' ? { k: m.k, c: isNum(m.c) ? m.c : null, aggr: AGGR.has(m.k) } : null;
}

// match: the queue's previous row is the track this one was entered from
function fromInfo(x: unknown): MixInfo['from'] {
  const f = obj(x);

  return f && typeof f.k === 'string' ? { k: f.k, t: isNum(f.t) ? f.t : null, match: f.match === true } : null;
}

const CAM = /^(1[0-2]|[1-9])[AB]$/;

function adaptInfo(x: unknown): AdaptInfo | null {
  const a = obj(x);
  if (!a || typeof a.why !== 'string' || !['key_clash', 'tempo_far', 'both'].includes(a.why)) return null;
  const cams: unknown = a.cams,
    bpms: unknown = a.bpms;

  return {
    why: a.why,
    cams:
      Array.isArray(cams) && cams.length === 2 && cams.every((c) => typeof c === 'string' && CAM.test(c))
        ? (cams.slice() as string[])
        : null,
    bpms: Array.isArray(bpms) && bpms.length === 2 && bpms.every(isNum) ? bpms.map((b) => Math.round(b)) : null,
    baseSec: isNum(a.baseLeadSec) ? a.baseLeadSec : null,
  };
}

function styleInfo(x: unknown): StyleInfo | null {
  const s = obj(x);
  if (!s || typeof s.kind !== 'string' || !['tail', 'blend', 'segue'].includes(s.kind)) return null;
  const why = typeof s.why === 'string' && /^[a-z_]{1,16}$/.test(s.why) ? s.why : '';
  const bpms: unknown = s.bpms;

  return {
    kind: s.kind,
    why,
    aligned: typeof s.aligned === 'string' && ['both', 'old', 'new'].includes(s.aligned) ? s.aligned : null,
    bpms: Array.isArray(bpms) && bpms.length === 2 && bpms.every(isNum) ? bpms.map((b) => Math.round(b)) : null,
    beat: beatCode(s.beat),
  };
}

function beatCode(x: unknown): string | null {
  const w: unknown = typeof x === 'string' ? x : obj(x)?.why;

  return typeof w === 'string' && /^[a-z_]{1,24}$/.test(w) ? w : null;
}

const OUTS = new Set(['fades', 'decays', 'abrupt', 'stop', 'mid', 'other']);
const INS = new Set(['loud_entry', 'cut_in', 'intro', 'soft', 'plain', 'short']);

function basisInfo(x: unknown): BasisInfo | null {
  const b = obj(x);
  if (!b || typeof b.out !== 'string' || !OUTS.has(b.out)) return null;

  return {
    out: b.out,
    outSec: isNum(b.outSec) ? r2(b.outSec) : null,
    in: typeof b.in === 'string' && INS.has(b.in) ? b.in : null,
    inSec: isNum(b.inSec) ? r2(b.inSec) : null,
    long: typeof b.long === 'string' && ['intro', 'soft', 'key_tempo'].includes(b.long) ? b.long : null,
  };
}

const MIN_BAND_SEC = 0.05;

class MarkList {
  readonly items: MarkItem[] = [];
  readonly dur: number;

  constructor(dur: number) {
    this.dur = dur;
  }

  band(kind: MarkKind, start: unknown, end: unknown, extra?: Extra) {
    if (!isNum(start) || !isNum(end)) return;
    const s = this.clamp(start);
    const e = this.clamp(end);
    if (e - s < MIN_BAND_SEC) return;
    const base: MarkItem = {
      id: kind,
      kind,
      shape: 'band',
      start: r2(s),
      end: r2(e),
      at: null,
      sec: r2(e - s),
      state: 'planned',
      param: null,
      info: null,
    };
    this.items.push(Object.assign(base, extra));
  }

  point(kind: MarkKind, at: unknown, extra?: Extra) {
    if (!isNum(at) || at < 0 || at > this.dur) return;
    const base: MarkItem = {
      id: kind,
      kind,
      shape: 'point',
      start: null,
      end: null,
      at: r2(at),
      sec: null,
      state: 'planned',
      param: null,
      info: null,
    };
    this.items.push(Object.assign(base, extra));
  }

  private clamp(x: number) {
    return Math.min(this.dur, Math.max(0, x));
  }
}

// fade comes from the page, so nothing in it is trusted
export function seekbarMarks(fade: unknown, opts?: { duration?: unknown } | null): MarksModel {
  const o = opts || {};
  const f = obj(fade);
  if (!f) return { dur: null, items: [] };
  const m = obj(f.marks) || {};
  const dur = isNum(o.duration) && o.duration > 0 ? o.duration : isNum(m.dur) && m.dur > 0 ? m.dur : null;
  if (!dur) return { dur: null, items: [] };
  const list = new MarkList(dur);
  const tr = obj(f.transition);

  if (m.excluded !== true) {
    headMarks(list, m, f, tr);
    overlapMarks(list, obj(f.overlap));
    fadeOutMarks(list, m, f);
    nextMarks(list, tr);
  }

  if (isNum(m.fs) && m.fs > 0.05) list.point('firstSound', m.fs, { state: 'done', info: { exact: m.fx === true } });
  if (isNum(m.ls)) list.point('lastSound', m.ls, { state: 'done' });
  list.items.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));

  return { dur: r2(dur), items: list.items };
}

function headMarks(list: MarkList, m: Loose, f: Loose, tr: Loose | null) {
  const inc = tr && obj(tr.incoming);

  if (!inc) {
    if (m.fadesOn && f.fadeIn && isNum(m.fadeInSec)) {
      list.band('fadeIn', 0, m.fadeInSec, {
        state: m.fadeInDone ? 'done' : 'planned',
        param: 'fadeIn.durSec',
        info: { via: 'cut_in' },
      });
    }

    return;
  }

  const from = isNum(inc.headTrimTo) && inc.headTrimTo > 0 ? inc.headTrimTo : 0;
  const mi = mixInfo(inc.mix);
  if (mi) mi.from = fromInfo(obj(inc.mix)?.from);

  if (mi && from > 0) {
    const state = inc.cancel ? 'cancelled' : 'done';
    list.band('headSkip', 0, from, { state, param: 'mix.n.t', info: { mix: mi } });
    list.point('entry', from, { state, param: 'mix.n.t', info: { mix: mi } });
  } else if (from > 0) list.band('headSkip', 0, from, { state: 'done', param: 'headTrim.seekTo' });

  if (inc.fadeIn && isNum(inc.fadeInSec)) {
    list.band('fadeIn', from, from + inc.fadeInSec, {
      state: inc.cancel ? 'cancelled' : 'done',
      param: 'transition.fadeInSec',
      info: { via: 'transition' },
    });
  }
}

function overlapMarks(list: MarkList, ov: Loose | null) {
  if (!ov) return;
  const state = ov.state === 'done' || ov.state === 'cancelled' ? ov.state : 'planned';
  list.band('lead', ov.leadStartPos, isNum(ov.leadEndPos) ? ov.leadEndPos : ov.overlapStartPos, {
    state,
    param: 'overlap.leadSec',
    info: { rate: isNum(ov.rate) ? ov.rate : null },
  });
  list.band('overlap', ov.overlapStartPos, ov.overlapEndPos, {
    state,
    param: 'overlap.overlapSec',
    info: {
      shape: ov.shape === 'segue' ? 'segue' : 'equal',
      adapt: adaptInfo(ov.adapt),
      basis: basisInfo(ov.basis),
      style: styleInfo(ov.style),
    },
  });
  if (isNum(ov.swapPos) && styleInfo(ov.style))
    list.point('swap', ov.swapPos, { state, param: 'overlap.style.swapPos' });
}

function fadeOutMarks(list: MarkList, m: Loose, f: Loose) {
  if (m.fadesOn === false || !isNum(f.fadeOutStart) || !isNum(f.fadeOutEnd)) return;
  const res = m.outResult;
  const state = res === 'done' ? 'done' : res === 'cancelled' ? 'cancelled' : 'planned';
  const align = obj(f.align);
  const info: MarkInfo =
    align && align.on
      ? { aligned: true, mode: align.mode === 'bar' ? 'bar' : 'beat', beats: isNum(align.beats) ? align.beats : null }
      : { aligned: false };
  list.band('fadeOut', f.fadeOutStart, f.fadeOutEnd, { state, param: 'fadeOut.startPos', info });
}

function nextMarks(list: MarkList, tr: Loose | null) {
  if (!tr || !tr.kind || tr.kind === 'none' || !isNum(tr.atSec)) return;
  const at = tr.atSec;
  const res = tr.result;
  const state = res === 'advanced' ? 'done' : res === 'cancelled' || res === 'skipped' ? 'cancelled' : 'planned';
  const pair = obj(tr.pair);
  const extraWait = pair && isNum(pair.extraWaitSec) && pair.extraWaitSec > 0 ? pair.extraWaitSec : 0;
  const trMix = obj(tr.mix);
  const mx = trMix && trMix.exit ? mixInfo(trMix.x) : null;
  const param = mx ? 'mix.x.t' : 'transition.advanceAtPos';
  list.point('next', at, {
    state,
    param,
    info: {
      kind: tr.kind,
      reason: tr.reason || null,
      extraWaitSec: extraWait || null,
      cancel: tr.cancel || null,
      mix: mx,
      next: state === 'planned' ? obj(tr.next) : null,
    },
  });
  list.band('tailSkip', at, list.dur, {
    state,
    param,
    info: mx ? { mix: mx, lastSoundSec: isNum(trMix?.lastSoundSec) ? trMix.lastSoundSec : null } : null,
  });
}

export function itemsAt(model: MarksModel | null | undefined, pos: unknown, tolSec?: unknown): MarkItem[] {
  if (!model || !Array.isArray(model.items) || !isNum(pos)) return [];
  const tol = isNum(tolSec) ? tolSec : 0;

  return model.items.filter((it) =>
    it.shape === 'point'
      ? Math.abs((it.at ?? 0) - pos) <= tol
      : pos >= (it.start ?? 0) - tol && pos <= (it.end ?? 0) + tol,
  );
}

export const marksSig = (model: MarksModel | null | undefined): string =>
  model && model.dur
    ? String(model.dur) +
      '|' +
      model.items
        .map((it) =>
          [
            it.kind,
            it.start,
            it.end,
            it.at,
            it.state,
            it.info && it.info.aligned,
            it.info?.mix ? it.info.mix.k : '',
          ].join(','),
        )
        .join(';')
    : '';

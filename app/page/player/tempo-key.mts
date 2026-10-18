import type { Player } from './state.mts';
import type { Frame, Tk, TkSegment } from './types.mts';

export const TK_EVERY_FLUSHES = 6;
const TK_MAX_FLUX = 480 * 100;
const TK_CHROMA_SKIP_FRAMES = 7; // the ~0.7 s chroma window still holds audio from before a gap
const TK_MIN_FRAME_LUFS = -50; // normalised noise would count fully
const TK_BLOCK_SEC = 5; // = BLOCK_SEC in shared/tempo-key.mts
const TK_MAX_BLOCKS = 96;
// Mix-point rows: [frame centre (s), LUFS, low-band share, high-band share, 12 chroma 0..99 (or none)]
const MX_MAX_ROWS = 12000;

export interface AcceptedFrame {
  vid: string;
  ct: number;
  raw: number;
  fx: Frame['fx'];
  cr: Frame['cr'];
  bd: Frame['bd'];
  contiguous: boolean;
  rate: number;
}

export function tkReset(pl: Player, vid: string): void {
  pl.tk = {
    vid,
    segments: [],
    cur: null,
    chromaSum: new Array<number>(12).fill(0),
    chromaFrames: 0,
    flux: 0,
    segFrames: 0,
    blocks: new Map(),
  };
}

const maxOf = (values: number[]) => values.reduce((m, v) => (v > m ? v : m), 0);

function currentSegment(tk: Tk, contiguous: boolean): TkSegment {
  if (contiguous && tk.cur) return tk.cur;
  const cur: TkSegment = { start: null, flux: [] };
  tk.cur = cur;
  tk.segments.push(cur);
  tk.segFrames = 0;

  return cur;
}

function blockOf(tk: Tk, ct: number): number[] | undefined {
  const bi = Math.floor(Math.max(0, ct - 0.05) / TK_BLOCK_SEC);
  let b = tk.blocks.get(bi);

  if (!b && tk.blocks.size < TK_MAX_BLOCKS) {
    b = new Array<number>(13).fill(0);
    tk.blocks.set(bi, b);
  }

  return b;
}

function addChroma(tk: Tk, ct: number, cr: number[]): void {
  const m = maxOf(cr);
  if (m <= 0) return;
  const b = blockOf(tk, ct);

  for (let i = 0; i < 12; i++) {
    const v = Math.sqrt(Math.max(0, cr[i]) / m);
    tk.chromaSum[i] += v;
    if (b) b[1 + i] += v;
  }

  tk.chromaFrames++;
  if (b) b[0]++;
}

export function tkAdd(pl: Player, fr: AcceptedFrame): void {
  const tk = pl.tk;
  const { fx, cr, ct } = fr;
  if (!tk || tk.vid !== fr.vid || !Array.isArray(fx)) return;

  // flux timing assumes normal speed
  if (fr.rate !== 1) {
    tk.cur = null;

    return;
  }

  const cur = currentSegment(tk, fr.contiguous);
  tk.segFrames++;

  if (tk.segFrames > 1 && tk.flux < TK_MAX_FLUX) {
    // the first frame's flux compares against audio before the gap
    if (cur.start === null) cur.start = ct - fx.length / 100;
    for (const v of fx) cur.flux.push(Number.isFinite(v) ? +v.toPrecision(4) : 0);
    tk.flux += fx.length;
  }

  if (Array.isArray(cr) && tk.segFrames > TK_CHROMA_SKIP_FRAMES && pl.A.energyToLufs(fr.raw) > TK_MIN_FRAME_LUFS)
    addChroma(tk, ct, cr);
}

export function mxAdd(pl: Player, fr: AcceptedFrame): void {
  const tk = pl.tk;

  if (!tk || tk.vid !== fr.vid || fr.rate !== 1) {
    if (tk) tk.mxRun = 0;

    return;
  }

  tk.mx ??= [];
  if (tk.mx.length >= MX_MAX_ROWS) return;
  tk.mxRun = fr.contiguous ? (tk.mxRun || 0) + 1 : 1;
  const { bd, cr } = fr;
  const lufs = fr.raw > 0 ? pl.A.energyToLufs(fr.raw) : -120;
  const row: (number | null)[] = [+(fr.ct - 0.05).toFixed(2), +Math.max(-120, lufs).toFixed(1)];
  const total = Array.isArray(bd) ? bd[0] + bd[1] + bd[2] : 0;
  row.push(bd && total > 0 ? +(bd[0] / total).toFixed(3) : null, bd && total > 0 ? +(bd[2] / total).toFixed(3) : null);

  if (Array.isArray(cr) && cr.length === 12 && tk.mxRun > TK_CHROMA_SKIP_FRAMES) {
    const m = maxOf(cr);
    if (m > 0) for (const v of cr) row.push(Math.round((Math.max(0, v) / m) * 99));
  }

  tk.mx.push(row);
}

export function tkPayload(pl: Player, vid: string) {
  const tk = pl.tk;
  if (!tk || tk.vid !== vid) return null;
  const segments = tk.segments.flatMap((g) =>
    g.flux.length && g.start !== null ? [{ start: +g.start.toFixed(3), flux: g.flux }] : [],
  );
  if (!segments.length && !tk.chromaFrames) return null;
  const chromaBlocks = [...tk.blocks]
    .sort((x, y) => x[0] - y[0])
    .map(([i, b]) => [i, b[0]].concat(b.slice(1).map((x) => +x.toFixed(3))));

  return {
    segments,
    chromaSum: tk.chromaSum.map((x) => +x.toFixed(3)),
    chromaFrames: tk.chromaFrames,
    chromaBlocks,
    fluxSec: tk.flux / 100,
  };
}

export function tkStatus(pl: Player) {
  const tk = pl.tk;
  if (!tk) return null;

  return { fluxSec: +(tk.flux / 100).toFixed(1), segments: tk.segments.length, chromaFrames: tk.chromaFrames };
}

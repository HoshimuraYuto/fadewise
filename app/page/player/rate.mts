import { noteError } from './common.mts';
import { ovDiag, ovWanted } from './overlap-core.mts';
import type { Player } from './state.mts';
import { isAdNow } from './youtube.mts';

// Our own rate / preservesPitch changes fire 'ratechange' too; selfRate tells them apart until the event has run.
export function asSelf(pl: Player, fn: () => void): void {
  pl.selfRate = true;

  try {
    fn();
  } catch (e) {
    noteError(pl, e);
  }

  pl.win.setTimeout(() => {
    pl.selfRate = false;
  }, 0);
}

export function setRate(pl: Player, rate: number, preservesPitch: boolean): void {
  const v = pl.video;
  if (!v) return;
  asSelf(pl, () => {
    if (v.preservesPitch !== preservesPitch) v.preservesPitch = preservesPitch;
    v.playbackRate = rate;
  });
  if (!preservesPitch) pl.ppTouched = true;
}

// Not tied to the stage being in the graph: at rate 1 the resampler is 1:1.
export const ppPreWanted = (pl: Player): boolean => ovWanted(pl) && !isAdNow(pl);

// Chrome drops 20-50 output samples when preservesPitch turns false on a sounding element.
export function ovPrearm(pl: Player): void {
  const v = pl.video;
  if (!v || !ppPreWanted(pl) || v.playbackRate !== 1 || !v.preservesPitch) return;
  asSelf(pl, () => {
    v.preservesPitch = false;
    pl.ppTouched = true;
    pl.ppPre = true;
  });
  ovDiag(pl, 'prearm', {});
}

export function restoreRate(pl: Player, silent?: boolean): void {
  const v = pl.video;
  if (!v || isAdNow(pl) || pl.rush) return;
  const quiet = silent === true || v.paused;
  const keep = pl.ppPre && (ppPreWanted(pl) || !quiet);
  if (v.playbackRate !== 1 && (pl.ov.state === 'capture' || pl.ppTouched)) setRate(pl, 1, !keep);
  else if (pl.ppTouched && !v.preservesPitch && !keep)
    asSelf(pl, () => {
      v.preservesPitch = true;
    });

  if (v.playbackRate === 1 && v.preservesPitch) {
    pl.ppTouched = false;
    pl.ppPre = false;
  }
}

export function ppRelease(pl: Player): void {
  const v = pl.video;
  if (!v || !pl.ppPre) return;
  pl.ppPre = false;
  if (!v.preservesPitch)
    asSelf(pl, () => {
      v.preservesPitch = true;
    });
  pl.ppTouched = false;
}

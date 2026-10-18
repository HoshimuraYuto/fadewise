import { type Style } from './types.mts';

export const fall = (p: number) => Math.cos((p * Math.PI) / 2);
export const rise = (p: number) => Math.sin((p * Math.PI) / 2);

export function swapSample(len: number, remSec: number, style: Style, leftSec: number | null, inSec: number | null) {
  const sr = sampleRate;
  let at = style.swapAt * len;
  if (leftSec !== null) at = (remSec - leftSec) * sr;
  else if (inSec !== null) at = inSec * sr;

  return Math.max(1, Math.round(Math.min(0.85 * len, Math.max(0.15 * len, at))));
}

export class Crossfade {
  old = 1;
  next = 0;
  span: { start: number; len: number } | null = null;
  shape: 'equal' | 'segue' = 'equal';
  maxSec: number | null = null;
  cutLeft = 0;
  cutLen = 0;
  cutFromOld = 1;
  cutFromNext = 1;
  cutFromComp = 1;

  reset(): void {
    this.span = null;
    this.old = 1;
    this.next = 0;
  }

  setGains(at: number, style: Style | null, swapAt: number, oldLeft: boolean): void {
    const span = this.span;

    if (!span) {
      this.old = 1;
      this.next = 1;
    } else if (style?.curve === 'overlap') {
      const k = at - span.start;
      this.next = rise(Math.min(1, k / Math.min(swapAt, sampleRate)));
      this.old = k < swapAt ? 1 : fall(Math.min(1, (k - swapAt) / Math.max(1, span.len - swapAt)));
    } else {
      const p = Math.min(1, (at - span.start) / span.len);
      const segue = style ? style.curve === 'segue' : this.shape === 'segue';
      this.old = fall(p);
      this.next = segue ? 1 : rise(p);
    }

    if (!oldLeft) this.old = 0;
  }

  // the new item may be an ad, so it ramps to full
  startCut(samples: number, comp: number): void {
    this.cutLeft = this.cutLen = samples;
    this.cutFromOld = this.old;
    this.cutFromNext = this.span ? this.next : 1;
    this.cutFromComp = comp;
  }

  cutStep(): boolean {
    if (!this.cutLeft) return false;
    this.next = 1 - ((1 - this.cutFromNext) * (this.cutLeft - 1)) / this.cutLen;
    this.old = (this.cutFromOld * --this.cutLeft) / this.cutLen;

    return !this.cutLeft;
  }

  get cutting(): boolean {
    return this.cutLeft > 0;
  }

  cutComp(): number {
    return 1 - ((1 - this.cutFromComp) * this.cutLeft) / this.cutLen;
  }
}

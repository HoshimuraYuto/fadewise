import { Biquad } from './biquad.mts';
import {
  BASS_CUT_DB,
  BASS_HZ,
  HP_NEW_FROM_HZ,
  HP_OLD_TO_HZ,
  HP_OPEN_HZ,
  SWAP_SEC,
  WET_SEC,
  smooth,
  sweep,
} from './blend-shape.mts';
import { type Style } from './types.mts';

export class BlendFilters {
  readonly oldBass = new Biquad();
  readonly oldHigh = new Biquad();
  readonly newBass = new Biquad();
  readonly newHigh = new Biquad();
  wetNew = 1;
  wetOld = 0;
  swapAt = Infinity;
  swapSent = false;

  start(style: Style | null): void {
    for (const f of [this.oldBass, this.oldHigh, this.newBass, this.newHigh]) f.reset();
    this.oldBass.lowShelf(BASS_HZ, 0);
    this.oldHigh.pass(HP_OPEN_HZ, true);
    this.newBass.lowShelf(BASS_HZ, BASS_CUT_DB);
    this.newHigh.pass(HP_NEW_FROM_HZ, true);
    this.wetNew = style && (style.bass || style.hpNew) ? 1 : 0;
    if (style && !style.hpNew) this.newHigh.bypass();
    this.wetOld = 0;
    this.swapAt = Infinity;
    this.swapSent = false;
  }

  // k: samples since the next track's first sound, -1 before it
  update(style: Style, k: number, len: number | null, oldLeft: boolean): void {
    const sr = sampleRate;
    if (len !== null && !oldLeft && k < this.swapAt) this.swapAt = Math.max(1, k);
    const sw = this.swapAt,
      half = (SWAP_SEC * sr) / 2;
    const x = k < 0 ? 0 : smooth((k - (sw - half)) / (2 * half));

    if (style.bass) {
      this.newBass.lowShelf(BASS_HZ, BASS_CUT_DB * (1 - x));
      this.oldBass.lowShelf(BASS_HZ, BASS_CUT_DB * x);
    }

    if (style.hpNew) this.newHigh.pass(k < 0 ? HP_NEW_FROM_HZ : sweep(HP_NEW_FROM_HZ, HP_OPEN_HZ, k / sw), true);

    if (style.hpOld && len !== null) {
      const closing = (k - sw) / Math.max(1, len - sw);
      this.oldHigh.pass(k < sw ? HP_OPEN_HZ : sweep(HP_OPEN_HZ, HP_OLD_TO_HZ, closing), true);
      this.wetOld = Math.min(1, k / (WET_SEC * sr));
    }

    if (k > sw + half) this.wetNew = Math.min(this.wetNew, Math.max(0, 1 - (k - sw - half) / (WET_SEC * sr)));
  }

  old(x: number, ch: number, style: Style): number {
    let y = x;
    if (style.bass) y = this.oldBass.run(y, ch);
    if (style.hpOld) y = this.oldHigh.run(y, ch) * this.wetOld + y * (1 - this.wetOld);

    return y;
  }

  next(x: number, ch: number): number {
    const w = this.wetNew;

    return this.newHigh.run(this.newBass.run(x, ch), ch) * w + x * (1 - w);
  }
}

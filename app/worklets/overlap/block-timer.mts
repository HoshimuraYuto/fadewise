import { type Mode } from './types.mts';

// not in AudioWorkletGlobalScope everywhere
declare const performance: { now?: () => number } | undefined;

const perfNow = typeof performance !== 'undefined' ? performance.now?.bind(performance) : undefined;
const CLOCK = perfNow ? 'performance' : 'Date';
export const clock = perfNow ?? (() => Date.now());

export class BlockTimer {
  mode: Mode | null = null;
  k = 0;
  list: [Mode, number, number, number][] = [];
  over = 0;
  readonly max: Partial<Record<Mode, number>> = {};
  sent = 0;

  note(mode: Mode, ms: number, n: number): Record<string, unknown> | null {
    if (this.mode !== mode) {
      this.mode = mode;
      this.k = 0;
    }

    const budget = (n / sampleRate) * 1000;
    if ((this.k < 6 || ms > budget * 0.5) && this.list.length < 60)
      this.list.push([mode, this.k, +ms.toFixed(3), +currentTime.toFixed(4)]);
    if (ms > budget) this.over++;
    this.max[mode] = Math.max(this.max[mode] ?? 0, +ms.toFixed(3));
    this.k++;
    if (!this.list.length || currentTime - this.sent <= 2) return null;
    const msg = { list: this.list, over: this.over, max: this.max, clock: CLOCK };
    this.list = [];
    this.sent = currentTime;

    return msg;
  }
}

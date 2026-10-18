import { Biquad } from './biquad.mts';
import { COMP_DOWN_SEC, COMP_END_SEC, COMP_UP_SEC, LOUD_SEC, SUM_OVER_DB } from './blend-shape.mts';

export class SumCap {
  // approximate BS.1770 K-weighting: old [0, 1], next [2, 3]
  readonly kw = [new Biquad(), new Biquad(), new Biquad(), new Biquad()];
  readonly energy = [0, 0, 0];
  comp = 1;
  target = 1;
  min = 1;

  start(): void {
    for (const f of this.kw) f.reset();
    this.kw[0].highShelf(1500, 4);
    this.kw[2].highShelf(1500, 4);
    this.kw[1].pass(38, true);
    this.kw[3].pass(38, true);
    this.energy.fill(0);
    this.comp = this.target = this.min = 1;
  }

  cap(): number {
    const [ea, eb, es] = this.energy,
      top = Math.max(ea, eb) * Math.pow(10, SUM_OVER_DB / 10);

    return ea + eb < 1e-8 || es <= top ? 1 : Math.sqrt(top / es);
  }

  step(pa: number, pb: number, gA: number, gB: number, both: boolean, retarget: boolean, forced: number | null): void {
    const wa = this.kw[1].run(this.kw[0].run(pa, 0), 0),
      wb = this.kw[3].run(this.kw[2].run(pb, 0), 0),
      ws = wa * gA + wb * gB,
      E = this.energy,
      q = 1 / (LOUD_SEC * sampleRate);
    E[0] += (wa * wa - E[0]) * q;
    E[1] += (wb * wb - E[1]) * q;
    E[2] += (ws * ws - E[2]) * q;
    if (retarget) this.target = both ? this.cap() : 1;

    if (forced !== null) {
      this.comp = forced;

      return;
    }

    const to = this.target,
      sec = to < this.comp ? COMP_DOWN_SEC : both ? COMP_UP_SEC : COMP_END_SEC;
    this.comp = to + (this.comp - to) * Math.exp(-1 / (sec * sampleRate));
    if (this.comp > 0.9995 && to === 1) this.comp = 1;
    if (this.comp < this.min) this.min = this.comp;
  }
}

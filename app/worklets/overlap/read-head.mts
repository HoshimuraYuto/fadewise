export class ReadHead {
  pos = 0;
  segs: { at: number; rate: number }[] = [];

  start(pos: number, writtenAt: number, rate: number): void {
    this.pos = pos;
    this.segs = [
      { at: -Infinity, rate: 1 },
      { at: writtenAt, rate },
    ];
  }

  rateAt(i: number): number {
    let r = 1;
    for (const s of this.segs) if (i >= s.at) r = s.rate;

    return r;
  }

  advance(): void {
    this.pos += 1 / this.rateAt(this.pos);
  }

  secondsUntil(upto: number): number {
    const segs = this.segs.concat([{ at: Infinity, rate: 1 }]);
    let sec = 0;

    for (let k = 0; k < segs.length - 1; k++) {
      const a = Math.max(this.pos, segs[k].at),
        b = Math.min(upto, segs[k + 1].at);
      if (b > a) sec += (b - a) * segs[k].rate;
    }

    return sec / sampleRate;
  }
}

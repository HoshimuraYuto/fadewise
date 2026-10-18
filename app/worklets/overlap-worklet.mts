import { BlendFilters } from './overlap/blend-filters.mts';
import { UPD } from './overlap/blend-shape.mts';
import { BlockTimer, clock } from './overlap/block-timer.mts';
import { Crossfade, fall, rise, swapSample } from './overlap/crossfade.mts';
import { LowMeter } from './overlap/low-meter.mts';
import { ReadHead } from './overlap/read-head.mts';
import { TAPS, buildSinc } from './overlap/sinc.mts';
import { StereoRing } from './overlap/stereo-ring.mts';
import { SumCap } from './overlap/sum-cap.mts';
import { SwitchReport } from './overlap/switch-report.mts';
import {
  parseStyle,
  secondsOrNull,
  type Command,
  type Mode,
  type ParamDescriptor,
  type Style,
} from './overlap/types.mts';

// the element starts and stops with a hard step: hold ~10 ms so a stop seen on the input can still be faded
const DELAY = 512;
const EDGE_FADE = 384;
const ZERO_RUN = 16;
const NEXT_RING = 2048;
const REPORT_WINDOWS_AFTER = 6;

const audible = (x0: number, x1: number, level: number) => Math.abs(x0) > level || Math.abs(x1) > level;
const quiet = (x0: number, x1: number, level: number) => Math.abs(x0) < level && Math.abs(x1) < level;
const valueAt = (p: Float32Array, s: number) => (p.length > 1 ? p[s] : p[0]);

class FadewiseOverlap extends AudioWorkletProcessor {
  static get parameterDescriptors(): ParamDescriptor[] {
    return [
      { name: 'gOld', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
      { name: 'kB', defaultValue: 1, minValue: 0, maxValue: 64, automationRate: 'a-rate' },
    ];
  }

  mode: Mode = 'pass';
  frame = 0;
  readonly sinc = buildSinc(0.97);
  readonly ring: StereoRing;
  written = 0;
  readonly head = new ReadHead();
  readonly next = new StereoRing(NEXT_RING);
  nextWritten = 0;
  oldEnd = 0;
  lastLoud = 0;
  readonly tailSec = 0.4;
  tailSent = false;
  zeroRun = 1e9;
  fadeIn = EDGE_FADE;
  flushLeft = 0;
  flushLen = 1;
  gate = false;
  gateOpensIn = 0;
  inSound = false;
  readonly crossfade = new Crossfade();
  style: Style | null = null;
  swapLeftSec: number | null = null;
  swapInSec: number | null = null;
  readonly filters = new BlendFilters();
  blendSample = 0;
  readonly cap = new SumCap();
  readonly low = new LowMeter();
  report: SwitchReport | null = null;
  reportAfter = 0;
  readonly windowLen = Math.round(sampleRate * 0.05);
  readonly timer: BlockTimer | null;
  seenInput = false;
  in0 = 0;
  in1 = 0;
  out0 = 0;
  out1 = 0;

  constructor(opts?: { processorOptions?: { maxLeadSec?: number; minRate?: number; timing?: boolean } }) {
    super();
    const o = opts?.processorOptions ?? {};
    const need = Math.ceil(((o.maxLeadSec || 6) / (o.minRate || 1.05)) * sampleRate * 1.1) + 8192;
    const size = 1 << Math.ceil(Math.log2(need));
    this.ring = new StereoRing(size);
    this.timer = o.timing ? new BlockTimer() : null;

    this.port.onmessage = (m: MessageEvent<Command | null>) => {
      this.command(m.data ?? {});
    };

    this.ev('ready', { ringMB: +((size * 2 * 4) / 1048576).toFixed(2) });
  }

  get comp(): number {
    return this.cap.comp;
  }

  ev(type: string, extra?: Record<string, unknown>): void {
    this.port.postMessage(Object.assign({ ev: type, t: +currentTime.toFixed(4), mode: this.mode }, extra ?? {}));
  }

  command(c: Command): void {
    if (c.cmd === 'capture') this.capture(c);
    else if (c.cmd === 'rate') this.rateChanged(c);
    else if (c.cmd === 'end') this.oldTrackEnded(c);
    else if (c.cmd === 'gate') this.setGate(c);
    else if (c.cmd === 'flush') this.flush(c);
  }

  capture(c: Command): void {
    if (this.mode !== 'pass') {
      this.ev('ignored', { cmd: c.cmd });

      return;
    }

    this.head.start(this.written - DELAY, this.written, c.rate ?? 1);
    this.lastLoud = this.written;
    this.tailSent = false;
    this.mode = 'capture';
    this.crossfade.maxSec = c.xfMax || null;
    this.crossfade.shape = c.shape === 'segue' ? 'segue' : 'equal';
    this.style = parseStyle(c.style);
    this.swapLeftSec = secondsOrNull(c.swapLeftSec);
    this.swapInSec = secondsOrNull(c.swapInSec);
    this.report = new SwitchReport(this.frame);
    this.ev('capture', { rate: c.rate });
  }

  rateChanged(c: Command): void {
    if (this.mode !== 'capture') return;
    this.head.segs.push({ at: this.written, rate: c.rate ?? 1 });
    this.ev('rate', { rate: c.rate });
  }

  oldTrackEnded(c: Command): void {
    if (this.mode !== 'capture') {
      this.ev('ignored', { cmd: c.cmd });

      return;
    }

    const w = this.written;
    this.oldEnd = Math.min(w, this.lastLoud + Math.round((c.tailKeep ?? 0.3) * sampleRate));
    if (this.oldEnd < w) this.ring.fadeBefore(this.oldEnd, EDGE_FADE);
    this.mode = 'drain';
    this.crossfade.reset();
    this.inSound = false;
    this.filters.start(this.style);
    this.blendSample = 0;
    this.low.start();
    this.cap.start();
    this.next.clear();

    if (this.report) {
      this.report.counting = true;
      this.report.switchAt = this.frame;
    }

    this.ev('drain', {
      leadOutSec: +this.head.secondsUntil(this.oldEnd).toFixed(3),
      trimmedSec: +(((w - this.oldEnd) * this.head.rateAt(w - 1)) / sampleRate).toFixed(3),
    });
  }

  setGate(c: Command): void {
    if (c.on && this.mode === 'drain') {
      this.gate = true;
      this.gateOpensIn = 0;
    } else if (!c.on && this.gate) {
      this.gateOpensIn = Math.max(1, Math.round((c.delay || 0) * sampleRate));
    }

    this.ev('gate', { on: this.gate, heard: this.inSound });
  }

  flush(c: Command): void {
    if (this.gate) {
      this.gate = false;
      this.fadeIn = 0;
    }

    if (this.mode === 'pass' || this.mode === 'flushing') return;
    const lost = this.head.secondsUntil(this.mode === 'capture' ? this.written : this.oldEnd);

    if (this.mode === 'drain') {
      this.crossfade.startCut(Math.max(1, Math.round((c.fade || 0.005) * sampleRate)), this.cap.comp);
    } else {
      this.flushLen = this.flushLeft = Math.max(1, Math.round((c.fade || 0.02) * sampleRate));
      this.mode = 'flushing';
    }

    this.ev('flush', { why: c.why || null, lostSec: +lost.toFixed(3) });
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: Record<string, Float32Array>): boolean {
    const input = inputs[0],
      out = outputs[0],
      n = out[0].length;
    const started = this.timer ? clock() : 0;
    if (this.timer && !this.seenInput && input.length) this.noteFirstInput(input[0], n);

    for (let s = 0; s < n; s++) {
      const at = this.frame + s;
      this.takeInput(input, s);
      this.render(at, valueAt(params.gOld, s), valueAt(params.kB, s));
      out[0][s] = this.out0;
      if (out.length > 1) out[1][s] = this.out1;
      this.track(at);
    }

    this.frame += n;
    const timing = this.timer?.note(this.mode, clock() - started, n);
    if (timing) this.ev('timing', timing);

    return true;
  }

  noteFirstInput(ch0: Float32Array, n: number): void {
    let peak = 0;
    for (let s = 0; s < n; s++) peak = Math.max(peak, Math.abs(ch0[s]));
    this.seenInput = true;
    this.ev('firstIn', { peak: +peak.toFixed(4) });
  }

  takeInput(input: Float32Array[], s: number): void {
    const writingRing = this.mode !== 'drain';
    let x0 = input.length ? input[0][s] : 0,
      x1 = input.length > 1 ? input[1][s] : x0;
    this.watchStops(x0, x1, writingRing);

    // before the gate zeroes the input: the page ends the head rush on this
    if (this.mode === 'drain' && !this.inSound && audible(x0, x1, 0.001)) {
      this.inSound = true;
      this.ev('inSound', { gated: this.gate });
    }

    if (this.gate) {
      x0 = 0;
      x1 = 0;
      this.gateStep();
    }

    if (this.fadeIn < EDGE_FADE) {
      const g = 0.5 - 0.5 * Math.cos((Math.PI * ++this.fadeIn) / (EDGE_FADE + 1));
      x0 *= g;
      x1 *= g;
    }

    this.in0 = x0;
    this.in1 = x1;
    if (writingRing) this.writeRing(x0, x1);
  }

  watchStops(x0: number, x1: number, writingRing: boolean): void {
    if (quiet(x0, x1, 1e-6)) {
      if (++this.zeroRun !== ZERO_RUN) return;
      if (writingRing) this.ring.fadeBefore(this.written - 15, EDGE_FADE);
      else this.next.fadeBefore(this.nextWritten - 15, EDGE_FADE);

      return;
    }

    if (this.zeroRun >= ZERO_RUN) this.fadeIn = 0;
    this.zeroRun = 0;
  }

  gateStep(): void {
    if (this.gateOpensIn <= 0 || --this.gateOpensIn !== 0) return;
    this.gate = false;
    this.fadeIn = 0;
    this.ev('gateOpen', {});
  }

  writeRing(x0: number, x1: number): void {
    this.ring.write(this.written, x0, x1);

    if (this.mode === 'capture') {
      if (audible(x0, x1, 0.00316)) {
        this.lastLoud = this.written;
        this.tailSent = false;
      } else if (!this.tailSent && this.written - this.lastLoud > this.tailSec * sampleRate) {
        this.tailSent = true;
        this.ev('tailSilent', {});
      }
    }

    this.written++;
  }

  render(at: number, gOld: number, kB: number): void {
    if (this.mode === 'pass') this.renderPass(kB);
    else if (this.mode === 'capture') this.renderCapture(gOld);
    else if (this.mode === 'flushing') this.renderFlush(gOld, kB);
    else this.renderDrain(at, gOld, kB);
  }

  renderPass(kB: number): void {
    const j = this.written - 1 - DELAY;
    this.out0 = this.ring.at(0, j) * kB;
    this.out1 = this.ring.at(1, j) * kB;
  }

  readOld(c: number): number {
    return this.ring.interpolated(c, this.head.pos, this.sinc);
  }

  renderCapture(gOld: number): void {
    this.out0 = this.readOld(0) * gOld;
    this.out1 = this.readOld(1) * gOld;
    this.head.advance();
    if (this.head.pos > this.written - TAPS - 1) this.head.pos = this.written - TAPS - 1;
  }

  renderFlush(gOld: number, kB: number): void {
    const j = this.written - 1 - DELAY,
      p = 1 - this.flushLeft / this.flushLen;
    const a = fall(p) * gOld,
      b = rise(p) * kB;
    this.out0 = this.readOld(0) * a + this.ring.at(0, j) * b;
    this.out1 = this.readOld(1) * a + this.ring.at(1, j) * b;
    this.head.advance();
    if (--this.flushLeft > 0) return;
    this.toPass();
    this.ev('pass', { why: 'flushed' });
  }

  toPass(): void {
    this.mode = 'pass';
    this.head.segs = [];
    this.reportAfter = this.windowLen * REPORT_WINDOWS_AFTER;
  }

  renderDrain(at: number, gOld: number, kB: number): void {
    this.next.write(this.nextWritten++, this.in0, this.in1);
    const delayed = this.nextWritten - 1 - DELAY;
    const nb0 = this.next.at(0, delayed),
      nb1 = this.next.at(1, delayed);
    const oldLeft = this.head.pos < this.oldEnd - TAPS - 1;
    let a0 = 0,
      a1 = 0;

    if (oldLeft) {
      a0 = this.readOld(0) * gOld;
      a1 = this.readOld(1) * gOld;
      this.head.advance();
    }

    this.watchNextSound(at, nb0, nb1, oldLeft);
    const xf = this.crossfade;
    xf.setGains(at, this.style, this.filters.swapAt, oldLeft);
    this.noteSwap(at);
    const cutDone = xf.cutStep();
    const unfilteredOld = a0 * xf.old;
    let b0 = nb0,
      b1 = nb1;
    const style = this.style;

    if (style) {
      const span = xf.span;
      if ((this.blendSample++ & (UPD - 1)) === 0)
        this.filters.update(style, span ? at - span.start : -1, span ? span.len : null, oldLeft);
      a0 = this.filters.old(a0, 0, style);
      a1 = this.filters.old(a1, 1, style);
      if (xf.cutting || cutDone) this.filters.wetNew = Math.max(0, this.filters.wetNew - 1 / xf.cutLen);

      if (this.filters.wetNew > 0) {
        b0 = this.filters.next(nb0, 0);
        b1 = this.filters.next(nb1, 1);
      }
    }

    this.out0 = a0 * xf.old + b0 * xf.next * kB;
    this.out1 = a1 * xf.old + b1 * xf.next * kB;
    this.capSum(at, (a0 + a1) / 2, ((b0 + b1) * kB) / 2, oldLeft, cutDone);
    if (xf.span) this.low.add(a0 * xf.old, b0 * xf.next * kB, unfilteredOld, nb0 * xf.next * kB, this.windowLen);
    if (cutDone || this.blendOver(at, oldLeft)) this.handOver(oldLeft, cutDone);
  }

  watchNextSound(at: number, nb0: number, nb1: number, oldLeft: boolean): void {
    const xf = this.crossfade;
    if (xf.span || xf.cutLen || !audible(nb0, nb1, 0.001)) return;
    const rem = oldLeft ? this.head.secondsUntil(this.oldEnd - TAPS - 1) : 0;
    const len = Math.max(1, Math.round(Math.min(rem, xf.maxSec || 1e9) * sampleRate));
    xf.span = { start: at, len };
    const style = this.style;
    if (style) this.filters.swapAt = swapSample(len, rem, style, this.swapLeftSec, this.swapInSec);
    this.ev('newSound', {
      remSec: +rem.toFixed(3),
      xfSec: +(len / sampleRate).toFixed(3),
      swapSec: style ? +(this.filters.swapAt / sampleRate).toFixed(3) : null,
    });
  }

  noteSwap(at: number): void {
    const span = this.crossfade.span;
    if (!this.style || !span || this.filters.swapSent || at - span.start < this.filters.swapAt) return;
    this.filters.swapSent = true;
    const atSec = +((at - span.start) / sampleRate).toFixed(3);
    this.ev('swap', { atSec, xfSec: +(span.len / sampleRate).toFixed(3) });
  }

  capSum(at: number, oldMono: number, nextMono: number, oldLeft: boolean, cutDone: boolean): void {
    const xf = this.crossfade,
      span = xf.span;
    if (!this.style || !span) return;
    const both = oldLeft && at - span.start < span.len;
    const retarget = (this.blendSample & (UPD - 1)) === 1;
    const forced = xf.cutting || cutDone ? xf.cutComp() : null;
    this.cap.step(oldMono, nextMono, xf.old, xf.next, both, retarget, forced);
    this.out0 *= this.cap.comp;
    this.out1 *= this.cap.comp;
  }

  blendOver(at: number, oldLeft: boolean): boolean {
    const span = this.crossfade.span;
    if (!span || this.gate || this.filters.wetNew > 0 || this.cap.comp !== 1) return false;

    return !oldLeft || at - span.start >= span.len;
  }

  handOver(oldLeft: boolean, cutDone: boolean): void {
    this.ev('drained', { ringLeft: oldLeft && !cutDone, killed: cutDone });
    this.toPass();
    this.crossfade.cutLen = 0;

    // seed the ring with the next track's recent samples so pass continues without a step
    for (let k = 0; k < NEXT_RING; k++) {
      const from = this.nextWritten - NEXT_RING + k;
      this.ring.write(this.written - NEXT_RING + k, this.next.at(0, from), this.next.at(1, from));
    }

    this.crossfade.old = 1;
    this.crossfade.next = 0;
  }

  track(at: number): void {
    const r = this.report;
    if (!r || (this.mode === 'pass' && this.reportAfter <= 0)) return;
    r.steps(this.in0, this.out0, at, this.mode);
    if (r.counting) r.levels(this.in0, this.in1, this.out0, this.out1, this.windowLen, at, this.mode);
    if (this.mode === 'pass' && --this.reportAfter <= 0) this.sendReport('done');
  }

  sendReport(why: string): void {
    if (!this.report) return;
    const style = this.style;
    this.ev('report', {
      ...this.report.summary(why, this.frame),
      lowWins: this.low.wins,
      lowBoth: this.low.both,
      lowBothRaw: this.low.bothRaw,
      style: style ? style.curve : null,
      sumCutDb: style ? +(20 * Math.log10(this.cap.min)).toFixed(1) : null,
    });
    this.report = null;
  }
}

registerProcessor('fadewise-overlap', FadewiseOverlap);

// K-weighting per ITU-R BS.1770 with libebur128's analog-prototype parameters (MIT, Copyright (c) 2011 Jan Kokemüller).
import { type Channels } from './meter/biquad.mts';
import { FeatureTap } from './meter/feature-tap.mts';
import { InputMeter, kWeightingCoefficients } from './meter/input-meter.mts';
import { StepProbe, type ProbeRow } from './meter/step-probe.mts';

// missing from AudioWorkletGlobalScope in some browsers and in its types
declare const performance: { now?: () => number } | undefined;

interface Frame {
  e: number;
  p: number;
  n: number;
  ch: number;
  t: number;
  e2?: number;
  p2?: number;
  st?: ProbeRow[];
  cr?: number[] | null;
  fx?: number[];
  bd?: number[] | null;
  fxMs?: number;
  pMs?: number;
}

const now = (): number => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

class LoudnessMeterProcessor extends AudioWorkletProcessor {
  readonly probe: StepProbe | null;
  readonly hop = Math.round(sampleRate * 0.1);
  readonly pre: InputMeter;
  readonly post: InputMeter;
  n = 0;
  channels = 0;
  features: FeatureTap | null = null;
  fxMs = 0;
  pMs = 0;

  constructor(opts?: { processorOptions?: { probe?: boolean } }) {
    super();
    this.probe = opts?.processorOptions?.probe ? new StepProbe() : null;
    const stages = kWeightingCoefficients(sampleRate);
    this.pre = new InputMeter(stages);
    this.post = new InputMeter(stages);

    this.guardFeatures(() => {
      this.features = new FeatureTap(sampleRate);
    });
  }

  guardFeatures(run: () => void): void {
    try {
      run();
    } catch {
      this.features = null;
    }
  }

  process(inputs: readonly Channels[]): boolean {
    const t0 = now();
    const input = inputs[0];
    this.channels = this.pre.add(input);
    if (inputs.length > 1) this.post.add(inputs[1]);
    this.probe?.addBlock(input, inputs[1]);
    this.n += this.channels && input ? input[0].length : 128;
    const t1 = now();
    const features = this.features;

    if (features) {
      this.guardFeatures(() => {
        features.push(input);
      });
    }

    const frame = this.n >= this.hop ? this.takeFrame() : null;
    const t2 = now();
    this.fxMs += t2 - t1;
    this.pMs += t2 - t0;
    if (frame) this.send(frame);

    return true;
  }

  takeFrame(): Frame {
    const frame: Frame = { e: this.pre.sum / this.n, p: this.pre.peak, n: this.n, ch: this.channels, t: currentTime };

    if (this.post.seen) {
      frame.e2 = this.post.sum / this.n;
      frame.p2 = this.post.peak;
    }

    if (this.probe) frame.st = this.probe.take();
    const features = this.features;

    if (features) {
      this.guardFeatures(() => {
        frame.cr = features.chroma();
        frame.fx = features.take();
        frame.bd = features.bands();
      });
    }

    return frame;
  }

  send(frame: Frame): void {
    frame.fxMs = this.fxMs;
    frame.pMs = this.pMs;
    this.fxMs = 0;
    this.pMs = 0;
    this.port.postMessage(frame);
    this.pre.reset();
    this.post.reset();
    this.n = 0;
  }
}

registerProcessor('fadewise-loudness-meter', LoudnessMeterProcessor);

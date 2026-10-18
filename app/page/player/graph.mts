import { errText, post } from './common.mts';
import { createFrameHandler } from './frame.mts';
import { applyGainFor } from './gain.mts';
import { ovRoute } from './overlap-graph.mts';
import type { Player } from './state.mts';
import type { Frame } from './types.mts';

export function setPostTap(pl: Player, on: boolean): void {
  const { meterNode, fadeNode } = pl;
  if (!meterNode || !fadeNode || on === pl.postTapOn) return;

  try {
    if (on) fadeNode.connect(meterNode, 0, 1);
    else fadeNode.disconnect(meterNode);
    pl.postTapOn = on;
  } catch (e) {
    pl.status.meterError = errText(e);
  }
}

function startMeter(pl: Player, c: AudioContext, src: MediaElementAudioSourceNode): AudioWorkletNode {
  const meter = new pl.win.AudioWorkletNode(c, 'fadewise-loudness-meter', {
    numberOfInputs: 2,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { probe: __FADEWISE_VERIFY__ },
  });
  // a worklet runs only when pulled by the destination; the muted sink pulls it silently
  const sink = c.createGain();
  sink.gain.value = 0;
  src.connect(meter, 0, 0);
  meter.connect(sink);
  sink.connect(c.destination);
  const onFrame = createFrameHandler(pl);
  let seq = 0;

  meter.port.onmessage = (m: MessageEvent<Frame | null>) => {
    const d = m.data;

    if (d) {
      d.seq = seq++;
      onFrame(d);
    }
  };

  return meter;
}

export async function attachMeter(pl: Player): Promise<void> {
  const { workletUrl, ctx, meterSource } = pl;
  if (!workletUrl || !ctx || !meterSource) return;

  try {
    await ctx.audioWorklet.addModule(workletUrl);
    pl.meterNode = startMeter(pl, ctx, meterSource);
    pl.meterOk = true;
    setPostTap(pl, !!__FADEWISE_VERIFY__ && !!pl.settings.postMeter);
  } catch (e) {
    pl.status.meterError = errText(e);
  }
}

function buildStages(pl: Player, c: AudioContext, src: MediaElementAudioSourceNode, g: GainNode): void {
  try {
    src.connect(g);
  } catch {
    try {
      src.connect(c.destination);
    } catch {
      /* nothing left to try */
    }

    pl.gainNode = null;

    return;
  }

  try {
    const fade = c.createGain();
    g.connect(fade);
    fade.connect(c.destination);
    pl.fadeNode = fade;
  } catch {
    pl.fadeNode = null;

    try {
      g.connect(c.destination);
    } catch {
      /* ignore */
    }
  }
}

function buildGraph(pl: Player, c: AudioContext, video: HTMLVideoElement): void {
  const g = c.createGain();
  // throws on a second call for the same element
  const src = c.createMediaElementSource(video);
  pl.connected = true;
  pl.ctx = c;
  pl.gainNode = g;
  pl.meterSource = src;
  buildStages(pl, c, src, g);
  applyGainFor(pl, 'connect');
  void attachMeter(pl);
  pl.connectedAt = c.currentTime;
  ovRoute(pl, true);
  if (c.state !== 'running') c.resume().catch(() => undefined);
  if (__FADEWISE_VERIFY__) post(pl, 'diag', { kind: 'connected', state: c.state, fadeStage: !!pl.fadeNode });
}

export function connect(pl: Player): void {
  const video = pl.video;
  if (pl.connected || !video) return;
  let created: AudioContext | null = null;

  try {
    created = new pl.win.AudioContext();
    buildGraph(pl, created, video);
  } catch (e) {
    pl.status.connectError = errText(e);

    // an unused context still holds the audio device
    if (created && pl.ctx !== created) {
      try {
        void created.close();
      } catch {
        /* ignore */
      }
    }
  }
}

export function resume(pl: Player): void {
  try {
    const ctx = pl.ctx;
    if (ctx && ctx.state !== 'running') ctx.resume().catch(() => undefined);
  } catch {
    /* ignore */
  }
}

import { noteError, RELEASE_SEC } from './common.mts';
import type { Player } from './state.mts';

const WASH_SEND = 0.5;
const WASH_OUT = 0.35;
const WASH_OPEN_SEC = 0.3;
const WASH_CLOSE_SEC = 0.09;
export const WASH_LEAD_SEC = 1.5;

function noiseBurst(ctx: AudioContext): AudioBuffer {
  const length = Math.round(ctx.sampleRate * 2.4);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);

  for (let ch = 0; ch < 2; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.2);
  }

  return buffer;
}

function buildWash(pl: Player, ctx: AudioContext, gainNode: GainNode): void {
  const send = ctx.createGain();
  const lowpass = ctx.createBiquadFilter();
  const reverb = ctx.createConvolver();
  const out = ctx.createGain();
  send.gain.value = 0;
  out.gain.value = WASH_OUT;
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 4000;
  reverb.buffer = noiseBurst(ctx);
  gainNode.connect(send);
  send.connect(lowpass);
  lowpass.connect(reverb);
  reverb.connect(out);
  out.connect(ctx.destination);

  if (pl.postTapOn && pl.meterNode) {
    try {
      out.connect(pl.meterNode, 0, 1);
    } catch {
      /* ignore */
    }
  }

  pl.washSend = send;
  pl.washOut = out;
}

function ensureWash(pl: Player): boolean {
  const { ctx, gainNode } = pl;
  if (pl.washSend || !ctx || !gainNode || !pl.settings.transitionWash) return !!pl.washSend;

  try {
    buildWash(pl, ctx, gainNode);
  } catch (e) {
    noteError(pl, e);
    pl.washSend = null;
    pl.washOut = null;
  }

  return !!pl.washSend;
}

export function openWash(pl: Player): void {
  if (!pl.settings.transitionWash || !ensureWash(pl)) return;
  const { ctx, washSend, washOut } = pl;
  if (!ctx || !washSend || !washOut) return;
  const now = ctx.currentTime;
  washOut.gain.cancelScheduledValues(now);
  washOut.gain.setValueAtTime(WASH_OUT, now);
  washSend.gain.cancelScheduledValues(now);
  washSend.gain.setValueAtTime(washSend.gain.value, now);
  washSend.gain.linearRampToValueAtTime(WASH_SEND, now + WASH_OPEN_SEC);
  pl.tr.washOpen = true;
}

export function closeWash(pl: Player, hard: boolean): void {
  const { ctx, washSend, washOut } = pl;
  if (!washSend || !washOut || !ctx) return;

  try {
    const now = ctx.currentTime;
    washSend.gain.cancelScheduledValues(now);
    washSend.gain.setValueAtTime(washSend.gain.value, now);
    washSend.gain.linearRampToValueAtTime(0, now + (hard ? RELEASE_SEC : WASH_CLOSE_SEC));

    if (hard) {
      washOut.gain.cancelScheduledValues(now);
      washOut.gain.setValueAtTime(washOut.gain.value, now);
      washOut.gain.linearRampToValueAtTime(0, now + RELEASE_SEC);
    }
  } catch {
    try {
      washSend.gain.value = 0;
      if (hard) washOut.gain.value = 0;
    } catch {
      /* ignore */
    }
  }
}

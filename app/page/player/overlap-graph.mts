import { errText, noteError, safe } from './common.mts';
import { ovDiag, ovWanted } from './overlap-core.mts';
import { onOvEvent } from './overlap-worklet-events.mts';
import { ovPrearm, restoreRate } from './rate.mts';
import type { Player } from './state.mts';
import type { OvEvent } from './types.mts';

function switchRoute(pl: Player, ovNode: AudioWorkletNode, want: boolean): void {
  const { meterSource, gainNode } = pl;
  if (!meterSource || !gainNode) return;

  if (want) {
    meterSource.disconnect(gainNode);
    meterSource.connect(ovNode);
    ovNode.connect(gainNode);
  } else {
    meterSource.disconnect(ovNode);
    ovNode.disconnect();
    meterSource.connect(gainNode);
  }
}

// The worklet is routed in or out only at a silent moment, so its 11 ms delay never jumps.
export function ovRoute(pl: Player, silent: boolean): void {
  const { ctx, meterSource, gainNode, ovNode, video } = pl;
  if (!ctx || !meterSource || !gainNode) return;
  const want = ovWanted(pl);

  if (want && !ovNode) {
    void ovLoad(pl);

    return;
  }

  if (!ovNode || want === pl.ovInGraph || pl.ov.state !== 'idle') return;
  if (!silent && video && !video.paused) return;

  try {
    switchRoute(pl, ovNode, want);
    pl.ovInGraph = want;
    ovDiag(pl, 'route', { inGraph: want });

    // the route may run on a sounding element (just after the graph was made): preservesPitch waits for a silent frame
    if (video?.paused) {
      if (want) ovPrearm(pl);
      else restoreRate(pl, true);
    }
  } catch (e) {
    noteError(pl, e);
  }
}

async function ovLoad(pl: Player): Promise<void> {
  const { ctx, overlapUrl } = pl;
  if (pl.ovNode || pl.ovLoading || !overlapUrl || !ctx) return;
  pl.ovLoading = true;

  try {
    await ctx.audioWorklet.addModule(overlapUrl);
    const limits = pl.A.OVERLAP;
    const node = new pl.win.AudioWorkletNode(ctx, 'fadewise-overlap', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: {
        maxLeadSec: limits.maxLeadSec,
        minRate: Math.min(...limits.rates),
        timing: __FADEWISE_VERIFY__,
      },
    });
    node.port.onmessage = safe(pl, (m: MessageEvent<OvEvent | null>) => {
      onOvEvent(pl, m.data || {});
    });
    pl.ovNode = node;
  } catch (e) {
    pl.status.overlapError = errText(e);
    pl.ovNode = null;
  }

  pl.ovLoading = false;
  const v = pl.video;
  // right after the graph was made the element has hardly sounded yet: the 11 ms delay is not heard as a jump
  const fresh = pl.connectedAt !== null && ctx.currentTime - pl.connectedAt < 1;
  ovRoute(pl, !v || v.paused || fresh);
}

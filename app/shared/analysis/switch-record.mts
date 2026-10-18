import { isNum, round } from './util.mts';

// times are seconds from the switch
export interface SwitchPlan {
  kind: string | null;
  overlap: boolean;
  leadSec: number | null;
  planLeadSec: number | null;
  rate: number | null;
  shape: string | null;
  adapt: string | null;
  style?: string | null;
  waitSec: number | null;
  headSec: number | null;
}
export interface SwitchRecord extends SwitchPlan {
  by: 'ext' | 'player';
  oldLastSec: number | null;
  playSec: number | null;
  firstSec: number | null;
  remEndSec: number | null;
  dipSec: number | null;
  cancel: string | null;
  // BeatAlignWhy or the page's outcome; beatMiss is in beats
  beat?: string | null;
  beatMiss?: number | null;
}
const r2 = (x: unknown) => (isNum(x) ? round(x, 2) : null);

export function switchRecord(plan: SwitchPlan | null, oldLastSec: number | null): SwitchRecord {
  const p: SwitchPlan = plan ?? {
    kind: null,
    overlap: false,
    leadSec: null,
    planLeadSec: null,
    rate: null,
    shape: null,
    adapt: null,
    waitSec: null,
    headSec: null,
  };

  return Object.assign({}, p, {
    by: plan ? ('ext' as const) : ('player' as const),
    oldLastSec: r2(oldLastSec),
    playSec: null,
    firstSec: null,
    remEndSec: null,
    dipSec: null,
    cancel: null,
  });
}

export function finishSwitch(
  r: SwitchRecord,
  firstSec: number | null,
  remEndSec: number | null,
  cancel: string | null,
): SwitchRecord {
  const out = Object.assign({}, r, { firstSec: r2(firstSec), remEndSec: r2(remEndSec), cancel });
  const heard = [out.oldLastSec, out.remEndSec].filter(isNum);
  if (isNum(out.firstSec) && heard.length) out.dipSec = round(Math.max(0, out.firstSec - Math.max(...heard)), 2);

  return out;
}

import { post } from './common.mts';
import { gaplessIds } from './queue.mts';
import { isExcluded, type Player } from './state.mts';
import { isAdNow, playerDuration, playerVideoId } from './youtube.mts';

// timers are throttled in hidden tabs; meter frames keep coming
function frameSleep(pl: Player, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const s = { due: Date.now() + ms, resolve, done: false };
    pl.sleepers.push(s);
    pl.win.setTimeout(() => {
      if (!s.done) {
        s.done = true;
        resolve();
      }
    }, ms);
  });
}

function wakeSleepers(pl: Player): void {
  const now = Date.now();
  const sleepers = pl.sleepers;

  for (let i = sleepers.length - 1; i >= 0; i--) {
    const s = sleepers[i];
    if (!s.done && now < s.due) continue;
    sleepers.splice(i, 1);

    if (!s.done) {
      s.done = true;
      s.resolve();
    }
  }
}

function playing(pl: Player) {
  const v = pl.video;
  if (!v) return null;

  return {
    vid: playerVideoId(pl),
    ct: v.currentTime,
    duration: playerDuration(pl) || v.duration,
    paused: v.paused,
    ad: isAdNow(pl),
  };
}

function trArmAt(pl: Player): number | null {
  const f = pl.fade && pl.fade.vid === playerVideoId(pl) ? pl.fade : null;
  const at = f?.tplan && !f.trDone ? f.tplan.advanceAtPos : null;

  return at !== null && Number.isFinite(at) ? at - pl.A.TR_ARM_SEC : null;
}

function initReorder(pl: Player): void {
  const { RO, RP, win } = pl;
  if (pl.reorderer || !RO) return;
  pl.reorderer = RP.createReorderer({
    R: RO,
    win,
    dom: RP.createQueueDom(win, { sleep: (ms) => frameSleep(pl, ms) }),
    now: () => (pl.ctx ? pl.ctx.currentTime : Date.now() / 1000),
    wall: () => Date.now(),
    playing: () => playing(pl),
    trState: () => pl.tr.state,
    trArmAt: () => trArmAt(pl),
    settings: () => pl.settings,
    entry: (vid) => (isExcluded(pl, vid) ? null : pl.index[vid] || null),
    fixedIds: () => gaplessIds(pl),
    onRun: (run) => {
      post(pl, 'reorderRun', run);
    },
    onDiag: (d) => {
      if (__FADEWISE_VERIFY__) post(pl, 'diag', d);
    },
    onDebug: (v) => {
      if (pl.settings.reorderDebug) post(pl, 'roDebug', v);
    },
  });
}

export function reorderTick(pl: Player): void {
  wakeSleepers(pl);
  if (!pl.settings.reorder && !pl.reorderer) return;
  initReorder(pl);
  const reorderer = pl.reorderer;
  if (!reorderer) return;
  reorderer.tick();
  const now = Date.now();

  if (pl.settings.reorderDebug && now - pl.debugStateAt >= 500) {
    pl.debugStateAt = now;
    post(pl, 'roDebugState', reorderer.debugState());
  }
}

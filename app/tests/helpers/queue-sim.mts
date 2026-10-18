import * as R from '../../shared/reorder.mts';
import * as RP from '../../page/reorder-page.mts';
import { installLayout } from './queue-sim/layout.mts';
import { installDrag } from './queue-sim/drag.mts';
import { installRowMenu } from './queue-sim/menu.mts';
import { pageChanges, userActions } from './queue-sim/actions.mts';
import {
  createQueuePage,
  isTrusted,
  setSelected,
  tick0,
  type Flagged,
  type QueuePage,
  type QueueSimOptions,
  type SimState,
  type SimTrack,
  type Tk,
} from './queue-sim/page.mts';

export { H, type QueueSimOptions, type SimFlags, type SimTrack } from './queue-sim/page.mts';

const QUEUE_DOM_TIMING = {
  stepPx: 8,
  stepMs: 0,
  settleMs: 0,
  dropWaitMs: 0,
  menuWaitMs: 300,
  menuPollMs: 100,
  actionWaitMs: 0,
  scrollWaitMs: 0,
};

function createReorderer(page: QueuePage, o: QueueSimOptions, tracks: Record<string, SimTrack>): RP.Reorderer {
  const { w, state } = page;

  return RP.createReorderer({
    R,
    win: w,
    dom: state.qdom,
    isTrusted,
    hasFocus: () => state.focus,
    timing: o.timing || { SETTLE_SEC: 3, QUIET_SEC: 0 },
    now: () => state.clock,
    wall: () => state.wall,
    playing: () => state.playing,
    trState: () => state.tr.state,
    trArmAt: () => state.tr.armAt,
    settings: () => state.settings,
    entry: (vid) => ((tracks[vid] as SimTrack | undefined)?.tk ? { tk: tracks[vid].tk } : null),
    fixedIds: () => state.fixedIds || [],
    onRun: (r) => state.runs.push(r),
    onDiag: (d) => state.diag.push(d),
    onDebug: (v) => state.debug.push(v),
  });
}

function clockControls<S extends SimState>(state: S) {
  return {
    async run(sec: number, each?: (s: S) => void): Promise<void> {
      const frames = Math.round(sec * 10);

      for (let i = 0; i < frames; i++) {
        state.clock = +(state.clock + 0.1).toFixed(2);
        state.wall += 100;
        const p = state.playing;
        if (p && !p.paused && !p.ad) p.ct = +(p.ct + 0.1).toFixed(2);
        state.ro.tick();
        if (each) each(state);
        for (let k = 0; k < 3; k++) await tick0();
      }
    },
    async settle(limit = 400): Promise<void> {
      for (let i = 0; i < limit && state.ro.status().state === 'running'; i++) await tick0();
    },
  };
}

function createToast(doc: Document): Flagged {
  const toast = doc.createElement('tp-yt-paper-toast') as Flagged;
  toast.opened = false;
  doc.body.appendChild(toast);

  return toast;
}

export function createQueueSim(o: QueueSimOptions) {
  const list = o.list || 'RDAMVMabc';
  const tracks = o.tracks || {};
  const page = createQueuePage(o, list, {
    playButton: (row) => {
      page.state.events.push(['play_button', row.data.videoId]);
    },
    menuButton: (row) => {
      menu.open(row);
    },
  });
  const { w, doc, state } = page;

  for (const id of o.ids) page.contents.appendChild(page.newRow(id));
  setSelected(page, o.sel || 0);
  state.store = page.ids();

  installLayout(page, o.tail || 0);
  installDrag(page, o.tail || 0);
  const menu = installRowMenu(page);

  state.playing = { vid: page.ids()[state.sel], ct: 5, duration: 200, paused: false, ad: false };
  state.toastEl = createToast(doc);
  state.qdom = RP.createQueueDom(w, { ...QUEUE_DOM_TIMING, sleep: tick0, isTrusted });
  state.ro = createReorderer(page, o, tracks);

  const sim = Object.assign(state, {
    w,
    doc,
    ids: page.ids,
    menuOpen: (): boolean => menu.dropdown.opened,
    upcoming: (n = 12): string[] => page.ids().slice(state.sel + 1, state.sel + 1 + n),
    ...userActions(page, tracks),
    ...pageChanges(page, state.toastEl),
  });

  return Object.assign(sim, clockControls(sim));
}

export type QueueSim = ReturnType<typeof createQueueSim>;

export const tk = (bpm: number | null, cam: string | null, conf = 1, extra?: Record<string, unknown>): Tk =>
  Object.assign({ bpm, bc: conf, cam, kc: conf, fc: conf, rel: [] }, extra);

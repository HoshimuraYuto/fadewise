import { H, resync, setSelected, type QueuePage, type SimTrack, type TrustedEvent } from './page.mts';

interface ToastOptions {
  toast?: boolean;
  toastMs?: number;
}

function trustedEvent(page: QueuePage, type: string, init?: Record<string, unknown>): void {
  const { w } = page;
  const C = type === 'wheel' ? w.WheelEvent : type.startsWith('key') ? w.KeyboardEvent : w.MouseEvent;
  const e: TrustedEvent = new C(type, Object.assign({ bubbles: true }, init));
  e.__trusted = true;
  w.dispatchEvent(e);
}

export function userActions(page: QueuePage, tracks: Record<string, SimTrack>) {
  const { contents, layout, state } = page;

  const trusted = (type: string, init?: Record<string, unknown>) => {
    trustedEvent(page, type, init);
  };

  return {
    trusted,
    next(): void {
      setSelected(page, state.sel + 1);
      const vid = page.ids()[state.sel];
      state.playing = {
        vid,
        ct: 0,
        duration: (tracks[vid] as SimTrack | undefined)?.d || 200,
        paused: false,
        ad: false,
      };
    },
    setPanel(open: boolean): void {
      if (open) layout.setAttribute('player-page-open', '');
      else layout.removeAttribute('player-page-open');
    },
    userMove(vid: string, to: number): void {
      trusted('pointerdown', { clientX: 200, clientY: 300 });
      const row = page.rows()[page.ids().indexOf(vid)];
      contents.removeChild(row);
      contents.insertBefore(row, page.rows()[to] ?? null);
      resync(page);
      trusted('pointerup', { clientX: 200, clientY: 340 });
    },
  };
}

export function pageChanges(page: QueuePage, toastEl: { opened: boolean }) {
  const { contents, state } = page;

  const pageReorder = (order: string[], opts: ToastOptions = {}): void => {
    if (opts.toast) {
      toastEl.opened = true;
      setTimeout(() => {
        toastEl.opened = false;
      }, opts.toastMs || 50);
    }

    const selected = page.rows()[state.sel];
    const keep = page.rows().filter((e) => !order.includes(e.data.videoId));
    const byId = new Map(page.rows().map((e) => [e.data.videoId, e]));
    const before = keep.slice(0, keep.indexOf(selected) + 1);
    const after = keep.slice(keep.indexOf(selected) + 1);
    const moved = order.map((v) => byId.get(v)!);

    for (const e of page.rows()) contents.removeChild(e);
    for (const e of [...before, ...moved, ...after]) contents.appendChild(e);
    resync(page);
  };

  return {
    pageReorder,
    pageSwap(exceptVid: string | null, opts?: ToastOptions): void {
      const upcoming = page.ids().slice(state.sel + 1);
      const [a, b] = upcoming.filter((v) => v !== exceptVid);
      const i = upcoming.indexOf(a);
      const j = upcoming.indexOf(b);
      [upcoming[i], upcoming[j]] = [upcoming[j], upcoming[i]];
      pageReorder(upcoming, opts);
    },
    appendRows(vids: string[]): void {
      for (const v of vids) contents.appendChild(page.newRow(v));
      state.store = page.ids();
    },
    rerender(keep?: Element | null): void {
      page.rows().forEach((row) => {
        if (row === keep) return;
        const fresh = page.newRow(row.data.videoId);
        if (row.hasAttribute('selected')) fresh.setAttribute('selected', '');
        contents.replaceChild(fresh, row);
      });
    },
    // Chrome sends a trusted move when the list scrolls under a resting pointer
    scrollUnderPointer(x: number, y: number): void {
      state.scroll += H;
      trustedEvent(page, 'pointermove', { screenX: x, screenY: y, clientX: x, clientY: y });
      trustedEvent(page, 'mousemove', { screenX: x, screenY: y, clientX: x, clientY: y });
    },
  };
}

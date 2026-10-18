import * as RP from '../../../page/reorder-page.mts';
import { BOTTOM, H, TOP, type QueuePage, type Row } from './page.mts';

const EDGE = 130;

interface Drag {
  row: Row;
  startY: number;
  startScroll: number;
  from: number;
  y: number;
}

// tailRows: another list below the queue in the same scroller (an album's #automix-contents)
export function installDrag(page: QueuePage, tailRows: number): void {
  const { w, doc, contents, state } = page;
  const tailPx = tailRows * H;
  let drag: Drag | null = null;

  const listBottomY = () => TOP + page.rows().length * H - state.scroll;

  const place = (d: Drag, y: number) => {
    const n = page.rows().length;
    const offset = Math.round((y + state.scroll - d.startY - d.startScroll) / H);
    const want = Math.max(0, Math.min(n - 1, d.from + offset));

    if (want !== page.rows().indexOf(d.row)) {
      contents.removeChild(d.row);
      contents.insertBefore(d.row, page.rows()[want] ?? null);
    }
  };

  // YTM scrolls while a held pointer is near the panel's edge
  const edgeScroll = (y: number) => {
    const max = Math.max(0, page.rows().length * H + tailPx - (BOTTOM - TOP));
    const direction = y > BOTTOM - EDGE ? 1 : y < TOP + EDGE ? -1 : 0;
    const next = Math.max(0, Math.min(max, state.scroll + direction * (state.flags.edgeStep || 8)));

    if (next !== state.scroll) {
      state.scroll = next;
      state.edgeScrolls++;
    }
  };

  const onDown = (e: MouseEvent) => {
    const row = (e.target as Element | null)?.closest<Row>('ytmusic-player-queue-item');
    if (!row) return;
    drag = { row, startY: e.clientY, startScroll: state.scroll, from: page.rows().indexOf(row), y: e.clientY };
    state.events.push(['down', row.data.videoId, e.isTrusted]);
  };

  const onMove = (e: MouseEvent) => {
    if (!drag) return;
    drag.y = e.clientY;
    if (state.flags.edgeScroll) edgeScroll(e.clientY);
    if (e.clientY > listBottomY()) return;
    place(drag, e.clientY);
  };

  const onUp = () => {
    if (!drag) return;
    const d = drag;
    drag = null;

    if (tailPx && d.y > listBottomY()) {
      contents.removeChild(d.row);
      contents.insertBefore(d.row, page.rows()[d.from] ?? null);
      state.events.push(['tail_release', d.row.data.videoId]);
    }

    state.sel = page.selectedIndex();

    if (state.flags.noDrop) {
      state.events.push(['nodrop', d.row.data.videoId]);

      return;
    }

    doc.dispatchEvent(new w.CustomEvent(RP.DROP_EVENT, { bubbles: true }));
    if (state.flags.dropTwice) doc.dispatchEvent(new w.CustomEvent(RP.DROP_EVENT, { bubbles: true }));
    if (!state.flags.storeLags) state.store = page.ids();
    state.events.push(['drop', d.row.data.videoId, page.rows().indexOf(d.row)]);
  };

  doc.addEventListener('pointerdown', onDown, true);
  doc.addEventListener('pointermove', onMove, true);
  doc.addEventListener('pointerup', onUp, true);
}

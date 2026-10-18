import * as S from '../shared/settings.mts';
import { exportFileName } from '../shared/brand.mts';
import * as A from '../shared/analysis.mts';
import { el, renderNow, invalidateNowRecord, reorderHistoryRows, reorderLogForExport } from './common.mts';
import { syncRows, deferredRender, whileVisible, setText, type Row, type SyncStats } from './dom-sync.mts';
import { detailOf, rowOf } from './library-rows.mts';
import { createLibraryTable, COLUMN_IDS, type LibraryRecord } from './library-table.mts';
import { t, applyI18n, initLang } from './i18n.mts';
import { byId, inputById } from './page-dom.mts';

const quietly = (p: Promise<unknown>) => {
  p.catch(() => {});
};

async function renderSaving(): Promise<void> {
  const { settings, consent } = await chrome.storage.local.get(['settings', 'consent']);
  byId('saving').textContent = t(S.analysisAllowed(settings, consent) ? 'library.savingOn' : 'library.savingOff');
}

const trackEntries = (all: Record<string, unknown>) =>
  Object.entries(all).filter((e): e is [string, LibraryRecord] => e[0].startsWith('track:'));

async function loadAll() {
  const all = await chrome.storage.local.get(null);
  const tracks = trackEntries(all)
    .map(([, v]) => v)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  return { tracks, excluded: S.sanitizeExcluded(all[S.EXCLUDED_KEY]) };
}

const COLS = COLUMN_IDS.length;
const view = createLibraryTable();
let lastExcluded: S.Excluded = {};
let searchText = '';
const opened = new Set<string>();
const tbody = byId('tracks');

const rowsOf = (data: { r: LibraryRecord }[]): Row[] =>
  data.flatMap((d) => {
    const open = opened.has(d.r.videoId);
    const row = rowOf(d.r, lastExcluded, open);

    return open ? [row, detailOf(d.r)] : [row];
  });

function markCells(): void {
  for (const td of tbody.querySelectorAll<HTMLElement>('td.toggle')) {
    td.tabIndex = 0;
    td.setAttribute('role', 'switch');
    td.setAttribute('aria-checked', td.classList.contains('on') ? 'true' : 'false');
    td.setAttribute('aria-label', t('col.exclude'));
  }

  for (const td of tbody.querySelectorAll<HTMLElement>('td.track')) {
    td.tabIndex = 0;
    td.setAttribute('aria-expanded', td.classList.contains('open') ? 'true' : 'false');
  }
}

function drawRows(): SyncStats {
  const data = view.rows();
  const empty = view.total() && searchText ? t('library.noMatch') : t('library.empty');
  const stats = syncRows(tbody, rowsOf(data), { text: empty, colSpan: COLS });
  setText(byId('searchCount'), searchText ? t('library.searchCount', { n: data.length, total: view.total() }) : '');

  for (const th of document.querySelectorAll<HTMLElement>('#trackHead th[data-col]')) {
    const dir = view.sortOf(th.dataset.col ?? '');
    const want = dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : null;
    if (want) {
      if (th.getAttribute('aria-sort') !== want) th.setAttribute('aria-sort', want);
    } else th.removeAttribute('aria-sort');
  }

  markCells();

  return stats;
}

async function renderTable(): Promise<SyncStats> {
  const { tracks, excluded } = await loadAll();
  lastExcluded = excluded;
  view.setData(tracks.map((r) => ({ r, off: r.videoId in excluded })));

  return drawRows();
}

const closestIn = (e: Event, sel: string) => (e.target instanceof Element ? e.target.closest<HTMLElement>(sel) : null);
byId('trackHead').addEventListener('click', (e) => {
  const b = closestIn(e, 'button.sort');
  if (!b) return;
  view.toggleSort(b.closest<HTMLElement>('th')?.dataset.col ?? '');
  drawRows();
});
const search = inputById('search');
search.addEventListener('input', () => {
  searchText = search.value.trim();
  view.setSearch(searchText);
  drawRows();
});

async function renderReorderHistory(): Promise<SyncStats> {
  const { reorderLog } = await chrome.storage.local.get('reorderLog');

  return syncRows(byId('reorderRuns'), reorderHistoryRows(reorderLog), {
    text: t('library.reorderEmpty'),
    colSpan: 1,
  });
}

async function toggleRow(vid: string): Promise<void> {
  const cur = (await chrome.storage.local.get(S.EXCLUDED_KEY))[S.EXCLUDED_KEY];
  const on = !(vid in S.sanitizeExcluded(cur));
  await chrome.storage.local.set({ [S.EXCLUDED_KEY]: S.setExcluded(cur, vid, on, Date.now()) });
}

const keyIn = (e: Event, sel: string) => closestIn(e, sel)?.parentElement?.dataset.key ?? null;

function openOrClose(vid: string): void {
  if (!opened.delete(vid)) opened.add(vid);
  drawRows();
}

function onRowAction(e: Event): boolean {
  const off = keyIn(e, 'td.toggle');
  if (off) quietly(toggleRow(off));
  const open = off ? null : keyIn(e, 'td.track');
  if (open) openOrClose(open);

  return !!(off || open);
}

tbody.addEventListener('click', (e) => {
  onRowAction(e);
});
tbody.addEventListener('keydown', (e) => {
  if (e.key !== ' ' && e.key !== 'Enter') return;
  if (onRowAction(e)) e.preventDefault();
});

async function exportAll(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const data = {
    exportedAt: new Date().toISOString(),
    settings: all.settings || null,
    autoContinueLog: all.autoContinueLog || null,
    reorderLog: reorderLogForExport(all.reorderLog),
    excluded: S.sanitizeExcluded(all[S.EXCLUDED_KEY]),
    tracks: trackEntries(all).map(([, v]) => ({ ...v, cells: A.floorCells(v.cells) })),
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = el('a');
  a.href = url;
  a.download = exportFileName(new Date());
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10000);
}

byId('export').addEventListener('click', () => {
  quietly(exportAll());
});

const IMPORT_MAX_BYTES = 50 * 1024 * 1024;
const fileInput = inputById('importFile');
const message = byId('message');
byId('import').addEventListener('click', () => {
  fileInput.value = '';
  fileInput.click();
});
interface ImportReply {
  ok?: boolean;
  reason?: string;
  added?: number;
  merged?: number;
  unchanged?: number;
  rejected?: number;
}

async function importFile(f: File): Promise<void> {
  if (f.size > IMPORT_MAX_BYTES) {
    message.textContent = t('import.tooBig');

    return;
  }

  let data: unknown;

  try {
    data = JSON.parse(await f.text());
  } catch {
    message.textContent = t('import.notJson');

    return;
  }

  const r = (await chrome.runtime.sendMessage({ type: 'import', data }).catch(() => null)) as ImportReply | null;
  const REASONS: Record<string, string> = {
    not_allowed: t('importReason.not_allowed'),
    format: t('importReason.format'),
    too_many: t('importReason.too_many'),
  };

  if (!r?.ok) {
    message.textContent = t('import.failed', { reason: REASONS[r?.reason ?? ''] ?? t('importReason.error') });

    return;
  }

  message.textContent = t('import.done', {
    added: r.added,
    merged: r.merged,
    unchanged: r.unchanged,
    rejected: r.rejected,
  });
  invalidateNowRecord();
  await renderTable();
}

fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) quietly(importFile(f));
});

let clearArmed = false;

async function clearAll(): Promise<void> {
  if (!clearArmed) {
    clearArmed = true;
    message.textContent = t('library.clearConfirm');
    setTimeout(() => {
      clearArmed = false;
      message.textContent = '';
    }, 5000);

    return;
  }

  clearArmed = false;
  const keys = Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith('track:'));
  await chrome.storage.local.remove(keys.concat('reorderLog', S.EXCLUDED_KEY));
  message.textContent = t('library.cleared', { n: keys.length });
  await renderTable();
}

byId('clear').addEventListener('click', () => {
  quietly(clearAll());
});

const requestTable = deferredRender(renderTable, 1000);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  if (Object.keys(changes).some((k) => k.startsWith('track:'))) {
    invalidateNowRecord();
    requestTable();
  }

  const has = (k: string) => k in changes;
  if (has(S.EXCLUDED_KEY)) quietly(renderTable());
  if (has('reorderLog')) quietly(renderReorderHistory());
  if (has('settings') || has('consent')) quietly(renderSaving());
});

const now = byId('now');

const renderAll = () => {
  applyI18n(document);
  quietly(renderTable());
  quietly(renderReorderHistory());
  quietly(renderSaving());
  quietly(renderNow(now));
};

initLang(renderAll).then(renderAll, renderAll);
whileVisible(() => renderNow(now), 1000);

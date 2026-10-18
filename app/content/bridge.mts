import * as S from '../shared/settings.mts';
import { mergeRunLog } from '../shared/reorder.mts';
import { pageTempoKey } from '../shared/tempo-key.mts';
import type { PageTempoKey } from '../shared/types.mts';
import type { Answered, AutoContinue, AutoContinueOptions } from './auto-continue.mts';

const TAG = 'fadewise';
const STATUS_EVERY_MS = 1000;
const DIAG_KEEP = 300;
const AUTO_CONTINUE_KEEP = 50;
const isTrue = (x: unknown) => x === true;
// WXT types getURL for its own outputs only; the worklets are copied from public/
type PublicPath = Parameters<typeof chrome.runtime.getURL>[0];

type Chrome = typeof chrome;
type Loose = Record<string, unknown>;
type Send = (type: string, data: unknown) => void;
type PageSettings = ReturnType<typeof S.pageSettings>;

interface StoredTempoKey {
  logicVersion?: unknown;
  tempo?: unknown;
  votes?: unknown;
}

const pageTk = (tk: StoredTempoKey): PageTempoKey | Loose | undefined => {
  try {
    return pageTempoKey(tk);
  } catch {
    return { logicVersion: tk.logicVersion, tempo: tk.tempo, votes: tk.votes, key: null };
  }
};

export const indexEntry = (r: Loose): Loose =>
  Object.assign({}, r, {
    cells: undefined,
    applied: undefined,
    tempoKey: r.tempoKey ? pageTk(r.tempoKey as StoredTempoKey) : undefined,
  });

interface Message {
  fadewise?: unknown;
  type?: unknown;
  data?: unknown;
}
export interface BridgeDeps {
  win: Window;
  chrome: typeof chrome;
  startAutoContinue: (opts: AutoContinueOptions) => AutoContinue;
}

function createPublisher(chrome: Chrome, toMain: Send) {
  let stored: unknown = null,
    consent: unknown = null;
  let settings: PageSettings = S.pageSettings(null, null);

  const publishSettings = () => {
    settings = S.pageSettings(stored, consent);
    toMain('settings', settings);
  };

  const publishExcluded = (map: unknown) => {
    toMain('excluded', Object.keys(S.sanitizeExcluded(map)));
  };

  async function loadAll(): Promise<void> {
    const all: Loose = await chrome.storage.local.get(null);
    stored = all.settings || null;
    consent = all.consent || null;
    const index: Record<string, Loose> = {};

    for (const [k, v] of Object.entries(all)) {
      const r = v as Loose | null;
      if (k.startsWith('track:') && r?.videoId) index[r.videoId as string] = indexEntry(r);
    }

    publishSettings();
    toMain('index', index);
    publishExcluded(all[S.EXCLUDED_KEY]);
  }

  function watchStorage(): void {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;

      if ('settings' in changes || 'consent' in changes) {
        if ('settings' in changes) stored = changes.settings.newValue || null;
        if ('consent' in changes) consent = changes.consent.newValue || null;
        publishSettings();
      }

      if (S.EXCLUDED_KEY in changes) publishExcluded(changes[S.EXCLUDED_KEY].newValue);
      const trackRemoved = Object.keys(changes).some((k) => k.startsWith('track:') && !changes[k].newValue);
      if (trackRemoved) loadAll().catch(() => {});
    });
  }

  return { loadAll, watchStorage, settings: () => settings };
}

function createRecorder(chrome: Chrome, toMain: Send, settings: () => PageSettings) {
  let lastStatusWrite = 0;
  let runQueue = Promise.resolve();

  function sendSnapshot(snap: { videoId?: unknown } | null): void {
    if (!settings().saveAnalysis) return;
    chrome.runtime
      .sendMessage({ type: 'snapshot', data: snap })
      .then((entry: unknown) => {
        if (entry && snap?.videoId) toMain('indexEntry', { vid: snap.videoId, entry });
      })
      .catch(() => {});
  }

  function storeStatus(status: unknown): void {
    const now = Date.now();
    if (now - lastStatusWrite < STATUS_EVERY_MS) return;
    lastStatusWrite = now;
    chrome.storage.session.set({ status }).catch(() => {});
  }

  function storeRun(run: unknown): void {
    runQueue = runQueue
      .then(() => chrome.storage.local.get('reorderLog'))
      .then((r) => chrome.storage.local.set({ reorderLog: mergeRunLog(r.reorderLog, run) }))
      .catch(() => {});
  }

  return { sendSnapshot, storeStatus, storeRun };
}

function createDiagLog(chrome: Chrome) {
  let diagQueue = Promise.resolve();

  return (d: unknown): void => {
    const item = Object.assign({ t: Date.now() }, d);
    diagQueue = diagQueue
      .then(() => chrome.storage.session.get('diag'))
      .then((r) => {
        const diag = ((r.diag as unknown[] | undefined) || []).concat(item).slice(-DIAG_KEEP);

        return chrome.storage.session.set({ diag });
      })
      .catch(() => {});
  };
}

async function logAutoContinue(chrome: Chrome, info: Answered): Promise<void> {
  const got = await chrome.storage.local.get('autoContinueLog');
  const log = (got.autoContinueLog as { count: number; times: number[] } | undefined) || { count: 0, times: [] };
  log.count += 1;
  log.times = log.times.concat(info.at).slice(-AUTO_CONTINUE_KEEP);
  await chrome.storage.local.set({ autoContinueLog: log });
}

// after the extension is reloaded or removed this script is orphaned and no new one is injected
function listenToPage(win: Window, alive: () => boolean, toMain: Send, handle: (type: unknown, data: unknown) => void) {
  let detached = false;

  win.addEventListener('message', (e: MessageEvent<Message | null>) => {
    if (e.source !== win || !e.data || e.data[TAG] !== 'main') return;

    if (!alive()) {
      if (!detached) {
        detached = true;
        toMain('detached', null);
      }

      return;
    }

    try {
      handle(e.data.type, e.data.data);
    } catch {
      /* extension context gone */
    }
  });
}

export function startBridge({ win, chrome, startAutoContinue }: BridgeDeps): void {
  const doc = win.document;
  const verify = typeof __FADEWISE_VERIFY__ !== 'undefined' && __FADEWISE_VERIFY__;

  const toMain: Send = (type, data) => {
    win.postMessage({ [TAG]: 'bridge', type, data }, win.location.origin);
  };

  const alive = () => {
    try {
      return !!chrome.runtime.id;
    } catch {
      return false;
    }
  };

  const publisher = createPublisher(chrome, toMain);
  const recorder = createRecorder(chrome, toMain, publisher.settings);
  const appendDiag = verify ? createDiagLog(chrome) : null;

  const sendWorklets = () => {
    toMain('workletUrl', chrome.runtime.getURL('audio/meter-worklet.js' as PublicPath));
    toMain('overlapUrl', chrome.runtime.getURL('audio/overlap-worklet.js' as PublicPath));
  };

  listenToPage(win, alive, toMain, (type, data) => {
    if (type === 'hello') {
      sendWorklets();
      publisher.loadAll().catch(() => {});
    } else if (type === 'snapshot') recorder.sendSnapshot(data as { videoId?: unknown } | null);
    else if (type === 'status') recorder.storeStatus(data);
    else if (type === 'reorderRun') recorder.storeRun(data);
    else if (appendDiag && type === 'diag') appendDiag(data);
  });
  publisher.watchStorage();
  sendWorklets();
  publisher.loadAll().catch(() => {});

  const startWatcher = () =>
    startAutoContinue({
      doc,
      win,
      isEnabled: () => isTrue(publisher.settings().autoContinue) && alive(),
      onAnswered: (info) => {
        logAutoContinue(chrome, info).catch(() => {});
      },
    });

  if ((doc.documentElement as HTMLElement | null) !== null) startWatcher();
  else doc.addEventListener('DOMContentLoaded', startWatcher);
}

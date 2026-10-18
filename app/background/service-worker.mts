import * as A from '../shared/analysis.mts';
import { analyseListen, mergeTempoKey, pageTempoKey, sanitizeImportTempoKey } from '../shared/tempo-key.mts';
import { mixAfterListen } from '../shared/mix-points.mts';
import * as S from '../shared/settings.mts';
import type { IndexEntry, MixRecord, TempoKey, TrackRecord } from '../shared/types.mts';

type Snapshot = Parameters<typeof A.mergeRecord>[1] & {
  sessionId: string;
  tk?: unknown;
  applied?: unknown;
  mx?: unknown;
};
type Record_ = TrackRecord & { mix?: MixRecord | null };
type Stored = Record<string, unknown>;

// WXT types getURL for its own outputs with a leading slash; the stored paths have none
type PagePath = Parameters<typeof chrome.runtime.getURL>[0];

const allowContentScripts = () => {
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }).catch(() => {});
};

chrome.runtime.onInstalled.addListener(allowContentScripts);
chrome.runtime.onStartup.addListener(allowContentScripts);
allowContentScripts();

chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.local
    .get('consent')
    .then(({ consent }) => {
      if (S.needsWelcome(details.reason, consent))
        return chrome.tabs.create({ url: chrome.runtime.getURL(S.WELCOME_PAGE as PagePath) });
    })
    .catch(() => {});
});

const VIDEO_ID = /^[\w-]{6,20}$/;
const BASE_PREFIX = 'listenBase:';

function tempoKeyFor(
  base: Record_ | null | undefined,
  current: Record_ | null,
  tkIn: unknown,
  rec: Record_,
): TrackRecord['tempoKey'] {
  const kept = () => (current?.tempoKey ? current.tempoKey : base?.tempoKey || null);
  if (!tkIn) return kept();

  try {
    const t0 = Date.now();
    const listen = analyseListen(tkIn);
    const anchors = {
      firstSoundSec: rec.firstSoundExact ? rec.firstSoundSec : null,
      lastSoundSec: rec.lastSoundSec,
      durationSec: rec.durationSec,
    };
    const tk: TempoKey = mergeTempoKey(base?.tempoKey, listen, Date.now(), anchors);
    tk.lastListen = {
      fluxSec: listen.fluxSec,
      votes: listen.votes.length,
      chromaFrames: listen.chromaFrames,
      ms: Date.now() - t0,
    };

    return tk;
  } catch {
    return kept();
  }
}

let queue: Promise<unknown> = Promise.resolve();

export async function storeSnapshot(snap: Snapshot | null | undefined): Promise<IndexEntry | null> {
  if (!snap || typeof snap.videoId !== 'string' || !VIDEO_ID.test(snap.videoId) || typeof snap.sessionId !== 'string')
    return null;
  const key = 'track:' + snap.videoId;
  const got: Stored = await chrome.storage.local.get(['settings', 'consent', key]);
  if (!S.analysisAllowed(got.settings, got.consent)) return null;
  const baseKey = BASE_PREFIX + snap.sessionId;
  let base = (await chrome.storage.session.get(baseKey))[baseKey] as Record_ | null | undefined;
  const current = (got[key] as Record_ | undefined) || null;

  if (base === undefined) {
    base = current;
    await chrome.storage.session.set({ [baseKey]: base });
  }

  const tk = snap.tk as { segments?: unknown } | undefined;
  delete snap.tk;
  const applied = snap.applied;
  delete snap.applied;
  const mx = snap.mx;
  delete snap.mx;
  const rec: Record_ = A.mergeRecord(base, snap, Date.now());
  rec.tempoKey = tempoKeyFor(base, current, tk, rec);
  const oldMix = current?.mix ? current.mix : base?.mix || null;
  if (mx) {
    let edges;

    try {
      const p = rec.tempoKey ? pageTempoKey(rec.tempoKey) : null;
      edges = p?.edges ?? null;
    } catch {
      edges = null;
    }

    rec.mix = mixAfterListen(oldMix, mx, tk?.segments, rec, edges);
  } else if (oldMix) rec.mix = oldMix;
  if (!rec.mix) delete rec.mix;
  rec.applied = A.mergeApplied(current ? current.applied : base?.applied, applied);
  await chrome.storage.local.set({ [key]: rec });

  return A.indexEntryOf(Object.assign({}, rec, { tempoKey: rec.tempoKey ? pageTempoKey(rec.tempoKey) : null }));
}

async function clearListenBases(): Promise<void> {
  const all = await chrome.storage.session.get(null);
  await chrome.storage.session.remove(Object.keys(all).filter((k) => k.startsWith(BASE_PREFIX)));
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.keys(changes).some((k) => k.startsWith('track:') && !changes[k].newValue)) {
    queue = queue.then(clearListenBases).catch(() => {});
  }
});

export interface ImportResult {
  ok: boolean;
  reason: string | null;
  added: number;
  merged: number;
  unchanged: number;
  rejected: number;
  excluded: number;
}
const IMPORT_MAX_TRACKS = 20000;

export async function importData(data: unknown): Promise<ImportResult> {
  const res: ImportResult = { ok: false, reason: null, added: 0, merged: 0, unchanged: 0, rejected: 0, excluded: 0 };
  const got: Stored = await chrome.storage.local.get(['settings', 'consent', S.EXCLUDED_KEY]);
  if (!S.analysisAllowed(got.settings, got.consent)) return Object.assign(res, { reason: 'not_allowed' });
  const d = data as { tracks?: unknown; excluded?: unknown } | null;
  if (!d || typeof d !== 'object' || !Array.isArray(d.tracks)) return Object.assign(res, { reason: 'format' });
  const tracks = d.tracks as unknown[];
  if (tracks.length > IMPORT_MAX_TRACKS) return Object.assign(res, { reason: 'too_many' });
  const wanted = new Map<string, { rec: TrackRecord; tk: TempoKey | null }>();

  for (const t of tracks) {
    let rec: TrackRecord | null;

    try {
      rec = A.sanitizeImportTrack(t);
    } catch {
      rec = null;
    }

    if (!rec || wanted.has(rec.videoId)) {
      res.rejected++;
      continue;
    }

    let tk: TempoKey | null;

    try {
      tk = sanitizeImportTempoKey((t as { tempoKey?: unknown }).tempoKey);
    } catch {
      tk = null;
    }

    wanted.set(rec.videoId, { rec, tk });
  }

  const keys = [...wanted.keys()].map((v) => 'track:' + v);
  const cur: Stored = keys.length ? await chrome.storage.local.get(keys) : {};
  const write: Stored = {};
  const now = Date.now();

  for (const [vid, { rec, tk }] of wanted) {
    const before = (cur['track:' + vid] as TrackRecord | undefined) || null;
    const m = A.mergeImportedRecord(before, rec, tk, now);

    if (!m.changed) {
      res.unchanged++;
      continue;
    }

    write['track:' + vid] = m.rec;
    if (before) res.merged++;
    else res.added++;
  }

  const ex = S.sanitizeExcluded(got[S.EXCLUDED_KEY]);
  const inEx = S.sanitizeExcluded(d.excluded);

  for (const [vid, at] of Object.entries(inEx))
    if (!(vid in ex)) {
      ex[vid] = at;
      res.excluded++;
    }

  if (res.excluded) write[S.EXCLUDED_KEY] = S.sanitizeExcluded(ex);
  if (Object.keys(write).length) await chrome.storage.local.set(write);

  return Object.assign(res, { ok: true });
}

interface Status {
  ad?: unknown;
  at?: number;
  videoId?: string;
}

export async function onCommand(name: string): Promise<void> {
  if (name === 'toggle-all') {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: S.toggleAll(settings) });
  } else if (name === 'toggle-track') {
    const status = (await chrome.storage.session.get('status')).status as Status | undefined;
    const vid = status && !status.ad && Date.now() - (status.at || 0) < 15000 ? status.videoId : null;
    if (!vid) return;
    const cur = (await chrome.storage.local.get(S.EXCLUDED_KEY))[S.EXCLUDED_KEY];
    const on = !(vid in S.sanitizeExcluded(cur));
    await chrome.storage.local.set({ [S.EXCLUDED_KEY]: S.setExcluded(cur, vid, on, Date.now()) });
  }
}

// absent in the tests' stub
const commands = chrome.commands as typeof chrome.commands | undefined;
if (commands?.onCommand)
  commands.onCommand.addListener((name) => {
    queue = queue.then(() => onCommand(name)).catch(() => {});
  });

const fromOwnPage = (sender: { id?: string; url?: string } | undefined, page: string) =>
  !!sender &&
  sender.id === chrome.runtime.id &&
  typeof sender.url === 'string' &&
  sender.url.startsWith(chrome.runtime.getURL(page as PagePath));

chrome.runtime.onMessage.addListener((msg: { type?: unknown; data?: unknown } | null, sender, reply) => {
  if (msg && msg.type === 'import' && fromOwnPage(sender, 'library.html')) {
    queue = queue
      .then(() => importData(msg.data))
      .then(reply, () => {
        reply({ ok: false, reason: 'error' });
      });

    return true;
  }

  if (!msg || msg.type !== 'snapshot' || !sender.tab) return false;
  queue = queue
    .then(() => storeSnapshot(msg.data as Snapshot | null))
    .then(reply, () => {
      reply(null);
    });

  return true;
});

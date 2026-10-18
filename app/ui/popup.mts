import * as S from '../shared/settings.mts';
import type { RunLogEntry } from '../shared/reorder.mts';
import type { StoredSettings, UiLanguage } from '../shared/types.mts';
import {
  renderNow,
  invalidateNowRecord,
  popupReorderText,
  summaryPairs,
  switchesText,
  type RecordView,
  type StatusView,
} from './common.mts';
import { whileVisible, syncPairs, setText } from './dom-sync.mts';
import { t, applyI18n, initLang } from './i18n.mts';
import { byId, inputById, selectById } from './page-dom.mts';

// WXT types getURL for its own outputs with a leading slash; the stored paths have none
type PagePath = Parameters<typeof chrome.runtime.getURL>[0];

const FEATURE_KEYS = [
  'gainEnabled',
  'fadesEnabled',
  'beatAlign',
  'transitions',
  'transitionWash',
  'overlap',
  'reorder',
  'reorderAlbums',
  'reorderToast',
  'queueBadges',
  'seekbarMarks',
  'autoContinue',
  'reorderDebug',
] as const;

const save = async (patch: StoredSettings) => {
  const cur = (await chrome.storage.local.get('settings')).settings;
  await chrome.storage.local.set({ settings: S.patchSettings(cur, patch) });
};

const quietly = (p: Promise<unknown>) => {
  p.catch(() => {});
};

let autoContinueLog: { count: number; times: number[] } | null = null;

function renderLog(): void {
  const log = byId('autoContinueLog');

  if (autoContinueLog?.count) {
    const last = new Date(autoContinueLog.times[autoContinueLog.times.length - 1]).toLocaleString();
    log.textContent = t('popup.autoContinueLog', { count: autoContinueLog.count, last });
  } else {
    log.textContent = t('popup.autoContinueNone');
  }
}

let reorderLog: unknown = null;

const lastRun = (): Partial<RunLogEntry> | null => {
  const runs = Array.isArray(reorderLog) ? (reorderLog as Partial<RunLogEntry>[]) : [];

  return runs[runs.length - 1] ?? null;
};

function renderReorderLog(): void {
  setText(byId('reorderLog'), popupReorderText(reorderLog, (S.withDefaults(stored).reorder as unknown) === true));
}

let stored: unknown = null;

function renderSettings(): void {
  const s = S.withDefaults(stored);
  // stored values are not checked for their type
  for (const key of FEATURE_KEYS) inputById(key).checked = (s[key] as unknown) === true;
  selectById('mixPoints').value = s.mixPoints;
  selectById('leadRate').value = String(s.leadRate);
  selectById('overlapStyle').value = s.overlapStyle;
  const p = S.presetOf(stored);
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name="preset"]')) r.checked = r.value === p;
  byId('presetCustom').hidden = p !== 'custom';
  const notes: Record<string, string> = {
    auto: t('presetNote.auto'),
    gentle: t('presetNote.gentle'),
    off: t('presetNote.off'),
  };
  setText(byId('presetNote'), notes[p] ?? '');
}

let excluded: Record<string, number> = {};
let playingVid: string | null = null;

function renderPlaying(status: StatusView | null, rec: RecordView | null): void {
  const vid = status?.at && Date.now() - status.at < 15000 && !status.ad && status.videoId ? status.videoId : null;
  playingVid = vid;
  const title = byId('playingTrack');
  setText(title, vid ? rec?.title || vid : t('now.none'));
  title.classList.toggle('none', !vid);
  setText(byId('playingArtist'), vid && rec?.title ? rec.artist || '' : '');
  byId('excludeRow').hidden = !vid;
  inputById('excludeTrack').checked = !!(vid && vid in excluded);
  syncPairs(byId('summary'), vid ? summaryPairs(status, lastRun()) : null, '');
  const sw = byId('switches') as HTMLTextAreaElement;
  const text = switchesText(status?.switches, chrome.runtime.getManifest().version);
  if (sw.value !== text) sw.value = text;
  byId('copySwitches').hidden = !text;
}

async function renderShortcuts(): Promise<void> {
  let cmds: { name?: string; shortcut?: string }[] = [];

  try {
    cmds = await chrome.commands.getAll();
  } catch {
    cmds = [];
  }

  const key = (n: string) => cmds.find((x) => x.name === n)?.shortcut || (cmds.length ? t('shortcut.unset') : '');
  setText(byId('kbdAll'), key('toggle-all'));
  setText(byId('kbdTrack'), key('toggle-track'));
}

async function tick(): Promise<void> {
  const r = await renderNow(byId('now'), { brief: true });
  renderPlaying(r.status, r.rec);
}

function renderAll(): void {
  applyI18n(document);
  renderLog();
  renderReorderLog();
  renderSettings();
  quietly(renderShortcuts());
  quietly(tick());
}

function saveSelect<T>(
  id: string,
  parse: (value: string) => T,
  allowed: readonly T[],
  patchOf: (v: T) => StoredSettings,
) {
  const sel = selectById(id);
  sel.addEventListener('change', () => {
    const v = parse(sel.value);
    if (allowed.includes(v)) quietly(save(patchOf(v)));
  });
}

function bindSettings(): void {
  for (const key of FEATURE_KEYS) {
    const box = inputById(key);
    box.addEventListener('change', () => {
      quietly(save({ [key]: box.checked }));
    });
  }

  saveSelect('mixPoints', String, S.MIX_POINTS as readonly string[], (v) => ({ mixPoints: v }));
  saveSelect('overlapStyle', String, S.OVERLAP_STYLES as readonly string[], (v) => ({ overlapStyle: v }));
  saveSelect('leadRate', Number, S.LEAD_RATES, (v) => ({ leadRate: v }));

  for (const r of document.querySelectorAll<HTMLInputElement>('input[name="preset"]')) {
    r.addEventListener('change', () => {
      if (!r.checked) return;
      quietly(
        chrome.storage.local
          .get('settings')
          .then(({ settings }) => chrome.storage.local.set({ settings: S.applyPreset(settings, r.value) })),
      );
    });
  }
}

function bindExclude(): void {
  const ex = inputById('excludeTrack');
  ex.addEventListener('change', () => {
    const vid = playingVid;
    if (!vid) return;
    quietly(
      chrome.storage.local.get(S.EXCLUDED_KEY).then((cur) =>
        chrome.storage.local.set({
          [S.EXCLUDED_KEY]: S.setExcluded(cur[S.EXCLUDED_KEY], vid, ex.checked, Date.now()),
        }),
      ),
    );
  });
}

async function toggleAnalysis(box: HTMLInputElement): Promise<void> {
  const cur = await chrome.storage.local.get(['settings', 'consent']);
  const r = S.toggleAnalysis(cur.settings, cur.consent, box.checked);

  if (r.openWelcome) {
    box.checked = false;
    await chrome.tabs.create({ url: chrome.runtime.getURL(S.WELCOME_PAGE as PagePath) });

    return;
  }

  await chrome.storage.local.set({ settings: r.settings });
}

function bindAnalysis(settings: unknown, consent: unknown): void {
  const analysis = inputById('analysisEnabled');
  analysis.checked = S.analysisAllowed(settings, consent);
  analysis.addEventListener('change', () => {
    quietly(toggleAnalysis(analysis));
  });
}

function bindCopy(): void {
  const copy = byId('copySwitches');
  copy.addEventListener('click', () => {
    const sw = byId('switches') as HTMLTextAreaElement;
    sw.select();
    quietly(
      navigator.clipboard.writeText(sw.value).then(() => {
        setText(copy, t('popup.copied'));
      }),
    );
  });
}

function bindLanguage(): void {
  const lang = selectById('uiLanguage');
  lang.value = S.withDefaults(stored).uiLanguage;
  lang.addEventListener('change', () => {
    quietly(save({ uiLanguage: lang.value as UiLanguage }));
  });
}

type StorageListener = Parameters<typeof chrome.storage.onChanged.addListener>[0];

const onStorageChanged: StorageListener = (changes, area) => {
  if (area !== 'local') return;
  if (Object.keys(changes).some((k) => k.startsWith('track:'))) invalidateNowRecord();

  if ('reorderLog' in changes) {
    reorderLog = changes.reorderLog.newValue ?? null;
    renderReorderLog();
    quietly(tick());
  }

  if ('settings' in changes) {
    stored = changes.settings.newValue ?? null;
    renderSettings();
    renderReorderLog();
  }

  if (S.EXCLUDED_KEY in changes) {
    excluded = S.sanitizeExcluded(changes[S.EXCLUDED_KEY].newValue);
    quietly(tick());
  }
};

async function init(): Promise<void> {
  await initLang(renderAll);
  const got = await chrome.storage.local.get(['settings', 'consent', 'autoContinueLog', 'reorderLog', S.EXCLUDED_KEY]);
  autoContinueLog = (got.autoContinueLog as typeof autoContinueLog | undefined) ?? null;
  reorderLog = got.reorderLog ?? null;
  stored = got.settings ?? null;
  excluded = S.sanitizeExcluded(got[S.EXCLUDED_KEY]);

  bindSettings();
  bindExclude();
  bindAnalysis(got.settings, got.consent);
  bindCopy();
  bindLanguage();

  renderAll();
  chrome.storage.onChanged.addListener(onStorageChanged);
  whileVisible(tick, 1000);
}

quietly(init());

import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as S from '../shared/settings.mts';
import * as A from '../shared/analysis.mts';
import * as I from '../ui/i18n.mts';
import { startBridge, type BridgeDeps } from '../content/bridge.mts';
import type { AutoContinueOptions, AutoContinue } from '../content/auto-continue.mts';

type Data = Record<string, unknown>;
type Listener = (...args: any[]) => unknown;

function area() {
  const data: Data = {};

  const pick = (keys: string | string[] | null | undefined): Data => {
    if (keys === null || keys === undefined) return { ...data };
    const list = Array.isArray(keys) ? keys : [keys];
    const out: Data = {};
    for (const k of list) if (k in data) out[k] = data[k];

    return out;
  };

  return {
    data,
    get: (keys?: string | string[] | null) => Promise.resolve(JSON.parse(JSON.stringify(pick(keys))) as Data),
    set: (obj: Data) => {
      Object.assign(data, JSON.parse(JSON.stringify(obj)));

      return Promise.resolve();
    },
    remove: (keys: string | string[]) => {
      for (const k of ([] as string[]).concat(keys)) Reflect.deleteProperty(data, k);

      return Promise.resolve();
    },
    setAccessLevel: () => Promise.resolve(),
  };
}

function chromeStub() {
  const listeners: Record<'installed' | 'message' | 'changed' | 'startup', Listener[]> = {
    installed: [],
    message: [],
    changed: [],
    startup: [],
  };
  const tabs: string[] = [];
  const sent: unknown[] = [];
  const c = {
    storage: { local: area(), session: area(), onChanged: { addListener: (f: Listener) => listeners.changed.push(f) } },
    runtime: {
      id: 'test',
      getURL: (p: string) => 'chrome-extension://test/' + p,
      onInstalled: { addListener: (f: Listener) => listeners.installed.push(f) },
      onStartup: { addListener: (f: Listener) => listeners.startup.push(f) },
      onMessage: { addListener: (f: Listener) => listeners.message.push(f) },
      sendMessage: (m: unknown) => {
        sent.push(m);

        return Promise.resolve(null);
      },
    },
    tabs: {
      create: (o: { url: string }) => {
        tabs.push(o.url);

        return Promise.resolve({});
      },
    },
  };

  return { c, listeners, tabs, sent };
}

type Stub = ReturnType<typeof chromeStub>;
const asChrome = (c: Stub['c']) => c as unknown as typeof chrome;
const flush = () => new Promise((r) => setTimeout(r, 0));

test('auto-continue is off by default; a value the user saved is kept', () => {
  assert.strictEqual(S.DEFAULTS.autoContinue, false);
  assert.strictEqual(S.withDefaults(null).autoContinue, false);
  assert.strictEqual(S.withDefaults({ gainEnabled: false }).autoContinue, false, 'existing install without the key');
  assert.strictEqual(S.withDefaults({ autoContinue: true }).autoContinue, true);
  assert.strictEqual(S.withDefaults({ autoContinue: false }).autoContinue, false);
});

test('saving needs consent to the current disclosure and the switch on', () => {
  const ok = { decision: 'granted', version: S.CONSENT_VERSION, at: 1 };
  assert.strictEqual(S.analysisAllowed(null, null), false, 'fresh install');
  assert.strictEqual(S.analysisAllowed({ analysisEnabled: true }, null), false, 'switch alone is not enough');
  assert.strictEqual(S.analysisAllowed(null, ok), true, 'switch defaults to on once consent is given');
  assert.strictEqual(S.analysisAllowed({ analysisEnabled: false }, ok), false, 'switch off');
  assert.strictEqual(S.analysisAllowed(null, { decision: 'declined', version: S.CONSENT_VERSION }), false);
  assert.strictEqual(
    S.analysisAllowed(null, { decision: 'granted', version: S.CONSENT_VERSION - 1 }),
    false,
    'older disclosure',
  );
});

test('welcome page: always on install; on update only while the current disclosure is unanswered', () => {
  assert.strictEqual(S.needsWelcome('install', null), true);
  assert.strictEqual(S.needsWelcome('install', { decision: 'granted', version: S.CONSENT_VERSION }), true);
  assert.strictEqual(S.needsWelcome('update', null), true, 'existing user from before the consent page');
  assert.strictEqual(S.needsWelcome('update', { decision: 'granted', version: S.CONSENT_VERSION }), false);
  assert.strictEqual(
    S.needsWelcome('update', { decision: 'declined', version: S.CONSENT_VERSION }),
    false,
    'a "no" is not asked again',
  );
  assert.strictEqual(S.needsWelcome('update', { decision: 'granted', version: S.CONSENT_VERSION - 1 }), true);
  assert.strictEqual(S.needsWelcome('chrome_update', null), false);
});

test('grant / decline / popup switch write only the keys they own', () => {
  const g = S.grant({ autoContinue: true }, 5);
  assert.deepStrictEqual(g.settings, { autoContinue: true, analysisEnabled: true });
  assert.deepStrictEqual(g.consent, { decision: 'granted', version: S.CONSENT_VERSION, at: 5 });
  const d = S.decline(null, 6);
  assert.deepStrictEqual(d.settings, { analysisEnabled: false });
  assert.strictEqual(d.consent.decision, 'declined');
  assert.deepStrictEqual(S.toggleAnalysis({ x: 1 }, null, true), { settings: null, openWelcome: true });
  assert.deepStrictEqual(S.toggleAnalysis({ x: 1 }, d.consent, true), { settings: null, openWelcome: true });
  assert.deepStrictEqual(S.toggleAnalysis({ x: 1 }, g.consent, false), {
    settings: { x: 1, analysisEnabled: false },
    openWelcome: false,
  });
  assert.deepStrictEqual(S.toggleAnalysis(null, g.consent, false).settings, { analysisEnabled: false });
  assert.strictEqual(S.toggleAnalysis(null, null, false).openWelcome, false);
  assert.strictEqual(S.pageSettings(null, null).saveAnalysis, false);
  assert.strictEqual(S.pageSettings(null, g.consent).saveAnalysis, true);
});

const V2 = { decision: 'granted', version: 2, at: 1 };
test('re-consent: version 3; an answer to version 2 counts as no answer until the new page is answered', () => {
  assert.strictEqual(S.CONSENT_VERSION, 3);
  assert.strictEqual(S.answered(V2), false);
  assert.strictEqual(S.granted(V2), false);
  assert.strictEqual(S.analysisAllowed({ analysisEnabled: true }, V2), false, 'saving stops');
  assert.strictEqual(S.needsWelcome('update', V2), true, 'the welcome page opens on the update');
  assert.strictEqual(S.needsWelcome('update', { decision: 'declined', version: 2 }), true, 'a v2 "no" is asked too');
  assert.deepStrictEqual(S.toggleAnalysis({ analysisEnabled: true }, V2, true), { settings: null, openWelcome: true });
  const again = S.grant({ analysisEnabled: true }, 9);
  assert.strictEqual(S.answered(again.consent), true);
  assert.strictEqual(S.analysisAllowed(again.settings, again.consent), true);
  assert.strictEqual(S.needsWelcome('update', again.consent), false);
});

const stub = chromeStub();
globalThis.chrome = asChrome(stub.c);
(globalThis as { self?: unknown }).self = globalThis;
// imported after the stub is installed: it registers its listeners when evaluated
const SW = await import('../background/service-worker.mts');

function snap(vid: string, i: number) {
  const s = A.createSession(vid, 200);
  for (let k = 0; k < 50; k++) A.addFrame(s, 10 + k * 0.1, 0.01, 0.2, k > 0);

  return { ...A.sessionSnapshot(s, { sessionId: vid + ':' + i, title: 'T', artist: 'A' }), sessionId: vid + ':' + i };
}

const tracks = () => Object.keys(stub.c.storage.local.data).filter((k) => k.startsWith('track:'));

function reset(local?: Data) {
  for (const k of Object.keys(stub.c.storage.local.data)) Reflect.deleteProperty(stub.c.storage.local.data, k);
  for (const k of Object.keys(stub.c.storage.session.data)) Reflect.deleteProperty(stub.c.storage.session.data, k);
  Object.assign(stub.c.storage.local.data, local ?? {});
  stub.tabs.length = 0;
}

const fireInstalled = async (reason: string) => {
  for (const f of stub.listeners.installed) f({ reason });
  await flush();
  await flush();
};

test('service worker: nothing is stored before consent', async () => {
  reset();
  assert.strictEqual(await SW.storeSnapshot(snap('aaaaaaaaaaa', 1)), null);
  reset({ settings: { analysisEnabled: true } });
  assert.strictEqual(await SW.storeSnapshot(snap('aaaaaaaaaaa', 2)), null);
  reset({ consent: { decision: 'declined', version: S.CONSENT_VERSION, at: 1 } });
  assert.strictEqual(await SW.storeSnapshot(snap('aaaaaaaaaaa', 3)), null);
  assert.deepStrictEqual(tracks(), []);
  assert.deepStrictEqual(Object.keys(stub.c.storage.session.data), [], 'no listen base either');
});

test('service worker: stores after consent, stops when the switch is off, existing records are kept', async () => {
  const ok = { decision: 'granted', version: S.CONSENT_VERSION, at: 1 };
  reset({ consent: ok });
  assert.ok(await SW.storeSnapshot(snap('bbbbbbbbbbb', 1)));
  assert.deepStrictEqual(tracks(), ['track:bbbbbbbbbbb']);
  const before = JSON.stringify(stub.c.storage.local.data['track:bbbbbbbbbbb']);
  stub.c.storage.local.data.settings = { analysisEnabled: false };
  assert.strictEqual(await SW.storeSnapshot(snap('ccccccccccc', 1)), null);
  assert.strictEqual(await SW.storeSnapshot(snap('bbbbbbbbbbb', 2)), null);
  assert.deepStrictEqual(tracks(), ['track:bbbbbbbbbbb']);
  assert.strictEqual(
    JSON.stringify(stub.c.storage.local.data['track:bbbbbbbbbbb']),
    before,
    'not updated, not deleted',
  );
  stub.c.storage.local.data.settings = { analysisEnabled: true };
  assert.ok(await SW.storeSnapshot(snap('ccccccccccc', 2)));
  assert.strictEqual(tracks().length, 2);
});

test('service worker: install opens the welcome page; update only without an answer', async () => {
  reset();
  await fireInstalled('install');
  assert.deepStrictEqual(stub.tabs, ['chrome-extension://test/welcome.html']);
  reset({ consent: { decision: 'granted', version: S.CONSENT_VERSION, at: 1 } });
  await fireInstalled('update');
  assert.deepStrictEqual(stub.tabs, []);
  reset({ 'track:ddddddddddd': { videoId: 'ddddddddddd' } }); // user from before the consent page
  await fireInstalled('update');
  assert.deepStrictEqual(stub.tabs, ['chrome-extension://test/welcome.html']);
});

test('service worker: a version 2 user is asked again on update; nothing new is stored until they agree', async () => {
  reset({ consent: V2, settings: { analysisEnabled: true }, 'track:fffffffffff': { videoId: 'fffffffffff' } });
  await fireInstalled('update');
  assert.deepStrictEqual(stub.tabs, ['chrome-extension://test/welcome.html']);
  assert.strictEqual(await SW.storeSnapshot(snap('ggggggggggg', 1)), null);
  assert.deepStrictEqual(tracks(), ['track:fffffffffff'], 'stored tracks are kept, nothing added');
  const r = S.grant(stub.c.storage.local.data.settings, 10);
  await stub.c.storage.local.set({ settings: r.settings, consent: r.consent });
  assert.ok(await SW.storeSnapshot(snap('ggggggggggg', 2)));
  stub.tabs.length = 0;
  await fireInstalled('update');
  assert.deepStrictEqual(stub.tabs, [], 'not asked again after the new answer');
});

interface FakeWin {
  addEventListener: (t: string, f: Listener) => void;
  postMessage: (m: { type: string; data: { saveAnalysis?: boolean } }) => void;
  location: { origin: string };
  document: { documentElement: object };
}

function runBridge(local?: Data, { verify = false } = {}) {
  const b = chromeStub();
  Object.assign(b.c.storage.local.data, local ?? {});
  const listeners: Listener[] = [];
  const toMain: { type: string; data: { saveAnalysis?: boolean } }[] = [];
  const watcher: { isEnabled?: () => boolean } = {};
  const win: FakeWin = {
    addEventListener: (t, f) => {
      if (t === 'message') listeners.push(f);
    },
    postMessage: (m) => toMain.push(m),
    location: { origin: 'https://music.youtube.com' },
    document: { documentElement: {} },
  };
  globalThis.__FADEWISE_VERIFY__ = verify;

  try {
    startBridge({
      win: win as unknown as BridgeDeps['win'],
      chrome: asChrome(b.c),
      startAutoContinue: (o: AutoContinueOptions) => {
        watcher.isEnabled = o.isEnabled;

        return {} as AutoContinue;
      },
    });
  } finally {
    delete globalThis.__FADEWISE_VERIFY__;
  }

  const fromMain = (type: string, data: unknown) => {
    for (const f of listeners) f({ source: win, data: { fadewise: 'main', type, data } });
  };

  return { b, toMain, fromMain, watcher };
}

test('bridge: snapshots are forwarded only when saving is allowed; page settings carry saveAnalysis', async () => {
  const none = runBridge();
  await flush();
  await flush();
  none.fromMain('snapshot', { videoId: 'eeeeeeeeeee' });
  assert.strictEqual(none.b.sent.length, 0);
  const sent = none.toMain.filter((m) => m.type === 'settings').pop();
  assert.strictEqual(sent?.data.saveAnalysis, false);

  const ok = { decision: 'granted', version: S.CONSENT_VERSION, at: 1 };
  const yes = runBridge({ consent: ok });
  await flush();
  await flush();
  yes.fromMain('snapshot', { videoId: 'eeeeeeeeeee' });
  assert.strictEqual(yes.b.sent.length, 1);

  const off = runBridge({ consent: ok, settings: { analysisEnabled: false } });
  await flush();
  await flush();
  off.fromMain('snapshot', { videoId: 'eeeeeeeeeee' });
  assert.strictEqual(off.b.sent.length, 0);

  const old = runBridge({ consent: V2 });
  await flush();
  await flush();
  old.fromMain('snapshot', { videoId: 'eeeeeeeeeee' });
  assert.strictEqual(old.b.sent.length, 0, 'an answer to version 2 does not let the page save');
});

test('bridge: auto-continue watcher is disabled unless the user turned it on', async () => {
  const fresh = runBridge();
  await flush();
  await flush();
  assert.strictEqual(fresh.watcher.isEnabled?.(), false);
  const old = runBridge({ settings: { gainEnabled: true } });
  await flush();
  await flush();
  assert.strictEqual(old.watcher.isEnabled?.(), false);
  const on = runBridge({ settings: { autoContinue: true } });
  await flush();
  await flush();
  assert.strictEqual(on.watcher.isEnabled?.(), true);
});

test('bridge: the diagnostic log is written only by the verification build', async () => {
  const prod = runBridge();
  prod.fromMain('diag', { kind: 'gain' });
  await flush();
  await flush();
  await flush();
  assert.strictEqual(prod.b.c.storage.session.data.diag, undefined);
  const verify = runBridge({}, { verify: true });
  verify.fromMain('diag', { kind: 'gain' });
  await flush();
  await flush();
  await flush();
  assert.strictEqual((verify.b.c.storage.session.data.diag as unknown[]).length, 1);
});

const WELCOME = readFileSync(new URL('../entrypoints/welcome.html', import.meta.url), 'utf8');

function welcomeText(lang: I.Lang): string {
  const doc = new JSDOM(WELCOME).window.document;
  I.setLang(lang);
  I.applyI18n(doc);

  return doc.body.textContent;
}

test('welcome page (ja): what is stored, the mix-point candidates, and the overlap held only in memory', () => {
  const text = welcomeText('ja');
  for (const s of [
    '保存する情報',
    '曲の ID（YouTube の videoId）',
    '曲をつなぐ位置の候補（次の曲へ移る位置と曲に入る位置の秒、種類、信頼度、その前後の音量、最後まで通して聴いた回数）',
    '曲を重ねてつなぐ（実験的、初期設定はオフ）',
    '曲の終わりで再生速度を一時的に変え',
    '最大 10 秒分の音声をメモリに置いて',
    '保存も送信もしません',
    '外部には送信しません。音声は保存しません。',
    '同意して解析を始める',
    '同意しない',
  ])
    assert.ok(text.includes(s), s);
});

test('welcome page (en): what is stored, the mix-point candidates, and the overlap held only in memory', () => {
  const text = welcomeText('en');
  for (const s of [
    'What is stored',
    'Track ID (YouTube video ID)',
    'Candidate points for joining tracks (seconds where a track can be left for the next one and where it can be entered',
    'Overlap tracks (experimental, off by default)',
    'the playback speed is changed for a moment at the end of a track',
    'up to 10 seconds of audio played ahead are held in memory',
    'it is neither stored nor sent',
    'Nothing is sent anywhere. Audio is never stored.',
    'Agree and start analyzing',
    "Don't agree",
  ])
    assert.ok(text.includes(s), s);
});

import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as I from '../ui/i18n.mts';
import * as T from '../content/toast.mts';
import * as Q from '../page/queue-badges.mts';
import * as S from '../shared/settings.mts';
import * as R from '../shared/reorder.mts';

const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const settle = (ms = 0) => new Promise((r) => setTimeout(r, ms));
type Win = Window & typeof globalThis;

test('toast text: only runs that moved tracks; ja / en', () => {
  I.setLang('ja');
  assert.strictEqual(T.runToastText({ result: 'done', moved: 2 }), 'Fadewise：2 曲を並べ替えました');
  assert.strictEqual(
    T.runToastText({ result: 'partial', moved: 1, planned: 3 }),
    'Fadewise：3 曲中 1 曲を並べ替えました',
  );
  assert.strictEqual(T.runToastText({ result: 'skipped', moved: 0 }), null);
  assert.strictEqual(T.runToastText({ result: 'aborted', moved: 0 }), null);
  assert.strictEqual(T.runToastText(null), null);
  I.setLang('en');
  assert.strictEqual(T.runToastText({ result: 'done', moved: 3 }), 'Fadewise: reordered 3 tracks');
  assert.strictEqual(T.runToastText({ result: 'partial', moved: 1, planned: 3 }), 'Fadewise: reordered 1 of 3 tracks');
});

function toastEnv(settings: unknown, uiLanguage = 'ja') {
  const dom = new JSDOM('<body><div id="page">page</div></body>', {
    url: 'https://music.youtube.com/watch?v=x',
    pretendToBeVisual: true,
  });
  const win = dom.window as unknown as Win;
  // toastify-js is UMD and reads the global document / window.
  const src = read('node_modules/toastify-js/src/toastify.js');
  const make = new win.Function(
    'module',
    'document',
    'window',
    'HTMLElement',
    'ShadowRoot',
    src + '\nreturn module.exports;',
  ) as (...a: unknown[]) => T.ToastifyFn;
  const Toastify = make({ exports: {} }, win.document, win, win.HTMLElement, win.ShadowRoot);
  const store = { settings };
  const chrome = {
    storage: { local: { get: () => Promise.resolve(store) } },
    i18n: { getUILanguage: () => uiLanguage },
  } as unknown as T.ToastDeps['chrome'];
  const toaster = T.startReorderToasts({
    win,
    chrome,
    Toastify,
    css: '.toastify{}',
    sanitizeRun: R.sanitizeRun,
    withDefaults: S.withDefaults,
  });
  const post = (run: unknown) =>
    win.dispatchEvent(
      new win.MessageEvent('message', { data: { fadewise: 'main', type: 'reorderRun', data: run }, source: win }),
    );

  return { win, toaster, post, store };
}

// Toastify writes innerText; jsdom keeps it as a plain property.
const textOf = (e: Element | null | undefined) => (e as HTMLElement | null)?.innerText;

test('toast: a reorder run shows one toast inside a closed shadow root, not in the page DOM; a newer replaces it', async () => {
  const { win, toaster, post } = toastEnv({ uiLanguage: 'en' });
  post({ at: Date.now(), kind: 'radio', result: 'done', moved: 2, planned: 2 });
  await settle(10);
  const host = win.document.querySelector('fadewise-toast');
  assert.ok(host, 'host element');
  assert.strictEqual(host.shadowRoot, null, 'closed shadow root');
  assert.strictEqual(win.document.querySelectorAll('.toastify').length, 0, 'nothing in the page DOM');
  const root = toaster.root()!;
  assert.strictEqual(textOf(root.querySelector('.toastify.fw')), 'Fadewise: reordered 2 tracks');
  assert.match(root.querySelector('style')!.textContent, /pointer-events: none/);
  post({ at: Date.now(), kind: 'radio', result: 'done', moved: 3, planned: 3 });
  await settle(10);
  assert.ok(textOf(root.querySelector('.toastify.fw.on'))!.includes('3'));
  post({ at: Date.now(), kind: 'radio', result: 'skipped', reason: 'same', moved: 0 });
  await settle(10);
  assert.ok(
    ![...root.querySelectorAll('.toastify.on')].some((e) => / 0 /.test(textOf(e) ?? '')),
    'nothing moved = no toast',
  );
});

test('toast: the language follows the setting, then the browser', async () => {
  const ja = toastEnv({}, 'ja');
  ja.post({ at: Date.now(), kind: 'radio', result: 'done', moved: 2, planned: 2 });
  await settle(10);
  assert.strictEqual(textOf(ja.toaster.root()!.querySelector('.toastify.fw')), 'Fadewise：2 曲を並べ替えました');
  const en = toastEnv({ uiLanguage: 'en' }, 'ja');
  en.post({ at: Date.now(), kind: 'radio', result: 'done', moved: 2, planned: 2 });
  await settle(10);
  assert.strictEqual(textOf(en.toaster.root()!.querySelector('.toastify.fw')), 'Fadewise: reordered 2 tracks');
});

test('toast: off in settings = no toast; untrusted shapes are sanitised first; markup is not interpreted', async () => {
  const off = toastEnv({ reorderToast: false });
  off.post({ at: Date.now(), result: 'done', moved: 2 });
  await settle(10);
  assert.strictEqual(off.win.document.querySelector('fadewise-toast'), null);
  const on = toastEnv({});
  assert.strictEqual(S.withDefaults({}).reorderToast, true, 'on by default');
  on.post({ at: 'x', result: 'done', moved: 2 });
  on.post({ at: Date.now(), result: '<img src=x onerror=alert(1)>', moved: 2 });
  await settle(10);
  assert.strictEqual(on.win.document.querySelector('fadewise-toast'), null, 'invalid at / result code: dropped');
});

interface Row {
  vid: string;
  wrapped?: boolean;
  broken?: boolean;
}
const ROW_HTML =
  '<div class="song-info"><yt-formatted-string class="song-title">T</yt-formatted-string><div class="byline-wrapper"><div></div><yt-formatted-string class="byline">Artist</yt-formatted-string></div></div><yt-formatted-string class="duration">3:30</yt-formatted-string>';

function queueDom(rows: Row[]): Win {
  const dom = new JSDOM(
    '<ytmusic-app-layout><ytmusic-player-queue><div id="contents"></div></ytmusic-player-queue></ytmusic-app-layout>',
    { url: 'https://music.youtube.com/watch?v=x', pretendToBeVisual: true },
  );
  const doc = dom.window.document;
  const contents = doc.getElementById('contents')!;

  for (const r of rows) {
    const row = doc.createElement('ytmusic-player-queue-item') as HTMLElement & { data?: unknown };
    row.data = r.wrapped
      ? { playlistPanelVideoWrapperRenderer: { primaryRenderer: { playlistPanelVideoRenderer: { videoId: r.vid } } } }
      : { videoId: r.vid };
    row.innerHTML = r.broken ? '<div class="song-info"></div>' : ROW_HTML;
    contents.append(row);
  }

  return dom.window as unknown as Win;
}

const send = (win: Win, type: string, data: unknown) =>
  win.dispatchEvent(new win.MessageEvent('message', { data: { fadewise: 'bridge', type, data }, source: win }));
const badgeOf = (row: Element) => row.querySelector<HTMLElement>('fadewise-badge');

const spanText = (row: Element) => {
  const h = badgeOf(row);

  return h ? h.shadowRoot!.querySelector('span')!.textContent : null;
};

test('badge parts: rounded BPM, Camelot key, provisional below 0.5; nothing without numbers', () => {
  I.setLang('en');
  assert.deepStrictEqual(Q.badgeParts({ bpm: 119.6, bc: 0.8, cam: '8A', kc: 0.7 }), [
    { text: '120 BPM', low: false },
    { text: '8A', low: false },
  ]);
  assert.deepStrictEqual(Q.badgeParts({ bpm: 90, bc: 0.3, cam: null, kc: 0 }), [{ text: '90 BPM', low: true }]);
  assert.deepStrictEqual(Q.badgeParts({ bpm: null, cam: '12B', kc: 0.2 }), [{ text: '12B', low: true }]);
  assert.strictEqual(Q.badgeParts({ bpm: null, cam: 'x' }), null);
  assert.strictEqual(Q.badgeParts(null), null);
  assert.deepStrictEqual(Q.fromEntry({ tk: { bpm: 128, bc: 0.9, cam: '5B', kc: 0.6 } }), {
    bpm: 128,
    bc: 0.9,
    cam: '5B',
    kc: 0.6,
  });
  assert.deepStrictEqual(
    Q.fromRecord({ tempoKey: { tempo: { bpm: 100, confidence: 0.4 }, key: { camelot: '3A', confidence: 0.9 } } }),
    { bpm: 100, bc: 0.4, cam: '3A', kc: 0.9 },
  );
});

test('badges: analysed rows get a badge after the artist line (own shadow root); others and broken rows are left alone', () => {
  const win = queueDom([{ vid: 'a' }, { vid: 'b' }, { vid: 'c', wrapped: true }, { vid: 'd', broken: true }]);
  const b = Q.createBadges(win, { periodMs: 1e9 });
  send(win, 'settings', { queueBadges: true, uiLanguage: 'ja' });
  send(win, 'index', {
    a: { tempoKey: { tempo: { bpm: 120, confidence: 0.86 }, key: { camelot: '8A', confidence: 0.74 } } },
    c: { tempoKey: { tempo: { bpm: 72.5, confidence: 0.38 }, key: null } },
    d: { tempoKey: { tempo: { bpm: 100, confidence: 0.9 } } },
  });
  const rows = [...win.document.querySelectorAll('ytmusic-player-queue-item')];
  assert.strictEqual(spanText(rows[0]), '120 BPM・8A');
  assert.strictEqual(rows[0].querySelector('.byline-wrapper')!.lastElementChild!.tagName, 'FADEWISE-BADGE');
  assert.strictEqual(badgeOf(rows[1]), null, 'not analysed');
  assert.strictEqual(spanText(rows[2]), '73 BPM');
  assert.ok(badgeOf(rows[2])!.shadowRoot!.querySelector('.low'), 'provisional style');
  assert.strictEqual(badgeOf(rows[2])!.title, 'Fadewise：信頼度が低い推定（暫定）');
  assert.strictEqual(badgeOf(rows[3]), null, 'row without byline-wrapper untouched');
  assert.strictEqual(rows[3].innerHTML, '<div class="song-info"></div>');
  send(win, 'indexEntry', { vid: 'b', entry: { tk: { bpm: 140, bc: 0.79, cam: '9A', kc: 0.68 } } });
  assert.strictEqual(spanText(rows[1]), '140 BPM・9A');
  const host = badgeOf(rows[0]);
  b.refresh();
  assert.strictEqual(badgeOf(rows[0]), host);
  assert.strictEqual(win.document.querySelectorAll('fadewise-badge').length, 3);
  send(win, 'settings', { queueBadges: true, uiLanguage: 'en' });
  assert.strictEqual(spanText(rows[0]), '120 BPM · 8A');
  assert.strictEqual(badgeOf(rows[2])!.title, 'Fadewise: low-confidence estimate (provisional)');
  send(win, 'settings', { queueBadges: false });
  assert.strictEqual(win.document.querySelectorAll('fadewise-badge').length, 0);
  assert.strictEqual(rows[0].querySelector('.byline')!.textContent, 'Artist');
  send(win, 'detached', null);
  send(win, 'settings', { queueBadges: true });
  assert.strictEqual(win.document.querySelectorAll('fadewise-badge').length, 0, 'stopped after detach');
  assert.strictEqual(S.withDefaults({}).queueBadges, true, 'on by default');
});

test('wiring: the badge script loads before the player script; the toast runs in the ISOLATED bridge; settings switch in the popup', () => {
  const player = read('entrypoints/player.content.ts');
  const badges = player.indexOf("import '../page/queue-badges-start.mts'");
  assert.ok(badges >= 0 && badges < player.indexOf("import '../page/player-start.mts'"));
  assert.match(read('entrypoints/bridge.content.ts'), /toast-start/);
  const popup = read('entrypoints/popup.html');
  assert.match(popup, /id="reorderToast"/);
  assert.match(popup, /id="queueBadges"/);

  for (const f of ['content/toast.mts', 'page/queue-badges.mts']) {
    assert.ok(!/import[^;]*reorder-page/.test(read(f)), f);
  }
});

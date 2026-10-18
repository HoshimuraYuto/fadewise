import test from 'node:test';
import assert from 'node:assert';
import { JSDOM, type DOMWindow } from 'jsdom';
import * as M from '../shared/seekbar-marks.mts';
import * as S from '../shared/settings.mts';
import * as C from '../content/seekbar-marks.mts';
import { fade } from './helpers/seekbar-status.mts';

type Json = Record<string, unknown>;
type Box = { left: number; top: number; width: number; height: number };
type ChangeListener = (changes: Record<string, { newValue: unknown }>, area: string) => void;

const PLAYER_BAR_HTML =
  '<ytmusic-player-bar><div id="progress-bar"><div id="sliderBar"><div id="progressContainer"></div></div></div></ytmusic-player-bar>';

// YTM's newer layout: no ytmusic-player-bar; the seek bar is a 3 px range input in ytmusic-miniplayer
const MINI_HTML =
  '<ytmusic-miniplayer><div class="ytMusicMiniPlayerProgressBarWrapper"><input type="range" class="ytMusicMiniPlayerProgressBar"></div></ytmusic-miniplayer>';

const opened: DOMWindow[] = [];
test.after(() => {
  for (const w of opened) w.close();
});

function boxOf(el: Element | null, b: Box | null) {
  if (el)
    el.getBoundingClientRect = () =>
      (b
        ? Object.assign({ right: b.left + b.width, bottom: b.top + b.height }, b)
        : { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }) as DOMRect;
}

function page({ bar = true } = {}) {
  const html = bar ? PLAYER_BAR_HTML + '<div id="movie_player"></div>' : '<div id="movie_player"></div>';
  const dom = new JSDOM(`<body>${html}</body>`, {
    url: 'https://music.youtube.com/watch?v=v1',
    pretendToBeVisual: true,
  });
  const win = dom.window;
  opened.push(win);
  boxOf(win.document.querySelector('#sliderBar'), { left: 100, top: 685, width: 800, height: 32 });
  boxOf(win.document.querySelector('#progressContainer'), { left: 100, top: 700, width: 800, height: 2 });

  return win;
}

function wired(win: DOMWindow, settings: Json) {
  const store = { settings };
  const listeners: ChangeListener[] = [];
  const chrome = {
    storage: {
      local: { get: () => Promise.resolve(store) },
      onChanged: { addListener: (f: ChangeListener) => listeners.push(f) },
    },
    i18n: { getUILanguage: () => 'ja' },
  };
  const ov = C.startSeekbarMarks({
    win: win as unknown as Window,
    chrome: chrome as unknown as C.SeekbarDeps['chrome'],
    withDefaults: S.withDefaults,
  });
  const status = (st: Json) =>
    win.dispatchEvent(
      new win.MessageEvent('message', {
        data: { fadewise: 'main', type: 'status', data: st },
        source: win as unknown as MessageEventSource,
      }),
    );

  const setSettings = (s: Json) => {
    listeners.forEach((f) => {
      f({ settings: { newValue: s } }, 'local');
    });
  };

  return { ov, status, setSettings };
}

const settle = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const playing = (over?: Json) => Object.assign({ videoId: 'v1', ad: false, fade: fade() }, over || {});

test('mix points: the overlay draws mix bands striped, aggressive ones dashed, and the entry point', () => {
  const win = page();
  const ov = C.createSeekbarOverlay(win.document);
  const m = M.seekbarMarks(
    fade({
      transition: Object.assign(fade().transition, {
        atSec: 160,
        mix: {
          mode: 'aggressive',
          x: { k: 'chorusEnd', t: 160, c: 0.84 },
          n: { k: 'thin', t: 12, c: 0.9 },
          exit: true,
          entry: true,
          lastSoundSec: 198,
        },
        incoming: {
          fadeIn: true,
          fadeInSec: 0.3,
          headTrimTo: 12,
          headReason: 'mix_thin',
          cancel: null,
          mix: { k: 'thin', t: 12, c: 0.9 },
        },
      }),
    }),
  );
  assert.equal(ov.update(m), true);
  const cls = [...ov.layer()!.children].map((e) => e.className);
  assert.ok(cls.includes('it headSkip mix'), cls.join('|'));
  assert.ok(cls.includes('it tailSkip mix aggr'), cls.join('|'));
  assert.ok(cls.includes('pt next aggr') && cls.includes('pt entry'), cls.join('|'));
  ov.unmount();
});

test('overlay: drawn over the bar, pointer-events none, hover text from the bar, not inside the bar', async () => {
  const win = page();
  const w = wired(win, {});
  await settle();
  w.status(playing());
  await settle();
  const lay = w.ov.layer();
  assert.ok(lay && !lay.hidden);
  assert.equal(
    win.document.querySelector('#progress-bar')!.querySelector('fadewise-seekbar'),
    null,
    'not inside the slider',
  );
  assert.match(w.ov.host()!.style.cssText, /pointer-events: none/);
  assert.equal(lay.style.left, '100px');
  assert.equal(lay.style.width, '800px');
  assert.equal(lay.style.height, '7px', 'the line (2 px, at least 3) + 4 px, not the 32 px hit area');
  assert.equal(lay.style.top, '697.5px');
  const fo = lay.querySelector<HTMLElement>('[data-kind="fadeOut"]');
  assert.equal(fo!.style.left, (194.8 / 200) * 100 + '%');
  assert.equal(lay.querySelectorAll('[data-kind]').length, 5);
  const css = w.ov.host() && [...lay.parentNode!.querySelectorAll('style')].map((s) => s.textContent).join('');
  assert.match(css!, /\.lay \{[^}]*pointer-events: none/);
  assert.match(css!, /\.tip \{[^}]*pointer-events: none/);
  const x = 100 + (196 / 200) * 800;
  win.document
    .querySelector('#progress-bar')!
    .dispatchEvent(new win.MouseEvent('mousemove', { clientX: x, bubbles: true }));
  const tip = w.ov.tipEl();
  assert.equal(tip!.hidden, false);
  assert.match(tip!.textContent, /フェードアウト 3\.2秒/);
  win.document.querySelector('#progress-bar')!.dispatchEvent(new win.MouseEvent('mouseleave', {}));
  assert.equal(tip!.hidden, true);
});

test('overlay: hidden for ads, another track, setting off; updates on a new plan; nothing without the bar', async () => {
  const win = page();
  const w = wired(win, {});
  await settle();
  w.status(playing());
  await settle();
  const lay = w.ov.layer();
  const first = lay!.firstChild;
  w.status(playing());
  await settle();
  assert.equal(lay!.firstChild, first, 'same model: not redrawn');
  w.status(playing({ ad: true, videoId: null }));
  await settle();
  assert.equal(lay!.hidden, true, 'ad');
  w.status(playing());
  await settle();
  assert.equal(lay!.hidden, false);
  win.document.getElementById('movie_player')!.classList.add('ad-showing');
  w.status(playing());
  await settle();
  assert.equal(lay!.hidden, true, 'ad class on the player');
  win.document.getElementById('movie_player')!.classList.remove('ad-showing');
  w.status(playing({ videoId: 'v2' }));
  await settle();
  assert.equal(lay!.hidden, true, 'plan of the previous track');
  w.status(
    playing({ fade: fade({ fadeOutStart: 190, marks: Object.assign({}, fade().marks, { outResult: 'cancelled' }) }) }),
  );
  await settle();
  assert.equal(lay!.hidden, false);
  assert.equal(lay!.querySelector<HTMLElement>('[data-kind="fadeOut"]')!.dataset.state, 'cancelled');
  w.setSettings({ seekbarMarks: false });
  await settle();
  assert.equal(win.document.querySelector('fadewise-seekbar'), null, 'off: removed');
  w.setSettings({});
  await settle();
  assert.ok(win.document.querySelector('fadewise-seekbar'), 'default on');

  const nb = page({ bar: false });
  const w2 = wired(nb, {});
  await settle();
  w2.status(playing());
  await settle();
  const l2 = w2.ov.layer();
  assert.ok(!l2 || l2.hidden, 'no bar: nothing shown');
});

test('overlay: miniplayer layout — drawn over its range input, hover text from its wrapper', async () => {
  const win = page({ bar: false });
  win.document.body.insertAdjacentHTML('beforeend', MINI_HTML);
  boxOf(win.document.querySelector('ytmusic-miniplayer input'), { left: 0, top: 404, width: 756, height: 3 });
  const w = wired(win, {});
  await settle();
  w.status(playing());
  await settle();
  const lay = w.ov.layer()!;
  assert.equal(lay.hidden, false);
  assert.deepEqual(
    [lay.style.left, lay.style.width, lay.style.height, lay.style.top],
    ['0px', '756px', '7px', '402px'],
    'the 3 px line + 4 px, centred on it',
  );
  const wrap = win.document.querySelector('ytmusic-miniplayer [class*="ProgressBarWrapper"]')!;
  wrap.dispatchEvent(new win.MouseEvent('mousemove', { clientX: (196 / 200) * 756, bubbles: true }));
  assert.equal(w.ov.tipEl()!.hidden, false);
  assert.match(w.ov.tipEl()!.textContent, /フェードアウト 3\.2秒/);
});

test('overlay: follows a switch between the player bar and the miniplayer (window width) on relayout', async () => {
  const win = page();
  win.document.body.insertAdjacentHTML('beforeend', MINI_HTML);
  const input = win.document.querySelector('ytmusic-miniplayer input');
  boxOf(input, null);
  const w = wired(win, {});
  await settle();
  w.status(playing());
  await settle();
  const lay = w.ov.layer()!;
  assert.deepEqual([lay.hidden, lay.style.left, lay.style.width], [false, '100px', '800px'], 'player bar');
  win.document.querySelector('ytmusic-player-bar')!.remove();
  boxOf(input, { left: 0, top: 404, width: 756, height: 3 });
  w.ov.relayout();
  assert.deepEqual([lay.hidden, lay.style.left, lay.style.width, lay.style.top], [false, '0px', '756px', '402px']);
  win.document.body.insertAdjacentHTML('beforeend', PLAYER_BAR_HTML);
  boxOf(win.document.querySelector('#sliderBar'), { left: 100, top: 685, width: 800, height: 32 });
  boxOf(win.document.querySelector('#progressContainer'), { left: 100, top: 700, width: 800, height: 2 });
  boxOf(input, null);
  w.ov.relayout();
  assert.deepEqual([lay.hidden, lay.style.left, lay.style.width, lay.style.top], [false, '100px', '800px', '697.5px']);
  boxOf(win.document.querySelector('#sliderBar'), null);
  boxOf(win.document.querySelector('#progressContainer'), null);
  w.ov.relayout();
  assert.equal(lay.hidden, true);
  boxOf(input, { left: 0, top: 404, width: 756, height: 3 });
  w.ov.relayout();
  assert.equal(lay.hidden, false);
});

test('overlay: detached extension removes it', async () => {
  const win = page();
  const w = wired(win, {});
  await settle();
  w.status(playing());
  await settle();
  win.dispatchEvent(
    new win.MessageEvent('message', {
      data: { fadewise: 'bridge', type: 'detached', data: null },
      source: win as unknown as MessageEventSource,
    }),
  );
  await settle();
  assert.equal(win.document.querySelector('fadewise-seekbar'), null);
  w.status(playing());
  await settle();
  assert.equal(win.document.querySelector('fadewise-seekbar'), null);
});

import test from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import { startAutoContinue } from '../content/auto-continue.mts';

const tick = () => new Promise((r) => setTimeout(r, 0));

// Shape follows the YTM DOM used by FelipheMP/ytmusic-autocontinue and BetterYTM.
const DIALOG_HTML = `
  <tp-yt-paper-dialog>
    <ytmusic-you-there-renderer>
      <div class="text">視聴を続けますか？</div>
      <div class="actions"><yt-button-renderer id="confirm-button"><button>はい</button></yt-button-renderer></div>
    </ytmusic-you-there-renderer>
  </tp-yt-paper-dialog>`;

function setup(enabled = { v: true }) {
  const dom = new JSDOM(
    '<!doctype html><html><body><ytmusic-app></ytmusic-app><ytmusic-popup-container></ytmusic-popup-container></body></html>',
  );
  const { document } = dom.window;
  const answered: any[] = [];
  const watcher = startAutoContinue({
    doc: document,
    win: dom.window as any,
    isEnabled: () => enabled.v,
    onAnswered: (i) => answered.push(i),
  });

  return { dom, document, answered, watcher, enabled };
}

test('answers a dialog already present when the watcher starts, records time and text', () => {
  const dom = new JSDOM(
    `<!doctype html><html><body><ytmusic-popup-container>${DIALOG_HTML}</ytmusic-popup-container></body></html>`,
  );
  let clicks = 0;
  dom.window.document.querySelector('button')!.addEventListener('click', () => clicks++);
  const answered: any[] = [];
  const w = startAutoContinue({
    doc: dom.window.document,
    win: dom.window as any,
    onAnswered: (i) => answered.push(i),
  });
  assert.strictEqual(clicks, 1);
  assert.match(answered[0].text, /視聴を続けますか/);
  assert.strictEqual(typeof answered[0].at, 'number');
  w.stop();
});

test('observer reacts to insertion without manual checks', async () => {
  const { document, answered, watcher } = setup();
  const tpl = document.createElement('div');
  tpl.innerHTML = DIALOG_HTML;
  let clicks = 0;
  tpl.querySelector('button')!.addEventListener('click', () => clicks++);
  document.querySelector('ytmusic-popup-container')!.append(...tpl.childNodes);
  await tick();
  assert.strictEqual(clicks, 1);
  assert.strictEqual(answered.length, 1);
  watcher.stop();
});

test('answers the same dialog again after it was hidden and re-shown (reused element)', async () => {
  const { document, answered, watcher } = setup();
  document.querySelector('ytmusic-popup-container')!.innerHTML = DIALOG_HTML;
  await tick();
  const dlg = document.querySelector('tp-yt-paper-dialog');
  dlg!.setAttribute('aria-hidden', 'true');
  await tick();
  dlg!.removeAttribute('aria-hidden');
  await tick();
  assert.strictEqual(answered.length, 2);
  watcher.stop();
});

test('does nothing when disabled or when the dialog is hidden', async () => {
  const s = setup({ v: false });
  s.document.querySelector('ytmusic-popup-container')!.innerHTML = DIALOG_HTML;
  await tick();
  assert.strictEqual(s.answered.length, 0);
  s.watcher.stop();

  const h = setup();
  h.document.querySelector('ytmusic-popup-container')!.innerHTML = DIALOG_HTML.replace(
    '<tp-yt-paper-dialog>',
    '<tp-yt-paper-dialog aria-hidden="true">',
  );
  await tick();
  assert.strictEqual(h.answered.length, 0);
  h.watcher.stop();
});

test('ignores unrelated dialogs', async () => {
  const { document, answered, watcher } = setup();
  document.querySelector('ytmusic-popup-container')!.innerHTML =
    '<tp-yt-paper-dialog><yt-confirm-dialog-renderer><button>OK</button></yt-confirm-dialog-renderer></tp-yt-paper-dialog>';
  await tick();
  assert.strictEqual(answered.length, 0);
  watcher.stop();
});

test('a throwing callback does not escape into the page', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const w = startAutoContinue({
    doc: dom.window.document,
    win: dom.window as any,
    onAnswered: () => {
      throw new Error('boom');
    },
  });
  dom.window.document.body.innerHTML = DIALOG_HTML;
  await tick();
  w.stop();
});

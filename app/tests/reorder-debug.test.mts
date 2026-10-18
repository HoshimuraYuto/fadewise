import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import * as R from '../shared/reorder.mts';
import * as S from '../shared/settings.mts';
import * as RP from '../page/reorder-page.mts';
import * as D from '../content/reorder-debug.mts';
import * as I from '../ui/i18n.mts';
import { createQueueSim, tk, type QueueSim, type QueueSimOptions, type SimTrack } from './helpers/queue-sim.mts';

const TRACKS: Record<string, SimTrack> = {
  cur: { tk: tk(120, '8A') },
  a: { tk: tk(150, '2B') },
  b: { tk: tk(95, '4B') },
  c: { tk: tk(121, '9A') },
  d: { tk: tk(122, '10A') },
  e: {},
  f: { tk: tk(120, '8B') },
  g: { tk: tk(140, '5A') },
  h: { tk: tk(119, '7A') },
};
const IDS = ['cur', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const mk = (over?: Partial<QueueSimOptions>) =>
  createQueueSim(Object.assign({ ids: IDS.slice(), tracks: TRACKS, timing: {} }, over));
const lastRun = (sim: QueueSim) => sim.runs[sim.runs.length - 1] as RP.RunRecord | undefined;

function during(sim: QueueSim, n: number, fn: (vid: string) => void) {
  let k = 0;
  const orig = sim.qdom.drag;
  sim.qdom.drag = async (vid, to, stop) =>
    orig(vid, to, () => {
      if (++k === n) fn(vid);

      return stop();
    });
}

async function runOnce(sim: QueueSim) {
  await sim.run(7.5);
  await sim.settle();

  return lastRun(sim);
}

const find = (sim: QueueSim, ev: string) => sim.debug.find((v) => v.ev === ev);

test('debug input: moves, clicks and releases neither postpone the start nor stop a run', async () => {
  const sim = mk();
  let x = 0;
  await sim.run(7.5, (s) => {
    x += 5;
    s.trusted('pointermove', { screenX: x, screenY: 300, clientX: x, clientY: 300 });
    s.trusted('mouseover', {});
  });
  await sim.settle();
  assert.equal(lastRun(sim)?.result, 'done', JSON.stringify(sim.ro.status()));
});

test('debug input: no input line is shown during a run, synthetic or trusted', async () => {
  const sim = mk();
  during(sim, 2, () => {
    sim.trusted('pointerdown');
    sim.trusted('keydown');
  });
  await runOnce(sim);
  assert.equal(lastRun(sim)?.result, 'done');
  assert.equal(sim.debug.filter((v) => v.ev === 'input').length, 0);
});

test('debug input: the input line before the start carries its coordinates', async () => {
  const sim = mk();
  await sim.run(4.5);
  sim.trusted('pointerdown', { clientX: 123, clientY: 456 });
  const v = find(sim, 'input')!;
  assert.deepEqual([v.type, v.x, v.y], ['pointerdown', 123, 456]);
});

test('debug page reorder: a change between runs is shown with positions and whether YTM showed a notice', async () => {
  for (const toast of [false, true]) {
    const sim = mk();
    await runOnce(sim);
    sim.pageSwap(null, { toast, toastMs: 1000 });
    await sim.run(0.3);
    const ev = find(sim, 'queue_ext');
    assert.ok(ev, JSON.stringify(sim.debug.map((v) => v.ev)));
    assert.equal(ev.by, 'page');
    assert.equal(ev.toast, toast);
    assert.ok(
      (ev.pos as number[]).every((p) => p >= 1),
      JSON.stringify(ev),
    );
    assert.equal(sim.ro.status().userMoved, 0, "the page's order is not a user move");
  }
});

test("debug page reorder: the user's own drag is told apart from the page's change", async () => {
  const sim = mk();
  await runOnce(sim);
  await sim.run(1.5);
  sim.userMove('h', sim.sel + 1);
  await sim.run(0.3);
  assert.equal(find(sim, 'queue_ext')?.by, 'user');
});

test('debug page reorder: mid-drag, the run stops (queue_changed), waits for the queue to settle and plans again on the same track', async () => {
  const sim = mk();
  let once = false;
  during(sim, 2, (vid) => {
    if (!once) {
      once = true;
      sim.pageSwap(vid);
    }
  });
  await sim.run(7.5);
  await sim.settle();
  assert.equal(sim.runs[0].reason, 'queue_changed', JSON.stringify(sim.runs[0]));
  assert.equal(sim.ro.status().state, 'waiting');
  assert.equal(sim.ro.status().wait, 'queue_changed');
  await sim.run(3);
  assert.equal(sim.runs.length, 1);
  await sim.run(2);
  await sim.settle();
  assert.equal(lastRun(sim)?.result, 'done', JSON.stringify(sim.runs));
  assert.ok(sim.debug.some((v) => v.ev === 'retry' && v.why === 'queue_changed'));
  assert.equal(sim.ids()[sim.sel], 'cur');
  assert.deepEqual(sim.store, sim.ids());
});

test('debug page reorder: between two moves, the run stops as queue_changed (not "order")', async () => {
  const sim = mk();
  let k = 0;
  const orig = sim.qdom.drag;

  sim.qdom.drag = async (...a) => {
    const r = await orig(...a);
    if (++k === 1) sim.pageSwap(null);

    return r;
  };

  await sim.run(7.5);
  await sim.settle();
  assert.equal(sim.runs[0].reason, 'queue_changed', JSON.stringify(sim.runs[0]));
});

test('debug page reorder: a page that keeps changing the queue wins; the track is left alone after PAGE_RETRIES', async () => {
  const sim = mk();
  const orig = sim.qdom.drag;

  sim.qdom.drag = async (vid, to, stop) => {
    let k = 0;

    return orig(vid, to, () => {
      if (++k === 2) sim.pageSwap(vid);

      return stop();
    });
  };

  await sim.run(40);
  await sim.settle();
  const reasons = sim.runs.map((r) => r.reason);
  assert.deepEqual(reasons, ['queue_changed', 'queue_changed', 'queue_changed', 'contested'], JSON.stringify(reasons));
  assert.equal(sim.runs.length, 4, 'nothing more on this track');
  assert.equal(sim.ro.status().state, 'done');
  assert.ok(sim.debug.some((v) => v.ev === 'contest'));
});

test('debug page reorder: the page putting back what we moved makes us back off for this track (no tug of war)', async () => {
  const sim = mk();
  const start = sim.ids().slice();
  await runOnce(sim);
  assert.equal(lastRun(sim)?.result, 'done');
  sim.pageReorder(start.slice(1));
  await sim.run(0.3);
  await sim.run(20);
  await sim.settle();
  assert.ok(
    sim.debug.some((v) => v.ev === 'contest'),
    JSON.stringify(sim.debug.map((v) => v.ev)),
  );
  assert.deepEqual(sim.ids(), start, "YTM's order stays");
  assert.equal(sim.runs.filter((r) => r.result === 'done').length, 1);
});

test('debug page reorder: the stored reason codes keep contested; the labels name YouTube', () => {
  assert.equal(R.sanitizeRun({ at: 1, result: 'skipped', reason: 'contested' })?.reason, 'contested');
  I.setLang('ja');
  assert.match(I.t('roReason.queue_changed'), /YouTube/);
  assert.match(I.t('roReason.contested'), /YouTube/);
  I.setLang('en');
  assert.match(I.t('roReason.queue_changed'), /YouTube/);
});

const MANY = Array.from({ length: 30 }, (_, i) => `t${String(i).padStart(2, '0')}`);
const keys = ['8A', '3B', '10A', '5B', '8B', '1A', '9A', '12B', '7A', '4B', '11A', '6B'];
const MANY_TRACKS = Object.fromEntries(
  MANY.map((id, i) => [id, { tk: tk(90 + ((i * 37) % 70), keys[i % keys.length]) }]),
);
const extScrolls = (sim: QueueSim) =>
  sim.debug.filter((v) => v.ev === 'scroll' && v.src === 'ext') as (RP.DebugView & { from: number; to: number })[];

test('debug scroll: at most one scroll per move, never back and forth, and one jump back to where the user was', async () => {
  for (const start of [600, 300, 0]) {
    const sim = createQueueSim({ ids: MANY.slice(), tracks: MANY_TRACKS, timing: {} });
    sim.scroll = start;
    await runOnce(sim);
    await sim.run(1);
    const run = lastRun(sim)!;
    assert.ok(run.moved > 1, JSON.stringify(run));
    const sc = extScrolls(sim);
    const during = sc.filter((v) => v.why !== 'restore');
    const dirs = during.map((v) => Math.sign(v.to - v.from));
    assert.ok(during.length <= run.moved, `${start}: ${JSON.stringify(sc)}`);
    assert.ok(
      dirs.every((d) => d === dirs[0]),
      `${start}: one direction ${JSON.stringify(sc)}`,
    );
    assert.ok(sc.filter((v) => v.why === 'restore').length <= 1);
    assert.equal(sim.scroll, start, 'back where the user was');
    assert.ok(!sim.debug.some((v) => v.ev === 'scroll' && v.src !== 'ext'), 'nothing else scrolled');
  }
});

test('debug scroll: no scroll at all when the rows are already in view', async () => {
  const sim = mk();
  sim.scroll = 0;
  await runOnce(sim);
  await sim.run(1);
  assert.equal(lastRun(sim)?.result, 'done');
  assert.equal(extScrolls(sim).length, 0);
});

test("debug scroll: the page's own scroll is shown as YouTube's, not ours", async () => {
  const sim = mk();
  await sim.run(1);
  sim.scroll += 120;
  await sim.run(1);
  const sc = sim.debug.filter((v) => v.ev === 'scroll');
  assert.equal(sc.length, 1);
  assert.equal(sc[0].src, 'ytm');
});

test('debug view: no video id reaches the panel; keys and BPM do', async () => {
  const sim = mk();
  await runOnce(sim);
  sim.pageSwap(null);
  await sim.run(0.5);
  const text = JSON.stringify(sim.debug);
  for (const id of IDS) assert.ok(!new RegExp(`"${id}"`).test(text), id);
  const plan = find(sim, 'plan') as RP.DebugView & { from: string[]; to: string[]; moves: number };
  assert.ok(plan.to.includes('8B') || plan.from.includes('8B'), JSON.stringify(plan));
  assert.ok(plan.moves >= 1);
  assert.ok(sim.debug.some((v) => v.ev === 'drag' && v.phase === 'start'));
  assert.ok(sim.debug.some((v) => v.ev === 'drag' && v.phase === 'drop'));
});

test('debug view: the state with the wait reason and the seconds left', async () => {
  const sim = mk();
  await sim.run(1);
  const s = sim.ro.debugState();
  assert.equal(s.state, 'waiting');
  assert.equal(s.wait, 'settle');
  assert.ok(s.remain! > 3 && s.remain! <= 4.1, JSON.stringify(s));
  await sim.run(4);
  sim.trusted('keydown');
  await sim.run(1);
  const s2 = sim.ro.debugState();
  assert.equal(s2.wait, 'user_input', JSON.stringify(s2));
  assert.ok(s2.remain! > 0.5 && s2.remain! <= 1.1, JSON.stringify(s2));
});

test('debug panel: closed shadow root, at most 30 lines, minimise, copy as text', async () => {
  I.setLang('ja');
  const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
  const doc = dom.window.document;
  let copied: string | null = null;
  const p = D.createDebugPanel(doc, {
    clipboard: async (s: string) => {
      copied = s;
      await Promise.resolve();
    },
  });
  p.mount();
  assert.equal(doc.querySelectorAll('fadewise-debug').length, 1);
  assert.equal(p.host()!.shadowRoot, null, 'closed');
  for (let i = 0; i < 40; i++) p.add({ ev: 'scroll', src: 'ytm', from: i, to: i + 1, ms: 10, at: 1e12 + i * 1000 });
  p.add({ ev: 'queue_ext', by: 'page', n: 2, pos: [1, 3], toast: false, at: 1e12 + 50000 });
  p.setState({ state: 'waiting', wait: 'queue_changed', remain: 2.5, focus: true, pageRetries: 1 });
  assert.equal(p.lines().length, D.MAX_LINES);
  const text = p.text();
  assert.match(text, /キューが外から変わった（YouTube）: 2 曲、位置 \+1 \+3、YouTube の通知 なし/);
  assert.match(text, /あと 2\.5 秒/);
  assert.match(text, /\d\d:\d\d:\d\d\.\d /);
  assert.ok(await p.copy());
  assert.equal(copied, text);
  assert.equal(doc.body.textContent.includes('YouTube'), false, 'nothing in the page DOM outside the shadow root');
  p.unmount();
  assert.equal(doc.querySelectorAll('fadewise-debug').length, 0);
});

test('debug panel: every event kind has a line in both languages', () => {
  const evs: D.DebugEvent[] = [
    { ev: 'track', key: '3B', bpm: 120 },
    { ev: 'plan', movable: 5, window: 12, moves: 3, gain: 0.4, reason: 'ok', from: ['8A', null], to: [null, '8A'] },
    { ev: 'scroll', src: 'ext', why: 'restore', from: 0, to: 100, ms: 20 },
    { ev: 'queue_ext', by: 'user', n: 1, pos: [2], toast: true },
    { ev: 'yt_toast' },
    { ev: 'drag', phase: 'start', from: 5, to: 1 },
    { ev: 'drag', phase: 'reached', at: 1, steps: 40 },
    { ev: 'drag', phase: 'drop', landed: 1, drops: 1 },
    { ev: 'move', to: 2, ok: true, landed: true, key: '8A', bpm: 120 },
    { ev: 'run', result: 'aborted', reason: 'user_input', by: 'wheel' },
    { ev: 'input', type: 'wheel', x: 10, y: 20 },
    { ev: 'retry', n: 1, why: 'queue_changed' },
    { ev: 'contest' },
    { ev: 'guard_resume', n: 1 },
    { ev: 'user_moved', n: 1 },
    { ev: 'error' },
  ];

  for (const lang of ['ja', 'en']) {
    I.setLang(lang);

    for (const v of evs) {
      const s = D.lineText(v);
      assert.ok(s && !/dbg\.|\{\w+\}/.test(s), `${lang} ${v.ev}: ${s}`);
    }
  }
});

test("debug panel: the setting is off by default and in the popup's individual settings", () => {
  assert.equal(S.DEFAULTS.reorderDebug, false);
  const html = fs.readFileSync(path.join(import.meta.dirname, '..', 'entrypoints', 'popup.html'), 'utf8');
  const ind = html.slice(html.indexOf('<details id="individual"'), html.indexOf('<details id="details"'));
  assert.ok(ind.includes('id="reorderDebug"'));
});

test('debug panel: debugView drops events it does not know and keeps no ids', () => {
  assert.equal(
    RP.debugView({ kind: 'ro_whatever', id: 'abc' }, () => ({})),
    null,
  );
  const v = RP.debugView({ kind: 'ro_move', id: 'secretid', to: 0, res: { ok: true }, landed: true }, () => ({
    key: '1A',
    bpm: 99,
  }));
  assert.ok(!JSON.stringify(v).includes('secretid'));
  assert.equal(v?.to, 1);
});

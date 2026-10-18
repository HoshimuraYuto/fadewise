import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../shared/reorder.mts';
import * as RP from '../page/reorder-page.mts';
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
const lastRun = (sim: QueueSim) => sim.runs[sim.runs.length - 1];

function recordInput(sim: QueueSim) {
  const seen: [string, Element][] = [];

  for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'keydown']) {
    sim.w.addEventListener(
      t,
      (e: Event & { __trusted?: boolean }) => {
        if (!e.__trusted) seen.push([t, e.target as Element]);
      },
      true,
    );
  }

  return seen;
}

type Row = HTMLElement & { data: { videoId: string } };

function withPlayButton(sim: QueueSim) {
  const bar = sim.doc.createElement('ytmusic-player-bar');
  const pp = sim.doc.createElement('button');
  pp.id = 'play-pause-button';
  bar.appendChild(pp);
  sim.doc.body.appendChild(bar);
  let presses = 0;
  pp.addEventListener('click', () => {
    presses++;
    sim.playing!.paused = false;
  });

  return () => presses;
}

test('pause: shipped waits — not before 5 s after the track change', async () => {
  const sim = mk();
  await sim.run(4.5);
  assert.equal(sim.runs.length, 0);
  assert.equal(sim.events.length, 0);
  await sim.run(1);
  await sim.settle();
  assert.equal(lastRun(sim).result, 'done', JSON.stringify(lastRun(sim)));
  assert.equal(RP.C.SETTLE_SEC, 5);
  assert.equal(RP.C.QUIET_SEC, 2);
});

test('pause: a queue the page keeps changing (mix reshuffled / refilled) postpones the start until 2 s of quiet', async () => {
  const sim = mk();
  let k = 0;
  await sim.run(7, (s) => {
    if (++k % 5 === 0) s.userMove(s.ids()[s.ids().length - 1], s.sel + 1);
  });
  assert.equal(sim.runs.length, 0, 'nothing while the queue changes');
  assert.equal(sim.ro.status().wait, 'queue_changed');
  assert.equal(sim.events.filter((e) => e[0] === 'down').length, 0);
  await sim.run(1.5);
  assert.equal(sim.runs.length, 0, 'quiet for less than 2 s');
  await sim.run(1);
  await sim.settle();
  assert.equal(sim.runs.length, 1, 'starts after 2 s of quiet');
});

test('pause: the press is on the row text, never on the thumbnail play button, the menu or the playing row', async () => {
  const sim = mk();
  const seen = recordInput(sim);
  await sim.run(6);
  await sim.settle();
  assert.equal(lastRun(sim).result, 'done');
  const downs = seen.filter(([t]) => t === 'pointerdown' || t === 'mousedown');
  assert.ok(downs.length >= 2);

  for (const [, el] of downs) {
    assert.equal(el.className, 'song-info', 'pressed on the title text');
    assert.equal(el.closest('ytmusic-player-queue-item')!.hasAttribute('selected'), false, 'not the playing row');
  }

  assert.equal(sim.events.filter((e) => e[0] === 'play_button').length, 0);
  assert.equal(seen.filter(([t]) => t === 'click').length, 0, 'a drag sends no click');
  assert.equal(seen.filter(([t]) => t === 'keydown').length, 0);
});

test('pause: the release goes to the dragged row itself, even when the rows moved under the pointer', async () => {
  const sim = mk();
  const seen = recordInput(sim);
  await sim.run(6);
  await sim.settle();
  const ups = seen.filter(([t]) => t === 'pointerup' || t === 'mouseup');
  assert.ok(ups.length >= 2);

  for (const [, el] of ups) {
    assert.equal(el.tagName.toLowerCase(), 'ytmusic-player-queue-item');
    assert.equal(el.hasAttribute('selected'), false);
  }
});

test('pause: no press point off the controls -> no drag at all (not_visible), nothing sent', async () => {
  const sim = mk();
  sim.doc.elementFromPoint = () => sim.doc.querySelector('ytmusic-play-button-renderer');
  const seen = recordInput(sim);
  const r = await sim.qdom.drag('h', 1, () => null);
  assert.deepEqual([r.ok, r.reason], [false, 'not_visible']);
  assert.equal(seen.length, 0);
});

test('pause: the page changing the queue mid-drag stops the drag at once (queue_changed), released on the row', async () => {
  for (const change of ['shift', 'reorder']) {
    const sim = mk();
    const seen = recordInput(sim);
    let n = 0;
    const orig = sim.qdom.drag;
    sim.qdom.drag = async (vid, to, stop) =>
      orig(vid, to, () => {
        if (++n === 2) {
          const c = sim.doc.querySelector('#contents')!;

          if (change === 'shift') {
            const rs = Array.from(c.children);
            c.insertBefore(rs[sim.sel], rs[sim.sel + 3]);
          } else {
            const rs = (Array.from(c.children) as Row[]).filter(
              (r) => r.data.videoId !== vid && !r.hasAttribute('selected'),
            );
            c.insertBefore(rs[rs.length - 1], rs[rs.length - 2]);
          }
        }

        return stop();
      });
    await sim.run(6);
    await sim.settle();
    const run = lastRun(sim);
    assert.equal(run.reason, 'queue_changed', change + ' ' + JSON.stringify(run));
    assert.equal(run.moved, 0, change);
    const ups = seen.filter(([t]) => t === 'pointerup');
    assert.equal(ups.length, 1, change);
    assert.equal(ups[0][1].hasAttribute('selected'), false, change + ': not released on the playing row');
  }
});

test('pause: the menu is closed with Escape on the dropdown only; no click on body / the page', async () => {
  const sim = mk({ flags: { menuNoEndpoint: true } });
  sim.setPanel(false);
  let bodyClicks = 0,
    docKeys = 0;
  sim.doc.body.addEventListener('click', (e) => {
    if (e.target === sim.doc.body) bodyClicks++;
  });
  sim.doc.addEventListener('keydown', (e) => {
    if (e.target === sim.doc) docKeys++;
  });
  await sim.run(6);
  await sim.settle();
  assert.equal(lastRun(sim).reason, 'menu');
  assert.equal(sim.menuOpen(), false, 'menu closed');
  assert.equal(bodyClicks, 0, 'no click on body');
  assert.equal(docKeys, 0, 'no key sent to the document itself');
});

test('pause: a lost press is replayed only when it was made on the player bar (not when the bar only appears there later)', async () => {
  const sim = mk();
  const bar = sim.doc.createElement('ytmusic-player-bar');
  const btn = sim.doc.createElement('button');
  bar.appendChild(btn);
  sim.doc.body.appendChild(bar);
  let clicks = 0;
  btn.addEventListener('click', () => {
    clicks++;
  });
  const ef = sim.doc.elementFromPoint.bind(sim.doc);
  let barThere = false;
  sim.doc.elementFromPoint = (x, y) => (barThere && y > 760 ? btn : ef(x, y));
  const orig = sim.qdom.drag;
  let pressed = false;

  sim.qdom.drag = async (...a) => {
    if (!pressed) {
      pressed = true;
      sim.trusted('pointerdown', { clientX: 50, clientY: 780 });
      barThere = true;
    }

    return orig(...a);
  };

  await sim.run(6);
  await sim.settle();
  await sim.run(0.2);
  assert.equal(clicks, 0);
  assert.ok(!sim.diag.some((d) => d.kind === 'ro_replay'));
});

test('pause: guard — a pause during the run without real input is undone once with the play button, and the run stops', async () => {
  const sim = mk();
  const presses = withPlayButton(sim);
  const orig = sim.qdom.drag;

  sim.qdom.drag = async (vid, to, stop) => {
    sim.playing!.paused = true;

    return orig(vid, to, stop);
  };

  await sim.run(5.3);
  await sim.settle();
  await sim.run(1);
  assert.equal(presses(), 1, 'resumed once');
  assert.equal(sim.playing!.paused, false);
  const run = lastRun(sim);
  assert.equal(run.reason, 'paused', JSON.stringify(run));
  assert.ok(sim.diag.some((d) => d.kind === 'ro_guard_resume' && d.ok === true));
});

test('pause: guard in the miniplayer layout (no ytmusic-player-bar) presses its play button; the run stops as paused', async () => {
  const sim = mk();
  const mini = sim.doc.createElement('ytmusic-miniplayer');
  const wrap = sim.doc.createElement('div');
  wrap.className = 'ytmusicPlayerControlsControlButton ytmusicPlayerControlsPlayPauseButton';
  const pp = sim.doc.createElement('button');
  wrap.appendChild(pp);
  mini.appendChild(wrap);
  sim.doc.body.appendChild(mini);
  let presses = 0;
  pp.addEventListener('click', () => {
    presses++;
    sim.playing!.paused = false;
  });
  assert.equal(sim.doc.querySelector('ytmusic-player-bar'), null);
  assert.equal(RP.playButton(sim.doc), pp);
  const orig = sim.qdom.drag;

  sim.qdom.drag = async (vid, to, stop) => {
    sim.playing!.paused = true;

    return orig(vid, to, stop);
  };

  await sim.run(5.3);
  await sim.settle();
  await sim.run(1);
  assert.equal(presses, 1, 'resumed once');
  assert.equal(lastRun(sim).reason, 'paused', JSON.stringify(lastRun(sim)));
  assert.ok(sim.diag.some((d) => d.kind === 'ro_guard_resume' && d.ok === true));
});

test('pause: the play button is the player bar one when both layouts are in the page', () => {
  const sim = mk();
  sim.doc.body.insertAdjacentHTML(
    'beforeend',
    '<ytmusic-miniplayer><div class="ytmusicPlayerControlsPlayPauseButton"><button id="m"></button></div></ytmusic-miniplayer>' +
      '<ytmusic-player-bar><button id="play-pause-button"></button></ytmusic-player-bar>',
  );
  assert.equal(RP.playButton(sim.doc)?.id, 'play-pause-button');
  sim.doc.querySelector('ytmusic-player-bar')!.remove();
  assert.equal(RP.playButton(sim.doc)?.id, 'm');
  sim.doc.querySelector('ytmusic-miniplayer')!.remove();
  assert.equal(RP.playButton(sim.doc), null);
});

// YTM: a real press while our row is held lands on that row and the row stops following us.
function realPressMidDrag(sim: QueueSim, press: boolean) {
  let swallowed = false,
    moves = 0;
  sim.w.addEventListener(
    'pointermove',
    (e) => {
      if (swallowed) {
        e.stopImmediatePropagation();

        return;
      }

      if (press && ++moves === 2) {
        swallowed = true;
        const row = (e.target as Element).closest('ytmusic-player-queue-item')!;
        // a real press comes in its own task
        setTimeout(() => {
          const p = new sim.w.MouseEvent('pointerdown', { bubbles: true, composed: true }) as MouseEvent & {
            __trusted?: boolean;
          };
          p.__trusted = true;
          row.dispatchEvent(p);
        }, 0);
      }
    },
    true,
  );
}

test('pause: a real press mid-drag that YTM swallows ends the run as user input (pointer), not not_visible', async () => {
  const sim = mk();
  realPressMidDrag(sim, true);
  await sim.run(6);
  await sim.settle();
  const run = lastRun(sim);
  assert.deepEqual([run.result, run.reason, run.by, run.moved], ['aborted', 'user_input', 'pointerdown', 0]);
  assert.equal(sim.playing!.paused, false, 'the press did not pause');
  assert.equal(R.sanitizeRun(run)?.by, 'pointerdown', 'kept in the history');
});

test('pause: without a real press the same stuck hop stays not_visible; our own press arriving trusted does not count', async () => {
  const stuck = mk();
  realPressMidDrag(stuck, false);
  let n = 0;
  stuck.w.addEventListener(
    'pointermove',
    (e) => {
      if (++n > 2) e.stopImmediatePropagation();
    },
    true,
  );
  await stuck.run(6);
  await stuck.settle();
  assert.deepEqual([lastRun(stuck).result, lastRun(stuck).reason], ['aborted', 'not_visible']);

  // the user's Chrome reports our synthetic events as trusted
  const own = mk();
  own.w.addEventListener(
    'pointerdown',
    (e) => {
      (e as Event & { __trusted?: boolean }).__trusted = true;
    },
    true,
  );
  await own.run(6);
  await own.settle();
  assert.equal(lastRun(own).result, 'done');
});

test('pause: guard is not used for an ad, the end of the track, another track, or after 1 s', async () => {
  const setup = () => {
    const sim = mk();

    return { sim, presses: withPlayButton(sim) };
  };

  const cases: Record<string, (s: QueueSim) => void> = {
    ad: (s) => {
      s.playing!.paused = true;
      s.playing!.ad = true;
    },
    end: (s) => {
      s.playing!.ct = s.playing!.duration - 0.5;
      s.playing!.paused = true;
    },
    other: (s) => {
      s.playing = Object.assign({}, s.playing, { vid: 'a', paused: true });
    },
  };

  for (const [name, act] of Object.entries(cases)) {
    const { sim, presses } = setup();
    const orig = sim.qdom.drag;
    let done = false;

    sim.qdom.drag = async (...a) => {
      if (!done) {
        done = true;
        act(sim);
      }

      return orig(...a);
    };

    await sim.run(5.3);
    await sim.settle();
    await sim.run(0.5);
    assert.equal(presses(), 0, name);
  }

  const late = setup();
  await late.sim.run(5.3);
  await late.sim.settle();
  late.sim.wall += 2000;
  late.sim.playing!.paused = true;
  await late.sim.run(0.5);
  assert.equal(late.presses(), 0, 'late pause');
  const none = setup();
  none.sim.settings.reorder = false;
  await none.sim.run(6);
  none.sim.playing!.paused = true;
  await none.sim.run(0.5);
  assert.equal(none.presses(), 0, 'no run');
});

test("pause: the account's auto-generated mixes (RDTMAK…) are told apart from radios and are ordered too", async () => {
  assert.equal(R.queueKind('RDTMAK5uy_abc', true), 'mix');
  assert.equal(R.kindAllowed('mix', { reorderAlbums: false }), true);
  assert.equal(R.queueKind('RDAMVMabc', true), 'radio');
  assert.equal(R.sanitizeRun({ at: 1, kind: 'mix', result: 'skipped', reason: 'kind', method: 'none' })?.kind, 'mix');
  const sim = mk({ list: 'RDTMAK5uy_abc' });
  await sim.run(6);
  await sim.settle();
  assert.equal(lastRun(sim).kind, 'mix');
  assert.notEqual(lastRun(sim).reason, 'kind');
});

test('pause: new reason codes are kept in the run log', () => {
  assert.equal(
    R.sanitizeRun({ at: 1, kind: 'radio', result: 'aborted', reason: 'queue_changed', method: 'drag' })?.reason,
    'queue_changed',
  );
  assert.equal(
    R.sanitizeRun({ at: 1, kind: 'radio', result: 'aborted', reason: 'paused', method: 'drag' })?.reason,
    'paused',
  );
});

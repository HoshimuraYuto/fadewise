import { JSDOM } from 'jsdom';
import { startPlayer, type PlayerWindow } from '../../page/player-main.mts';
import { makeCtxClass } from './player-sim/audio.mts';
import { installClock } from './player-sim/clock.mts';
import {
  installPlayerButtons,
  installQueuePanel,
  installTrackLoad,
  installVideo,
  type MediaPage,
} from './player-sim/media.mts';
import { makeWorkletNodeClass } from './player-sim/worklets.mts';
import type { Sim, SimOptions } from './player-sim/types.mts';

export { Param } from './player-sim/audio.mts';
export type { Sim, SimOptions, SimTrack } from './player-sim/types.mts';

export type Loose = Record<string, any>;

const PAGE_HTML = `<!doctype html><html><body><div id="movie_player" class=""></div>
    <ytmusic-player-bar><div class="next-button"><button id="next"></button></div><div class="previous-button"><button id="prev"></button></div></ytmusic-player-bar>
    <video></video><ytmusic-player-queue><div id="contents"></div></ytmusic-player-queue></body></html>`;

const DEFAULT_SETTINGS = {
  gainEnabled: false,
  fadesEnabled: true,
  beatAlign: true,
  transitions: true,
  transitionWash: false,
  saveAnalysis: true,
  postMeter: false,
};

globalThis.__FADEWISE_VERIFY__ = true;

function initialSim(o: SimOptions, w: PlayerWindow, video: HTMLVideoElement): Sim {
  return {
    w,
    ctx: null,
    gains: [],
    clicks: 0,
    prevClicks: 0,
    diag: [],
    status: null,
    snapshots: [],
    queue: o.queue.slice(),
    qi: 0,
    tracks: o.tracks,
    adNow: false,
    nextWorks: o.nextWorks !== false,
    frameT: 0,
    errorsAt: [],
    rateLog: [],
    albumPos: o.albumPos || null,
    video,
  } as unknown as Sim;
}

function installMessaging(sim: Sim, w: PlayerWindow & Loose): void {
  w.addEventListener('message', (e: MessageEvent<Loose | null>) => {
    const d = e.data;
    if (d?.['fadewise'] !== 'main') return;
    if (d.type === 'status') sim.status = d.data as Loose;
    else if (d.type === 'diag') sim.diag.push(d.data as Loose);
    else if (d.type === 'snapshot') sim.snapshots.push(d.data as Loose);
  });

  sim.send = (type, data) =>
    w.dispatchEvent(new w.MessageEvent('message', { data: { fadewise: 'bridge', type, data }, source: w }));
}

function installControls(sim: Sim, page: MediaPage): void {
  const { video, media, moviePlayer } = page;
  sim.rate = () => media.rate;
  sim.pp = () => media.pp;

  sim.setRate = (x) => {
    video.playbackRate = x;
  };

  sim.fade = () => sim.gains[1]; // connect() order: track gain, fade stage
  sim.fg = () => +sim.fade().gain.value.toFixed(4);
  sim.ct = () => media.ct;

  sim.setAd = (on) => {
    sim.adNow = on;
    if (on) moviePlayer.classList.add('ad-showing');
    else moviePlayer.classList.remove('ad-showing');
  };

  sim.pause = () => {
    video.pause();
  };

  sim.play = () => video.play();

  sim.seek = (x) => {
    video.currentTime = x;
  };

  sim.vid = () => sim.queue[sim.qi];
}

export function createSim(o: SimOptions): Sim {
  const dom = new JSDOM(PAGE_HTML, { url: o.url || 'https://music.youtube.com/watch?v=x' });
  const w = dom.window as unknown as PlayerWindow & Loose;
  const doc = w.document;
  const video = doc.querySelector('video')!;
  const sim = initialSim(o, w, video);
  const media = { ct: 0, paused: true, dur: NaN, ended: false, readyState: 0, rate: 1, pp: true };
  const fire = (type: string) => video.dispatchEvent(new w.Event(type));
  const moviePlayer = doc.getElementById('movie_player') as HTMLElement & Loose;
  const page: MediaPage = { doc, video, moviePlayer, media, fire };

  installVideo(sim, page);
  installQueuePanel(sim, page, o.url);
  installTrackLoad(sim, page);
  installPlayerButtons(sim, page);
  Object.assign(w, { AudioContext: makeCtxClass(sim), AudioWorkletNode: makeWorkletNodeClass(sim, media) });
  installMessaging(sim, w);
  installControls(sim, page);
  installClock(sim, page, o);

  startPlayer(w, { analysis: o.analysis, reorder: o.reorder === false ? null : undefined });
  sim.send('workletUrl', 'x');
  if (o.overlapUrl !== false) sim.send('overlapUrl', 'y');
  sim.send('settings', Object.assign({}, DEFAULT_SETTINGS, o.settings || {}));
  for (const [vid, e] of Object.entries(o.index || {})) sim.send('indexEntry', { vid, entry: e });

  return sim;
}

export function entry(d: number, kind: string, lastSoundSec: number, extra?: Loose): Loose {
  const en = {
    kind,
    lastSoundSec,
    silenceSec: +(d - lastSoundSec).toFixed(2),
    fadeSec: kind === 'abrupt' ? 3 : null,
    decaySec: null,
    endRelLu: null,
  };

  return Object.assign({ l: -10, c: 0.8, p: -1, y: null, fs: 0, fx: true, h0: -30, d, en, bt: null }, extra || {});
}

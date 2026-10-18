import { safe } from './common.mts';
import { releaseFade, startFadeIn } from './fades.mts';
import { applyGainFor } from './gain.mts';
import { connect, resume } from './graph.mts';
import { ovMedia } from './overlap-events.mts';
import { ovPrearm } from './rate.mts';
import { flush, guard } from './session.mts';
import type { Player } from './state.mts';
import { onTrMedia } from './transition.mts';
import { moviePlayer, playerDuration } from './youtube.mts';

const BOUNDARY_EVENTS = [
  'emptied',
  'loadstart',
  'loadedmetadata',
  'durationchange',
  'seeking',
  'seeked',
  'volumechange',
];

function onEnded(pl: Player): void {
  onTrMedia(pl, 'ended');
  releaseFade(pl, 'ended');
  const s = pl.session;

  if (s) {
    pl.A.markEnded(s, playerDuration(pl));
    flush(pl, true);
  }
}

function onPlay(pl: Player): void {
  if (!pl.rush && pl.ov.state === 'idle') ovPrearm(pl);
  connect(pl);
  resume(pl);
  onTrMedia(pl, 'play');
  applyGainFor(pl, 'play');
}

function listenToVideo(pl: Player, v: HTMLVideoElement): void {
  const on = (type: string, fn: () => void) => {
    v.addEventListener(type, safe(pl, fn));
  };

  // on the event itself: an ad starting at the boundary is otherwise seen 100 ms late
  const boundary = safe(pl, (e: Event) => {
    ovMedia(pl, v, e.type);
    onTrMedia(pl, e.type);
    guard(pl, e.type);
    applyGainFor(pl, e.type);
  });
  for (const type of BOUNDARY_EVENTS) v.addEventListener(type, boundary);
  on('ratechange', () => {
    ovMedia(pl, v, 'ratechange');
  });
  on('ended', () => {
    onEnded(pl);
  });
  on('play', () => {
    onPlay(pl);
  });
  on('playing', () => {
    onTrMedia(pl, 'playing');
    startFadeIn(pl, 'playing');
  });
  on('pause', () => {
    ovMedia(pl, v, 'pause');
    onTrMedia(pl, 'pause');
    releaseFade(pl, 'pause');
  });
}

function onVideoFound(pl: Player, v: HTMLVideoElement): void {
  pl.video = v;
  listenToVideo(pl, v);
  if (!v.paused) connect(pl);
  const mp = moviePlayer(pl);
  // the player's class says when an ad starts or ends
  if (mp)
    new pl.win.MutationObserver(
      safe(pl, () => {
        applyGainFor(pl, 'player_class');
      }),
    ).observe(mp, { attributes: true, attributeFilter: ['class'] });
}

function findVideo(pl: Player): boolean {
  const v = pl.doc.querySelector('video');
  if (!v) return false;
  onVideoFound(pl, v);

  return true;
}

// <video> may not exist yet at document_start; the AudioContext can only resume on user input.
export function listenToPage(pl: Player): void {
  const { doc, win } = pl;
  safe(pl, () => {
    if (findVideo(pl)) return;
    const mo = new win.MutationObserver(() => {
      if (findVideo(pl)) mo.disconnect();
    });
    mo.observe(doc.firstElementChild ?? doc, { childList: true, subtree: true });
  })();

  const resumeOnInput = () => {
    resume(pl);
  };

  doc.addEventListener('pointerdown', resumeOnInput, true);
  doc.addEventListener('keydown', resumeOnInput, true);
  win.addEventListener(
    'pagehide',
    safe(pl, () => {
      flush(pl, true);
    }),
  );
}

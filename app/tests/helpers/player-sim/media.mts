import type { FakeContext } from './audio.mts';
import type { Loose, MediaState, Sim, SimTrack } from './types.mts';

export interface MediaPage {
  doc: Document;
  video: HTMLVideoElement;
  moviePlayer: HTMLElement & Loose;
  media: MediaState;
  fire: (type: string) => void;
}

function defineVideoProperties(sim: Sim, page: MediaPage): void {
  const { video, media, fire } = page;
  const readOnly = (get: () => unknown) => ({ get, configurable: true });

  Object.defineProperties(video, {
    currentTime: {
      get: () => media.ct,
      set: (x: number) => {
        media.ct = x;
        fire('seeking');
        fire('seeked');
      },
      configurable: true,
    },
    paused: readOnly(() => media.paused),
    ended: readOnly(() => media.ended),
    duration: readOnly(() => media.dur),
    readyState: readOnly(() => media.readyState),
    volume: readOnly(() => 1),
    muted: readOnly(() => false),
    // like Chrome: setting the rate fires ratechange; YTM sets it back to 1 on a new source but leaves preservesPitch
    playbackRate: {
      get: () => media.rate,
      set: (x: number) => {
        if (x === media.rate) return;
        media.rate = x;
        sim.rateLog.push([(sim.ctx as FakeContext | null)?.currentTime ?? 0, x, media.pp, sim.adNow]);
        fire('ratechange');
      },
      configurable: true,
    },
    preservesPitch: {
      get: () => media.pp,
      set: (x: unknown) => {
        media.pp = !!x;
      },
      configurable: true,
    },
  });
}

export function installVideo(sim: Sim, page: MediaPage): void {
  const { video, media, fire } = page;
  defineVideoProperties(sim, page);

  video.play = () => {
    media.paused = false;
    fire('play');
    fire('playing');

    return Promise.resolve();
  };

  video.pause = () => {
    media.paused = true;
    fire('pause');
  };
}

const listIdOf = (url: string | undefined) => {
  try {
    return new URL(url || 'https://x/').searchParams.get('list');
  } catch {
    return null;
  }
};

export function installQueuePanel(sim: Sim, page: MediaPage, url: string | undefined): void {
  const { doc, moviePlayer } = page;
  const vid = () => sim.queue[sim.qi];
  moviePlayer.getVideoData = () => ({ video_id: vid(), title: 'T', author: 'X' });
  moviePlayer.getDuration = () => (sim.tracks[vid()] as SimTrack | undefined)?.d;
  moviePlayer.getPlayerResponse = () => null;

  const contents = doc.getElementById('contents')!;
  const listId = listIdOf(url);

  // rows carry watchEndpoint { playlistId, index } as on YTM
  sim.renderQueue = () => {
    contents.textContent = '';
    sim.queue.forEach((id, k) => {
      const row = doc.createElement('ytmusic-player-queue-item') as HTMLElement & Loose;
      const data: Loose = { videoId: id };
      row.data = data;
      const pos = sim.albumPos?.[id];
      if (pos !== undefined && Number.isInteger(pos))
        data.navigationEndpoint = { watchEndpoint: { videoId: id, playlistId: listId, index: pos } };
      if (k === sim.qi) row.setAttribute('selected', '');
      contents.appendChild(row);
    });
  };
}

export function installTrackLoad(sim: Sim, page: MediaPage): void {
  const { media, fire } = page;

  // YTM clears the source first (src='', duration NaN, position 0), then loads the new one
  sim.load = (i, startCt, noPlay) => {
    sim.qi = i;
    Object.assign(media, { dur: NaN, ct: 0, ended: false, readyState: 0 });
    fire('emptied');
    fire('loadstart');

    if (media.rate !== 1) {
      media.rate = 1;
      fire('ratechange');
    }

    sim.renderQueue();
    media.dur = sim.tracks[sim.queue[sim.qi]].d;
    media.readyState = 4;
    fire('loadedmetadata');
    fire('durationchange');
    if (startCt) media.ct = startCt;

    if (noPlay) {
      media.paused = true;

      return;
    }

    media.paused = false;
    fire('play');
    fire('playing');
  };

  // YTM sometimes sends emptied / loadstart again while the same next track is still loading
  sim.reload = () => {
    fire('emptied');
    fire('loadstart');
  };
}

export function installPlayerButtons(sim: Sim, page: MediaPage): void {
  const { doc, video, media } = page;

  doc.getElementById('next')!.addEventListener('click', () => {
    sim.clicks++;
    if (sim.nextWorks && sim.qi + 1 < sim.queue.length) sim.load(sim.qi + 1, 0, sim.nextLoadsPaused);
  });
  doc.getElementById('prev')!.addEventListener('click', () => {
    sim.prevClicks++;
    if (media.ct > 3) video.currentTime = 0;
    else if (sim.qi > 0) sim.load(sim.qi - 1);
  });
}

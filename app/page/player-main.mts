import { post } from './player/common.mts';
import { listenToBridge } from './player/bridge.mts';
import { listenToPage } from './player/media.mts';
import { createPlayer } from './player/state.mts';
import type { PlayerDeps, PlayerWindow } from './player/types.mts';

export type { PlayerDeps, PlayerWindow } from './player/types.mts';

export function startPlayer(win: PlayerWindow, deps?: PlayerDeps): void {
  if (win.__fadewiseLoaded) return;
  win.__fadewiseLoaded = true;
  const pl = createPlayer(win, deps);
  listenToPage(pl);
  listenToBridge(pl);
  post(pl, 'hello', null);
}

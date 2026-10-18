import * as Analysis from '../shared/analysis.mts';
import * as Reorder from '../shared/reorder.mts';
import * as ReorderPage from './reorder-page.mts';
import { startPlayer } from './player-main.mts';

declare global {
  var FadewiseAnalysis: typeof Analysis | undefined;
  var FadewiseReorder: typeof Reorder | undefined;
  var FadewiseReorderPage: typeof ReorderPage | undefined;
}

if (typeof __FADEWISE_VERIFY__ !== 'undefined' && __FADEWISE_VERIFY__) {
  const analysis = Object.assign({}, Analysis);
  const reorder = Object.assign({}, Reorder);
  globalThis.FadewiseAnalysis = analysis;
  globalThis.FadewiseReorder = reorder;
  globalThis.FadewiseReorderPage = ReorderPage;
  startPlayer(window, { analysis, reorder });
} else startPlayer(window);

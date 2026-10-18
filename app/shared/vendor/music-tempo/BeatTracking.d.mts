// Types for the vendored BeatTracking.mjs.
import type Agent from './Agent.mjs';
import type { AgentParams } from './Agent.mjs';

export interface BeatTrackingParams extends AgentParams {
  initPeriod?: number;
  thresholdBI?: number;
  thresholdBT?: number;
}
export default class BeatTracking {
  static trackBeat(
    events: number[],
    eventsScores: number[],
    tempoList: number[],
    params?: BeatTrackingParams,
  ): Agent[];
}

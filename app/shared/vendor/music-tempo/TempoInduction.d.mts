// Types for the vendored TempoInduction.mjs.
export interface TempoParams {
  widthTreshold?: number;
  maxIOI?: number;
  minIOI?: number;
  maxTempos?: number;
  minBeatInterval?: number;
  maxBeatInterval?: number;
}
export interface Clusters {
  clIntervals: number[];
  clSizes: number[];
}
export interface ClusterScores {
  clScores: number[];
  clScoresIdxs: number[];
}
export default class TempoInduction {
  static processRhythmicEvents(events: number[], params?: TempoParams): Clusters;
  static mergeClusters(clusters: Clusters, params?: TempoParams): Clusters;
  static calculateScore(clusters: Clusters, params?: TempoParams): ClusterScores;
  // Beat intervals (s), best first.
  static createTempoList(clusters: Clusters & ClusterScores, params?: TempoParams): number[];
}

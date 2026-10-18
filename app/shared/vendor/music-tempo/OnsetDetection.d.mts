// Types for the vendored OnsetDetection.mjs (only what shared/tempo-key.mts calls).
export interface PeakParams {
  decayRate?: number;
  peakFindingWindow?: number;
  meanWndMultiplier?: number;
  peakThreshold?: number;
}
export default class OnsetDetection {
  // Normalises in place to mean 0, standard deviation 1.
  static normalize(data: number[]): void;
  // Indices of the peaks; throws a string when none are found.
  static findPeaks(spectralFlux: number[], params?: PeakParams): number[];
}

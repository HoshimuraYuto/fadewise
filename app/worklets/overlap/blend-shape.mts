// cuts 25 dB or more below ~150 Hz
export const BASS_HZ = 250;
export const BASS_CUT_DB = -30;
export const SWAP_SEC = 0.15;
export const HP_NEW_FROM_HZ = 1000;
export const HP_OLD_TO_HZ = 1500;
export const HP_OPEN_HZ = 20;
export const WET_SEC = 0.1;
export const UPD = 32;

export const SUM_OVER_DB = 1.5;
export const LOUD_SEC = 0.4;
export const COMP_DOWN_SEC = 0.25;
export const COMP_UP_SEC = 0.8;
export const COMP_END_SEC = 0.05;

export const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
export const sweep = (from: number, to: number, x: number) => from * Math.pow(to / from, smooth(x));

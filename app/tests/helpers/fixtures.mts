import { readFileSync } from 'node:fs';
import type { Ending, Tail } from '../../shared/types.mts';

export interface FixtureTrack {
  label: string;
  reviewLabel: string;
  reviewMethod?: string;
  durationSec: number;
  integratedLufs: number;
  lastSoundSec: number | null;
  coverage: number;
  tail: Tail & { endPos: number };
  endingStored: Ending;
  head: { headProfile: (number | null)[]; firstSoundSec: number | null; firstSoundExact: boolean; frames?: unknown[] };
}
export interface Fixtures {
  description: string;
  count?: number;
  tracks: FixtureTrack[];
}

export function loadFixtures(name: 'ear-checked' | 'real-tracks'): Fixtures {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8')) as Fixtures;
}

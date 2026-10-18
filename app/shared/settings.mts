import type {
  Consent,
  MixMode,
  OverlapStyleMode,
  PresetKey,
  PresetValues,
  Settings,
  StoredSettings,
} from './types.mts';

export const MIX_POINTS: readonly MixMode[] = Object.freeze(['gentle', 'auto', 'aggressive'] as const);
// keep equal to analysis.mts OVERLAP.rates
export const LEAD_RATES: readonly number[] = Object.freeze([1.25, 1.5]);
// keep equal to analysis.mts OVERLAP_STYLE.modes
export const OVERLAP_STYLES: readonly OverlapStyleMode[] = Object.freeze(['auto', 'simple'] as const);
export const DEFAULTS: Readonly<Settings> = Object.freeze({
  gainEnabled: true,
  fadesEnabled: true,
  beatAlign: true,
  transitions: false,
  transitionWash: false,
  overlap: false,
  leadRate: 1.25,
  overlapStyle: 'auto',
  mixPoints: 'gentle',
  reorder: false,
  reorderAlbums: false,
  reorderToast: true,
  queueBadges: true,
  seekbarMarks: true,
  reorderDebug: false,
  autoContinue: false,
  analysisEnabled: true,
  uiLanguage: 'auto',
  postMeter: false,
  targetLufs: -10,
  maxBoostDb: 6,
});
export type EffectiveSettings = Settings & Omit<StoredSettings, keyof Settings>;

// Bump when what is stored changes: users are asked again.
export const CONSENT_VERSION = 3;
export const WELCOME_PAGE = 'welcome.html';

const asStored = (x: unknown): StoredSettings => (x && typeof x === 'object' ? (x as StoredSettings) : {});
const asConsent = (x: unknown): Consent | null => (x && typeof x === 'object' ? x : null);

export function migrate(s: unknown): StoredSettings {
  const out: StoredSettings = Object.assign({}, s);
  if (typeof out.transitions !== 'boolean' && out.skipSilence === true) out.transitions = true;
  delete out.skipSilence;
  if ('mixPoints' in out && !MIX_POINTS.includes(out.mixPoints as MixMode)) delete out.mixPoints;
  if ('leadRate' in out && !LEAD_RATES.includes(out.leadRate as number)) delete out.leadRate;
  if ('overlapStyle' in out && !OVERLAP_STYLES.includes(out.overlapStyle as OverlapStyleMode)) delete out.overlapStyle;

  return out;
}

export const withDefaults = (stored: unknown): EffectiveSettings =>
  Object.assign({}, DEFAULTS, migrate(asStored(stored)));

export const granted = (consent: unknown): boolean => {
  const c = asConsent(consent);

  return !!c && c.decision === 'granted' && (c.version ?? NaN) >= CONSENT_VERSION;
};

export function analysisAllowed(settings: unknown, consent: unknown): boolean {
  const on: unknown = withDefaults(settings).analysisEnabled;

  return granted(consent) && on === true;
}

export function answered(consent: unknown): boolean {
  const c = asConsent(consent);

  return !!c && (c.version ?? NaN) >= CONSENT_VERSION && (c.decision === 'granted' || c.decision === 'declined');
}

export function needsWelcome(reason: string, consent: unknown): boolean {
  if (reason === 'install') return true;
  if (reason !== 'update') return false;

  return !answered(consent);
}

// Unsaved keys stay unstored so they keep following DEFAULTS.
export const patchSettings = (stored: unknown, patch: StoredSettings): StoredSettings =>
  Object.assign({}, asStored(stored), patch);

export function grant(stored: unknown, now: number): { settings: StoredSettings; consent: Consent } {
  return {
    settings: patchSettings(stored, { analysisEnabled: true }),
    consent: { decision: 'granted', version: CONSENT_VERSION, at: now },
  };
}

export function decline(stored: unknown, now: number): { settings: StoredSettings; consent: Consent } {
  return {
    settings: patchSettings(stored, { analysisEnabled: false }),
    consent: { decision: 'declined', version: CONSENT_VERSION, at: now },
  };
}

export function toggleAnalysis(
  stored: unknown,
  consent: unknown,
  checked: unknown,
): { settings: StoredSettings | null; openWelcome: boolean } {
  if (checked && !granted(consent)) return { settings: null, openWelcome: true };

  return { settings: patchSettings(stored, { analysisEnabled: !!checked }), openWelcome: false };
}

export const pageSettings = (stored: unknown, consent: unknown): EffectiveSettings & { saveAnalysis: boolean } =>
  Object.assign(withDefaults(stored), { saveAnalysis: analysisAllowed(stored, consent) });

export type PresetName = 'auto' | 'gentle' | 'off';
export const PRESET_KEYS: PresetKey[] = [
  'gainEnabled',
  'fadesEnabled',
  'beatAlign',
  'transitions',
  'transitionWash',
  'reorder',
  'reorderAlbums',
];
export const PRESETS: Readonly<Record<PresetName, Readonly<PresetValues>>> = Object.freeze({
  auto: Object.freeze({
    gainEnabled: true,
    fadesEnabled: true,
    beatAlign: true,
    transitions: true,
    transitionWash: false,
    reorder: true,
    reorderAlbums: false,
  }),
  gentle: Object.freeze({
    gainEnabled: true,
    fadesEnabled: true,
    beatAlign: true,
    transitions: false,
    transitionWash: false,
    reorder: false,
    reorderAlbums: false,
  }),
  off: Object.freeze({
    gainEnabled: false,
    fadesEnabled: false,
    beatAlign: true,
    transitions: false,
    transitionWash: false,
    reorder: false,
    reorderAlbums: false,
  }),
});

export function presetOf(stored: unknown): PresetName | 'custom' {
  const s = withDefaults(stored);

  for (const [name, p] of Object.entries(PRESETS) as [PresetName, PresetValues][]) {
    if (PRESET_KEYS.every((k) => (name === 'off' && k === 'beatAlign') || s[k] === p[k])) return name;
  }

  return 'custom';
}

export function applyPreset(stored: unknown, name: string): StoredSettings {
  const p = (PRESETS as Readonly<Record<string, Readonly<PresetValues> | undefined>>)[name];
  if (!p) return asStored(stored);
  const patch: StoredSettings = Object.assign({}, p);
  if (name === 'off') {
    const s = withDefaults(stored);
    if (presetOf(stored) !== 'off') patch.offFrom = Object.fromEntries(PRESET_KEYS.map((k) => [k, s[k]]));
  } else patch.offFrom = null;

  return patchSettings(stored, patch);
}

export function toggleAll(stored: unknown): StoredSettings {
  if (presetOf(stored) !== 'off') return applyPreset(stored, 'off');
  const from = asStored(stored).offFrom;
  const prev = from && typeof from === 'object' ? (from as Record<string, unknown>) : null;
  if (!prev) return applyPreset(stored, 'auto');
  const patch: StoredSettings = { offFrom: null };

  for (const k of PRESET_KEYS) {
    const v = prev[k];
    if (typeof v === 'boolean') patch[k] = v;
  }

  const out = patchSettings(stored, patch);

  return presetOf(out) === 'off' ? applyPreset(stored, 'auto') : out;
}

export const EXCLUDED_KEY = 'excluded';
export const MAX_EXCLUDED = 5000;
const VIDEO_ID = /^[\w-]{6,20}$/;
export type Excluded = Record<string, number>;

export function sanitizeExcluded(x: unknown): Excluded {
  const out: Excluded = {};
  if (!x || typeof x !== 'object' || Array.isArray(x)) return out;
  const items = (Object.entries(x) as [string, unknown][])
    .filter((e): e is [string, number] => {
      const v = e[1];

      return VIDEO_ID.test(e[0]) && typeof v === 'number' && Number.isFinite(v) && v > 0;
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_EXCLUDED);
  for (const [k, v] of items) out[k] = Math.round(v);

  return out;
}

export function setExcluded(map: unknown, vid: unknown, on: unknown, now?: number): Excluded {
  const out = sanitizeExcluded(map);
  const id = String(vid);
  if (!VIDEO_ID.test(id)) return out;
  if (on) out[id] = Math.round(now || Date.now());
  else Reflect.deleteProperty(out, id);

  return sanitizeExcluded(out);
}

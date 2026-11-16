// settings.js — persistent player settings (localStorage).
// Single contract shared by the lobby panel (menu.js), the renderer
// (main.js), the world visuals (world.js) and audio (audio.js).
//   quality: 'low' | 'medium' | 'ultra'  (default 'medium')
//   volume: 0..1                          (default 1, master volume)
//   muted: boolean                        (default false)
//   sensitivity: granular look sensitivities, each 0.3..2.5:
//     hipfire      — base look speed when not aiming (default 1)
//     pistol       — per-weapon multiplier, pistol (default 1)
//     primary      — per-weapon multiplier, rifle/primary (default 1)
//     sniper       — per-weapon multiplier, sniper (default 1)
//     knife        — per-weapon multiplier, knife (default 1)
//     scopeSniper  — per-scope multiplier, sniper scope, high zoom (default 0.6)
//     scopeIron    — per-scope multiplier, rifle/pistol iron sights, low zoom (default 0.8)
//   Effective look speed = hipfire x weapon multiplier x scope multiplier
//   (scope factor only while aiming down sights; sniper scope uses
//   scopeSniper, iron-sight zoom uses scopeIron).
const KEY = 'ferroline.settings.v1';

export const SENS_MIN = 0.3, SENS_MAX = 2.5;

export const DEFAULT_SENSITIVITY = {
  hipfire: 1, pistol: 1, primary: 1, sniper: 1, knife: 1, scopeSniper: 0.6, scopeIron: 0.8,
};

export const DEFAULT_SETTINGS = { quality: 'medium', volume: 1, muted: false, sensitivity: { ...DEFAULT_SENSITIVITY } };

// What each graphics tier means for the renderer / world. One source of
// truth so main.js and world.js apply the same tier the same way.
export const QUALITY = {
  low:    { shadows: false, shadowMapSize: 0,    pixelRatioMax: 1,   particleScale: 0.35, atmosphere: false },
  medium: { shadows: true,  shadowMapSize: 1024, pixelRatioMax: 1.5, particleScale: 1,    atmosphere: true },
  ultra:  { shadows: true,  shadowMapSize: 2048, pixelRatioMax: 2,   particleScale: 1.6,  atmosphere: true },
};

let cached = null;

function readStored() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function sanitizeSensitivity(s) {
  const out = { ...DEFAULT_SENSITIVITY };
  // Migrate the old single-number sensitivity: it was the hipfire base.
  if (typeof s === 'number' && Number.isFinite(s)) {
    out.hipfire = Math.max(SENS_MIN, Math.min(SENS_MAX, s));
    return out;
  }
  if (!s || typeof s !== 'object') return out;
  for (const k of Object.keys(DEFAULT_SENSITIVITY)) {
    const v = s[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.max(SENS_MIN, Math.min(SENS_MAX, v));
  }
  return out;
}

function sanitize(s) {
  const out = { ...DEFAULT_SETTINGS, sensitivity: { ...DEFAULT_SENSITIVITY } };
  if (s.quality === 'low' || s.quality === 'medium' || s.quality === 'ultra') out.quality = s.quality;
  if (typeof s.volume === 'number' && Number.isFinite(s.volume)) out.volume = Math.max(0, Math.min(1, s.volume));
  if (typeof s.muted === 'boolean') out.muted = s.muted;
  out.sensitivity = sanitizeSensitivity(s.sensitivity);
  return out;
}

export function loadSettings() {
  cached = sanitize(readStored());
  return cached;
}

export function getSettings() {
  if (!cached) return loadSettings();
  return cached;
}

export function saveSettings(s) {
  cached = sanitize(s);
  try { localStorage.setItem(KEY, JSON.stringify(cached)); } catch { /* storage unavailable: keep in-memory */ }
  return cached;
}

export function setSettings(patch) {
  return saveSettings({ ...getSettings(), ...patch });
}

export function setSensitivity(patch) {
  return saveSettings({ ...getSettings(), sensitivity: { ...getSettings().sensitivity, ...patch } });
}

export function resetSensitivity() {
  return setSensitivity({ ...DEFAULT_SENSITIVITY });
}

export function qualityPreset(quality) {
  return QUALITY[quality] || QUALITY.medium;
}

// Effective look-speed multiplier for the current state.
//   weapon: 'pistol' | 'rifle' | 'smg' | 'sniper' | 'knife' | 'grenade' | 'smoke'
//   scoped: aiming down sights right now
//   sniperScope: the scope is the sniper's high-zoom scope (else iron sights)
export function effectiveSensitivity(settings, weapon, scoped, sniperScope) {
  const s = (settings && settings.sensitivity) || DEFAULT_SENSITIVITY;
  let m = s.hipfire;
  if (weapon === 'pistol') m *= s.pistol;
  else if (weapon === 'rifle' || weapon === 'smg') m *= s.primary;
  else if (weapon === 'sniper') m *= s.sniper;
  else if (weapon === 'knife') m *= s.knife;
  if (scoped) m *= sniperScope ? s.scopeSniper : s.scopeIron;
  return m;
}

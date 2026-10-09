/** Map layer defaults. v3 starts with housing pins only. */

export const LAYER_STORAGE_KEY = 'tnrc2:mapLayers:v3';

/** Earlier keys are ignored so a device that never chose layers gets the new defaults. */
export const LEGACY_LAYER_KEYS = ['tnrc2:mapLayers', 'tnrc2:mapLayers:v1', 'tnrc2:mapLayers:v2', 'tnrc2:layers'];

export const DEFAULT_LAYERS = {
  pins: true,
  opportunity: false,
  territories: false,
  density: false,
  roofAge: false,
  radar: false,
  warnings: false,
  reports: false
};

export function readSavedLayers(storage) {
  if (!storage) return null;
  let raw = null;
  try { raw = storage.getItem(LAYER_STORAGE_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const known = Object.keys(DEFAULT_LAYERS).some((key) => typeof parsed[key] === 'boolean');
    return known ? parsed : null;
  } catch {
    return null;
  }
}

export function resolveLayers(saved) {
  const next = { ...DEFAULT_LAYERS };
  if (!saved) return next;
  for (const key of Object.keys(DEFAULT_LAYERS)) {
    if (typeof saved[key] === 'boolean') next[key] = saved[key];
  }
  return next;
}

export function writeSavedLayers(storage, flags) {
  const payload = resolveLayers(flags);
  storage.setItem(LAYER_STORAGE_KEY, JSON.stringify(payload));
  return payload;
}

export function stormLayersEnabled(flags) {
  const layers = resolveLayers(flags);
  return !!(layers.radar || layers.warnings || layers.reports);
}

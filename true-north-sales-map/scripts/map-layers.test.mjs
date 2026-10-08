import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LAYERS,
  LAYER_STORAGE_KEY,
  LEGACY_LAYER_KEYS,
  readSavedLayers,
  resolveLayers,
  stormLayersEnabled,
  writeSavedLayers
} from '../lib/map-layers.js';

assert.equal(DEFAULT_LAYERS.pins, true);
assert.equal(DEFAULT_LAYERS.opportunity, true);
assert.equal(DEFAULT_LAYERS.territories, false);
assert.equal(DEFAULT_LAYERS.density, false);
assert.equal(DEFAULT_LAYERS.roofAge, false);
assert.equal(DEFAULT_LAYERS.radar, false);
assert.equal(DEFAULT_LAYERS.warnings, false);
assert.equal(DEFAULT_LAYERS.reports, false);
assert.equal(stormLayersEnabled(DEFAULT_LAYERS), false);
assert.equal(stormLayersEnabled({ radar: true }), true);

const storage = new Map();
const memory = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value)
};
assert.equal(readSavedLayers(memory), null);
assert.deepEqual(resolveLayers(null), DEFAULT_LAYERS);

LEGACY_LAYER_KEYS.forEach((key) => {
  memory.setItem(key, JSON.stringify({ warnings: true, territories: true, reports: true }));
});
assert.equal(readSavedLayers(memory), null);
assert.deepEqual(resolveLayers(readSavedLayers(memory)), DEFAULT_LAYERS);

const saved = writeSavedLayers(memory, { pins: false, warnings: true, extra: true });
assert.equal(saved.pins, false);
assert.equal(saved.warnings, true);
assert.equal(saved.opportunity, true);
assert.equal(saved.radar, false);
assert.equal('extra' in saved, false);
assert.equal(memory.getItem(LAYER_STORAGE_KEY)?.includes('"warnings":true'), true);
assert.deepEqual(resolveLayers(readSavedLayers(memory)).warnings, true);
assert.equal(resolveLayers(readSavedLayers(memory)).pins, false);

memory.setItem(LAYER_STORAGE_KEY, '{');
assert.equal(readSavedLayers(memory), null);

const root = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(root, '../index.html'), 'utf8');
const app = readFileSync(join(root, '../app.js'), 'utf8');

function layerChecked(id) {
  const match = html.match(new RegExp(`data-layer="${id}"([^>]*)>`));
  return Boolean(match && /\bchecked\b/.test(match[1]));
}
assert.equal(layerChecked('pins'), true);
assert.equal(layerChecked('opportunity'), true);
assert.equal(layerChecked('territories'), false);
assert.equal(layerChecked('warnings'), false);
assert.equal(layerChecked('reports'), false);
assert.equal(layerChecked('radar'), false);
assert.equal(layerChecked('density'), false);
assert.equal(layerChecked('roofAge'), false);

assert.ok(app.includes('readSavedLayers'));
assert.ok(app.includes('writeSavedLayers'));
assert.ok(app.includes('resolveLayers'));
const warm = app.slice(app.indexOf('function warmFieldLayers'), app.indexOf('async function fetchAll'));
assert.equal(warm.split('ensureStormMaps').length - 1, 1);
assert.match(warm, /layerFlags\.radar/);
assert.match(warm, /layerFlags\.warnings/);
assert.match(warm, /layerFlags\.reports/);

console.log('map-layers.test.mjs ok');

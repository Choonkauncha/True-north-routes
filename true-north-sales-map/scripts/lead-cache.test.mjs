import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createArrayCursor, leadCacheUsable, localStamp, mergeLeadDelta, newestUpdatedAt, nextObjectEnd, normalizeStamp, parseJsonArraySlice, planLeadSync, takeCompleteObjects } from '../lib/lead-cache.js';
import { STREET_ZOOM, clusterLeads, pinDiff, sampleHeat } from '../lib/pin-layer.js';

assert.equal(localStamp({ generated: '2026-10-08', totalRecords: 17232, mappedRecords: 17177 }), 'local:2026-10-08:17232:17177');
assert.equal(newestUpdatedAt([{ updated_at: '2026-10-01T00:00:00Z' }, { updatedAt: '2026-10-08T00:00:00Z' }]), '2026-10-08T00:00:00Z');
assert.equal(planLeadSync({ cachedCount: 0 }), 'full');
assert.equal(planLeadSync({ cachedStamp: '2026-10-08T00:00:00Z', cachedCount: 10, remoteCount: 10, remoteUpdatedAt: '2026-10-08T00:00:00Z' }), 'use-cache');
assert.equal(planLeadSync({ cachedStamp: '2026-10-01T00:00:00Z', cachedCount: 10, remoteCount: 10, remoteUpdatedAt: '2026-10-08T00:00:00Z' }), 'delta');
assert.equal(planLeadSync({ cachedStamp: '2026-10-08T00:00:00Z', cachedCount: 10, remoteCount: 9, remoteUpdatedAt: '2026-10-08T00:00:00Z' }), 'full');

const merged = mergeLeadDelta(
  [{ id: 'a', name: 'Old' }, { id: 'b', name: 'Keep' }],
  [{ id: 'a', name: 'New' }, { id: 'c', name: 'Added' }]
);
assert.deepEqual(merged.map((lead) => lead.name), ['New', 'Keep', 'Added']);
assert.deepEqual(mergeLeadDelta([{ id: 'a' }], []), [{ id: 'a' }]);
const kept = mergeLeadDelta(
  [{ id: 'a', name: 'Old', lat: 40.1, lng: -82.4 }, { id: 'b', lat: 1, lng: 2 }],
  [{ id: 'a', name: 'New', lat: null, lng: null }, { id: 'b', lat: 3, lng: 4 }]
);
assert.equal(kept.find((lead) => lead.id === 'a').lat, 40.1);
assert.equal(kept.find((lead) => lead.id === 'a').lng, -82.4);
assert.equal(kept.find((lead) => lead.id === 'a').name, 'New');
assert.equal(kept.find((lead) => lead.id === 'b').lat, 3);
assert.equal(leadCacheUsable({ leads: [{ id: 'a', address: '1 Main' }, { id: 'b' }] }), false);
assert.equal(leadCacheUsable({ leads: [{ id: 'a' }, { id: 'b', lat: 40.2, lng: -82.5 }] }), true);
assert.equal(leadCacheUsable(null), false);
assert.equal(leadCacheUsable({ leads: [] }), false);
assert.equal(planLeadSync({ cachedStamp: '2026-10-08T00:00:00Z', cachedCount: 0, remoteCount: 17235, remoteUpdatedAt: '2026-10-08T00:00:00Z' }), 'full');

const sample='[{"id":"a","note":"brace } stays"},{"id":"b","child":{"n":1}},{"id":"c"}]';
const cursor=createArrayCursor();
const firstEnd=nextObjectEnd(sample, cursor, 2);
assert.deepEqual(parseJsonArraySlice(sample, 0, firstEnd).map(row=>row.id), ['a','b']);
const secondEnd=nextObjectEnd(sample, cursor, 2);
assert.deepEqual(parseJsonArraySlice(sample, firstEnd, secondEnd).map(row=>row.id), ['c']);
assert.equal(parseJsonArraySlice(sample, secondEnd, sample.length).length, 0);
assert.equal(nextObjectEnd('', createArrayCursor(), 1), 0);
assert.equal(normalizeStamp('2026-10-08T15:00:00+00:00'), '2026-10-08T15:00:00.000Z');
assert.equal(normalizeStamp('local:2026-10-08:1:1'), 'local:2026-10-08:1:1');

const partial='[{"id":"a"},{"id":"b"';
const streamCursor=createArrayCursor();
const partialEnd=takeCompleteObjects(partial, streamCursor, 10);
assert.deepEqual(parseJsonArraySlice(partial, 0, partialEnd).map(row=>row.id), ['a']);
const rest=partial+'}]';
const restEnd=takeCompleteObjects(rest, streamCursor, 10);
assert.deepEqual(parseJsonArraySlice(rest, partialEnd, restEnd).map(row=>row.id), ['b']);

assert.equal(STREET_ZOOM, 16);
const diff = pinDiff(new Set(['a', 'b']), new Set(['b', 'c']));
assert.deepEqual(diff.remove, ['a']);
assert.deepEqual(diff.add, ['c']);

const clusters = clusterLeads([
  { lat: 40.39, lng: -82.48 },
  { lat: 40.3901, lng: -82.4801 },
  { lat: 41.2, lng: -81.5 },
  { lat: null, lng: null }
], 11);
assert.equal(clusters.length, 2);
assert.equal(clusters.reduce((sum, cluster) => sum + cluster.count, 0), 3);
assert.equal(sampleHeat(Array.from({ length: 8000 }, (_, index) => ({ lat: 40, lng: -82 - index / 10000 }))).length, 4000);

const root = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(root, '../app.js'), 'utf8');
const html = readFileSync(join(root, '../index.html'), 'utf8');
const css = readFileSync(join(root, '../styles.css'), 'utf8');
assert.ok(app.includes('readLeadCache'));
assert.ok(app.includes('leadCacheUsable'));
assert.ok(app.includes('leadLoadSettled'));
assert.ok(app.includes("state.mode==='cloud'&&!state.cloudReady"));
assert.ok(app.includes('rememberLeadCache'));
assert.equal(app.split('writeLeadCache(').length - 1, 1);

assert.ok(app.includes('clusterLeads'));
assert.ok(app.includes('requestAnimationFrame'));
assert.ok(app.includes('showMoreLeads'));
assert.ok(html.includes('id="mapLoader"'));
assert.ok(html.includes('id="bootText"'));
assert.ok(html.includes('id="bootBar"'));
assert.ok(html.includes('id="mapLoaderFact"'));
assert.ok(html.includes('class="bootEmblem" src="/brand/logo-full.webp"'));
assert.ok(html.includes('class="bootOutline"'));
assert.ok(html.includes('viewBox="0 0 960 724"'));
assert.ok(html.includes('pathLength="100"'));
assert.equal(html.includes('mapLoaderSpin'), false);
assert.equal(css.includes('bootSpin'), false);
assert.equal(css.includes('tnMapSpin'), false);
assert.ok(css.includes('bootOutlineTravel'));
assert.ok(css.includes('#1e6bff'));
assert.ok(css.includes('prefers-reduced-motion'));
assert.ok(css.includes('stroke-dasharray:none'));
assert.ok(css.includes('#0c1424') || css.includes('#0c1424'.replace('#', '')));

console.log('lead-cache.test.mjs ok');

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEAD_OVERLAY_COLUMNS, LEAD_OVERLAY_OR, STATIC_LEAD_SOURCES, mergeLeadOverlay, pageRanges } from '../lib/lead-sync.js';

assert.deepEqual(pageRanges(0), []);
assert.deepEqual(pageRanges(1000), [[0, 999]]);
assert.deepEqual(pageRanges(1001), [[0, 999], [1000, 1000]]);
assert.equal(pageRanges(17234).length, 18);
assert.equal(pageRanges(17234)[17][0], 17000);

const merged = mergeLeadOverlay(
  [{ id: 'a', name: 'Ada', lat: 1, status: 'New' }, { id: 'b', name: 'Bea', lat: null }],
  [{ id: 'a', status: 'Knocked', notes: 'Talked', lat: null, assigned_rep_id: 'rep-1' }, { id: 'b', lat: 40.2, lng: -82.4 }],
  [{ id: 'c', source: 'Homeowner public form', name: 'Cam', status: 'Interested', address: '1 Public Sq' }]
);
assert.equal(merged.find((lead) => lead.id === 'a').name, 'Ada');
assert.equal(merged.find((lead) => lead.id === 'a').status, 'Knocked');
assert.equal(merged.find((lead) => lead.id === 'a').lat, 1);
assert.equal(merged.find((lead) => lead.id === 'a').assigned_rep_id, 'rep-1');
assert.equal(merged.find((lead) => lead.id === 'b').lat, 40.2);
assert.equal(merged.find((lead) => lead.id === 'c').address, '1 Public Sq');
const keptPins = mergeLeadOverlay(
  [{ id: 'a', name: 'Ada', lat: 40.1, lng: -82.4 }],
  [],
  [{ id: 'a', name: 'Ada', lat: null, lng: null, status: 'New', source: 'Setter' }]
);
assert.equal(keptPins[0].lat, 40.1);
assert.equal(keptPins[0].lng, -82.4);
assert.equal(keptPins[0].status, 'New');
assert.ok(LEAD_OVERLAY_COLUMNS.split(',').includes('status'));
assert.ok(LEAD_OVERLAY_OR.includes('status.neq.New'));
assert.ok(STATIC_LEAD_SOURCES.includes('Knox Walk List'));

const root = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(root, '../app.js'), 'utf8');
const html = readFileSync(join(root, '../index.html'), 'utf8');
const sql = readFileSync(join(root, '../supabase/migrations/20261008_lead_map_boot.sql'), 'utf8');
assert.ok(app.includes('lead_map_boot'));
assert.ok(app.includes('Promise.all'));
assert.ok(app.includes('readLeadCache'));
assert.ok(app.includes('loadSideData'));
assert.ok(html.includes('qdovtewieuojjsebipex.supabase.co'));
assert.ok(html.includes('/vendor/leaflet/leaflet.js'));
assert.ok(html.includes('tile.openstreetmap.org'));
assert.equal(html.includes('unpkg.com'), false);
assert.equal(html.includes('apple-touch-icon'), false);
assert.ok(sql.includes('security invoker'));
assert.ok(sql.includes('grant execute on function public.lead_map_boot() to authenticated'));
assert.equal(sql.includes('security definer'), false);

console.log('lead-sync.test.mjs ok');

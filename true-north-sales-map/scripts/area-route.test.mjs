import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROUTE_STOP_LIMIT } from '../lib/route-picks.js';
import { orderNearest, pointInPolygon, routeFromArea } from '../lib/area-route.js';

const square = [
  { lat: 40, lng: -83 },
  { lat: 40, lng: -82 },
  { lat: 41, lng: -82 },
  { lat: 41, lng: -83 }
];
assert.equal(pointInPolygon({ lat: 40.5, lng: -82.5 }, square), true);
assert.equal(pointInPolygon({ lat: 39, lng: -80 }, square), false);
assert.equal(pointInPolygon({ lat: 40.5, lng: -82.5 }, square.slice(0, 2)), false);
assert.equal(pointInPolygon({ lat: null, lng: -82.5 }, square), false);

const closed = square.concat([{ lat: 40, lng: -83 }]);
assert.equal(pointInPolygon({ lat: 40.2, lng: -82.2 }, closed), true);
assert.equal(pointInPolygon({ lat: 42, lng: -82.5 }, closed), false);

const leads = [
  { id: 'far-high', lat: 40.9, lng: -82.9, score: 80 },
  { id: 'near-low', lat: 40.1, lng: -82.1, score: 5 },
  { id: 'mid', lat: 40.2, lng: -82.2, score: 40 },
  { id: 'out', lat: 39, lng: -80, score: 100 },
  { id: 'skip', lat: 40.5, lng: -82.5, score: -1000 },
  { id: 'unmapped', lat: null, lng: null, score: 90 }
];
const capped = routeFromArea(leads, square, {
  score: (lead) => lead.score,
  start: { lat: 40.1, lng: -82.1 },
  limit: 2
});
assert.deepEqual(capped.stops.map((lead) => lead.id), ['mid', 'far-high']);
assert.equal(capped.capped, true);
assert.equal(capped.leftOut, 1);
assert.equal(capped.inside, 4);

const fromHouse = routeFromArea(leads, square, { score: (lead) => lead.score, limit: 2 });
assert.equal(fromHouse.stops[0].id, 'far-high');
assert.equal(fromHouse.stops[1].id, 'mid');

const all = routeFromArea(leads, square, {
  score: (lead) => lead.score,
  start: { lat: 40.1, lng: -82.1 }
});
assert.deepEqual(all.stops.map((lead) => lead.id), ['near-low', 'mid', 'far-high']);
assert.equal(all.capped, false);
assert.equal(all.stops.some((lead) => lead.id === 'skip' || lead.id === 'out'), false);

const ordered = orderNearest(
  [{ id: 'b', lat: 1, lng: 1 }, { id: 'a', lat: 0, lng: 0 }],
  { lat: 0, lng: 0.1 }
);
assert.deepEqual(ordered.map((lead) => lead.id), ['a', 'b']);

assert.equal(routeFromArea(leads, [], { score: (lead) => lead.score }).stops.length, 0);
assert.equal(ROUTE_STOP_LIMIT, 80);
const many = Array.from({ length: 90 }, (_, index) => ({
  id: `h${String(index).padStart(2, '0')}`,
  lat: 40.1 + index * 0.001,
  lng: -82.5,
  score: 100 - index
}));
const limited = routeFromArea(many, square, { score: (lead) => lead.score, start: { lat: 40.1, lng: -82.5 } });
assert.equal(limited.stops.length, 80);
assert.equal(limited.capped, true);
assert.equal(limited.leftOut, 10);
assert.equal(limited.stops.some((lead) => lead.id === 'h89'), false);
assert.equal(limited.stops[0].id, 'h00');

const root = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(root, '../index.html'), 'utf8');
const app = readFileSync(join(root, '../app.js'), 'utf8');
assert.ok(html.includes('id="drawAreaBtn"'));
assert.ok(html.includes('id="drawAreaTrayBtn"'));
assert.ok(html.includes('id="drawCancel"'));
assert.ok(html.includes('id="drawClear"'));
assert.ok(app.includes('routeFromArea') || app.includes('bindAreaDraw'));
assert.ok(app.includes('function clearRoute'));

console.log('area-route.test.mjs ok');

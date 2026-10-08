import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ROUTE_STOP_LIMIT, pickRouteStops, routeToggleLabel, visibleRoutePool } from '../lib/route-picks.js';

assert.equal(ROUTE_STOP_LIMIT, 80);
assert.equal(routeToggleLabel(false), 'Add to route');
assert.equal(routeToggleLabel(true), 'Remove from route');

const view = ['a', 'b'];
const filtered = ['a', 'b', 'c'];
assert.deepEqual(visibleRoutePool(view, filtered), view);
assert.deepEqual(visibleRoutePool([], filtered), filtered);

const many = Array.from({ length: 90 }, (_, index) => `h${index}`);
const picked = pickRouteStops(many, ['h0', 'h1']);
assert.equal(picked.chosen.length, 78);
assert.equal(picked.leftOut, 10);
assert.equal(picked.capped, true);
assert.equal(picked.chosen.includes('h0'), false);

const room = pickRouteStops(['a', 'b', 'a'], []);
assert.deepEqual(room.chosen, ['a', 'b']);
assert.equal(room.capped, false);

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.ok(app.includes('visibleRoutePool'));
assert.ok(app.includes('pickRouteStops'));
assert.ok(app.includes('data-popup-route'));
assert.ok(app.includes('doorSheetRoute'));
assert.ok(app.includes('selectVisibleForRoute'));
assert.ok(app.includes('function clearRoute'));
assert.ok(app.includes('geocode_match:l.geocodeMatch??null'));
assert.ok(app.includes('lat:l.lat??null'));
assert.ok(app.includes('lng:l.lng??null'));
assert.ok(app.includes('showMoreLeads'));
assert.ok(!app.slice(app.indexOf('function selectVisibleForRoute'), app.indexOf('function clearRoute')).includes('role'));
assert.ok(html.includes('id="selectVisibleBtn"'));
assert.ok(html.includes('id="clearRouteBtn"'));
assert.ok(html.includes('id="doorSheetRoute"'));
assert.ok(app.includes("drawRoutePreview();$('routeDistance').textContent=`Road router unavailable"));

console.log('route-picks tests ok');

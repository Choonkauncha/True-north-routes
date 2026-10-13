import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { housePinAction, pinClickSlack, routeAddedMessage, ROUTE_PIN_COLOR } from '../lib/house-pin-tap.js';

assert.equal(housePinAction({ onRoute: false, viewOnly: false }), 'add');
assert.equal(housePinAction({ onRoute: true, viewOnly: false }), 'remove');
assert.equal(housePinAction({ onRoute: false, viewOnly: true }), 'open-detail');
assert.equal(housePinAction({ onRoute: true, viewOnly: true }), 'open-detail');
assert.equal(routeAddedMessage('10 North Main Street'), 'Added to route · 10 North Main Street');
assert.equal(routeAddedMessage('  '), 'Added to route · Property lead');
assert.equal(pinClickSlack(true), 18);
assert.ok(pinClickSlack(true) + 8 >= 22, 'phone hit area is at least 44px across');
assert.equal(ROUTE_PIN_COLOR, '#0f7a32');

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
assert.match(app, /function onHousePinTap\(id\)/);
assert.match(app, /function addHouseToRoute\(id\)/);
assert.match(app, /routeAddedMessage\(lead\?\.address\)/);
assert.match(app, /if\(state\.routeUndo\) undoRouteAdd\(\)/);
assert.match(app, /if\(state\.selected\.has\(id\)\|\|state\.routeViewOnly\)return;/);
assert.match(app, /marker\.on\('dblclick', event=>\{L\.DomEvent\.stop\(event\);\}/);
assert.match(app, /marker\.on\('click',\(\)=>state\.map\.setView\(\[cluster\.lat, cluster\.lng\], Math\.min\(STREET_ZOOM, zoom\+2\)\)\)/);
const cluster = app.slice(app.indexOf('clusters.forEach'), app.indexOf('syncRouteBadges();\n    return;'));
assert.equal(cluster.includes('addHouseToRoute'), false);
assert.match(app, /updateSelectedBadge\(\{expand:false\}\)/);
assert.match(app, /writeStoredRoutes\(localStorage, state\.assignedRoutes\)/);
assert.match(app, /if\(state\.doorUndo\) return;/);
assert.match(app, /if\(state\.routeUndo\) return;/);

console.log('House pin tap adds, retap removes, and view-only taps open details');

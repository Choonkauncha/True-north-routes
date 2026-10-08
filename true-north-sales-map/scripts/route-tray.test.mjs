import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MAP_FACTS } from '../lib/map-facts.js';
import { ROUTE_TRAY_KEY, routeTrayCollapsedByDefault, routeTraySummary, shouldExpandRouteTray } from '../lib/route-tray.js';

assert.equal(routeTraySummary(0, 'driving'), 'Route · 0 houses · Drive');
assert.equal(routeTraySummary(1, 'driving'), 'Route · 1 house · Drive');
assert.equal(routeTraySummary(3, 'walking'), 'Route · 3 houses · Walk');
assert.equal(routeTraySummary(3, 'driving'), 'Route · 3 houses · Drive');

assert.equal(routeTrayCollapsedByDefault({ saved: null, phone: true, houseCount: 0 }), true);
assert.equal(routeTrayCollapsedByDefault({ saved: null, phone: false, houseCount: 0 }), false);
assert.equal(routeTrayCollapsedByDefault({ saved: '0', phone: true, houseCount: 0 }), false);
assert.equal(routeTrayCollapsedByDefault({ saved: '1', phone: false, houseCount: 4 }), true);
assert.equal(routeTrayCollapsedByDefault({ saved: null, phone: true, houseCount: 2 }), false);

assert.equal(shouldExpandRouteTray(0, 1), true);
assert.equal(shouldExpandRouteTray(0, 4), true);
assert.equal(shouldExpandRouteTray(2, 3), false);
assert.equal(shouldExpandRouteTray(1, 0), false);
assert.equal(shouldExpandRouteTray(undefined, 0), false);

assert.ok(MAP_FACTS.length >= 15 && MAP_FACTS.length <= 20);
const banned = /\b\d+(\.\d+)?\s*%|\$\d+|studies show|clinically proven/i;
for (const fact of MAP_FACTS) {
  assert.equal(typeof fact, 'string');
  assert.ok(fact.length > 40 && fact.length < 180, fact);
  assert.equal(banned.test(fact), false, fact);
}

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const fieldCss = fs.readFileSync(new URL('../field-ops.css', import.meta.url), 'utf8');
const fieldJs = fs.readFileSync(new URL('../field-ops.js', import.meta.url), 'utf8');

assert.equal(ROUTE_TRAY_KEY, 'tnrc2:routeTrayCollapsed');
assert.ok(html.includes(ROUTE_TRAY_KEY));
assert.ok(html.includes('id="routeTrayToggle"'));
assert.ok(html.includes('aria-controls="routeTrayBody"'));
assert.ok(html.includes('id="mapLoader"'));
assert.ok(html.includes('/brand/logo-full.webp'));
assert.ok(app.includes('setRouteTrayCollapsed'));
assert.ok(app.includes('shouldExpandRouteTray'));
assert.ok(app.includes('settleMapLoader'));
assert.ok(app.includes('MAP_FACTS'));
assert.ok(css.includes('routeTrayStartCollapsed'));
assert.ok(css.includes('.mapLoader'));
assert.ok(css.includes('prefers-reduced-motion'));
assert.ok(fieldJs.includes("bar.appendChild(wrap)"));
assert.ok(fieldCss.includes('#mobileBar .tnFieldOps'));
assert.ok(fieldCss.includes('display:contents'));

console.log('route-tray tests ok');

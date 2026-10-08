import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SNAP_METERS,
  acquireScreenWakeLock,
  activeStep,
  bearingDegrees,
  createGpsFilter,
  createInterpolator,
  createReadoutThrottle,
  createRerouteGate,
  easeInOut,
  lerpAngle,
  lineLatLngs,
  maneuverText,
  arrowRotationDegrees,
  chooseTravelHeading,
  compassHeadingFromOrientation,
  navLookaheadPixels,
  navZoomFor,
  normalizeSteps,
  offsetCameraPoint,
  pointAlong,
  screenOffsetForLayerOffset,
  smoothBearing,
  snapToRoute,
  splitRoute
} from '../lib/nav-motion.js';

assert.ok(easeInOut(0.25) < 0.25);
assert.equal(easeInOut(0), 0);
assert.equal(easeInOut(1), 1);
assert.ok(Math.abs(lerpAngle(10, 350, 0.5) - 0) < 0.001 || Math.abs(lerpAngle(10, 350, 0.5) - 360) < 0.001);
assert.ok(Math.abs(bearingDegrees({ lat: 40, lng: -82 }, { lat: 41, lng: -82 }) - 0) < 1);

const filter = createGpsFilter();
assert.equal(filter.push({ lat: 40, lng: -82, accuracy: 200, heading: 10 }, 0), null);
const first = filter.push({ lat: 40.39, lng: -82.48, accuracy: 8, heading: 90 }, 1000);
assert.ok(first);
assert.equal(filter.push({ lat: 40.39001, lng: -82.48, accuracy: 8, heading: 90 }, 1500), null);
const moved = filter.push({ lat: 40.3904, lng: -82.48, accuracy: 8, heading: 0 }, 4000);
assert.ok(moved);
assert.ok(moved.lat > 40.39 && moved.lat < 40.3904);
assert.equal(filter.push({ lat: 41.2, lng: -82.48, accuracy: 8 }, 4200), null);

const clock = createInterpolator();
clock.setTarget({ lat: 0, lng: 0, heading: 0, interval: 1000 }, 0, false);
clock.setTarget({ lat: 0, lng: 10, heading: 90, interval: 1000 }, 0, false);
const mid = clock.sample(250);
assert.ok(mid.lng > 0 && mid.lng < 5);
const end = clock.sample(1000);
assert.ok(Math.abs(end.lng - 10) < 0.001);
clock.setTarget({ lat: 1, lng: 1, heading: 10, interval: 1000 }, 2000, true);
assert.equal(clock.sample(2000).lat, 1);

const line = [{ lat: 40, lng: -82 }, { lat: 40.01, lng: -82 }, { lat: 40.01, lng: -81.99 }];
const onLine = snapToRoute({ lat: 40.005, lng: -82.00005 }, line, SNAP_METERS);
assert.equal(onLine.snapped, true);
assert.ok(onLine.distance < SNAP_METERS);
const offLine = snapToRoute({ lat: 40.005, lng: -82.01 }, line, SNAP_METERS);
assert.equal(offLine.snapped, false);
assert.ok(offLine.distance > SNAP_METERS);

const gate = createRerouteGate({ offMeters: 40, holdMs: 3500, cooldownMs: 8000 });
assert.equal(gate.consider(10, 0), false);
assert.equal(gate.consider(80, 1000), false);
assert.equal(gate.consider(80, 4499), false);
assert.equal(gate.consider(80, 4500), true);
assert.equal(gate.consider(80, 5000), false);
assert.equal(gate.consider(5, 6000), false);
assert.equal(gate.consider(90, 20000), false);
assert.equal(gate.consider(90, 23500), true);

const readout = createReadoutThrottle(250);
assert.deepEqual(readout.push('Turn left', '1 min', 0, false), { title: 'Turn left', meta: '1 min' });
assert.equal(readout.push('Turn left', '1 min', 100, false), null);
assert.equal(readout.push('Turn right', '1 min', 100, false), null);
assert.equal(readout.flush(200), null);
assert.deepEqual(readout.flush(400), { title: 'Turn right', meta: '1 min' });
assert.deepEqual(readout.push('Arrive', '0 min', 500, true), { title: 'Arrive', meta: '0 min' });

const steps = normalizeSteps([
  { maneuver: { type: 'depart', modifier: '' }, name: 'Main', distance: 40 },
  { maneuver: { type: 'turn', modifier: 'left' }, name: 'Oak', distance: 100 },
  { type: 'arrive', name: 'Oak', distance: 10, endMeters: 150 }
]);
assert.equal(maneuverText(steps[1]), 'Turn left onto Oak');
assert.equal(activeStep(steps, 20).index, 0);
assert.equal(activeStep(steps, 50).step.type, 'turn');
assert.equal(activeStep(steps, 140).step.type, 'arrive');
assert.deepEqual(lineLatLngs({ type: 'LineString', coordinates: [[-82, 40], [-82, 40.1]] }), [{ lng: -82, lat: 40 }, { lng: -82, lat: 40.1 }]);

assert.equal(chooseTravelHeading({ gpsHeading: 90, speedMps: 4, compassHeading: 10, segmentBearing: 180 }), 90);
assert.equal(chooseTravelHeading({ gpsHeading: 90, speedMps: 0.2, compassHeading: 10, segmentBearing: 180 }), 10);
assert.equal(chooseTravelHeading({ speedMps: 0, segmentBearing: 45 }), 45);
assert.ok(Math.abs(smoothBearing(0, 90, 0.01) - 0) < 20);
assert.ok(Math.abs(smoothBearing(0, 90, 5) - 90) < 1);
const ahead = pointAlong([{ lat: 40, lng: -82 }, { lat: 40.001, lng: -82 }], 40);
assert.ok(ahead.lat > 40 && ahead.lat < 40.001);
const eastUp = screenOffsetForLayerOffset({ x: 40, y: 0 }, 90);
assert.ok(Math.abs(eastUp.x) < 0.01);
assert.ok(eastUp.y < -39);
assert.equal(Math.round(arrowRotationDegrees(90, 90)), 0);
assert.equal(Math.round(arrowRotationDegrees(0, 90)), 270);
const compass = compassHeadingFromOrientation({ webkitCompassHeading: 90 }, 0);
assert.equal(compass, 90);
assert.equal(compassHeadingFromOrientation({ absolute: true, alpha: 90 }, 0), 270);
assert.equal(navLookaheadPixels('driving', 20, 700) / 700 > 0.15, true);
assert.ok(navLookaheadPixels('driving', 20, 700) < 700 * 0.25);
assert.equal(navLookaheadPixels('walking', NaN, 700), 0);

assert.equal(navZoomFor('walking', 0), 18);
assert.equal(navZoomFor('foot', 3), 17.5);
assert.equal(navZoomFor('driving', 0), 16);
assert.equal(navZoomFor('driving', 13), 15.75);
assert.equal(navZoomFor('driving', 22), 15.5);
assert.ok(navZoomFor('driving', 40) < navZoomFor('walking', 0));
assert.ok(navZoomFor('driving', 0) <= 16);
assert.ok(navZoomFor('walking', 0) >= 17.5);
const north = offsetCameraPoint({ x: 100, y: 200 }, 0, 40);
assert.equal(north.x, 100);
assert.ok(north.y < 200);
const routeLine = [{ lat: 40, lng: -82 }, { lat: 40.001, lng: -82 }];
const parts = splitRoute(routeLine, 40);
assert.ok(parts.ahead.length >= 2);
assert.ok(parts.ahead[0].lat > routeLine[0].lat && parts.ahead[0].lat < routeLine[1].lat);
assert.ok(parts.traveled.length >= 2);

let asked = null;
const lock = await acquireScreenWakeLock({ wakeLock: { request: async (kind) => { asked = kind; return { release() {} }; } } });
assert.equal(asked, 'screen');
assert.ok(lock);
assert.equal(await acquireScreenWakeLock({}), null);

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../api/route.js', import.meta.url), 'utf8');
assert.ok(app.includes('requestAnimationFrame'));
assert.ok(app.includes('acquireScreenWakeLock'));
assert.ok(app.includes("textContent='Re-center'"));
assert.ok(app.includes('createGpsFilter'));
assert.ok(app.includes('snapToRoute'));
assert.ok(app.includes('prefers-reduced-motion') || app.includes('reducedMotion()'));
assert.ok(css.includes('.navArrow'));
assert.ok(api.includes('body.steps===true'));
assert.ok(!app.slice(app.indexOf('function beginInAppNav'), app.indexOf('function endNavigation')).includes('role==='));

const pages = fs.readdirSync(new URL('..', import.meta.url)).filter((name) => name.endsWith('.html'));
for (const name of pages) {
  const html = fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
  assert.ok(html.includes('background:#0c1424'), name);
  assert.ok(html.includes('/brand/transitions.css'), name);
  assert.ok(html.includes('/brand/prefetch.js'), name);
}
const transitions = fs.readFileSync(new URL('../brand/transitions.css', import.meta.url), 'utf8');
assert.ok(transitions.includes('@view-transition'));
assert.ok(transitions.includes('navigation: auto'));
assert.ok(transitions.includes('prefers-reduced-motion'));
const accounts = fs.readFileSync(new URL('../tn-files/accounts-admin.js', import.meta.url), 'utf8');
const forms = fs.readFileSync(new URL('../tn-files/my-forms.js', import.meta.url), 'utf8');
assert.ok(accounts.includes('accountsCacheReady'));
assert.ok(forms.includes('formDataCache'));
assert.ok(app.includes('restyle:false'));
assert.ok(app.includes('flyTo'));
assert.ok(app.includes('navZoomFor'));
assert.ok(app.includes('splitRoute'));
assert.ok(app.includes('maximumAge:0'));
assert.ok(app.includes('requestFullscreen'));
assert.ok(app.includes('setMapHeading'));
assert.ok(app.includes('webkitCompassHeading') || fs.readFileSync(new URL('../lib/nav-motion.js', import.meta.url), 'utf8').includes('webkitCompassHeading'));
assert.ok(css.includes('safe-area-inset'));
assert.ok(css.includes('.navCompass'));
assert.ok(css.includes('html.isNavigating .mapShell'));
assert.ok(css.includes('.navStop'));
assert.ok(!app.includes('Math.max(state.map.getZoom(),17)'));

console.log('nav-motion tests ok');

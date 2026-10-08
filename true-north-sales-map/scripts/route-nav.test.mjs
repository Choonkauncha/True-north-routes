import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ARRIVAL_METERS,
  appleDirectionsUrl,
  arrivedAtStop,
  etaSeconds,
  googleDirectionsUrl,
  googleTravelMode,
  isAppleDevice,
  metersBetween,
  osrmProfile,
  readNavChoice
} from '../lib/route-nav.js';

assert.equal(osrmProfile('driving'), 'driving');
assert.equal(osrmProfile('walking'), 'foot');
assert.equal(osrmProfile('foot'), 'foot');
assert.equal(googleTravelMode('walking'), 'walking');
assert.equal(googleTravelMode('driving'), 'driving');
assert.equal(ARRIVAL_METERS, 40);

const here = { lat: 40.3934, lng: -82.482 };
const near = { lat: 40.39355, lng: -82.482 };
const far = { lat: 40.4, lng: -82.49 };
assert.equal(arrivedAtStop(here, near), true);
assert.equal(arrivedAtStop(here, far), false);
assert.ok(metersBetween(here, near) < 40);
assert.ok(etaSeconds(1609, 'walking') > etaSeconds(1609, 'driving'));

const google = googleDirectionsUrl(here, far, 'walking');
assert.ok(google.includes('travelmode=walking'));
assert.ok(google.startsWith('https://www.google.com/maps/dir/'));
const apple = appleDirectionsUrl(here, [near, far], 'driving');
assert.ok(apple.includes('dirflg=d'));
assert.ok(apple.includes('+to:'));
assert.equal(readNavChoice('app'), 'app');
assert.equal(readNavChoice('google'), 'google');
assert.equal(readNavChoice('nope'), '');
assert.equal(isAppleDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), true);
assert.equal(isAppleDevice('Mozilla/5.0 (Linux; Android 14)'), false);

const api = fs.readFileSync(new URL('../api/route.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.ok(api.includes('trip/v1/${profile}'));
assert.ok(api.includes('route/v1/${profile}'));
assert.ok(api.includes("body.profile==='foot'"));
assert.ok(app.includes('watchPosition'));
assert.ok(html.includes('Navigate in app'));
assert.ok(html.includes('id="navRemember"'));
assert.ok(html.includes('id="trayDrive"'));
assert.ok(html.includes('id="trayWalk"'));
assert.ok(html.includes('id="startRouteBtn"'));
assert.ok(html.includes('id="navGoogleLeg"'));
assert.ok(html.includes('id="navChoiceBtn"'));
assert.ok(app.includes('osrmProfile(state.routeMode)'));
assert.ok(!app.slice(app.indexOf('function beginInAppNav'), app.indexOf('function endNavigation')).includes("role==="));

console.log('route-nav tests ok');

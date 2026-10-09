import assert from 'node:assert/strict';
import { handleRoute } from '../api/route.js';
import {
  ROUTE_MAX_COORDINATES,
  normalizeRouteRequest,
  routeServiceUrl
} from '../lib/route-request.js';

const valid = {
  profile: 'walking',
  service: 'route',
  steps: true,
  coordinates: [{ lat: '40.39', lng: '-82.48' }, { lat: 40.4, lng: -82.49 }]
};
const normalized = normalizeRouteRequest(valid);
assert.equal(normalizeRouteRequest({coordinates: Array.from({length:81},()=>({lat:40,lng:-82}))}).coordinates.length,81,'80 stops plus starting point');
assert.deepEqual(normalized.coordinates[0], { lat: 40.39, lng: -82.48 });
assert.equal(normalized.profile, 'foot');
assert.equal(normalized.service, 'route');
assert.equal(normalized.wantSteps, true);
assert.match(routeServiceUrl(normalized), /route\/v1\/foot\/-82\.48,40\.39;-82\.49,40\.4/);
assert.match(routeServiceUrl(normalized), /steps=true/);

for (const coordinates of [
  [],
  [{ lat: 40, lng: -82 }],
  Array.from({ length: ROUTE_MAX_COORDINATES + 1 }, () => ({ lat: 40, lng: -82 })),
  [{ lat: null, lng: -82 }, { lat: 40, lng: -82 }],
  [{ lat: '', lng: -82 }, { lat: 40, lng: -82 }],
  [{ lat: '   ', lng: -82 }, { lat: 40, lng: -82 }],
  [{ lat: true, lng: -82 }, { lat: 40, lng: -82 }],
  [{ lat: 'not-a-number', lng: -82 }, { lat: 40, lng: -82 }],
  [{ lat: 91, lng: -82 }, { lat: 40, lng: -82 }],
  [{ lat: 40, lng: -181 }, { lat: 40, lng: -82 }]
]) {
  assert.ok(normalizeRouteRequest({ coordinates }).error);
}

const request = (body, method = 'POST') => new Request('https://example.test/api/route', {
  method,
  headers: { 'content-type': 'application/json' },
  body: method === 'POST' ? body : undefined
});
assert.equal((await handleRoute(request('{}'))).status, 400);
assert.equal((await handleRoute(request('{bad json'))).status, 400);
assert.equal((await handleRoute(request('', 'GET'))).status, 405);

let upstreamUrl = '';
let upstreamOptions;
const routed = await handleRoute(request(JSON.stringify(valid)), {
  fetchImpl: async (url, options) => {
    upstreamUrl = url;
    upstreamOptions = options;
    return new Response(JSON.stringify({
      code: 'Ok',
      routes: [{
        geometry: { type: 'LineString', coordinates: [[-82.48, 40.39], [-82.49, 40.4]] },
        distance: 1200,
        duration: 300,
        legs: [{ steps: [{ distance: 1200, duration: 300, name: 'Main St', maneuver: { type: 'turn', modifier: 'left', location: [-82.48, 40.39] } }] }]
      }]
    }), { status: 200 });
  }
});
assert.equal(routed.status, 200);
assert.match(upstreamUrl, /steps=true/);
assert.equal(upstreamOptions.signal instanceof AbortSignal, true);
assert.equal(routed.headers.get('cache-control'), 'no-store');
const routeBody = await routed.json();
assert.equal(routeBody.steps[0].endMeters, 1200);
assert.equal(routeBody.profile, 'foot');

const upstreamFailure = await handleRoute(request(JSON.stringify(valid)), {
  fetchImpl: async () => new Response('down', { status: 503 })
});
assert.equal(upstreamFailure.status, 502);
assert.equal((await upstreamFailure.json()).error, 'Road router HTTP 503');

const invalidUpstream = await handleRoute(request(JSON.stringify(valid)), {
  fetchImpl: async () => new Response('not json', { status: 200 })
});
assert.equal(invalidUpstream.status, 502);

const missingRoute = await handleRoute(request(JSON.stringify(valid)), {
  fetchImpl: async () => Response.json({ code: 'Ok', routes: [] })
});
assert.equal(missingRoute.status, 502);

console.log('Route API validation, timeout, privacy and upstream-error tests passed.');

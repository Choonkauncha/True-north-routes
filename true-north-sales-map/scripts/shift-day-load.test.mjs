import assert from 'node:assert/strict';
import { createShiftDayLoader } from '../lib/shift-day-load.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

const requests = [];
const visible = [];
let authorized = true;
const loader = createShiftDayLoader({
  fetchDay(date) {
    const request = { date, ...deferred() };
    requests.push(request);
    return request.promise;
  },
  isAuthorized: () => authorized,
  onLoading: date => visible.push(['loading', date]),
  onSuccess: (data, date) => visible.push(['success', date, data.people]),
  onError: (error, date) => visible.push(['error', date, error.message])
});

// A slower old date must not replace the newest selection or its selected reps.
const old = loader.load('2026-10-07');
const newest = loader.load('2026-10-08');
requests[1].resolve({ people: ['newest-rep'] });
await newest;
requests[0].resolve({ people: ['old-rep'] });
await old;
assert.deepEqual(visible.at(-1), ['success', '2026-10-08', ['newest-rep']]);
assert.equal(visible.filter(item => item[0] === 'success').length, 1);

// A late failure has no right to replace an already successful newer day.
const lateFailure = loader.load('2026-10-06');
const next = loader.load('2026-10-09');
requests[3].resolve({ people: ['current-rep'] });
await next;
requests[2].reject(new Error('Older day failed'));
await lateFailure;
assert.deepEqual(visible.at(-1), ['success', '2026-10-09', ['current-rep']]);
assert.equal(visible.filter(item => item[0] === 'error').length, 0);

// Signing out, or replacing the authenticated session, invalidates pending work.
const logoutRequest = loader.load('2026-10-08');
const beforeLogout = visible.length;
authorized = false;
loader.invalidate();
requests[4].resolve({ people: ['private-rep'] });
await logoutRequest;
assert.equal(visible.length, beforeLogout);
await loader.load('2026-10-09');
assert.equal(requests.length, 5, 'Signed-out requests do not run');

authorized = true;
const firstSession = loader.load('2026-10-08');
loader.invalidate();
const secondSession = loader.load('2026-10-08');
requests[6].resolve({ people: ['second-session-rep'] });
await secondSession;
requests[5].reject(new Error('Previous session failed'));
await firstSession;
assert.deepEqual(visible.at(-1), ['success', '2026-10-08', ['second-session-rep']]);

// Current errors identify the requested day, and retry can succeed for that day.
const failed = loader.load('2026-10-07');
requests[7].reject(new Error('Network unavailable'));
await failed;
assert.deepEqual(visible.at(-1), ['error', '2026-10-07', 'Network unavailable']);
const retry = loader.load('2026-10-07');
requests[8].resolve({ people: [] });
await retry;
assert.deepEqual(visible.at(-1), ['success', '2026-10-07', []]);

console.log('Shift day loading: latest selection, late errors, session invalidation and retry passed.');

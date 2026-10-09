import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createDeferredAuthHandler } from '../lib/auth-events.js';

const wait = () => new Promise(resolve => setTimeout(resolve, 0));
const session = id => ({ access_token: `token-${id}`, user: { id, email: `${id}@example.com` } });
let locked = false;
const started = [], finished = [], invalidated = [], errors = [];
let finishA;
const aDone = new Promise(resolve => { finishA = resolve; });
const handler = createDeferredAuthHandler({
  onInvalidate: (event, next) => invalidated.push([event, next?.user.id]),
  async onSession(next, current) {
    assert.equal(locked, false, 'database requests must start outside the auth notification lock');
    started.push(next.user.id);
    if (next.user.id === 'A') await aDone;
    if (next.user.id === 'bad') throw new Error('profile read failed');
    if (current()) finished.push(next.user.id);
  },
  onError: error => errors.push(error.message)
});
function notify(event, next) {
  locked = true;
  assert.equal(handler(event, next), undefined, 'auth callback must not return an awaited promise');
  locked = false;
}
notify('SIGNED_IN', session('discarded'));
notify('SIGNED_OUT', null);
await wait();
assert.deepEqual(started, [], 'sign-out cancels a queued sign-in');
notify('SIGNED_IN', session('A'));
await wait();
notify('SIGNED_OUT', null);
notify('SIGNED_IN', session('B'));
await wait();
finishA();
await wait();
assert.deepEqual(finished, ['B'], 'late account A result must not repaint account B');
notify('SIGNED_IN', session('bad'));
await wait();
await wait();
assert.deepEqual(errors, ['profile read failed']);
notify('SIGNED_IN', session('C'));
await wait();
assert.equal(finished.at(-1), 'C', 'a failed account must not prevent retry');
assert.ok(invalidated.some(([event]) => event === 'SIGNED_OUT'));

// Exercise the actual app initialization functions, including stale failures and
// independent in-flight cleanup. No source-shape assertions stand in for behavior.
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const cloudSource = source.slice(source.indexOf('async function enterCloud('), source.indexOf('async function loadCloudData('));
const element = { textContent: '', className: '', hidden: false, classList: { add() {}, remove() {}, toggle() {} } };
const pending = new Map();
const fallback = [];
const state = { user: null, cloudReady: false, map: {}, config: {}, pendingPostSignIn: false };
const context = vm.createContext({
  state, console: { error() {} },
  $: () => element, hideLogin() {}, initMapOnce() {}, deferFieldTools() {}, settleMapLoader() {},
  canOpenManagement: () => false, rememberRole() {}, localStorage: {}, showPostSignIn() {},
  startRealtime() {}, updatePinBanner() {}, publishSideData() {},
  loadSideData: async () => {},
  loadLeadBundle: current => new Promise((resolve, reject) => pending.set(state.user.id, { resolve, reject, current })),
  enterLocal: message => fallback.push(message)
});
vm.runInContext(`let authEpoch=0, cloudToken='', cloudFlight=null; ${cloudSource}; globalThis.flight=()=>cloudFlight; globalThis.logout=()=>{authEpoch++;cloudToken='';cloudFlight=null;state.user=null;};`, context);
const first = context.enterCloud(session('A'));
context.logout();
const second = context.enterCloud(session('B'));
pending.get('A').reject(new Error('late account A failure'));
await first;
assert.equal(pending.get('A').current(), false);
assert.equal(fallback.length, 0, 'stale failure cannot enter local mode after account switch');
assert.ok(context.flight(), 'old flight cleanup cannot clear account B initialization');
pending.get('B').resolve();
await second;
assert.equal(state.user.id, 'B');
assert.equal(state.cloudReady, true);
assert.equal(context.flight(), null);

const bundleSource = source.slice(source.indexOf('async function loadLeadBundle('), source.indexOf('function publishSideData('));
let finishRows;
const rowsDone = new Promise(resolve => { finishRows = resolve; });
const bundleState = { supabase: { from: () => ({ select: () => ({ eq: () => ({ order() {} }), order() {} }) }) }, user: session('B').user, reps: ['B'], appointments: ['B'], activities: ['B'] };
const writes = [];
const bundleContext = vm.createContext({ state: bundleState, fetchAll: () => rowsDone, loadCloudLeadRows: async () => ['old-lead'], managementProfile: () => ({}), replaceLeads: rows => writes.push(rows) });
vm.runInContext(bundleSource, bundleContext);
let current = true;
const load = bundleContext.loadLeadBundle(() => current);
current = false;
finishRows([{ user_id: 'A' }]);
await load;
assert.deepEqual(bundleState.reps, ['B']);
assert.equal(writes.length, 0, 'old profile/lead bundle cannot write after sign-out');
await bundleContext.loadSideData(() => false);
assert.deepEqual(bundleState.appointments, ['B']);
assert.deepEqual(bundleState.activities, ['B'], 'late side-data reads cannot restore account A after logout');

const localSource = source.slice(source.indexOf('async function loadLocalDataset('), source.indexOf('function startStaticLeads('));
const localRows = [{ id: 'static', lat: 40, lng: -82 }];
const streamed = [];
const localContext = vm.createContext({
  authEpoch: 2, state: { staticManifest: { totalRecords: 1 }, staticPromise: Promise.resolve(localRows), bootDone: false },
  localStamp: () => 'local:stamp', localStorage: { getItem: () => null }, readLeadCache: async () => null,
  leadCacheUsable: () => false, $: () => element, fmt: String, initMapOnce() {},
  streamLeads: rows => streamed.push(rows), rememberLeadCache() {}
});
vm.runInContext(localSource, localContext);
await localContext.loadLocalDataset();
assert.deepEqual(streamed, [localRows], 'retained static source must repaint after sign-out scrub');
console.log('Deferred auth lock, ordering, account ownership, retry, and warm-source tests passed.');

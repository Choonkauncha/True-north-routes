/** Exercise the actual app sync flow with controlled read-only database responses. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { leadCacheUsable, mergeLeadDelta, newestUpdatedAt, normalizeStamp, planLeadSync } from '../lib/lead-cache.js';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const syncSource = source.slice(source.indexOf('async function loadCloudLeadRows(){'), source.indexOf('async function loadColdLeads('));
assert.ok(syncSource.startsWith('async function loadCloudLeadRows(){'));
const oldStamp = '2026-10-08T20:00:00.000Z';
const newStamp = '2026-10-08T21:00:00.000Z';
const original = { id: 'a', status: 'New', lat: 40.1, lng: -82.4 };

function scenario({ head = { count: 1 }, delta = [], pageError, newest = newStamp } = {}) {
  const saved = [], requests = [], cold = [];
  const cached = { stamp: oldStamp, leads: [{ ...original }] };
  const boot = { count: 1, newest, overlay: [], added: [] };
  const sb = {
    rpc: async () => ({ data: boot }),
    from(table) {
      assert.equal(table, 'leads');
      return { select(columns, options) {
        return { gt(column, since) {
          requests.push({ columns, options, column, since });
          return options?.head ? Promise.resolve(head) : { order: () => ({ query: 'delta' }) };
        } };
      } };
    },
  };
  const context = vm.createContext({
    state: { supabase: sb }, readLeadCache: async () => cached,
    leadCacheUsable, mergeLeadDelta, newestUpdatedAt, normalizeStamp, planLeadSync,
    normalizeLead: row => ({ ...row }),
    fetchAllParallel: async (makeBuilder, count) => {
      makeBuilder();
      assert.equal(count, head.count);
      if (pageError) throw pageError;
      return delta;
    },
    rememberLeadCache: (stamp, leads) => saved.push({ stamp, leads }),
    loadColdLeads: async (...args) => { cold.push(args); return ['fresh read']; },
  });
  vm.runInContext(syncSource, context);
  return { run: () => context.loadCloudLeadRows(), cached, saved, requests, cold };
}

const denied = new Error('changed-lead count failed');
const failed = scenario({ head: { count: null, error: denied } });
await assert.rejects(failed.run, error => error === denied);
assert.equal(failed.saved.length, 0, 'failed count must not advance the cache stamp');
assert.equal(failed.cached.stamp, oldStamp);
assert.equal(failed.cached.leads[0].status, 'New');

for (const count of [null, undefined, 0, -1, NaN, 1.5]) {
  const uncertain = scenario({ head: { count } });
  await uncertain.run();
  assert.equal(uncertain.cold.length, 1, `uncertain delta count ${count} requires a fresh read`);
  assert.equal(uncertain.saved.length, 0, 'delta path must not stamp stale data');
  assert.equal(uncertain.cold[0][3], newStamp);
}

const timeout = new Error('changed-lead page failed');
const partial = scenario({ pageError: timeout });
await assert.rejects(partial.run, error => error === timeout);
assert.equal(partial.saved.length, 0, 'failed delta page must not advance the cache stamp');

const recovered = scenario({ delta: [{ id: 'a', status: 'Interested', lat: null, lng: null }] });
const rows = await recovered.run();
assert.equal(rows[0].status, 'Interested');
assert.equal(rows[0].lat, original.lat, 'successful recovery retains the known pin');
assert.equal(rows[0].lng, original.lng);
assert.equal(recovered.saved[0].stamp, newStamp);
assert.ok(recovered.requests.every(request => request.since === oldStamp), 'retry reads from the last verified stamp');
assert.equal(recovered.cached.leads[0].status, 'New', 'merging must not mutate the old cache');

const current = scenario({ newest: oldStamp });
assert.equal(await current.run(), null);
assert.equal(current.requests.length, 0);
assert.equal(current.saved.length, 0);
console.log('Cloud lead sync failure, fallback, recovery and cache-hit tests passed.');

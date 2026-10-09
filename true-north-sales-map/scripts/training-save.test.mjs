import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createTrainingSaver, saveTrainingRow } from '../lib/training-save.js';

const identity = { userId: 'user-a', repId: 'rep-a', itemId: 'lesson-a' };
const row = { rep_id: 'rep-a', item_id: 'lesson-a', percent: 100, pages_viewed: [1], completed_at: '2026-10-09T08:00:00Z' };
const cfg = { url: 'https://example.test', publishableKey: 'public-test-key' };
const sb = { auth: { getSession: async () => ({ data: { session: { access_token: 'test-token', user: { id: identity.userId } } } }) } };
let requests = 0;
for (const status of [400, 401, 403, 500]) {
  await assert.rejects(saveTrainingRow({ sb, cfg, identity, row, fetchImpl: async () => ({ ok: false, status }) }), status === 401 || status === 403 ? /authorized/ : /failed/);
}
await assert.rejects(saveTrainingRow({ sb, cfg, identity, row, fetchImpl: async () => { throw new Error('offline'); } }), /connection/);
await assert.rejects(saveTrainingRow({ sb: { auth: { getSession: async () => ({ data: { session: null } }) } }, cfg, identity, row, fetchImpl: async () => { requests++; } }), /Sign in again/);
await assert.rejects(saveTrainingRow({ sb, cfg, identity: { ...identity, userId: 'new-account' }, row, fetchImpl: async () => { requests++; } }), /same account/);
await assert.rejects(saveTrainingRow({ sb, cfg, identity, row: { ...row, item_id: 'wrong-lesson' }, fetchImpl: async () => { requests++; } }), /does not match/);
assert.equal(requests, 0, 'Missing or changed identity must never send another account’s draft');
await saveTrainingRow({ sb, cfg, identity, row, keepalive: true, fetchImpl: async (url, options) => {
  assert.match(url, /training_progress\?on_conflict=rep_id,item_id/);
  assert.equal(options.keepalive, true);
  assert.equal(JSON.parse(options.body).completed_at, row.completed_at);
  assert.equal(options.headers.Authorization, 'Bearer test-token');
  return { ok: true, status: 204 };
} });

// A rejected completion remains a draft, not confirmed progress. Retry recovers it.
let reject = true;
const saver = createTrainingSaver({ write: async () => { if (reject) throw new Error('Service offline. Retry.'); } });
const failed = await saver.enqueue({ identity, row });
assert.match(failed.error, /offline/);
assert.equal(saver.stateFor(identity).confirmed, null);
assert.equal(saver.stateFor(identity).status, 'error');
assert.equal(saver.pendingFor(identity).completed_at, row.completed_at);
assert.equal(saver.unsavedFor('user-a', 'rep-a').length, 1);
assert.equal(saver.unsavedFor('user-b', 'rep-a').length, 0);
reject = false;
await saver.retry(identity);
assert.equal(saver.stateFor(identity).confirmed.completed_at, row.completed_at);
assert.equal(saver.stateFor(identity).status, 'saved');
assert.equal(saver.pendingFor(identity), null);

// In-flight older writes are serialized; newer snapshots and page arrays are immutable.
let release;
let calls = [];
const ordered = createTrainingSaver({ write: async ({ row: outgoing }) => {
  calls.push(outgoing);
  if (calls.length === 1) await new Promise((resolve) => { release = resolve; });
} });
const first = ordered.enqueue({ identity, row: { ...row, percent: 20, completed_at: null } });
await new Promise((resolve) => setImmediate(resolve));
const nextRow = { ...row, pages_viewed: [1, 2] };
const second = ordered.enqueue({ identity, row: nextRow });
nextRow.pages_viewed.push(3);
assert.equal(calls.length, 1, 'Second request must wait for the first response');
release();
await Promise.all([first, second]);
assert.deepEqual(calls.map((item) => item.percent), [20, 100]);
assert.deepEqual(calls[1].pages_viewed, [1, 2]);
assert.equal(ordered.stateFor(identity).confirmed.percent, 100);

// A snapshot captured before earlier completion was confirmed cannot undo it.
await ordered.enqueue({ identity, row: { ...row, percent: 50, completed_at: null } });
assert.equal(calls.at(-1).completed_at, row.completed_at);

// Late results belong to their captured lesson/user, never the current view.
const other = { userId: 'user-b', repId: 'rep-b', itemId: 'lesson-b' };
await ordered.enqueue({ identity: other, row: { ...row, rep_id: 'rep-b', item_id: 'lesson-b', percent: 35, completed_at: null } });
assert.equal(ordered.stateFor(identity).confirmed.item_id, 'lesson-a');
assert.equal(ordered.stateFor(identity).confirmed.completed_at, row.completed_at);
assert.equal(ordered.stateFor(other).confirmed.percent, 35);
assert.equal(ordered.stateFor(other).confirmed.completed_at, null);

// A stalled lesson must not block a different lesson/account queue.
let releaseBlocked;
const parallelCalls = [];
const parallel = createTrainingSaver({ write: async ({ identity: active }) => {
  parallelCalls.push(active.itemId);
  if (active.itemId === 'lesson-a') await new Promise((resolve) => { releaseBlocked = resolve; });
} });
const blocked = parallel.enqueue({ identity, row: { ...row, percent: 20, completed_at: null } });
await new Promise((resolve) => setImmediate(resolve));
const independent = parallel.enqueue({ identity: other, row: { ...row, rep_id: 'rep-b', item_id: 'lesson-b', percent: 35, completed_at: null } });
await independent;
assert.deepEqual(parallelCalls, ['lesson-a', 'lesson-b'], 'Independent lessons save without waiting on each other');
releaseBlocked();
await blocked;

const migration = fs.readFileSync(new URL('../supabase/migrations/20261009_training_progress_monotonic.sql', import.meta.url), 'utf8');
assert.match(migration, /new\.completed_at\s*:=\s*coalesce\(old\.completed_at, new\.completed_at\)/i);
assert.match(migration, /new\.percent\s*:=\s*greatest\(old\.percent, new\.percent\)/i);
assert.match(migration, /array_agg\(distinct page order by page\)/i);

console.log('training-save tests ok: rejection, auth isolation, recovery, per-lesson ordering and monotonic database merge');

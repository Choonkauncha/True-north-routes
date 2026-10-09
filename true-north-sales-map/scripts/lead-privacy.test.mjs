import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import middleware, { isPrivateLeadPath, config } from '../middleware.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// 1. Private lead files are never uploaded to Vercel.
const ignore = read('.vercelignore').split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
for (const entry of ['data/leads.json', 'data/*.csv', 'source', '*.csv']) assert.ok(ignore.includes(entry), `.vercelignore is missing ${entry}`);
for (const kept of ['data/city-centers.json', 'data/manifest.json', 'api', '*.html', '*.js']) assert.equal(ignore.includes(kept), false, `${kept} must stay deployed`);

// 2. The routing guard answers 404 for lead files and leaves the rest alone.
for (const path of ['/data/leads.json', '/DATA/Leads.json', '//data/leads.json', '/data/leads.csv', '/source', '/source/Roofing%20Leads_2026-10-06.csv', '/source/Knox%20High%20Priority%20Owner-Occupied%20v2.pdf']) {
  assert.equal(isPrivateLeadPath(path), true, path);
  const response = middleware(new Request(`https://truenorthmaps.vercel.app${path}`));
  assert.equal(response?.status, 404, path);
  assert.equal(response.headers.get('cache-control'), 'no-store');
}
for (const path of ['/', '/index.html', '/app.js', '/api/config', '/data/manifest.json', '/data/city-centers.json', '/admin']) {
  assert.equal(isPrivateLeadPath(path), false, path);
  assert.equal(middleware(new Request(`https://truenorthmaps.vercel.app${path}`)), undefined, path);
}
assert.deepEqual(config.matcher, ['/data/:path*', '/source/:path*', '/source']);

// 3. Only the two public map files get a long public cache header.
const vercel = JSON.parse(read('vercel.json'));
const dataHeaders = vercel.headers.filter((rule) => rule.source.startsWith('/data/'));
assert.deepEqual(dataHeaders.map((rule) => rule.source), ['/data/(city-centers|manifest).json']);

// 4. The app copes with a missing /data/leads.json.
const app = read('app.js');
const pick = (start, end) => {
  const from = app.indexOf(start);
  const to = app.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `cannot slice ${start}`);
  return app.slice(from, to);
};
const staticSource = pick('function startStaticLeads(', 'async function readLeadResponse(');
const coldSource = pick('async function loadColdLeads(', 'async function fetchOverlayRows(');
const localSource = pick('async function loadLocalDataset(', 'function startStaticLeads(');

const notFound = async () => ({ ok: false, status: 404 });
const element = { textContent: '', classList: { add() {}, remove() {}, toggle() {} } };

// 4a. Cloud mode: a 404 base resolves to [] and every lead is read from Supabase.
{
  const rows = Array.from({ length: 2500 }, (_, i) => ({ id: `L${i}`, lat: 40 + i / 1e5, lng: -82, updated_at: '2026-10-09T20:00:00Z' }));
  const ranges = [];
  const saved = [];
  const sb = {
    from(table) {
      assert.equal(table, 'leads');
      return { select(columns, options) {
        if (options?.head) return Promise.resolve({ count: rows.length, error: null });
        assert.equal(columns, '*');
        return { order: () => ({ range(from, to) { ranges.push([from, to]); return Promise.resolve({ data: rows.slice(from, to + 1), error: null }); } }) };
      } };
    },
  };
  const state = { staticPromise: null };
  const context = vm.createContext({
    state, authEpoch: 1, $: () => element, fmt: String, console: { error() {} },
    fetch: notFound, fetchJSON: async () => ({ totalRecords: 17232 }),
    ingestLeadText() { throw new Error('no static text'); }, readLeadResponse() { throw new Error('no static body'); },
    fetchOverlayRows: async () => [], fetchAddedRows: async () => [], fetchCoordFixes: async () => { throw new Error('no base fixes'); },
    mergeLeadOverlay() { throw new Error('no merge without base'); },
    pageRanges: (total, size) => { const out = []; for (let f = 0; f < total; f += size) out.push([f, Math.min(total, f + size) - 1]); return out; },
    normalizeLead: (lead) => ({ ...lead, status: lead.status || 'New' }),
    normalizeStamp: (value) => value || '', newestUpdatedAt: () => '2026-10-09T20:00:00Z',
    rememberLeadCache: (stamp, leads) => saved.push([stamp, leads.length]),
  });
  vm.runInContext(`${staticSource}\nasync function fetchAllParallel(makeBuilder, count){const total=Number(count);if(!Number.isFinite(total)||total<=0)return[];const pages=await Promise.all(pageRanges(total,1000).map(([f,t])=>makeBuilder().range(f,t)));const out=[];for(const r of pages){if(r.error)throw r.error;out.push(...(r.data||[]));}return out;}\n${coldSource}\nthis.startStaticLeads=startStaticLeads;this.loadColdLeads=loadColdLeads;`, context);
  assert.equal(JSON.stringify(await context.startStaticLeads()), '[]');
  assert.equal(state.staticUnavailable, true);
  const withCount = await context.loadColdLeads(sb, { count: rows.length }, rows.length, '2026-10-09T20:00:00Z', () => true);
  assert.equal(withCount.length, 2500, 'cloud mode must load every lead without the static file');
  assert.ok(withCount.every((lead) => lead.lat != null), 'pins keep their coordinates');
  assert.equal(JSON.stringify(ranges), JSON.stringify([[0, 999], [1000, 1999], [2000, 2499]]));
  const noCount = await context.loadColdLeads(sb, null, null, '', () => true);
  assert.equal(noCount.length, 2500, 'falls back to a head count when the boot RPC is missing');
  assert.deepEqual(saved.map(([, n]) => n), [2500, 2500]);
}

// 4b. A network error on the static file does not reject the shared promise.
{
  const state = { staticPromise: null };
  const context = vm.createContext({
    state, authEpoch: 1, $: () => element, fmt: String, console: { error() {} },
    fetch: async () => { throw new TypeError('offline'); }, fetchJSON: async () => null,
  });
  vm.runInContext(`${staticSource}\nthis.startStaticLeads=startStaticLeads;`, context);
  assert.equal(JSON.stringify(await context.startStaticLeads()), '[]');
}

// 4c. Local mode shows a sign-in notice instead of "Could not load command center".
for (const staticPromise of [Promise.resolve([]), null]) {
  const streamed = [];
  const notice = { textContent: '', hidden: true, classList: { add() {}, remove() { notice.hidden = false; }, toggle() {} } };
  const context = vm.createContext({
    authEpoch: 3, state: { staticManifest: { totalRecords: 17232 }, staticPromise, bootDone: false },
    localStamp: () => 'local', localStorage: { getItem: () => null }, readLeadCache: async () => null,
    leadCacheUsable: () => false, fmt: String, initMapOnce() {}, fetch: notFound,
    $: (id) => (id === 'cloudNotice' ? notice : element),
    streamLeads: (rows, total) => streamed.push([rows.length, total]), rememberLeadCache() { throw new Error('nothing to cache'); },
  });
  vm.runInContext(`${localSource}\nthis.loadLocalDataset=loadLocalDataset;`, context);
  await context.loadLocalDataset();
  assert.deepEqual(streamed, [[0, 0]], 'empty list settles the loader without a fake pin banner');
  assert.match(notice.textContent, /private/);
  assert.equal(notice.hidden, false);
}

// 4d. The obsolete "Initialize cloud data" import does not throw on a 404.
assert.match(pick('async function importLeadsToCloud(', 'async function syncTerritories('), /try\{ local=await fetchJSON\('\/data\/leads\.json'\); \}catch\{/);

// 5. Other pages already treat a missing file as an empty list.
assert.match(read('tn-files/store.js'), /if \(!response\.ok\) return \[\];/);

console.log('Lead privacy guard and missing-static-file tests passed.');

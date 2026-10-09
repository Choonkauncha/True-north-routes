import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { hydratePhotoUrls, listPhotoPage, listPhotos, photosForLead } from '../tn-files/store.js';

const lead = { id: 'old-house', address: '12 Main St', city: 'Columbus', state: 'OH' };
const fullAddress = '12 Main St, Columbus, OH';
const newer = Array.from({ length: 620 }, (_, i) => ({ id: `new-${i}`, lead_id: 'other-house', address_snapshot: '18 Main St, Columbus, OH', created_at: '2026-10-09', storage_path: `new/${i}` }));
const older = Array.from({ length: 53 }, (_, i) => ({ id: `old-${String(i).padStart(3, '0')}`, lead_id: lead.id, address_snapshot: fullAddress, created_at: '2026-09-01', storage_path: `old/${i}` }));
const legacy = { id: 'legacy', lead_id: null, address_snapshot: fullAddress.toUpperCase(), created_at: '2026-08-01', storage_path: 'old/legacy' };
const similar = { id: 'similar', lead_id: null, address_snapshot: `112 Main St, Columbus, OH`, created_at: '2026-08-02', storage_path: 'wrong/similar' };
const conflicting = { id: 'conflicting', lead_id: 'different-house', address_snapshot: fullAddress, created_at: '2026-08-02', storage_path: 'wrong/linked' };
const data = [...newer, ...older, legacy, similar, conflicting];

function fixture({ failReview = false, fail = false } = {}) {
  const requests = [], signed = [];
  let active = 0, peak = 0;
  const ctx = { mode: 'cloud', sb: {
    from(table) {
      assert.equal(table, 'lead_photos');
      const request = { table, orders: [] }; requests.push(request);
      const query = {
        select(columns) { request.columns = columns; return query; },
        or(filter) { request.filter = filter; return query; },
        order(column, options) { request.orders.push([column, options]); return query; },
        range(start, end) { request.range = [start, end]; return query; },
        then(resolve, reject) {
          if (fail) return Promise.resolve({ error: new Error('Read denied') }).then(resolve, reject);
          if (failReview && request.columns.includes('reviewed_at')) return Promise.resolve({ error: new Error('column reviewed_at does not exist') }).then(resolve, reject);
          // Check the real scope expression, then model the database applying that filter before paging.
          let rows = data;
          if (request.filter) {
            assert.equal(request.filter, 'lead_id.eq."old-house",and(lead_id.is.null,or(address_snapshot.ilike."12 Main St, Columbus, OH"))');
            rows = data.filter((row) => row.lead_id === lead.id || (!row.lead_id && row.address_snapshot.toLowerCase() === fullAddress.toLowerCase()));
          }
          rows = [...rows].sort((a,b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
          return Promise.resolve({ data: rows.slice(request.range[0], request.range[1] + 1) }).then(resolve, reject);
        }
      };
      return query;
    },
    storage: { from(bucket) { assert.equal(bucket, 'lead-photos'); return {
      async createSignedUrl(path) { signed.push(path); peak = Math.max(peak, ++active); await new Promise((resolve) => setImmediate(resolve)); --active; return { data: { signedUrl: `https://test.invalid/${path}` } }; }
    }; } }
  } };
  return { ctx, requests, signed, peak: () => peak };
}

const scoped = fixture();
let page = await listPhotoPage(scoped.ctx, { lead, pageSize: 24 });
assert.equal(page.photos.length, 24, 'an old property must load despite over500 newer unrelated photos');
assert.equal(page.nextOffset, 24);
assert.ok(page.photos.every((photo) => photo.lead_id === lead.id));
assert.equal(scoped.signed.length, 24, 'only returned rows get signed; lookahead row is metadata only');
assert.ok(scoped.peak() <= 4, 'storage work has a concurrency budget');
assert.deepEqual(scoped.requests[0].range, [0,24]);
assert.deepEqual(scoped.requests[0].orders, [['created_at', { ascending: false }], ['id', { ascending: false }]]);
const all = [...page.photos];
while (page.nextOffset !== null) {
  page = await listPhotoPage(scoped.ctx, { lead, offset: page.nextOffset, pageSize: 24 });
  all.push(...page.photos);
}
assert.equal(all.length, 54);
assert.equal(new Set(all.map((photo) => photo.id)).size, 54);
assert.ok(all.some((photo) => photo.id === legacy.id));
assert.ok(!all.some((photo) => photo.id === similar.id || photo.id === conflicting.id));
assert.equal(scoped.signed.length, 54);

const bank = fixture();
const bankPage = await listPhotoPage(bank.ctx, { pageSize: 100, signUrls: false });
assert.equal(bankPage.photos.length, 100);
assert.equal(bankPage.nextOffset, 100);
assert.equal(bank.signed.length, 0, 'property bank only needs metadata');
assert.ok(bankPage.photos.every((photo) => !photo.url));
const compatible = fixture();
assert.equal((await listPhotos(compatible.ctx)).length, 500, 'legacy document callers retain existing capped result contract');
assert.ok(compatible.peak() <= 4);
const metadata = fixture();
const metadataRows = await listPhotos(metadata.ctx, { signUrls: false });
assert.equal(metadata.signed.length, 0, 'management indexes load metadata without signing 500 images');
const opened = await hydratePhotoUrls(metadata.ctx, metadataRows.slice(0, 3));
assert.equal(metadata.signed.length, 3, 'only the opened property subset is signed');
assert.ok(opened.every((photo) => photo.url));
const fallback = fixture({ failReview: true });
const oldSchema = await listPhotoPage(fallback.ctx, { lead, pageSize: 1 });
assert.equal(oldSchema.photos.length, 1);
assert.equal(fallback.requests.length, 2);
assert.equal(fallback.requests[1].filter, fallback.requests[0].filter, 'old-schema fallback preserves the property scope');
await assert.rejects(listPhotoPage(fixture({ fail: true }).ctx, { lead }), /Read denied/);
await assert.rejects(listPhotoPage(fixture().ctx, { lead: {} }), /Choose a property/);
assert.deepEqual(photosForLead([legacy, similar, conflicting], lead), [legacy]);
assert.deepEqual(photosForLead([legacy, similar], { address: fullAddress }), [legacy]);

// Offline data follows the same scope and page contract without allocating image URLs for bank metadata.
const oldIndexedDB = globalThis.indexedDB;
const oldCreateUrl = URL.createObjectURL;
const blobUrls = [];
globalThis.indexedDB = { open() {
  const request = {};
  queueMicrotask(() => {
    request.result = { transaction() { return { objectStore() { return { getAll() {
      const read = {};
      queueMicrotask(() => { read.result = data.map((row) => ({ ...row, blob: new Blob(['photo']) })); read.onsuccess(); });
      return read;
    } }; } }; } };
    request.onsuccess();
  });
  return request;
} };
URL.createObjectURL = () => { const value = `blob:local-${blobUrls.length}`; blobUrls.push(value); return value; };
try {
  const localBank = await listPhotoPage({ mode: 'local' }, { signUrls: false, pageSize: 100 });
  assert.equal(localBank.photos.length, 100);
  assert.equal(blobUrls.length, 0);
  const localHouse = await listPhotoPage({ mode: 'local' }, { lead, pageSize: 24 });
  assert.equal(localHouse.photos.length, 24);
  assert.equal(localHouse.nextOffset, 24);
  assert.equal(blobUrls.length, 24, 'only the visible offline gallery page creates blob URLs');
  assert.ok(localHouse.photos.every((photo) => photo.lead_id === lead.id));
} finally {
  globalThis.indexedDB = oldIndexedDB;
  URL.createObjectURL = oldCreateUrl;
}
const bounded = fixture();
await listPhotoPage(bounded.ctx, { offset: -1, pageSize: 50000, signUrls: false });
assert.deepEqual(bounded.requests[0].range, [0, 100]);

// Exercise the actual asynchronous gallery function against an out-of-order response.
const source = readFileSync(new URL('../tn-files/photo-page.js', import.meta.url), 'utf8');
const functionSource = source.slice(source.indexOf('async function loadGallery('), source.indexOf('\nfunction editNote('));
const resolvers = [], paints = [];
const gallery = { isConnected: true, innerHTML: '', querySelector: () => null, setAttribute() {}, removeAttribute() {} };
const context = vm.createContext({
  galleryGeneration: 0, galleryPhotos: [], galleryOffset: 0, ctx: {}, lead,
  document: { getElementById: () => gallery },
  releaseGalleryPhotos() { context.galleryPhotos = []; },
  listPhotoPage: () => new Promise((resolve) => resolvers.push(resolve)),
  paintGallery: () => paints.push(context.galleryPhotos.map((photo) => photo.id)),
  URL, Set,
});
vm.runInContext(functionSource, context);
const first = context.loadGallery();
const second = context.loadGallery();
resolvers[1]({ photos: [{ id: 'latest' }], nextOffset: null });
await second;
resolvers[0]({ photos: [{ id: 'stale' }], nextOffset: null });
await first;
assert.equal(paints.length, 1);
assert.deepEqual(Array.from(context.galleryPhotos, (photo) => photo.id), ['latest'], 'older gallery response cannot replace the latest view');
console.log('photo-loading tests ok: scoped paging, legacy fallback, signing bounds, schema errors, stale responses');

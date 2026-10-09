/**
 * Signed-in boot trace at phone size.
 * Chrome Fast 4G (8.1 Mbps down, 1.35 Mbps up, 165ms request latency) and 4x CPU.
 * Prints cold and warm time-to-first-pins plus requests started before those pins.
 *
 *   node scripts/boot-trace.mjs
 */
import { createServer } from 'node:http';
import { readFileSync, createReadStream, existsSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const puppeteerPath = process.env.PUPPETEER_CORE
  || '/tmp/ppt/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
const puppeteer = (await import(pathToFileURL(puppeteerPath).href)).default;

const root = fileURLToPath(new URL('..', import.meta.url));
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const LABEL = process.env.BOOT_LABEL || 'trace';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const REP_ID = '11111111-1111-4111-8111-111111111111';
const STATIC_SOURCES = new Set(['Roofing Leads CSV', 'Knox Owner-Occupied', 'Knox Walk List']);
const FAST_4G = {
  offline: false,
  latency: 165,
  downloadThroughput: 9 * 1000 * 1000 / 8 * 0.9,
  uploadThroughput: 1.5 * 1000 * 1000 / 8 * 0.9
};

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json'
};

function toDb(lead) {
  return {
    id: lead.id,
    source: lead.source,
    name: lead.name,
    address: lead.address,
    secondary_address: lead.secondaryAddress || '',
    city: lead.city,
    state: lead.state,
    zip: lead.zip,
    full_address: lead.fullAddress,
    record_id: lead.recordId || null,
    record_type: lead.recordType || null,
    year_built: lead.yearBuilt ?? null,
    priority: lead.priority || null,
    owner_occupied: lead.ownerOccupied || null,
    pdf_page: lead.pdfPage ?? null,
    lat: lead.lat ?? null,
    lng: lead.lng ?? null,
    geocode_match: lead.geocodeMatch ?? null,
    status: 'New',
    assigned_rep_id: null,
    territory_id: null,
    roof_age_years: null,
    roof_age_verified: false,
    notes: null,
    updated_at: '2026-10-08T12:00:00.000Z',
    updated_by: null
  };
}

function loadDb() {
  const raw = JSON.parse(readFileSync(join(root, 'data/leads.json'), 'utf8'));
  const leads = raw.map(toDb);
  leads.sort((a, b) => String(a.city).localeCompare(String(b.city)) || String(a.address).localeCompare(String(b.address)) || String(a.id).localeCompare(String(b.id)));
  for (let i = 0; i < 40; i++) {
    leads[i].status = i % 2 ? 'No Answer' : 'Knocked';
    leads[i].notes = 'Door worked';
    leads[i].assigned_rep_id = REP_ID;
    leads[i].roof_age_years = 12 + (i % 5);
    leads[i].roof_age_verified = true;
    leads[i].updated_at = '2026-10-08T15:00:00.000Z';
    leads[i].updated_by = REP_ID;
  }
  let fixed = 0;
  for (const lead of leads) {
    if (lead.lat == null && fixed < 5) {
      lead.lat = 40.39;
      lead.lng = -82.48;
      lead.geocode_match = 'Cloud';
      fixed++;
    }
  }
  leads.push({
    id: 'homeowner-boot-1',
    source: 'Homeowner public form',
    name: 'NEW HOMEOWNER',
    address: '1 PUBLIC SQ',
    secondary_address: '',
    city: 'Mount Vernon',
    state: 'OH',
    zip: '43050',
    full_address: '1 PUBLIC SQ, Mount Vernon, OH 43050',
    record_id: null,
    record_type: null,
    year_built: 1978,
    priority: 'High',
    owner_occupied: 'Y',
    pdf_page: null,
    lat: 40.3934,
    lng: -82.4859,
    geocode_match: 'Exact',
    status: 'Interested',
    assigned_rep_id: REP_ID,
    territory_id: null,
    roof_age_years: 18,
    roof_age_verified: false,
    notes: 'Called in',
    updated_at: '2026-10-08T15:00:00.000Z',
    updated_by: REP_ID
  });
  leads.push({
    id: 'homeowner-boot-2',
    source: 'Homeowner public form',
    name: 'SECOND HOMEOWNER',
    address: '2 PUBLIC SQ',
    secondary_address: '',
    city: 'Mount Vernon',
    state: 'OH',
    zip: '43050',
    full_address: '2 PUBLIC SQ, Mount Vernon, OH 43050',
    record_id: null,
    record_type: null,
    year_built: 1964,
    priority: null,
    owner_occupied: 'Y',
    pdf_page: null,
    lat: 40.394,
    lng: -82.486,
    geocode_match: 'Exact',
    status: 'Interested',
    assigned_rep_id: null,
    territory_id: null,
    roof_age_years: null,
    roof_age_verified: false,
    notes: null,
    updated_at: '2026-10-08T15:00:00.000Z',
    updated_by: null
  });
  return leads;
}

const db = {
  leads: loadDb(),
  reps: [{ id: REP_ID, user_id: USER_ID, name: 'Casey Setter', role: 'appointment_setter', active: true, email: 'setter@truenorth.example' }],
  territories: [{ id: '33333333-3333-4333-8333-333333333333', name: 'Mount Vernon', city: 'Mount Vernon', assigned_rep_id: REP_ID, center_lat: 40.393, center_lng: -82.486 }],
  appointments: [{
    id: '44444444-4444-4444-8444-444444444444',
    lead_id: 'homeowner-boot-1',
    canvasser_id: REP_ID,
    salesperson_id: REP_ID,
    scheduled_at: '2026-10-09T15:00:00.000Z',
    stage: 'Scheduled',
    notes: 'Afternoon',
    canvasser: { id: REP_ID, name: 'Casey Setter' },
    salesperson: { id: REP_ID, name: 'Casey Setter' }
  }],
  lead_activity: [{
    id: '55555555-5555-4555-8555-555555555555',
    lead_id: 'pending',
    actor_id: REP_ID,
    action: 'status',
    metadata: { to_status: 'Knocked' },
    created_at: '2026-10-08T15:00:00.000Z',
    actor: { name: 'Casey Setter' }
  }]
};

db.lead_activity[0].lead_id = db.leads[0].id;

const session = {
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  token_type: 'bearer',
  expires_in: 60 * 60 * 24 * 30,
  expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
  user: {
    id: USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'setter@truenorth.example',
    app_metadata: { provider: 'email' },
    user_metadata: { name: 'Casey Setter' },
    created_at: '2026-10-01T00:00:00.000Z'
  }
};

function needsOverlay(lead) {
  return lead.status !== 'New'
    || lead.assigned_rep_id
    || lead.territory_id
    || lead.roof_age_years != null
    || lead.roof_age_verified === true
    || (lead.notes != null && lead.notes !== '')
    || lead.updated_by;
}

function project(row, select) {
  if (!select || select === '*' || select.includes('*') || select.includes('(')) return row;
  const out = {};
  for (const column of select.split(',')) {
    const key = column.trim();
    if (key) out[key] = row[key] ?? null;
  }
  return out;
}

function splitList(value) {
  const body = value.trim().replace(/^\(/, '').replace(/\)$/, '');
  const parts = [];
  let current = '';
  let quoted = false;
  for (const char of body) {
    if (char === '"') { quoted = !quoted; continue; }
    if (char === ',' && !quoted) { parts.push(current); current = ''; continue; }
    current += char;
  }
  if (current) parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

function matchClause(row, clause) {
  const dot = clause.indexOf('.');
  if (dot < 0) return false;
  const column = clause.slice(0, dot);
  let rest = clause.slice(dot + 1);
  let negate = false;
  if (rest.startsWith('not.')) { negate = true; rest = rest.slice(4); }
  const opDot = rest.indexOf('.');
  const op = opDot === -1 ? rest : rest.slice(0, opDot);
  const value = opDot === -1 ? '' : rest.slice(opDot + 1);
  const current = row[column];
  let ok = false;
  if (op === 'is') ok = value === 'null' ? current == null : String(current) === value;
  else if (op === 'eq') ok = value === 'true' ? current === true : value === 'false' ? current === false : String(current ?? '') === value;
  else if (op === 'neq') ok = String(current ?? '') !== value;
  else if (op === 'gt') ok = String(current ?? '') > value;
  else if (op === 'in') ok = splitList(value).includes(String(current ?? ''));
  else ok = false;
  return negate ? !ok : ok;
}

function applyFilters(rows, url) {
  let next = rows.slice();
  const or = url.searchParams.get('or');
  if (or) {
    const clauses = splitList(or.startsWith('(') ? or : `(${or})`);
    next = next.filter((row) => clauses.some((clause) => matchClause(row, clause)));
  }
  for (const [key, value] of url.searchParams.entries()) {
    if (['select', 'order', 'limit', 'offset', 'apikey', 'on_conflict', 'or'].includes(key)) continue;
    next = next.filter((row) => matchClause(row, `${key}.${value}`));
  }
  const orders = url.searchParams.getAll('order').flatMap((item) => item.split(','));
  if (orders.length) {
    next.sort((a, b) => {
      for (const order of orders) {
        const [column, direction] = order.split('.');
        const av = a[column] ?? '';
        const bv = b[column] ?? '';
        const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
        if (cmp) return direction === 'desc' ? -cmp : cmp;
      }
      return 0;
    });
  }
  return next;
}

function tableRows(name) {
  if (name === 'leads') return db.leads;
  if (name === 'reps') return db.reps;
  if (name === 'territories') return db.territories;
  if (name === 'appointments') return db.appointments;
  if (name === 'lead_activity') return db.lead_activity;
  return [];
}

function bootPayload() {
  const newest = db.leads.reduce((max, lead) => lead.updated_at > max ? lead.updated_at : max, '');
  const overlay = db.leads.filter(needsOverlay).map((lead) => ({
    id: lead.id,
    status: lead.status,
    assigned_rep_id: lead.assigned_rep_id,
    territory_id: lead.territory_id,
    roof_age_years: lead.roof_age_years,
    roof_age_verified: lead.roof_age_verified,
    notes: lead.notes,
    updated_at: lead.updated_at,
    updated_by: lead.updated_by,
    lat: lead.lat,
    lng: lead.lng,
    geocode_match: lead.geocode_match
  }));
  const added = db.leads.filter((lead) => !STATIC_SOURCES.has(lead.source));
  return { count: db.leads.length, newest, overlay, added };
}

function send(res, status, body, headers, acceptGzip) {
  const extra = { ...headers };
  let payload = body;
  if (payload && acceptGzip && payload.length > 800) {
    payload = gzipSync(payload);
    extra['content-encoding'] = 'gzip';
  }
  extra['content-length'] = Buffer.byteLength(payload || '');
  res.writeHead(status, extra);
  if (payload && res.req?.method !== 'HEAD') res.end(payload);
  else res.end();
}

const jsonCache = new Map();
function sendJson(req, res, status, value, headers = {}) {
  const gzip = String(req.headers['accept-encoding'] || '').includes('gzip');
  const key = `${req.method} ${req.url} ${req.headers.range || ''} ${gzip ? 1 : 0}`;
  let hit = jsonCache.get(key);
  if (!hit) {
    let body = Buffer.from(JSON.stringify(value));
    const extra = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers };
    if (gzip && body.length > 800) {
      body = gzipSync(body);
      extra['content-encoding'] = 'gzip';
    }
    extra['content-length'] = body.length;
    hit = { body, extra };
    jsonCache.set(key, hit);
  }
  res.writeHead(status, hit.extra);
  if (req.method === 'HEAD') res.end();
  else res.end(hit.body);
}

const fileGzip = new Map();
function gzippedFile(filePath) {
  let body = fileGzip.get(filePath);
  if (!body) {
    body = gzipSync(readFileSync(filePath));
    fileGzip.set(filePath, body);
  }
  return body;
}

function serveFile(req, res, filePath) {
  if (!filePath.startsWith(root) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    res.writeHead(404); res.end('missing'); return;
  }
  const type = TYPES[extname(filePath)] || 'application/octet-stream';
  const headers = { 'content-type': type, 'cache-control': filePath.includes('/data/') ? 'public, max-age=86400' : 'public, max-age=3600' };
  const gzip = String(req.headers['accept-encoding'] || '').includes('gzip') && !['.png', '.webp', '.ico'].includes(extname(filePath));
  if (!gzip) {
    res.writeHead(200, headers);
    if (req.method === 'HEAD') res.end();
    else createReadStream(filePath).pipe(res);
    return;
  }
  const body = gzippedFile(filePath);
  headers['content-encoding'] = 'gzip';
  headers['content-length'] = body.length;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') res.end();
  else res.end(body);
}

function handle(req, res) {
  const host = req.headers.host || '127.0.0.1';
  const url = new URL(req.url, `http://${host}`);
  if (url.pathname === '/api/config') {
    sendJson(req, res, 200, {
      configured: true,
      url: `http://${host}`,
      publishableKey: 'test-publishable-key',
      adminEmails: ['truenorthrestorationss@gmail.com', 'travisbishopmackie@gmail.com', 'spencer@truenorthrestorationsohio.com'],
      homeownerFormUrl: `http://${host}/homeowner.html`,
      setterFormUrl: `http://${host}/setter.html`
    });
    return;
  }
  if (url.pathname === '/api/field') {
    sendJson(req, res, 200, {
      rep: db.reps[0],
      isField: true,
      openShift: null,
      consent: { consented_at: '2026-10-01T00:00:00.000Z' },
      threads: [],
      messages: []
    });
    return;
  }
  if (url.pathname === '/api/weather' || url.pathname === '/api/storm-maps') {
    sendJson(req, res, 200, url.pathname.endsWith('weather') ? { forecast: null, alerts: [] } : { radar: [], warnings: [], reports: [] });
    return;
  }
  if (url.pathname === '/auth/v1/token' || url.pathname === '/auth/v1/user') {
    sendJson(req, res, 200, url.pathname.endsWith('user') ? session.user : session);
    return;
  }
  if (url.pathname === '/rest/v1/rpc/lead_map_boot') {
    sendJson(req, res, 200, bootPayload());
    return;
  }
  if (url.pathname.startsWith('/rest/v1/')) {
    const name = url.pathname.split('/')[3];
    const rows = applyFilters(tableRows(name), url);
    const total = rows.length;
    const range = String(req.headers.range || '');
    const offset = Number(url.searchParams.get('offset') || 0);
    const limitParam = url.searchParams.get('limit');
    let start = Number.isFinite(offset) ? offset : 0;
    let end = total - 1;
    if (limitParam != null) {
      const limit = Number(limitParam);
      end = total ? Math.min(total - 1, start + Math.max(0, limit) - 1) : -1;
    } else if (/^\d+-\d+$/.test(range)) {
      const [from, to] = range.split('-').map(Number);
      start = from;
      end = Math.min(to, total - 1);
    }
    const slice = start >= total || end < start ? [] : rows.slice(start, end + 1);
    const select = url.searchParams.get('select') || '*';
    const body = slice.map((row) => project(row, select));
    const contentRange = slice.length ? `${start}-${start + slice.length - 1}/${total}` : `*/${total}`;
    if (req.method === 'HEAD') {
      send(res, 200, '', {
        'content-type': 'application/json',
        'content-range': `*/${total}`,
        'cache-control': 'no-store'
      }, false);
      return;
    }
    sendJson(req, res, range ? 206 : 200, body, { 'content-range': contentRange });
    return;
  }
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const filePath = normalize(join(root, pathname));
  serveFile(req, res, filePath);
}

const seen = [];
const server = createServer((req, res) => {
  seen.push(`${req.method} ${req.url}`);
  try { handle(req, res); }
  catch (error) {
    console.error(error);
    res.writeHead(500); res.end(String(error.message || error));
  }
});

gzippedFile(join(root, 'data/leads.json'));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const origin = `http://127.0.0.1:${port}`;
console.error(`serving ${origin} leads=${db.leads.length}`);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', `--user-data-dir=/tmp/tn-chrome-${LABEL}-${Date.now()}`]
});

const sent = [];
async function instrument(page) {
  const client = await page.createCDPSession();
  await client.send('Network.enable');
  client.on('Network.requestWillBeSent', (event) => {
    sent.push({ url: event.request.url, wall: event.wallTime * 1000, type: event.type || '' });
  });
  await page.evaluateOnNewDocument((stored) => {
    localStorage.setItem('sb-127-auth-token', stored);
    window.__tnFirstPins = 0;
    const latch = () => {
      if (window.__tnFirstPins) return true;
      if (document.documentElement?.dataset?.tnPins === '1' || document.querySelector('.pinCluster')) {
        window.__tnFirstPins = performance.now();
        return true;
      }
      return false;
    };
    const arm = () => {
      new MutationObserver(latch).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-tn-pins'] });
      latch();
    };
    if (document.documentElement) arm();
    else document.addEventListener('DOMContentLoaded', arm);
  }, JSON.stringify(session));
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  if (!process.env.SKIP_THROTTLE) {
    await client.send('Network.emulateNetworkConditions', FAST_4G);
    await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  return client;
}

function summarize(metrics, before) {
  const pins = metrics.firstPins || 0;
  const kind = (name) => {
    if (/tile\.openstreetmap\.org/.test(name)) return 'tile';
    if (/\/rest\/v1\/leads/.test(name) || /lead_map_boot/.test(name) || /\/data\/leads\.json/.test(name)) return 'leads';
    if (/\/rest\/v1\/|\/api\/|\/auth\//.test(name)) return 'api';
    if (/unpkg|jsdelivr|leaflet/.test(name)) return 'library';
    if (/logo-full|apple-touch/.test(name)) return 'brand';
    return 'other';
  };
  const counts = {};
  for (const entry of before) counts[kind(entry.url)] = (counts[kind(entry.url)] || 0) + 1;
  return {
    firstPinsMs: Math.round(pins),
    requestsBeforePins: before.length,
    requestKinds: counts,
    leadRequests: (counts.leads || 0)
  };
}

async function measure(page, phase) {
  const started = Date.now();
  const sentFrom = sent.length;
  page.on('console', (msg) => console.error(`console ${phase}`, msg.type(), msg.text()));
  page.on('pageerror', (error) => console.error(`pageerror ${phase}`, error.message));
  page.on('requestfailed', (request) => console.error(`failed ${phase}`, request.url(), request.failure()?.errorText));
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  const pinWait = Number(process.env.PIN_TIMEOUT || 180000);
  try {
    await page.waitForFunction(() => window.__tnFirstPins > 0, { timeout: pinWait, polling: 100 });
  } catch (error) {
    const debug = await page.evaluate(() => ({
      text: document.body?.innerText?.slice(0, 500) || '',
      login: document.getElementById('loginModal')?.className || '',
      connection: document.getElementById('connection')?.textContent || '',
      boot: document.getElementById('bootText')?.textContent || '',
      clusters: document.querySelectorAll('.pinCluster').length,
      keys: Object.keys(localStorage)
    }));
    console.error('debug', JSON.stringify(debug));
    console.error('requests', seen.slice(0, 80).join('\n'));
    await page.screenshot({ path: `/tmp/tn-boot-${LABEL}-${phase}-fail.png` });
    throw error;
  }
  const metrics = await page.evaluate(() => ({
      firstPins: window.__tnFirstPins,
      timeOrigin: performance.timeOrigin,
    resources: performance.getEntriesByType('resource').map((entry) => ({
      name: entry.name,
      start: entry.startTime,
      end: entry.responseEnd
    })),
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    loginOpen: !document.getElementById('loginModal')?.classList.contains('hidden'),
    connection: document.getElementById('connection')?.textContent || '',
    pins: document.querySelectorAll('.pinCluster').length
  }));
  await page.screenshot({ path: `/tmp/tn-boot-${LABEL}-${phase}.png` });
  console.error(`${phase} wall ${Date.now() - started}ms pins ${Math.round(metrics.firstPins)} login ${metrics.loginOpen} clusters ${metrics.pins} ${metrics.connection}`);
  const pinWall = metrics.timeOrigin + metrics.firstPins;
  const before = sent.slice(sentFrom).filter((entry) => entry.wall < pinWall);
  return { ...summarize(metrics, before), loginOpen: metrics.loginOpen, scrollWidth: metrics.scrollWidth, clientWidth: metrics.clientWidth, connection: metrics.connection };
}

const page = await browser.newPage();
await instrument(page);
const cold = await measure(page, 'cold');
await page.waitForFunction(() => new Promise((resolve) => {
  const request = indexedDB.open('tn-field-map');
  request.onerror = () => resolve(false);
  request.onsuccess = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains('leads')) { resolve(false); return; }
    const get = db.transaction('leads').objectStore('leads').get('dataset');
    get.onsuccess = () => resolve(Boolean(get.result?.leads?.length > 1000));
    get.onerror = () => resolve(false);
  };
}), { timeout: 180000, polling: 250 });
const warm = await measure(page, 'warm');
await page.setViewport({ width: 360, height: 740, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.waitForFunction(() => document.querySelector('.pinCluster'), { timeout: 30000 }).catch(() => {});
const narrow = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth
}));
await page.screenshot({ path: `/tmp/tn-boot-${LABEL}-360.png` });
console.log(JSON.stringify({ label: LABEL, origin, cold, warm, narrow360: narrow }, null, 2));
await browser.close();
server.close();

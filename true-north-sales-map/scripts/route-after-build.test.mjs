/** After a route is built, pin, list, and popup adds stay on the route. */
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const out = process.env.ARTIFACTS || '/tmp/tn-artifacts';
fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.mjs': 'text/javascript' };
const leads = [
  { id: 'h1', name: 'Ada House', address: '10 North Main Street', city: 'Mount Vernon', state: 'OH', zip: '43050', lat: 40.3935, lng: -82.4851, status: 'New', source: 'local' },
  { id: 'h2', name: 'Bea House', address: '14 North Main Street', city: 'Mount Vernon', state: 'OH', zip: '43050', lat: 40.3941, lng: -82.4842, status: 'New', source: 'local' },
  { id: 'h3', name: 'Cole House', address: '18 North Main Street', city: 'Mount Vernon', state: 'OH', zip: '43050', lat: 40.3928, lng: -82.4861, status: 'New', source: 'local' },
  { id: 'h4', name: 'Dee House', address: '22 North Main Street', city: 'Mount Vernon', state: 'OH', zip: '43050', lat: 40.3938, lng: -82.4856, status: 'New', source: 'local' },
  { id: 'h5', name: 'Eve House', address: '26 North Main Street', city: 'Mount Vernon', state: 'OH', zip: '43050', lat: 40.3932, lng: -82.4848, status: 'New', source: 'local' }
];
const reps = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Riley Setter', role: 'appointment_setter', active: true },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Jordan Sales', role: 'salesperson', active: true }
];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const file = path.join(root, pathname);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const extraArgs = process.env.PLAYWRIGHT_CHROMIUM_ARGS ? JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS) : ['--no-sandbox'];
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
  headless: true,
  args: extraArgs
});

function routeBody(post) {
  const coordinates = post?.coordinates || [];
  const stops = Math.max(0, coordinates.length - 1);
  return {
    code: 'Ok',
    distance: 1600,
    duration: 420,
    order: Array.from({ length: stops }, (_, index) => index + 1),
    geometry: { type: 'LineString', coordinates: coordinates.map((point) => [point.lng, point.lat]) },
    profile: 'driving',
    source: 'test'
  };
}

async function prepare(page, { role, userId }) {
  page.on('dialog', async (dialog) => { console.log('dialog', dialog.message()); await dialog.dismiss(); });
  await page.route('**/data/leads.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(leads) }));
  await page.route('**/data/manifest.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ totalRecords: leads.length }) }));
  await page.route('**/api/config', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ configured: false }) }));
  await page.route('**/api/route', async (route) => {
    const post = route.request().postDataJSON();
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(routeBody(post)) });
  });
  await page.addInitScript(({ reps, role, userId }) => {
    localStorage.setItem('tnrc2:reps', JSON.stringify(reps));
    localStorage.setItem('tnrc2:localRole', role);
    localStorage.setItem('tnrc2:localUserId', userId);
    localStorage.removeItem('tnrc2:assignedRoutes');
    sessionStorage.removeItem('tnrc2:routeDraft');
  }, { reps, role, userId });
}

async function openMap(page, urlPath = '/') {
  await page.goto(origin + urlPath, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__tnRoute?.pinPoint('h1'), null, { timeout: 20000 });
  await page.evaluate(() => window.__tnRoute.focus(40.3935, -82.4851, 17));
  await page.waitForTimeout(400);
}

async function selectHouse(page, id) {
  assert.equal(await page.evaluate((leadId) => window.__tnRoute.tap(leadId), id), true);
  await page.waitForFunction((leadId) => window.__tnRoute.selected().includes(leadId), id);
}

async function buildFrom(page, ids) {
  for (const id of ids) await selectHouse(page, id);
  await page.evaluate(() => document.getElementById('routeTrayBtn').click());
  try {
    await page.waitForFunction((count) => {
      const tray = document.getElementById('routeTray');
      return tray?.dataset.routeReady === 'true' && count.every((id) => window.__tnRoute.stops().includes(id));
    }, ids, { timeout: 8000 });
  } catch (error) {
    console.log('build failed', await page.evaluate(() => ({
      selected: window.__tnRoute.selected(),
      stops: window.__tnRoute.stops(),
      ready: document.getElementById('routeTray')?.dataset.routeReady,
      building: document.getElementById('routeTray')?.dataset.routeBuilding,
      warning: document.getElementById('routeWarning')?.textContent,
      distance: document.getElementById('routeDistance')?.textContent,
      btn: document.getElementById('routeTrayBtn')?.textContent
    })));
    throw error;
  }
}

try {
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await prepare(desktop, { role: 'salesperson', userId: 'local' });
  await openMap(desktop);
  await buildFrom(desktop, ['h1', 'h2']);
  const built = await desktop.evaluate(() => window.__tnRoute.stops());
  assert.equal(await desktop.evaluate(() => window.__tnRoute.tap('h3')), true);
  await desktop.waitForFunction((previous) => {
    const tray = document.getElementById('routeTray');
    const stops = window.__tnRoute.stops();
    return tray?.dataset.routeReady === 'true' && tray.dataset.routeStale === 'true' && stops.at(-1) === 'h3' && previous.every((id) => stops.includes(id)) && document.getElementById('routeTrayBtn')?.textContent === 'Re-optimize';
  }, built);
  await desktop.locator('#fieldAddressesTab').click();
  await desktop.evaluate(() => {
    const box = document.querySelector('.rowCheck[data-id="h4"]');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await desktop.waitForFunction(() => window.__tnRoute.stops().includes('h4'));
  const opened = await desktop.evaluate(() => window.__tnRoute.openPopup('h5'));
  assert.equal(opened, true);
  await desktop.waitForFunction(() => document.querySelector('.routeToggle')?.textContent === 'Add to route');
  await desktop.locator('.routeToggle').click();
  await desktop.waitForFunction(() => window.__tnRoute.stops().includes('h5'));
  const saved = await desktop.evaluate(() => ({
    ids: JSON.parse(localStorage.getItem('tnrc2:assignedRoutes') || '[]')[0]?.lead_ids,
    stops: window.__tnRoute.stops()
  }));
  assert.deepEqual(saved.ids, saved.stops);
  assert.ok(saved.stops.includes('h3') && saved.stops.includes('h4') && saved.stops.includes('h5'));
  await desktop.locator('#fieldRouteTab').click();
  await desktop.locator('#routeStops').scrollIntoViewIfNeeded();
  await desktop.screenshot({ path: path.join(out, 'desktop_add_after_build.png') });
  await desktop.locator('#routeStops [data-route-lead="h2"]').click();
  await desktop.waitForFunction(() => {
    const stops = window.__tnRoute.stops();
    return !stops.includes('h2') && stops.includes('h1') && stops.includes('h3') && document.getElementById('routeTray')?.dataset.routeReady === 'true';
  });
  await desktop.close();

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await prepare(phone, { role: 'salesperson', userId: 'local' });
  await openMap(phone);
  await buildFrom(phone, ['h1', 'h2']);
  assert.equal(await phone.evaluate(() => window.__tnRoute.tap('h3')), true);
  await phone.waitForFunction(() => window.__tnRoute.stops().includes('h3') && document.getElementById('routeTray')?.dataset.routeReady === 'true');
  await phone.evaluate(() => {
    document.getElementById('toast')?.classList.remove('show');
    document.getElementById('fieldRouteTab')?.click();
  });
  await phone.screenshot({ path: path.join(out, 'phone_add_after_build.png') });
  await phone.close();

  const admin = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await prepare(admin, { role: 'admin', userId: '22222222-2222-4222-8222-222222222222' });
  await openMap(admin, '/?makeRoute=1');
  await admin.waitForSelector('#routeForPicker:not(.hidden) button');
  await admin.getByRole('button', { name: /Riley Setter/ }).click();
  await admin.waitForFunction(() => document.getElementById('routeForBannerText')?.textContent === 'Building route for Riley Setter');
  await buildFrom(admin, ['h1', 'h2']);
  assert.equal(await admin.evaluate(() => window.__tnRoute.tap('h3')), true);
  await admin.waitForFunction(() => window.__tnRoute.stops().includes('h3') && document.getElementById('routeForBannerText')?.textContent === 'Building route for Riley Setter');
  const draft = await admin.evaluate(() => JSON.parse(sessionStorage.getItem('tnrc2:routeDraft') || 'null'));
  assert.deepEqual(draft.leadIds, ['h1', 'h2', 'h3']);
  await admin.screenshot({ path: path.join(out, 'admin_add_after_build.png') });
  await admin.close();
  console.log('Adding stops after a route is built passed.');
} finally {
  await browser.close();
  server.close();
}

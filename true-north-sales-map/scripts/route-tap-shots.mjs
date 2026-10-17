/** Capture phone and desktop shots of one-tap route add, plus the admin assignment flow. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const out = process.env.TN_ARTIFACTS_DIR || process.env.ARTIFACTS_DIR || new URL('../.ui-artifacts/', import.meta.url).pathname;
fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
const leads = [
  { id: 'h1', name: 'Ada House', address: '10 North Main Street', city: 'Mount Vernon', state: 'OH', zip: '43050', lat: 40.3935, lng: -82.4851, status: 'New', source: 'local' },
  { id: 'h2', name: 'Bea House', address: '14 North Main Street', city: 'Mount Vernon', state: 'OH', zip: '43050', lat: 40.3941, lng: -82.4842, status: 'New', source: 'local' },
  { id: 'h3', name: 'Cole House', address: '18 North Main Street', city: 'Mount Vernon', state: 'OH', zip: '43050', lat: 40.3928, lng: -82.4861, status: 'New', source: 'local' }
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
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

async function prepare(page, { role, userId, routes }) {
  await page.route('**/data/leads.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(leads) }));
  await page.route('**/data/manifest.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ totalRecords: leads.length }) }));
  await page.route('**/api/config', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ configured: false }) }));
  await page.addInitScript(({ reps, role, userId, routes }) => {
    localStorage.setItem('tnrc2:reps', JSON.stringify(reps));
    localStorage.setItem('tnrc2:localRole', role);
    localStorage.setItem('tnrc2:localUserId', userId);
    localStorage.setItem('tnrc2:assignedRoutes', JSON.stringify(routes));
    sessionStorage.removeItem('tnrc2:routeDraft');
  }, { reps, role, userId, routes });
}

async function openMap(page, path = '/') {
  await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__tnRoute?.pinPoint('h1'), null, { timeout: 20000 });
  await page.evaluate(() => window.__tnRoute.focus(40.3935, -82.4851, 17));
  await page.waitForTimeout(600);
  await page.waitForFunction(() => window.__tnRoute.pinPoint('h1'));
}

async function tapHouse(page, id) {
  const point = await page.evaluate((leadId) => window.__tnRoute.pinPoint(leadId), id);
  await page.mouse.click(point.x, point.y);
  return point;
}

try {
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await prepare(phone, { role: 'appointment_setter', userId: 'local', routes: [] });
  await openMap(phone);
  await phone.screenshot({ path: path.join(out, 'phone_dot_before_tap.png') });
  await tapHouse(phone, 'h1');
  await phone.waitForFunction(() => {
    const el = document.getElementById('toast');
    const text = document.getElementById('toastText')?.textContent || '';
    if (!el?.classList.contains('show') || !text.includes('Added to route · 10 North Main Street')) return false;
    if (getComputedStyle(el).opacity !== '1') return false;
    const undo = document.getElementById('toastUndo');
    if (!undo || undo.offsetParent === null) return false;
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + 24);
    const bar = document.getElementById('mobileRoute')?.getBoundingClientRect();
    const clearOfBar = !bar || rect.bottom <= bar.top + 1;
    return clearOfBar && (hit === el || el.contains(hit));
  });
  await phone.screenshot({ path: path.join(out, 'phone_dot_after_tap_toast.png') });
  await tapHouse(phone, 'h1');
  await phone.waitForFunction(() => document.getElementById('doorSheet')?.classList.contains('open') && document.getElementById('doorSheetRoute')?.textContent === 'Remove from route');
  await phone.screenshot({ path: path.join(out, 'phone_sheet_second_tap.png') });
  await phone.close();

  const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await prepare(desktop, { role: 'salesperson', userId: 'local', routes: [] });
  await openMap(desktop);
  await desktop.screenshot({ path: path.join(out, 'desktop_dot_before_tap.png') });
  await tapHouse(desktop, 'h1');
  await desktop.waitForFunction(() => document.getElementById('toastText')?.textContent.includes('Added to route · 10 North Main Street'));
  await desktop.screenshot({ path: path.join(out, 'desktop_dot_after_tap_toast.png') });
  await tapHouse(desktop, 'h1');
  await desktop.waitForSelector('.leaflet-popup-content');
  await desktop.waitForFunction(() => document.querySelector('.routeToggle')?.textContent === 'Remove from route');
  await desktop.screenshot({ path: path.join(out, 'desktop_popup_second_tap.png') });
  await desktop.close();

  const admin = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await prepare(admin, { role: 'admin', userId: '22222222-2222-4222-8222-222222222222', routes: [] });
  await openMap(admin, '/?makeRoute=1');
  await admin.waitForSelector('#routeForPicker:not(.hidden) button');
  await admin.screenshot({ path: path.join(out, 'admin_employee_picker.png') });
  await admin.getByRole('button', { name: /Riley Setter/ }).click();
  await admin.waitForFunction(() => {
    const text = document.getElementById('routeForBannerText');
    if (text?.textContent !== 'Building route for Riley Setter') return false;
    if (getComputedStyle(text).color !== 'rgb(255, 255, 255)') return false;
    const banner = document.getElementById('routeForBanner').getBoundingClientRect();
    const search = document.querySelector('.mapSearch').getBoundingClientRect();
    return banner.top >= search.bottom - 1;
  });
  await tapHouse(admin, 'h2');
  await admin.waitForFunction(() => window.__tnRoute.selected().includes('h2'));
  await admin.screenshot({ path: path.join(out, 'admin_building_banner.png') });
  await admin.locator('#routeForDone').click();
  await admin.waitForFunction(() => document.getElementById('toastText')?.textContent.includes('Route saved for Riley Setter'));
  await admin.close();

  const rep = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await prepare(rep, {
    role: 'appointment_setter',
    userId: '11111111-1111-4111-8111-111111111111',
    routes: [{ assignee_id: '11111111-1111-4111-8111-111111111111', created_by: '22222222-2222-4222-8222-222222222222', lead_ids: ['h1', 'h2'], assignee_name: 'Riley Setter', updated_at: '2026-10-11T00:00:00.000Z' }]
  });
  await openMap(rep);
  await rep.waitForFunction(() => window.__tnRoute.selected().includes('h1') && window.__tnRoute.selected().includes('h2'));
  await rep.screenshot({ path: path.join(out, 'rep_assigned_route.png') });
  await rep.close();
  console.log('route screenshots saved');
} finally {
  await browser.close();
  server.close();
}

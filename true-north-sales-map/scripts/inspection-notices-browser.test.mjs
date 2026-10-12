/** Scheduled inspections: bell, toast, filters, and the detail view. */
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const out = '/opt/cursor/artifacts';
fs.mkdirSync(out, { recursive: true });
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mjs': 'text/javascript',
  '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml'
};
const harness = `<!doctype html>
<html lang="en" class="tn-workspace tn-admin-workspace">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Scheduled inspections</title>
<link rel="stylesheet" href="/portal.css">
<link rel="stylesheet" href="/brand/workspace.css">
<link rel="stylesheet" href="/brand/atlas.css">
<link rel="stylesheet" href="/brand/inspection-notices.css">
</head>
<body class="tn-workspace tn-admin-workspace">
<header class="tnHeader"><div class="brand"><img class="brandEmblem" src="/brand/logo-emblem.webp" alt="" width="40" height="40"><div class="brandText"><b>TRUE NORTH <span class="brandRest">RESTORATIONS</span></b><span>MANAGEMENT</span></div></div>
<div class="headerLinks"><div class="inspectionBellWrap"><button type="button" id="inspectionBell" class="inspectionBell" aria-expanded="true" aria-controls="inspectionBellPanel" aria-label="1 unread inspection alert"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9a6 6 0 1 1 12 0c0 7 3 7 3 7H3s3 0 3-7"/><path d="M10 19a2 2 0 0 0 4 0"/></svg><span id="inspectionBellCount" class="inspectionBellCount">1</span></button><div id="inspectionBellPanel" class="inspectionBellPanel" hidden></div></div><button type="button" id="signOut">Sign out</button></div></header>
<main class="dashMain" style="padding:16px"><section id="tab-appointments"><div class="dashTitle"><div><div class="eyebrow">HANDOFF QUEUE</div><h1>Scheduled inspections</h1><p>Upcoming inspections are listed first.</p></div></div>
<div class="inspectionRange" role="group" aria-label="When"><button type="button" data-range="today">Today</button><button type="button" data-range="week">This week</button><button type="button" data-range="all" aria-pressed="true">All</button></div>
<div id="scheduledInspections" class="scheduledInspections"></div>
<div id="inspectionDetail" class="inspectionDetail" hidden></div>
</section></main>
<div id="inspectionToast" class="inspectionToast" hidden role="status"></div>
<script type="module">
import { inspectionCardsHtml, inspectionDetailHtml, noticeListHtml, prepareInspections } from '/lib/inspection-notices.js';
const now = new Date('2026-10-12T15:00:00Z');
const appointments = [
  { id: 'today', lead_id: 'l2', scheduled_at: '2026-10-12T18:00:00Z', stage: 'Scheduled', canvasser_id: 'setter', salesperson_id: 'sales', notes: 'Hail on the north slope.' },
  { id: 'week', lead_id: 'l3', scheduled_at: '2026-10-14T18:00:00Z', stage: 'Confirmed', canvasser_id: 'setter', salesperson_id: 'sales', notes: 'Homeowner wants the afternoon.' },
  { id: 'later', lead_id: 'l4', scheduled_at: '2026-10-20T18:00:00Z', stage: 'Scheduled', canvasser_id: 'setter', salesperson_id: null, notes: '' }
];
const leads = [
  { id: 'l2', name: 'Ada Home', address: '18 North Main', city: 'Mount Vernon', state: 'OH', zip: '43050', lat: 40.393, lng: -82.485 },
  { id: 'l3', name: 'Blake Porter', address: '9 Public Square', city: 'Mount Vernon', state: 'OH', zip: '43050' },
  { id: 'l4', name: 'Casey Nguyen', address: '44 Gambier', city: 'Mount Vernon', state: 'OH', zip: '43050' }
];
const homes = [{ lead_id: 'l2', phone: '740-555-0199', updated_at: '2026-10-11T00:00:00Z' }, { lead_id: 'l3', phone: '740-555-0144', updated_at: '2026-10-11T00:00:00Z' }];
const reps = [
  { id: 'setter', name: 'Riley Setter', role: 'appointment_setter', active: true },
  { id: 'sales', name: 'Jordan Sales', role: 'salesperson', active: true }
];
const notices = [{ id: 'n1', appointment_id: 'today', title: 'Inspection scheduled', body: 'Riley Setter booked Ada Home · 18 North Main, Mount Vernon, OH · Today, 2:00 PM ET', read_at: null }];
let range = 'all';
let openId = '';
const list = document.getElementById('scheduledInspections');
const detail = document.getElementById('inspectionDetail');
const panel = document.getElementById('inspectionBellPanel');
function items() { return prepareInspections({ appointments, leads, homes, reps, range, now }); }
function paint() {
  const rows = items();
  list.innerHTML = inspectionCardsHtml(rows);
  document.querySelectorAll('[data-range]').forEach((button) => button.setAttribute('aria-pressed', button.dataset.range === range ? 'true' : 'false'));
  const open = rows.find((row) => row.id === openId);
  detail.hidden = !open;
  detail.innerHTML = open ? inspectionDetailHtml(open) : '';
  panel.innerHTML = '<h2>Scheduled inspections</h2>' + noticeListHtml(notices) + '<button type="button" class="inspectionPush" data-inspection-push>Turn on alerts for this browser</button>';
}
list.addEventListener('click', (event) => {
  const button = event.target.closest('[data-inspection]');
  if (!button) return;
  openId = button.dataset.inspection;
  paint();
});
detail.addEventListener('click', (event) => {
  if (event.target.closest('[data-inspection-close]')) { openId = ''; paint(); }
});
document.querySelector('.inspectionRange').addEventListener('click', (event) => {
  const button = event.target.closest('[data-range]');
  if (!button) return;
  range = button.dataset.range;
  paint();
});
document.getElementById('inspectionBell').addEventListener('click', () => { panel.hidden = !panel.hidden; });
window.__desk = {
  toast() {
    const toast = document.getElementById('inspectionToast');
    toast.hidden = false;
    toast.innerHTML = '<b>Inspection scheduled</b><span>Riley Setter booked Ada Home · 18 North Main, Mount Vernon · Today, 2:00 PM ET</span>';
  },
  openPanel() { panel.hidden = false; },
  closePanel() { panel.hidden = true; document.getElementById('inspectionToast').hidden = true; },
  ids() { return [...list.querySelectorAll('[data-inspection]')].map((node) => node.dataset.inspection); }
};
paint();
document.documentElement.dataset.ready = '1';
</script>
</body></html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/inspections-harness.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(harness);
    return;
  }
  const file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end(); return;
  }
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
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${origin}/inspections-harness.html`, { waitUntil: 'networkidle' });
  await page.waitForSelector('html[data-ready="1"]');
  assert.deepEqual(await page.evaluate(() => window.__desk.ids()), ['today', 'week', 'later']);
  await page.evaluate(() => { window.__desk.toast(); window.__desk.openPanel(); });
  await page.waitForSelector('#inspectionBellPanel:not([hidden])');
  await page.waitForSelector('#inspectionToast:not([hidden])');
  assert.match(await page.locator('#inspectionBellCount').innerText(), /1/);
  assert.match(await page.locator('#inspectionToast').innerText(), /Ada Home/);
  await page.screenshot({ path: path.join(out, 'desktop_inspection_notification.png') });

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await phone.goto(`${origin}/inspections-harness.html`, { waitUntil: 'networkidle' });
  await phone.waitForSelector('html[data-ready="1"]');
  await phone.evaluate(() => { window.__desk.toast(); window.__desk.openPanel(); });
  await phone.screenshot({ path: path.join(out, 'phone_inspection_notification.png') });

  await page.evaluate(() => window.__desk.closePanel());
  await page.locator('[data-range="today"]').click();
  assert.deepEqual(await page.evaluate(() => window.__desk.ids()), ['today']);
  await page.locator('[data-range="week"]').click();
  assert.deepEqual(await page.evaluate(() => window.__desk.ids()), ['today', 'week']);
  await page.locator('[data-range="all"]').click();
  await page.getByRole('button', { name: /Ada Home/ }).click();
  await page.waitForSelector('#inspectionDetail:not([hidden])');
  const detail = page.locator('#inspectionDetail');
  assert.match(await detail.innerText(), /740-555-0199/);
  assert.match(await detail.innerText(), /Riley Setter/);
  assert.match(await detail.innerText(), /Jordan Sales/);
  assert.match(await detail.innerText(), /Hail on the north slope/);
  const directions = await detail.locator('a', { hasText: 'Directions' }).getAttribute('href');
  assert.match(directions, /^https:\/\/www\.google\.com\/maps\/dir\//);
  await page.screenshot({ path: path.join(out, 'desktop_scheduled_inspections.png') });

  await phone.evaluate(() => window.__desk.closePanel());
  await phone.locator('[data-range="all"]').click();
  await phone.getByRole('button', { name: /Ada Home/ }).click();
  await phone.waitForSelector('#inspectionDetail:not([hidden])');
  await phone.evaluate(() => window.scrollTo(0, 0));
  await phone.screenshot({ path: path.join(out, 'phone_scheduled_inspections.png') });
  await phone.close();
  await page.close();
} finally {
  await browser.close();
  server.close();
}
console.log('Inspection notice browser: bell, toast, filters, and detail view passed.');

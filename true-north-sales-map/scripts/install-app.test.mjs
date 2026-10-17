/** Install app: manifest, head tags, platform modes, prompt() on Chrome/Edge/Android,
 *  the iOS Safari sheet, the "open in Safari" sheet, and hiding once installed. */
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { installMode, isIOS, sheetContent } from '../lib/install-app.js';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const IOS_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IOS_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';

// Manifest: name, short name, start_url, standalone, navy theme, 192/512/maskable icons that exist.
const manifest = JSON.parse(read('manifest.webmanifest'));
assert.equal(manifest.name, 'True North Maps');
assert.ok(manifest.short_name && manifest.short_name.length <= 12);
assert.equal(manifest.start_url, '/');
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.theme_color, '#0c1424');
for (const [size, purpose] of [['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']]) {
  const icon = manifest.icons.find(item => item.sizes === size && item.purpose === purpose);
  assert.ok(icon, `${size} ${purpose} icon`);
  assert.ok(fs.existsSync(path.join(root, icon.src)), `${icon.src} exists`);
  const png = fs.readFileSync(path.join(root, icon.src));
  assert.equal(png.readUInt32BE(16), Number(size.split('x')[0]), `${icon.src} is ${size}`);
}
assert.equal(JSON.stringify(manifest).includes('data:image'), false, 'icons are real files');

// Every page links the manifest once and has the Apple home-screen tags and installer.
for (const file of fs.readdirSync(root).filter(name => name.endsWith('.html'))) {
  const html = read(file);
  assert.equal(html.split('rel="manifest" href="/manifest.webmanifest"').length - 1, 1, `${file} links the manifest once`);
  assert.ok(html.includes('<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">'), `${file} apple-touch-icon`);
  assert.ok(html.includes('<meta name="apple-mobile-web-app-capable" content="yes">'), `${file} apple-mobile-web-app-capable`);
  assert.ok(html.includes('<meta name="theme-color" content="#0c1424">'), `${file} theme color`);
  assert.ok(html.includes('src="/lib/install-app.js"'), `${file} loads the installer`);
  assert.ok(html.includes('beforeinstallprompt'), `${file} captures the install prompt early`);
}
const sw = read('sw.js');
assert.ok(sw.includes("addEventListener('fetch'"), 'service worker has a fetch handler');
assert.ok(sw.includes("request.mode !== 'navigate'"), 'service worker never caches app code or data');

// Install button on every sign-in screen and in the More menu.
for (const file of ['index.html', 'admin.html', 'setter.html', 'field-ops.js', 'tn-files/ui.js']) assert.ok(read(file).includes('data-install-app'), `${file} sign-in offers Install app`);
assert.match(read('field-ops.js'), /install\.dataset\.installApp = ''/, 'More menu offers Install app');

// Platform modes.
assert.equal(isIOS({ userAgent: IOS_SAFARI }), true);
assert.equal(isIOS({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 }), true, 'iPadOS desktop UA');
assert.equal(installMode({ userAgent: IOS_SAFARI }), 'ios-safari');
assert.equal(installMode({ userAgent: IOS_CHROME }), 'ios-other');
assert.equal(installMode({ userAgent: ANDROID, hasPrompt: true }), 'prompt');
assert.equal(installMode({ userAgent: ANDROID }), 'none', 'no button until the browser offers install');
assert.equal(installMode({ userAgent: IOS_SAFARI, standalone: true }), 'installed');
assert.equal(installMode({ userAgent: ANDROID, hasPrompt: true, installed: true }), 'installed');
assert.match(sheetContent('ios-safari').steps.map(step => step.text).join(' '), /Share.*Add to Home Screen/);
assert.ok(sheetContent('ios-safari').steps.every(step => step.icon.includes('<')), 'each step has an icon');
assert.match(sheetContent('ios-other').title, /Safari/);

// Browser behavior.
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/fixture') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><script>addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__tnInstallPrompt=e;});</script><script type="module" src="/lib/install-app.js"></script></head><body><div data-install-section hidden><button type="button" data-install-app hidden>Install app</button></div></body></html>'); return; }
  const file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const shots = process.env.TN_ARTIFACTS_DIR || path.join(root, '.ui-artifacts');
fs.mkdirSync(shots, { recursive: true });
const visible = page => page.locator('[data-install-app]').isVisible();
try {
  // Android / Chrome / Edge: hidden until beforeinstallprompt, then prompt() on tap, hidden once accepted.
  let context = await browser.newContext({ userAgent: ANDROID, viewport: { width: 390, height: 844 } });
  let page = await context.newPage();
  await page.goto(origin + '/fixture');
  await page.waitForFunction(() => window.__tnInstall);
  assert.equal(await visible(page), false, 'no button before the browser offers install');
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    event.prompt = async () => { window.prompted = (window.prompted || 0) + 1; };
    event.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(event);
  });
  await page.locator('[data-install-app]').waitFor();
  await page.locator('[data-install-app]').click();
  await page.waitForFunction(() => window.prompted === 1);
  await page.waitForFunction(() => document.querySelector('[data-install-app]').hidden);
  await context.close();

  // appinstalled hides the button.
  context = await browser.newContext({ userAgent: ANDROID });
  page = await context.newPage();
  await page.goto(origin + '/fixture');
  await page.waitForFunction(() => window.__tnInstall);
  await page.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = async () => {}; e.userChoice = Promise.resolve({ outcome: 'dismissed' }); window.dispatchEvent(e); });
  await page.locator('[data-install-app]').waitFor();
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await page.waitForFunction(() => document.querySelector('[data-install-app]').hidden);
  await context.close();

  // iOS Safari: button shows; tap opens the Share → Add to Home Screen sheet.
  context = await browser.newContext({ userAgent: IOS_SAFARI, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page = await context.newPage();
  await page.goto(origin + '/fixture');
  await page.locator('[data-install-app]').waitFor();
  await page.locator('[data-install-app]').click();
  const sheet = page.locator('#tnInstallSheet [role="dialog"]');
  await sheet.waitFor();
  const text = await sheet.innerText();
  assert.match(text, /Share/); assert.match(text, /Add to Home Screen/);
  assert.equal(await sheet.locator('svg').count() >= 2, true, 'steps show icons');
  await page.screenshot({ path: path.join(shots, 'install-ios-safari-sheet.png') });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#tnInstallSheet').count(), 0, 'Escape closes the sheet');
  await context.close();

  // iOS Chrome: sheet says to open the page in Safari.
  context = await browser.newContext({ userAgent: IOS_CHROME, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page = await context.newPage();
  await page.goto(origin + '/fixture');
  await page.locator('[data-install-app]').click();
  await page.locator('#tnInstallSheet').getByText('Open in Safari to install').waitFor();
  await page.screenshot({ path: path.join(shots, 'install-ios-other-sheet.png') });
  await context.close();

  // Standalone (already installed): never shown.
  context = await browser.newContext({ userAgent: IOS_SAFARI });
  page = await context.newPage();
  await page.addInitScript(() => { Object.defineProperty(navigator, 'standalone', { get: () => true }); });
  await page.goto(origin + '/fixture');
  await page.waitForFunction(() => window.__tnInstall);
  assert.equal(await visible(page), false, 'hidden when running standalone');
  await context.close();
  console.log('Install app: manifest, head tags, prompt(), iOS sheets and installed state passed');
} finally {
  await browser.close();
  server.close();
}

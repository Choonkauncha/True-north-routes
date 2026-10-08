/** More menu stays on screen, and the field map paints pins without a layer click. */
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const file = path.join(root, pathname);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox']
});

function menuBox(page) {
  return page.evaluate(() => {
    const menu = document.getElementById('tnMoreMenu');
    const rect = menu.getBoundingClientRect();
    const visible = !menu.hidden && rect.width >= 160 && rect.height >= 80
      && rect.top >= 0 && rect.bottom <= window.innerHeight + 1
      && rect.left >= -1 && rect.right <= window.innerWidth + 1;
    return { visible, top: Math.round(rect.top), height: Math.round(rect.height), links: menu.querySelectorAll('a,button').length };
  });
}

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.documentElement.classList.remove('tn-signed-out'));
  await page.addScriptTag({ type: 'module', content: "import '/field-ops.js';" });
  await page.waitForSelector('#tnMore');
  for (const [width, height] of [[390, 844], [768, 800], [1024, 800]]) {
    await page.setViewportSize({ width, height });
    const open = await page.locator('#tnMore').getAttribute('aria-expanded');
    if (open === 'true') await page.locator('#tnMore').click();
    await page.locator('#tnMore').click();
    await page.waitForFunction(() => document.getElementById('tnMore')?.getAttribute('aria-expanded') === 'true');
    const box = await menuBox(page);
    assert.equal(box.visible, true, `More menu on screen at ${width}: ${JSON.stringify(box)}`);
    assert.ok(box.links >= 4, `More menu has links at ${width}`);
    const clicked = await page.evaluate(() => {
      const link = document.querySelector('#tnMoreMenu a');
      const rect = link.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= window.innerHeight && rect.height >= 40;
    });
    assert.equal(clicked, true, `More menu link is tappable at ${width}`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('tnMoreMenu').hidden);
  }

  const css = fs.readFileSync(path.join(root, 'field-ops.css'), 'utf8');
  const workspace = fs.readFileSync(path.join(root, 'brand/workspace.css'), 'utf8');
  assert.match(css, /#tnMoreMenu:not\(\[hidden\]\)\{[^}]*position:absolute/);
  assert.doesNotMatch(css, /tnMoreMenu:not\(\[hidden\]\)\{[^}]*position:fixed/);
  assert.doesNotMatch(workspace, /tnMoreMenu[^}]*top:\s*calc\(100%/);

  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(app, /if\(state\.layerFlags\.pins\) syncPins\(\)/);
  assert.match(app, /ingestLeadChunk[\s\S]*markFirstPins/);
  assert.match(app, /function openLead\(id, options=\{\}\)\{[\s\S]*useDoorSheet\(\) && !options\.full/);
  assert.match(app, /openLead\(id,\{full:true\}\)/);
  console.log('More menu stays on screen at phone and tablet widths');
  await page.close();
} finally {
  await browser.close();
  server.close();
}

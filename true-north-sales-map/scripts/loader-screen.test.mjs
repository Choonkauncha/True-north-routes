import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loaderHoldHtml, loaderMarkHtml } from '../brand/loader.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

const mark = loaderMarkHtml();
assert.ok(mark.includes('class="bootOutline"'));
assert.ok(mark.includes('class="bootOutlineTravel"'));
assert.ok(mark.includes('logo-emblem.webp'));
assert.ok(mark.includes('viewBox="0 0 256 259"'));
assert.ok(mark.includes('pathLength="100"'));
assert.ok(loaderHoldHtml().includes('bootOutlineTravel'));

const pages = [
  'index.html',
  'admin.html',
  'account.html',
  'setter.html',
  'files.html',
  'shifts.html',
  'reset-password.html'
];
for (const page of pages) {
  const html = read(page);
  assert.ok(html.includes('bootOutlineTravel'), page);
  assert.ok(html.includes('M99.7 0.7'), page);
  assert.ok(html.includes('logo-emblem.webp'), page);
  assert.ok(html.includes('@keyframes bootOutlineTravel'), page);
  assert.ok(html.includes('prefers-reduced-motion'), page);
}

const index = read('index.html');
assert.ok(index.includes('class="tn-map"'));
assert.ok(index.includes('tn-signed-out'));
assert.ok(index.includes('body>*:not(#loginModal){display:none!important}'));
assert.ok(index.includes('#loginModal{display:flex!important;background:#0c1424!important'));

const admin = read('admin.html');
assert.ok(admin.includes('#auth{display:none!important}'));
assert.ok(admin.includes('id="tnAdminHold"'));
assert.ok(admin.includes('class="tnLoader tn-vt-loader"'));
assert.equal(admin.includes('html[data-tn-admin="redirect"] body{display:none'), false);
assert.ok(admin.includes("dataset.tnAdmin='check'"));

const app = read('app.js');
assert.ok(app.includes('scrubPrivateMap'));
assert.ok(app.includes("classList.add('tn-signed-out')"));
assert.ok(app.includes('state.sessionReady'));
assert.ok(app.includes('if(!state.sessionReady) return;'));
assert.ok(app.includes('if(authed){'));
assert.ok(app.includes("event==='SIGNED_OUT'"));

const transitions = read('brand/transitions.css');
assert.ok(transitions.includes('bootOutlineTravel'));
assert.ok(transitions.includes('view-transition-name:tn-loader'));
assert.ok(transitions.includes('tn-signed-out'));

const prefetch = read('brand/prefetch.js');
assert.ok(prefetch.includes('loaderHoldHtml'));
assert.ok(prefetch.includes('showTransitionLoader'));
assert.equal(prefetch.includes('background:#0c1424\''), false);

const gate = read('tn-files/password-gate.js');
assert.ok(gate.includes('loaderHoldHtml'));

const shifts = read('field-ops.js');
assert.ok(shifts.includes('mountSignInScreen'));
assert.ok(shifts.includes('destroyShiftMap'));

console.log('loader-screen.test.mjs ok');

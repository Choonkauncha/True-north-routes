/** Text and palette polish: one token system, AA contrast, Title Case display,
 *  intuitive copy, and the developer-only offline demo link. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { titleCase, statusLabel } from '../lib/display-text.js';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const lum = hex => { const h = hex.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

// One palette, defined in styles.css and mirrored with identical values elsewhere.
const styles = read('styles.css');
const root = styles.slice(styles.indexOf(':root{'), styles.indexOf('}', styles.indexOf(':root{')));
const token = name => (root.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`)) || [])[1]?.toLowerCase();
assert.equal(token('navy'), '#0c1424');
assert.equal(token('brand'), '#1e6bff');
assert.equal(token('cyan'), '#32c7f8');
assert.equal(token('green'), '#2e6b4b');
assert.equal(token('red'), '#a44835');
assert.equal(token('amber'), '#a66b19');
assert.equal(token('on-navy-muted'), '#afc0cf');
assert.equal(/--orange/.test(styles + read('portal.css') + read('brand/atlas.css') + read('brand/workspace.css')), false, 'misleading --orange token is gone');
const atlas = read('brand/atlas.css');
assert.match(atlas, /--atlas-primary: #1e6bff;/);
assert.match(atlas, /--atlas-accent: #32c7f8;/);
assert.match(atlas, /--atlas-muted: #afc0cf;/);
assert.match(read('brand/workspace.css'), /--brand: #1e6bff;/);
assert.match(read('brand/workspace.css'), /--navy: #0c1424;/);
// Primary buttons are brand blue with white text, not cyan.
assert.match(atlas, /body\.tn-workspace \.btn\.primary,[^{]*\{\s*background: var\(--atlas-primary\);\s*border-color: var\(--atlas-primary\);\s*color: var\(--atlas-on-primary\);/);
// The retired blue is gone from every page and stylesheet.
for (const file of fs.readdirSync(new URL('../', import.meta.url)).filter(name => /\.(html|css|js)$/.test(name)).concat(fs.readdirSync(new URL('../brand/', import.meta.url)).filter(n => /\.(css|js|html)$/.test(n)).map(n => 'brand/' + n), fs.readdirSync(new URL('../tn-files/', import.meta.url)).filter(n => /\.(css|js)$/.test(n)).map(n => 'tn-files/' + n))) {
  assert.equal(/#0267ee|#2563eb/i.test(read(file)), false, `${file} uses only the brand blue`);
}

// WCAG AA 4.5:1 for every text pairing in the palette.
const pairs = [['#ffffff', '#1e6bff', 'white on brand button'], ['#ffffff', '#1554d6', 'white on pressed button'], ['#afc0cf', '#0c1424', 'secondary text on navy'], ['#afc0cf', '#102239', 'secondary text on dark card'],
  ['#32c7f8', '#102239', 'cyan link on dark card'], ['#2e6b4b', '#ffffff', 'green status'], ['#a44835', '#ffffff', 'red status'], ['#8c5d13', '#ffffff', 'amber status text'], ['#5c6d76', '#ffffff', 'muted text'], ['#1554d6', '#e8f0ff', 'blue on soft blue']];
for (const [fg, bg, label] of pairs) assert.ok(ratio(fg, bg) >= 4.5, `${label}: ${ratio(fg, bg).toFixed(2)}`);
assert.equal(token('amber-ink'), '#8c5d13');

// Sign-in screens share one look.
const usability = read('brand/usability.css');
assert.match(usability, /html body \.authCard form button\[type="submit"\][\s\S]*background:#1e6bff!important;color:#ffffff!important/);
for (const file of ['index.html', 'admin.html', 'setter.html', 'field-ops.js', 'tn-files/ui.js']) {
  const text = read(file);
  assert.ok(text.includes('Sign in to True North'), `${file}: one heading`);
  assert.ok(text.includes('tnSignInRole'), `${file}: one-line role subtitle`);
}

// Copy.
const index = read('index.html'), app = read('app.js');
assert.equal(index.includes('Field command center'), false);
assert.ok(index.includes('Tap a house to add it to your route'));
assert.ok(index.includes('Build route <span id="mobileRouteCount" class="countBadge hidden" hidden>0</span>'));
assert.ok(app.includes("'Offline demo mode. Changes stay on this device.'"));
assert.equal(app.includes('Cloud is not configured'), false);
assert.ok(read('setter.html').includes('Book the inspection and pass it to the rep.'));
assert.equal(/>\s*[^<]*\bappointments?\b[^<]*</i.test(read('setter.html').replace(/<title>[^<]*<\/title>/, '')), false, 'setter page says Inspection, not appointment');
assert.ok(app.includes('Score ${score}') && !app.includes('pts</span>'), 'lead score has a plain label');
assert.ok(app.includes('title="Lead score'), 'lead score explains itself');

// Title Case display only.
assert.equal(titleCase('BETTY WATSON'), 'Betty Watson');
assert.equal(titleCase('1272 CITY PARK AVE'), '1272 City Park Ave');
assert.equal(titleCase('100 N MAIN ST NE'), '100 N Main St NE');
assert.equal(titleCase("MARY O'BRIEN-MCDONALD"), "Mary O'Brien-McDonald");
assert.equal(titleCase('123 1ST AVE'), '123 1st Ave');
assert.equal(titleCase('Kept As Typed'), 'Kept As Typed');
assert.equal(titleCase(null), '');
assert.equal(statusLabel('Appointment'), 'Inspection');
assert.equal(statusLabel('Knocked'), 'Knocked');
assert.ok(index.includes('<option value="Appointment">Inspection</option>'), 'stored status value is unchanged');

// "Use local test mode" only on localhost or with ?dev=1.
const fn = app.slice(app.indexOf('function localModeAllowed('), app.indexOf('async function fetchJSON('));
const ctx = vm.createContext({ URLSearchParams });
vm.runInContext(fn + ';this.allowed=localModeAllowed;', ctx);
assert.equal(ctx.allowed({ hostname: 'truenorthmaps.vercel.app', search: '' }), false);
assert.equal(ctx.allowed({ hostname: 'truenorthmaps.vercel.app', search: '?dev=1' }), true);
assert.equal(ctx.allowed({ hostname: 'localhost', search: '' }), true);
assert.equal(ctx.allowed({ hostname: '127.0.0.1', search: '' }), true);
assert.ok(index.includes('id="localModeBtn" class="textBtn" hidden>'), 'hidden before scripts run');
assert.ok(app.includes("$('localModeBtn').hidden=!localModeAllowed();"));
console.log('Palette, contrast, sign-in, copy, Title Case and local-mode polish checks passed');

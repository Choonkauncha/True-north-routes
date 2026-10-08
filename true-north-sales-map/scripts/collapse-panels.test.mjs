import assert from 'node:assert/strict';
import fs from 'node:fs';
import { collapseDecision, panelPageId, panelStorageKey, readPanelCollapsed } from '../brand/collapse.js';

const root = new URL('..', import.meta.url);

function read(name) {
  return fs.readFileSync(new URL(name, root), 'utf8');
}

assert.equal(collapseDecision({ rank: 'primary', narrow: true, saved: null }), false);
assert.equal(collapseDecision({ rank: 'secondary', narrow: true, saved: null }), true);
assert.equal(collapseDecision({ rank: 'secondary', narrow: false, saved: null }), false);
assert.equal(collapseDecision({ rank: 'secondary', narrow: false, saved: '1' }), true);
assert.equal(collapseDecision({ rank: 'primary', narrow: true, saved: '0' }), false);
assert.equal(collapseDecision({ rank: 'secondary', narrow: true, saved: '0' }), false);

assert.equal(panelPageId('/'), 'map');
assert.equal(panelPageId('/index.html'), 'map');
assert.equal(panelPageId('/admin'), 'admin');
assert.equal(panelPageId('/setter.html'), 'setter');

assert.equal(panelStorageKey('user-1', 'admin', 'admin-rail'), 'tnrc2:panel:user-1:admin:admin-rail');
assert.equal(panelStorageKey('', 'map', 'door-sheet'), 'tnrc2:panel:local:map:door-sheet');

const memory = {
  getItem(key) { return memory.map.get(key) ?? null; },
  map: new Map([['tnrc2:panel:user-1:setter:setter-book', '0']])
};
assert.equal(readPanelCollapsed(memory, 'user-1', 'setter', 'setter-book', 'secondary', true), false);
assert.equal(readPanelCollapsed(memory, 'user-1', 'setter', 'setter-checklist', 'secondary', true), true);
assert.equal(readPanelCollapsed(memory, 'user-1', 'account', 'account-password', 'primary', true), false);

const css = read('brand/collapse.css');
assert.match(css, /min-height:\s*44px/);
assert.match(css, /prefers-reduced-motion:\s*reduce/);
assert.match(css, /grid-template-rows:\s*0fr/);
assert.match(css, /\.tnFoldChevron/);

const helper = read('brand/collapse.js');
assert.match(helper, /aria-expanded/);
assert.match(helper, /aria-controls/);
assert.match(helper, /NARROW_PANEL_QUERY = '\(max-width: 412px\)'/);
assert.match(helper, /#listSheet/);
assert.match(helper, /#navBar/);
assert.match(helper, /#navChoice/);
assert.match(helper, /#handoffPanel/);

const index = read('index.html');
assert.match(index, /data-tn-panel="door-sheet"/);
assert.match(index, /data-tn-panel="route-builder"/);
assert.match(index, /id="listSheet"/);
assert.doesNotMatch(index, /id="listSheet"[^>]*data-tn-panel/);
assert.doesNotMatch(index, /id="navBar"[^>]*data-tn-panel/);
assert.doesNotMatch(index, /id="navChoice"[^>]*data-tn-panel/);
assert.doesNotMatch(index, /id="handoffPanel"[^>]*data-tn-panel/);
assert.match(index, /brand\/collapse\.css/);
assert.match(index, /brand\/collapse\.js/);

const app = read('app.js');
assert.match(app, /data-tn-panel="lead-details"/);
assert.match(app, /Appointment handoff/);
assert.match(app, /function openNavChoice/);
assert.match(app, /function closeNavChoice/);

const setter = read('setter.html');
assert.match(setter, /data-tn-panel="setter-homeowner"/);
assert.match(setter, /data-tn-panel="setter-checklist"/);
assert.match(setter, /id="setterForm"/);
assert.match(setter, /type="submit">Save appointment/);

const homeowner = read('homeowner.html');
assert.match(homeowner, /data-tn-panel="homeowner-you"/);
assert.match(homeowner, /type="submit">Request my inspection/);
assert.doesNotMatch(homeowner, /data-tn-panel="homeowner-consent"/);

const admin = read('admin.html');
assert.match(admin, /data-tn-panel="admin-rail"/);
assert.match(admin, /data-tn-panel="today-appts"/);
assert.match(admin, /data-tn-panel="recent-activity"/);
assert.match(admin, /id="tab-team"[^>]*data-tn-panel="team"/);

const shifts = read('field-ops.js');
assert.match(shifts, /data-tn-panel="shift-now"/);
assert.match(shifts, /data-tn-panel="shift-day"/);
assert.match(shifts, /data-tn-panel="shift-trail"/);
assert.match(shifts, /data-tn-panel="messages"/);
assert.match(shifts, /data-tn-panel="message-threads"/);

for (const name of ['account.html', 'files.html', 'forms.html', 'rep.html', 'shifts.html', 'training.html', 'setter.html', 'admin.html']) {
  const html = read(name);
  assert.match(html, /brand\/collapse\.css/, name);
  assert.match(html, /brand\/collapse\.js/, name);
}

console.log('collapse-panels.test.mjs ok');

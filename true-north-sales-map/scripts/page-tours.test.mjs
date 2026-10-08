import assert from 'node:assert/strict';
import { PAGE_TOURS, ADMIN_TOURS, tourPage } from '../lib/page-tours.js';

const pages = ['map', 'setter', 'account', 'rep', 'photo', 'forms', 'files', 'training', 'shifts', 'reset-password', 'form-print'];
for (const page of pages) {
  assert.ok(PAGE_TOURS[page]?.length, `${page} has a tutorial`);
  for (const step of PAGE_TOURS[page]) {
    assert.ok(step.target && step.title && step.text.length > 50, `${page} has actionable steps`);
  }
}
for (const tab of ['overview', 'accounts', 'team', 'appointments', 'homeowners', 'activity', 'territories', 'files', 'training']) {
  assert.ok(ADMIN_TOURS[tab]?.length, `${tab} has contextual office help`);
}
assert.equal(tourPage('/'), 'map');
assert.equal(tourPage('/index.html'), 'map');
assert.equal(tourPage('/setter'), 'setter');
assert.equal(tourPage('/setter/'), 'setter');
assert.equal(tourPage('/homeowner.html'), 'setter'); // Legacy route reaches the unified form.
assert.equal(tourPage('/reset-password.html'), 'reset-password');
console.log('Page tutorial coverage and route aliases passed.');

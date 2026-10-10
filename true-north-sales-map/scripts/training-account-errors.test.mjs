import assert from 'node:assert/strict';
import { mountAccountTraining } from '../tn-files/training-account.js';

globalThis.document = { createElement: () => ({ setAttribute() {}, textContent: '' }) };
for (const failed of ['training_items', 'training_progress', 'training_reminders', 'training_assignments']) {
  const host = { innerHTML: '', children: [], replaceChildren() { this.children = []; this.innerHTML = ''; }, append(child) { this.children.push(child); } };
  const sb = { from(table) {
    const result = { data: [], error: table === failed ? { message: 'Offline' } : null };
    const query = { select() { return query; }, eq() { return query; }, order() { return query; }, then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); } };
    return query;
  } };
  await mountAccountTraining(host, { sb, rep: { id: 'rep', role: 'salesperson' } });
  assert.equal(host.children.length, 1, `${failed} failure must show an unavailable notice`);
  assert.match(host.children[0].textContent, /status is unavailable/);
  assert.doesNotMatch(host.innerHTML, /New|Completed/);
}
console.log('Training account partial reads show unavailable status instead of false progress.');

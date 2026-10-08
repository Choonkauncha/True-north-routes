import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectDocuments,
  dateSection,
  easternWeekStart,
  propertyGroups,
  sectionDocuments,
  sectionGroups,
  visibleDocuments
} from '../lib/documents.js';

const now = new Date('2026-10-08T18:00:00Z');
assert.equal(easternWeekStart(now), '2026-10-05');
assert.equal(dateSection('2026-10-08T15:00:00Z', now), 'today');
assert.equal(dateSection('2026-10-06T15:00:00Z', now), 'week');
assert.equal(dateSection('2026-09-01T15:00:00Z', now), 'older');

const setter = { id: 'setter-1', name: 'Ada Setter', role: 'appointment_setter' };
const rep = { id: 'rep-1', name: 'Sam Sales', role: 'salesperson' };
const address = '18 Public Square, Mount Vernon, OH 43050';
const docs = collectDocuments({
  reps: [setter, rep],
  templates: [{ id: 'tpl-file', kind: 'file', name: 'Insurance card' }],
  submissions: [
    { id: 'c1', template_id: 'tpl-c', template_name: 'Contingency Agreement', submitted_by: 'rep-1', address_snapshot: address, homeowner_name: 'Alex Morgan', created_at: '2026-10-08T16:00:00Z', reviewed_at: null },
    { id: 'cl1', template_id: 'tpl-cl', template_name: 'Closing / Deal Agreement', submitted_by: 'rep-1', address_snapshot: '9 West St, Mount Vernon, OH', homeowner_name: 'Pat Lee', created_at: '2026-10-06T15:00:00Z', reviewed_at: '2026-10-07T12:00:00Z' },
    { id: 'up1', template_id: 'tpl-file', template_name: 'Insurance card', submitted_by: 'rep-1', address_snapshot: address, homeowner_name: 'Alex Morgan', created_at: '2026-09-02T15:00:00Z', reviewed_at: null }
  ],
  photos: [
    { id: 'p1', uploaded_by: 'rep-1', address_snapshot: address, caption: 'North slope', created_at: '2026-10-08T17:00:00Z', reviewed_at: null, url: '/roof.jpg' }
  ],
  intakes: [
    { id: 'i1', first_name: 'Alex', last_name: 'Morgan', address: '18 Public Square', city: 'Mount Vernon', state: 'OH', zip: '43050', source: 'appointment_setter', created_by: 'setter-1', created_at: '2026-10-08T14:00:00Z', notes: 'Homeowner is ready Thursday.' },
    { id: 'i2', first_name: 'Jo', last_name: 'Kim', address: '4 Oak Ave', city: 'Mount Vernon', state: 'OH', zip: '43050', source: 'public_homeowner_form', created_by: null, created_at: '2026-09-01T15:00:00Z', reviewed_at: null }
  ]
});

const house = propertyGroups(visibleDocuments(docs, {})).find((group) => group.address.includes('18 Public Square'));
assert.ok(house);
assert.deepEqual(house.docs.map((doc) => doc.type), ['photo', 'contingency', 'intake', 'upload']);
assert.equal(house.homeowner, 'Alex Morgan');
assert.equal(house.newCount, 4);
assert.equal(house.docs.find((doc) => doc.type === 'photo').note, 'North slope');
assert.equal(house.docs.find((doc) => doc.type === 'intake').personName, 'Ada Setter');

const sections = sectionGroups(propertyGroups(visibleDocuments(docs, {})), now);
assert.deepEqual(sections.map((section) => section.id), ['today', 'week', 'older']);
assert.equal(sections[0].groups[0].address.includes('18 Public Square'), true);
assert.equal(sections[1].groups[0].homeowner, 'Pat Lee');

assert.equal(visibleDocuments(docs, { query: 'ada setter' }).every((doc) => doc.personName === 'Ada Setter'), true);
assert.equal(visibleDocuments(docs, { query: 'contingency' }).length, 1);
assert.equal(visibleDocuments(docs, { query: '18 public' }).length, 4);
assert.equal(visibleDocuments(docs, { query: 'alex morgan' }).some((doc) => doc.type === 'photo'), true);
assert.equal(visibleDocuments(docs, { type: 'closing', status: 'reviewed' }).length, 1);
assert.equal(visibleDocuments(docs, { type: 'inspection' })[0].title, 'Inspection request');
assert.equal(visibleDocuments(docs, { personId: 'rep-1', status: 'new' }).some((doc) => doc.type === 'closing'), false);
assert.equal(sectionDocuments(house.docs, now)[0].docs[0].type, 'photo');

const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../supabase/migrations/20261008_document_review.sql'), 'utf8');
assert.ok(sql.includes('reviewed_at'));
assert.ok(sql.includes('guard_document_review'));
assert.ok(sql.includes('form_submissions_update_review'));
assert.equal(/reps_role|alter table public\.reps drop constraint/i.test(sql), false);
const setup = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../supabase/setup_all.sql'), 'utf8');
assert.ok(setup.includes('guard_document_review'));

console.log('documents.test.mjs ok');

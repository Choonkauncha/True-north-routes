import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LIBRARY_LIMIT,
  addCategory,
  canDeleteRecord,
  filterRecords,
  formatMoney,
  groupLibrary,
  libraryFileKind,
  parseAmount,
  removeCategory,
  renameCategory,
  reorderCategory,
  seedCategories
} from '../lib/records.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

const seeded = seedCategories();
assert.deepEqual(seeded.map((row) => row.name), ['Contingency', 'Agreements', 'Other', 'Uncategorized']);
assert.equal(seeded.find((row) => row.slug === 'uncategorized').system, true);

const added = addCategory(seeded, ' Warranties ');
assert.equal(added.category.name, 'Warranties');
assert.equal(added.category.slug, 'warranties');
assert.equal(addCategory(seeded, 'contingency').error.includes('already exists'), true);
assert.equal(addCategory(seeded, '  ').error.includes('Name'), true);

const renamed = renameCategory(seeded, seeded[0].id, 'Contingency agreements');
assert.equal(renamed.categories[0].name, 'Contingency agreements');
assert.equal(renameCategory(seeded, seeded[0].id, 'Agreements').error.includes('already exists'), true);

const reordered = reorderCategory(seeded, seeded[0].id, 1);
assert.equal(reordered[0].slug, 'agreements');
assert.equal(reordered[1].slug, 'contingency');

const file = { id: 'doc-1', name: 'Storm contingency', kind: 'file', category_id: seeded[0].id };
const blocked = removeCategory(seeded, [file], seeded[3].id);
assert.equal(blocked.error.includes('Uncategorized stays'), true);
const removed = removeCategory(seeded, [file], seeded[0].id);
assert.equal(removed.moved, 1);
assert.equal(removed.documents[0].category_id, seeded[3].id);
assert.equal(removed.message.includes('Uncategorized'), true);
assert.equal(removed.categories.some((row) => row.slug === 'contingency'), false);

const groups = groupLibrary(seeded, [{ ...file, category_id: null }, { id: 'doc-2', name: 'Packet', category_id: seeded[1].id }]);
assert.equal(groups.find((group) => group.slug === 'uncategorized').documents[0].id, 'doc-1');
assert.equal(groups.find((group) => group.slug === 'agreements').documents[0].id, 'doc-2');

assert.deepEqual(parseAmount(' $1,250.50 '), { amount: 1250.5 });
assert.equal(parseAmount('').amount, null);
assert.equal(parseAmount('12.345').error.includes('dollars'), true);
assert.equal(formatMoney(40), '$40.00');

const rows = [
  { vendor: 'ABC Supply', address_snapshot: '18 Public Square', record_date: '2026-10-01', amount: 40, note: 'nails' },
  { homeowner_name: 'Alex Morgan', address_snapshot: '9 West St', record_date: '2026-10-08', status: 'sent', amount: 9000, note: '' }
];
assert.equal(filterRecords(rows, { query: 'abc' }).length, 1);
assert.equal(filterRecords(rows, { from: '2026-10-02' }).length, 1);
assert.equal(filterRecords(rows, { status: 'sent' })[0].homeowner_name, 'Alex Morgan');

assert.equal(libraryFileKind({ name: 'agreement.pdf', type: 'application/pdf', size: 1200 }).mime, 'application/pdf');
assert.equal(libraryFileKind({ name: 'scope.docx', type: '', size: 20 }).mime.includes('wordprocessingml'), true);
assert.equal(libraryFileKind({ name: 'notes.exe', type: '', size: 20 }).error.includes('PDF'), true);
assert.equal(libraryFileKind({ name: 'photo.jpg', type: 'image/jpeg', size: LIBRARY_LIMIT + 1 }).error.includes('25 MB'), true);
assert.equal(libraryFileKind({ name: 'sheet.xlsx', type: '', size: 20 }, { imagesAndPdfOnly: true }).error.includes('PDF'), true);

const setter = '33333333-3333-4333-8333-333333333333';
assert.equal(canDeleteRecord('admin', { uploaded_by: setter }, 'other'), true);
assert.equal(canDeleteRecord('appointment_setter', { uploaded_by: setter }, setter), true);
assert.equal(canDeleteRecord('salesperson', { uploaded_by: setter }, 'rep-1'), false);

const sql = read('supabase/migrations/20261008_document_library.sql');
assert.ok(sql.includes('document_categories'));
assert.ok(sql.includes('receipt_records'));
assert.ok(sql.includes('estimate_records'));
assert.ok(sql.includes('26214400'));
assert.ok(sql.includes('wordprocessingml'));
assert.ok(sql.includes('Uncategorized stays so documents always have a folder.'));
assert.ok(sql.includes("status in ('draft', 'sent', 'accepted', 'declined')"));
assert.equal(/reps_role|alter table public\.reps drop constraint/i.test(sql), false);
assert.equal(sql.includes('20261008_role_form_library.sql'), false);

const setup = read('supabase/setup_all.sql');
assert.ok(setup.indexOf('guard_document_review') < setup.indexOf('document_categories'));
assert.ok(setup.includes('receipt_records'));

const page = read('tn-files/my-forms.js');
assert.ok(page.includes('capture="environment"'));
assert.ok(page.includes('Library'));
assert.ok(page.includes('Receipts'));
assert.ok(page.includes('Estimates'));
assert.ok(page.includes(read('lib/records.js').includes('RECORD_ACCEPT') ? 'RECORD_ACCEPT' : 'image/*'));
assert.ok(read('tn-files/form-wizard.js').includes('mountMyForms'));
assert.ok(read('tn-files/admin-app.js').includes('data-view="library"'));
assert.ok(read('forms.html').includes('MY FORMS'));

console.log('records.test.mjs ok');

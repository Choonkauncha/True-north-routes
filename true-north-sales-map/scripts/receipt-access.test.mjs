import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canBrowseDocumentLibrary,
  canSeeReceipt,
  canUploadReceipt,
  receiptDeleteAllowed,
  receiptInsertAllowed,
  receiptStorageAllowed
} from '../lib/receipt-access.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const setterId = '33333333-3333-4333-8333-333333333333';
const repId = '55555555-5555-4555-8555-555555555555';
const otherRep = '66666666-6666-4666-8666-666666666666';
const adminId = '77777777-7777-4777-8777-777777777777';
const leadId = 'lead-1';
const assigned = { id: 'appt-1', lead_id: leadId, salesperson_id: repId, stage: 'Scheduled' };
const cancelled = { id: 'appt-2', lead_id: 'lead-2', salesperson_id: repId, stage: 'Cancelled' };
const otherLead = { id: 'appt-3', lead_id: 'lead-3', salesperson_id: otherRep, stage: 'Scheduled' };

assert.equal(canUploadReceipt({ role: 'salesperson', repId, leadId: null, appointments: [assigned] }).ok, true);
assert.equal(canUploadReceipt({ role: 'salesperson', repId, leadId, appointments: [assigned] }).ok, true);
assert.equal(canUploadReceipt({ role: 'salesperson', repId, leadId: 'lead-2', appointments: [cancelled] }).error, 'You can upload a receipt only for an inspection assigned to you.');
assert.equal(canUploadReceipt({ role: 'salesperson', repId, leadId: 'lead-3', appointments: [otherLead] }).error, 'You can upload a receipt only for an inspection assigned to you.');
assert.equal(canUploadReceipt({ role: 'salesperson', repId: otherRep, leadId, appointments: [assigned] }).error, 'You can upload a receipt only for an inspection assigned to you.');
assert.equal(canUploadReceipt({ role: 'appointment_setter', repId: setterId, leadId: null }).error, 'Only sales reps can upload receipts.');
assert.equal(canUploadReceipt({ role: 'canvasser', repId: setterId, leadId }).error, 'Only sales reps can upload receipts.');
assert.equal(canUploadReceipt({ role: 'admin', repId: adminId, leadId, appointments: [] }).ok, true);
assert.equal(canUploadReceipt({ role: 'manager', repId: adminId, leadId: null }).ok, true);

const own = { id: 'r1', uploaded_by: repId, lead_id: leadId, vendor: 'ABC Supply' };
const theirs = { id: 'r2', uploaded_by: otherRep, lead_id: null };
assert.equal(canSeeReceipt({ role: 'salesperson', repId, receipt: own }), true);
assert.equal(canSeeReceipt({ role: 'salesperson', repId, receipt: theirs }), false);
assert.equal(canSeeReceipt({ role: 'salesperson', repId: otherRep, receipt: own }), false);
assert.equal(canSeeReceipt({ role: 'admin', repId: adminId, receipt: own }), true);
assert.equal(canSeeReceipt({ role: 'admin', repId: adminId, receipt: theirs }), true);
assert.equal(canSeeReceipt({ role: 'appointment_setter', repId: setterId, receipt: own }), false);
assert.equal(canSeeReceipt({ role: 'manager', repId: adminId, receipt: theirs }), true);
assert.equal(canBrowseDocumentLibrary('salesperson'), false);
assert.equal(canBrowseDocumentLibrary('appointment_setter'), false);
assert.equal(canBrowseDocumentLibrary('admin'), true);
assert.equal(receiptDeleteAllowed('salesperson'), false);
assert.equal(receiptDeleteAllowed('appointment_setter'), false);
assert.equal(receiptDeleteAllowed('admin'), true);

const ownPath = `receipts/${repId}/file.pdf`;
assert.equal(receiptInsertAllowed({ role: 'salesperson', repId, uploadedBy: repId, storagePath: ownPath, leadId: null, appointments: [] }), true);
assert.equal(receiptInsertAllowed({ role: 'salesperson', repId, uploadedBy: repId, storagePath: ownPath, leadId, appointments: [assigned] }), true);
assert.equal(receiptInsertAllowed({ role: 'salesperson', repId, uploadedBy: repId, storagePath: ownPath, leadId: 'lead-3', appointments: [otherLead] }), false);
assert.equal(receiptInsertAllowed({ role: 'salesperson', repId, uploadedBy: otherRep, storagePath: `receipts/${otherRep}/file.pdf`, leadId: null }), false);
assert.equal(receiptInsertAllowed({ role: 'appointment_setter', repId: setterId, uploadedBy: setterId, storagePath: `receipts/${setterId}/file.pdf`, leadId: null }), false);
assert.equal(receiptInsertAllowed({ role: 'admin', repId: adminId, uploadedBy: adminId, storagePath: `receipts/${adminId}/file.pdf`, leadId: 'anywhere' }), true);

assert.equal(receiptStorageAllowed({ role: 'salesperson', repId, objectName: ownPath, action: 'insert' }), true);
assert.equal(receiptStorageAllowed({ role: 'salesperson', repId, objectName: ownPath, action: 'select' }), true);
assert.equal(receiptStorageAllowed({ role: 'salesperson', repId, objectName: `receipts/${otherRep}/file.pdf`, action: 'select' }), false);
assert.equal(receiptStorageAllowed({ role: 'salesperson', repId, objectName: `estimates/${repId}/file.pdf`, action: 'select' }), false);
assert.equal(receiptStorageAllowed({ role: 'salesperson', repId, objectName: 'library/doc.pdf', action: 'select' }), false);
assert.equal(receiptStorageAllowed({ role: 'appointment_setter', repId: setterId, objectName: `receipts/${setterId}/file.pdf`, action: 'insert' }), false);
assert.equal(receiptStorageAllowed({ role: 'appointment_setter', repId: setterId, objectName: `forms/${setterId}/file.pdf`, action: 'insert' }), true);
assert.equal(receiptStorageAllowed({ role: 'salesperson', repId, objectName: ownPath, action: 'delete' }), false);
assert.equal(receiptStorageAllowed({ role: 'admin', repId: adminId, objectName: ownPath, action: 'select' }), true);
assert.equal(receiptStorageAllowed({ role: 'admin', repId: adminId, objectName: ownPath, action: 'delete' }), true);

const sql = readFileSync(join(root, 'supabase/migrations/20261008_inspection_handoff.sql'), 'utf8');
for (const line of [
  'can_upload_receipt',
  'receipt_records_select',
  'receipt_records_insert',
  'receipt_records_delete',
  "current_rep_role() = 'salesperson'",
  'uploaded_by = public.current_rep_id()',
  "storage_path like 'receipts/' || public.current_rep_id()::text || '/%'",
  "split_part(name, '/', 1) = 'receipts'",
  "split_part(name, '/', 2) = public.current_rep_id()::text",
  "a.stage is distinct from 'Cancelled'",
  'using (public.is_admin_or_manager())',
  'Setters cannot',
  "split_part(name, '/', 1) not in ('receipts', 'estimates', 'library')"
]) {
  assert.ok(sql.includes(line), line);
}
assert.equal(/create policy document_categories_select/i.test(sql), false);
assert.equal(/create policy estimate_records_select/i.test(sql), false);
assert.equal(/alter table public\.reps drop constraint/i.test(sql), false);

const app = readFileSync(join(root, 'app.js'), 'utf8');
assert.ok(app.includes('canUploadReceipt'));
assert.ok(app.includes('canSeeReceipt'));
assert.ok(app.includes('saveReceipt'));
assert.ok(app.includes('uploadReceiptBtn'));
assert.ok(app.includes("actor.role!=='salesperson'"));
assert.equal(app.includes("href: '/files.html'") || app.includes('href="/files.html"'), false);
const index = readFileSync(join(root, 'index.html'), 'utf8');
assert.ok(index.includes('id="uploadReceiptBtn"'));
assert.ok(index.includes('Upload receipt'));
assert.ok(index.includes('id="handoffReceiptFile"'));
assert.ok(index.includes('id="receiptAmount"'));
assert.ok(index.includes('id="receiptVendor"'));
assert.ok(index.includes('id="receiptDate"'));
assert.ok(index.includes('id="receiptNote"'));
assert.ok(index.includes('accept="image/*,application/pdf"'));
assert.equal(index.includes('href="/files.html"'), false);

const setup = readFileSync(join(root, 'supabase/setup_all.sql'), 'utf8');
assert.ok(setup.includes('can_upload_receipt'));
assert.ok(setup.indexOf('sync_inspection_folder') < setup.indexOf('can_upload_receipt'));

console.log('receipt-access.test.mjs ok');

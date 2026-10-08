import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canManageAccount } from '../lib/account-rules.js';
import {
  CREATABLE_FIELD_ROLES,
  canMessageManagement,
  canSeeForm,
  canUsePhotoBank,
  cleanPhotoNote,
  fieldHomeLinks,
  isSalesRep,
  isSetterRole
} from '../lib/role-access.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

const creatable = CREATABLE_FIELD_ROLES.map(([role]) => role);
assert.deepEqual(creatable, ['appointment_setter', 'salesperson']);
assert.equal(creatable.includes('canvasser'), false);

assert.equal(isSetterRole('appointment_setter'), true);
assert.equal(isSetterRole('canvasser'), true);
assert.equal(isSalesRep('salesperson'), true);
assert.equal(isSalesRep('appointment_setter'), false);

function ids(role) {
  return fieldHomeLinks(role).map((item) => item.id);
}
assert.deepEqual(ids('appointment_setter'), ['map', 'inspection', 'forms', 'message', 'training', 'account']);
assert.deepEqual(ids('canvasser'), ids('appointment_setter'));
assert.equal(ids('appointment_setter').includes('photos'), false);
assert.ok(ids('salesperson').includes('photos'));
assert.deepEqual(ids('salesperson').filter((id) => id !== 'photos'), ids('appointment_setter'));
assert.equal(canUsePhotoBank('appointment_setter'), false);
assert.equal(canUsePhotoBank('canvasser'), false);
assert.equal(canUsePhotoBank('salesperson'), true);
assert.equal(canUsePhotoBank('admin'), true);
assert.equal(canUsePhotoBank('manager'), true);
assert.equal(canMessageManagement('appointment_setter'), true);
assert.equal(canMessageManagement('salesperson'), true);
assert.equal(canMessageManagement('admin'), true);

const setterId = '33333333-3333-4333-8333-333333333333';
const repForm = { id: 'form-rep', audience: 'rep', active: true };
const setterForm = { id: 'form-setter', audience: 'setter', active: true };
const peopleForm = { id: 'form-people', audience: 'people', active: true };
const hidden = { id: 'form-hidden', audience: 'both', active: false };
const assigned = [{ template_id: 'form-rep', rep_id: setterId }];

assert.equal(canSeeForm('appointment_setter', setterForm), true);
assert.equal(canSeeForm('canvasser', setterForm), true);
assert.equal(canSeeForm('appointment_setter', repForm), false);
assert.equal(canSeeForm('canvasser', repForm), false);
assert.equal(canSeeForm('salesperson', repForm), true);
assert.equal(canSeeForm('salesperson', setterForm), false);
assert.equal(canSeeForm('appointment_setter', repForm, { repId: setterId, assignments: assigned }), true);
assert.equal(canSeeForm('appointment_setter', peopleForm), false);
assert.equal(canSeeForm('appointment_setter', peopleForm, { repId: setterId, assignments: [{ template_id: 'form-people', rep_id: setterId }] }), true);
assert.equal(canSeeForm('salesperson', peopleForm, { repId: 'other', assignments: assigned }), false);
assert.equal(canSeeForm('appointment_setter', hidden), false);
assert.equal(canSeeForm('admin', hidden), true);
assert.equal(canSeeForm('manager', repForm), true);
assert.equal(canSeeForm('appointment_setter', { ...setterForm, kind: 'file' }), false);
assert.equal(canSeeForm('salesperson', { ...repForm, kind: 'file' }), false);
assert.equal(canSeeForm('admin', { ...setterForm, kind: 'file' }), true);

assert.deepEqual(cleanPhotoNote('  north slope  '), { text: 'north slope' });
assert.equal(cleanPhotoNote('x'.repeat(501)).error.includes('500'), true);

assert.equal(canManageAccount('admin', 'canvasser', 'create'), false);
assert.equal(canManageAccount('manager', 'canvasser', 'create'), false);
assert.equal(canManageAccount('admin', 'canvasser', 'deactivate'), true);
assert.equal(canManageAccount('manager', 'canvasser', 'reset'), true);
assert.equal(canManageAccount('admin', 'appointment_setter', 'create'), true);
assert.equal(canManageAccount('manager', 'salesperson', 'create'), true);

const accountsAdmin = read('tn-files/accounts-admin.js');
assert.equal(accountsAdmin.includes("['canvasser'"), false);
assert.equal(accountsAdmin.includes('Canvasser'), false);
assert.ok(accountsAdmin.includes('CREATABLE_FIELD_ROLES'));

const adminHtml = read('admin.html');
assert.equal(adminHtml.includes('value="canvasser"'), false);
assert.equal(adminHtml.includes('Canvassers'), false);
assert.ok(adminHtml.includes('id="openMessages"'));
assert.ok(adminHtml.includes('appointment_setter') && adminHtml.includes("x.r.role==='canvasser'"));

const indexHtml = read('index.html');
assert.equal(indexHtml.includes('Canvasser'), false);
assert.ok(indexHtml.includes('Field Command Center'));
assert.ok(indexHtml.includes('Inspection form'));

const fieldOps = read('field-ops.js');
assert.ok(fieldOps.includes('Message management'));
assert.ok(fieldOps.includes('fieldHomeLinks'));

const migration = read('supabase/migrations/20261008_role_form_library.sql');
assert.ok(migration.includes('can_fill_template'));
assert.ok(migration.includes('form_assignments'));
assert.ok(migration.includes('lead_photos_update_caption'));
assert.ok(migration.includes('application/pdf'));
assert.ok(migration.includes("audience in ('setter', 'rep', 'both', 'people')"));
assert.equal(/reps_role|alter table public\.reps drop constraint/i.test(migration), false);
assert.ok(migration.includes('Do not remove `canvasser`'));

const setup = read('supabase/setup_all.sql');
assert.ok(setup.includes('can_fill_template'));
assert.ok(setup.includes('form_assignments'));

console.log('role-access.test.mjs ok');

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertHandoffPhoto,
  handoffPermissions,
  validateHandoffPatch,
  visibleHandoffs
} from '../lib/handoff-access.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const setterId = '33333333-3333-4333-8333-333333333333';
const repId = '55555555-5555-4555-8555-555555555555';
const otherRep = '66666666-6666-4666-8666-666666666666';
const adminId = '77777777-7777-4777-8777-777777777777';

const open = {
  id: 'appt-1',
  lead_id: 'lead-1',
  canvasser_id: setterId,
  salesperson_id: repId,
  stage: 'Scheduled',
  scheduled_at: '2026-10-10T18:30:00.000Z',
  notes: 'Gate code 1234.'
};
const unassigned = { ...open, id: 'appt-2', salesperson_id: null, canvasser_id: setterId };
const completed = { ...open, id: 'appt-3', stage: 'Completed' };

function perms(role, rep, appointment) {
  return handoffPermissions({ role, repId: rep, appointment });
}

assert.deepEqual(perms('appointment_setter', setterId, open), {
  view: true, assign: false, schedule: false, notes: false, photos: false, complete: false, reopen: false
});
assert.equal(perms('canvasser', setterId, open).notes, false);
assert.equal(validateHandoffPatch({ role: 'appointment_setter', repId: setterId, before: open, patch: { notes: 'Changed' } }).error, 'Appointment setters can view handoffs only.');
assert.equal(validateHandoffPatch({ role: 'appointment_setter', repId: setterId, before: open, patch: { stage: 'Completed' } }).error, 'Appointment setters can view handoffs only.');
assert.equal(validateHandoffPatch({ role: 'canvasser', repId: setterId, before: open, patch: { salesperson_id: otherRep } }).error, 'Appointment setters can view handoffs only.');
assert.equal(assertHandoffPhoto({ role: 'appointment_setter', repId: setterId, appointment: open }).error, 'You cannot add a photo to this inspection.');

const assigned = perms('salesperson', repId, open);
assert.equal(assigned.view, true);
assert.equal(assigned.notes, true);
assert.equal(assigned.photos, true);
assert.equal(assigned.complete, true);
assert.equal(assigned.assign, false);
assert.equal(assigned.reopen, false);
assert.equal(validateHandoffPatch({ role: 'salesperson', repId, before: open, patch: { notes: 'Roof is steep.' } }).ok, true);
assert.equal(validateHandoffPatch({ role: 'salesperson', repId, before: open, patch: { stage: 'Completed' } }).ok, true);
assert.equal(validateHandoffPatch({ role: 'salesperson', repId, before: open, patch: { salesperson_id: otherRep } }).error, 'Only management can assign the sales rep.');
assert.equal(validateHandoffPatch({ role: 'salesperson', repId, before: open, patch: { scheduled_at: '2026-10-11T18:30:00.000Z' } }).error, 'Only management can change the inspection time.');
assert.equal(validateHandoffPatch({ role: 'salesperson', repId, before: completed, patch: { stage: 'Scheduled' } }).error, 'Only management can reopen an inspection.');
assert.equal(assertHandoffPhoto({ role: 'salesperson', repId, appointment: open }).ok, true);

const stranger = perms('salesperson', otherRep, open);
assert.equal(stranger.notes, false);
assert.equal(stranger.photos, false);
assert.equal(stranger.complete, false);
assert.equal(stranger.view, true);
assert.equal(validateHandoffPatch({ role: 'salesperson', repId: otherRep, before: open, patch: { notes: 'Nope' } }).error, 'You can view this handoff, not edit the notes.');
assert.equal(validateHandoffPatch({ role: 'salesperson', repId: otherRep, before: open, patch: { stage: 'Completed' } }).error, 'You cannot mark this inspection completed.');
assert.equal(assertHandoffPhoto({ role: 'salesperson', repId: otherRep, appointment: open }).error, 'You cannot add a photo to this inspection.');
assert.equal(perms('salesperson', otherRep, unassigned).photos, false);
assert.equal(validateHandoffPatch({ role: 'salesperson', repId: otherRep, before: unassigned, patch: { stage: 'Completed' } }).error, 'You cannot mark this inspection completed.');

const admin = perms('admin', adminId, open);
assert.equal(admin.assign, true);
assert.equal(admin.notes, true);
assert.equal(admin.photos, true);
assert.equal(admin.complete, true);
assert.equal(admin.reopen, false);
assert.equal(perms('manager', adminId, completed).reopen, true);
assert.equal(perms('admin', adminId, completed).complete, false);
assert.equal(validateHandoffPatch({ role: 'admin', repId: adminId, before: open, patch: { salesperson_id: otherRep, notes: 'Reassigned.' } }).ok, true);
assert.equal(validateHandoffPatch({ role: 'manager', repId: adminId, before: completed, patch: { stage: 'Scheduled' } }).ok, true);
assert.equal(validateHandoffPatch({ role: 'admin', repId: adminId, before: open, patch: { stage: 'Completed' } }).ok, true);
assert.equal(assertHandoffPhoto({ role: 'admin', repId: adminId, appointment: unassigned }).ok, true);

const visibleSetter = visibleHandoffs({
  role: 'appointment_setter',
  repId: setterId,
  appointments: [open, unassigned, completed, { ...open, id: 'cancelled', stage: 'Cancelled' }]
});
assert.deepEqual(visibleSetter.map((row) => row.id), ['appt-1', 'appt-2']);
const visibleAdmin = visibleHandoffs({ role: 'admin', repId: adminId, appointments: [open, completed] });
assert.deepEqual(visibleAdmin.map((row) => row.id), ['appt-1', 'appt-3']);
assert.equal(visibleHandoffs({ role: 'appointment_setter', repId: setterId, appointments: [open] }).some((row) => row.canvasser_id === setterId), true);

const sql = readFileSync(join(root, 'supabase/migrations/20261008_inspection_handoff.sql'), 'utf8');
for (const line of [
  'Appointment setters can view handoffs only.',
  'Only management can assign the sales rep.',
  'Only management can change the inspection time.',
  'You can view this handoff, not edit the notes.',
  'You cannot mark this inspection completed.',
  'Only management can reopen an inspection.',
  'You cannot change this inspection stage.',
  'You can view this handoff only.',
  'can_add_handoff_photo',
  "new.stage = 'Completed'",
  "'inspection_completed'",
  "'inspection_reopened'",
  "'handoff_assigned'",
  "'handoff_note'",
  'sync_inspection_folder',
  'appointment_id',
  'Do not remove `canvasser`'
]) {
  assert.ok(sql.includes(line), line);
}
assert.equal(/alter table public\.reps drop constraint/i.test(sql), false);

const setup = readFileSync(join(root, 'supabase/setup_all.sql'), 'utf8');
assert.ok(setup.includes('guard_handoff_update'));
assert.ok(setup.includes('can_add_handoff_photo'));
assert.ok(setup.indexOf('sync_inspection_folder') < setup.indexOf('guard_handoff_update'));

const app = readFileSync(join(root, 'app.js'), 'utf8');
assert.ok(app.includes('handoffPermissions'));
assert.ok(app.includes('validateHandoffPatch'));
assert.ok(app.includes('visibleHandoffs'));
assert.ok(app.includes('completeHandoffBtn'));
assert.ok(app.includes('reopenHandoffBtn'));
const index = readFileSync(join(root, 'index.html'), 'utf8');
assert.ok(index.includes('id="completeHandoffBtn"'));
assert.ok(index.includes('id="appPhoto"'));
assert.ok(index.includes('id="reopenHandoffBtn"'));

console.log('handoff-access.test.mjs ok');

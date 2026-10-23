import assert from 'node:assert/strict';
import { canDeleteAppointments, deleteAppointment, withoutLocallyDeleted, LOCAL_DELETED_KEY } from '../lib/appointment-delete.js';

const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
const admin = { role: 'admin', active: true };
assert.equal(canDeleteAppointments(admin), true);
assert.equal(canDeleteAppointments({ role: 'manager', active: true }), false);
assert.equal(canDeleteAppointments({ role: 'admin', active: false }), false);
assert.equal(canDeleteAppointments(null), false);

const list = [{ id: 'a' }, { id: 'b' }];
await assert.rejects(deleteAppointment({ sb: null, id: 'a', list, storage: memory(), me: { role: 'manager' } }), /Only admins/);

// Local mode remembers the deletion on this device.
const storage = memory();
assert.deepEqual(await deleteAppointment({ sb: null, id: 'a', list, storage, me: admin }), [{ id: 'b' }]);
assert.deepEqual(JSON.parse(storage.getItem(LOCAL_DELETED_KEY)), ['a']);
assert.deepEqual(withoutLocallyDeleted(list, storage), [{ id: 'b' }]);

// Cloud mode deletes by id and treats zero returned rows (RLS refusal) as an error.
const calls = [];
const fakeSb = rows => ({ from: t => ({ delete: () => ({ eq: (c, v) => ({ select: s => { calls.push([t, c, v, s]); return Promise.resolve({ data: rows, error: null }); } }) }) }) });
assert.deepEqual(await deleteAppointment({ sb: fakeSb([{ id: 'b' }]), id: 'b', list, storage: memory(), me: admin }), [{ id: 'a' }]);
assert.deepEqual(calls[0], ['appointments', 'id', 'b', 'id']);
await assert.rejects(deleteAppointment({ sb: fakeSb([]), id: 'b', list, storage: memory(), me: admin }), /not deleted/);
console.log('Appointment delete tests passed.');

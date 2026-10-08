import assert from 'node:assert/strict';
import { dashboardIndex, dashboardSummary, upcomingAppointments } from '../lib/dashboard.js';

const index = dashboardIndex([
  { id: 'one', city: 'A', lat: 40, lng: -82 },
  { id: 'two', city: 'A', lat: null, lng: -82 },
  { id: 'three', city: 'B', lat: 'invalid', lng: -82 },
], [{ id: 'rep', name: 'Alex' }]);
assert.equal(index.leads.get('one').city, 'A');
assert.equal(index.reps.get('rep').name, 'Alex');
assert.deepEqual(index.cities.get('A'), { total: 2, mapped: 1 });
assert.deepEqual(index.cities.get('B'), { total: 1, mapped: 0 });

// November's DST transition has a 25-hour Eastern day; both repeated hours count.
const now = new Date('2026-11-01T18:00:00Z');
const appointments = [
  { id: 'overdue', stage: 'Scheduled', scheduled_at: '2026-11-01T05:30:00Z', salesperson_id: null },
  { id: 'next', stage: 'Confirmed', scheduled_at: '2026-11-01T20:00:00Z', salesperson_id: 'rep' },
  { id: 'later', stage: 'Requested', scheduled_at: '2026-11-02T04:59:59Z', salesperson_id: null },
  { id: 'tomorrow', stage: 'Scheduled', scheduled_at: '2026-11-02T05:00:00Z', salesperson_id: 'rep' },
  { id: 'cancelled', stage: 'Cancelled', scheduled_at: '2026-11-01T21:00:00Z' },
  { id: 'done', stage: 'Completed', scheduled_at: '2026-11-01T22:00:00Z' },
  { id: 'missed', stage: 'No-show', scheduled_at: '2026-11-01T23:00:00Z' },
  { id: 'undated', stage: 'Scheduled', scheduled_at: null, salesperson_id: 'rep' },
];
const summary = dashboardSummary({
  appointments,
  reps: [
    { active: true, role: 'appointment_setter' }, { active: true, role: 'canvasser' },
    { active: true, role: 'salesperson' }, { active: false, role: 'salesperson' },
  ],
  activities: [
    { created_at: '2026-11-01T03:59:59Z', metadata: { to_status: 'Knocked' } },
    { created_at: '2026-11-01T05:30:00Z', metadata: { to_status: 'Knocked' } },
    { created_at: '2026-11-01T06:30:00Z', metadata: { to_status: 'No Answer' } },
    { created_at: '2026-11-02T04:59:59Z', metadata: { to_status: 'Interested' } },
    { created_at: '2026-11-02T05:00:00Z', metadata: { to_status: 'Knocked' } },
    { created_at: now.toISOString(), metadata: {} },
  ],
  homes: [{ status: 'New' }, { status: 'Contacted' }, { status: 'Completed' }, { status: 'Closed' }, { status: 'Do Not Contact' }],
}, now);
assert.equal(summary.worked, 3);
assert.equal(summary.apptToday, 5);
assert.equal(summary.setters, 2);
assert.equal(summary.sales, 1);
assert.equal(summary.openHomes, 2);
assert.equal(summary.newRequests, 1);
assert.equal(summary.unassigned, 2);
assert.equal(summary.overdue, 1); // Undated inspections must not become "past due".
assert.deepEqual(upcomingAppointments(appointments, now).map(row => row.id), ['next', 'later', 'tomorrow']);
assert.deepEqual(upcomingAppointments(appointments, now, 1).map(row => row.id), ['next']);
assert.equal(dashboardSummary({}, now).worked, 0);
console.log('Dashboard indexing, queues, and Eastern DST metrics passed.');

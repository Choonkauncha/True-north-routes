import assert from 'node:assert/strict';
import {
  inspectionBookingChanged,
  inspectionCardsHtml,
  inspectionDirectionsUrl,
  inspectionInRange,
  noticeRecipients,
  phoneForLead,
  prepareInspections,
  pushInspectionNotice,
  sortInspections,
  unreadNotices,
  withNoticeRead
} from '../lib/inspection-notices.js';

const now = new Date('2026-10-12T15:00:00Z');
const reps = [
  { id: 'setter', role: 'appointment_setter', active: true, name: 'Riley Setter' },
  { id: 'admin', role: 'admin', active: true, name: 'Avery Admin' },
  { id: 'manager', role: 'manager', active: true, name: 'Morgan Manager' },
  { id: 'owner', role: 'owner', active: true, name: 'Owen Owner' },
  { id: 'sales', role: 'salesperson', active: true, name: 'Jordan Sales' },
  { id: 'old-admin', role: 'admin', active: false, name: 'Former Admin' }
];
assert.deepEqual(noticeRecipients(reps, 'setter').map((rep) => rep.id), ['admin', 'manager', 'owner']);
assert.equal(inspectionBookingChanged(null, { scheduled_at: '2026-10-12T16:00:00Z', stage: 'Scheduled', canvasser_id: 'setter' }), true);
assert.equal(inspectionBookingChanged(null, { scheduled_at: '2026-10-12T16:00:00Z', stage: 'Requested', canvasser_id: null }), false);
assert.equal(inspectionBookingChanged(
  { scheduled_at: '2026-10-12T16:00:00Z', stage: 'Scheduled', canvasser_id: 'setter' },
  { scheduled_at: '2026-10-12T16:00:00Z', stage: 'Scheduled', canvasser_id: 'setter', notes: 'added a note' }
), false);
assert.equal(inspectionBookingChanged(
  { scheduled_at: '2026-10-12T16:00:00Z', stage: 'Scheduled', canvasser_id: 'setter' },
  { scheduled_at: '2026-10-13T16:00:00Z', stage: 'Scheduled', canvasser_id: 'setter' }
), true);

const notices = [
  { id: 'n1', read_at: null },
  { id: 'n2', read_at: '2026-10-12T12:00:00Z' }
];
assert.equal(unreadNotices(notices).length, 1);
assert.equal(withNoticeRead(notices, 'n1', '2026-10-12T16:00:00Z')[0].read_at, '2026-10-12T16:00:00Z');
assert.equal(withNoticeRead(notices, 'n2', '2026-10-12T16:00:00Z')[1].read_at, '2026-10-12T12:00:00Z');

let pushed = null;
const NotificationApi = function NotificationApi(title, options) { pushed = { title, options }; };
assert.equal(pushInspectionNotice({ id: 'n1', title: 'Inspection scheduled', body: 'Riley booked Ada' }, {
  NotificationApi, permission: 'granted', hidden: true
}), true);
assert.equal(pushed.options.tag, 'inspection-n1');
assert.equal(pushInspectionNotice({ id: 'n1', title: 'Inspection scheduled' }, {
  NotificationApi, permission: 'granted', hidden: false
}), false);
assert.equal(pushInspectionNotice({ id: 'n1', title: 'Inspection scheduled' }, {
  NotificationApi, permission: 'default', hidden: true
}), false);

const appointments = [
  { id: 'past', lead_id: 'l1', scheduled_at: '2026-10-10T15:00:00Z', stage: 'Completed', canvasser_id: 'setter', salesperson_id: 'sales', notes: 'Done' },
  { id: 'today', lead_id: 'l2', scheduled_at: '2026-10-12T18:00:00Z', stage: 'Scheduled', canvasser_id: 'setter', salesperson_id: 'sales', notes: 'Hail concern' },
  { id: 'week', lead_id: 'l3', scheduled_at: '2026-10-14T18:00:00Z', stage: 'Confirmed', canvasser_id: 'setter', salesperson_id: null, notes: '' },
  { id: 'later', lead_id: 'l4', scheduled_at: '2026-10-20T18:00:00Z', stage: 'Scheduled', canvasser_id: 'setter', salesperson_id: 'sales' },
  { id: 'sunday', lead_id: 'l5', scheduled_at: '2026-10-11T15:00:00Z', stage: 'Scheduled', canvasser_id: 'setter', salesperson_id: 'sales' }
];
assert.deepEqual(sortInspections(appointments, now).map((row) => row.id), ['today', 'week', 'later', 'sunday', 'past']);
assert.equal(inspectionInRange('2026-10-12T18:00:00Z', 'today', now), true);
assert.equal(inspectionInRange('2026-10-14T18:00:00Z', 'today', now), false);
assert.equal(inspectionInRange('2026-10-11T15:00:00Z', 'week', now), true);
assert.equal(inspectionInRange('2026-10-18T04:00:00Z', 'week', now), false);
assert.equal(inspectionInRange('2026-10-20T18:00:00Z', 'all', now), true);

const leads = [
  { id: 'l2', name: 'Ada <Home>', address: '18 North Main', city: 'Mount Vernon', state: 'OH', zip: '43050', lat: 40.393, lng: -82.485 },
  { id: 'l3', name: 'Blake', address: '9 Public Square', city: 'Mount Vernon', state: 'OH', zip: '43050' }
];
const homes = [
  { lead_id: 'l2', phone: '740-555-0100', updated_at: '2026-10-01T00:00:00Z' },
  { lead_id: 'l2', phone: '740-555-0199', updated_at: '2026-10-11T00:00:00Z' }
];
assert.equal(phoneForLead(homes, 'l2'), '740-555-0199');
const todayRows = prepareInspections({ appointments, leads, homes, reps, range: 'today', now });
assert.deepEqual(todayRows.map((row) => row.id), ['today']);
assert.equal(todayRows[0].homeowner, 'Ada <Home>');
assert.equal(todayRows[0].phone, '740-555-0199');
assert.equal(todayRows[0].setter, 'Riley Setter');
assert.equal(todayRows[0].rep, 'Jordan Sales');
assert.match(todayRows[0].directionsUrl, /google\.com\/maps\/dir/);
assert.match(inspectionDirectionsUrl(leads[0]), /40\.393%2C-82\.485|40\.393,-82\.485/);
const html = inspectionCardsHtml(todayRows);
assert.match(html, /Ada &lt;Home&gt;/);
assert.match(html, /740-555-0199/);
assert.match(html, /Hail concern/);
assert.doesNotMatch(html, /<Home>/);
const weekRows = prepareInspections({ appointments, leads, homes, reps, range: 'week', now });
assert.deepEqual(weekRows.map((row) => row.id), ['today', 'week', 'sunday']);
const found = prepareInspections({ appointments, leads, homes, reps, range: 'all', now, query: '555-0199' });
assert.deepEqual(found.map((row) => row.id), ['today']);
console.log('Inspection notices: recipients, ranges, upcoming-first order, and safe cards passed.');

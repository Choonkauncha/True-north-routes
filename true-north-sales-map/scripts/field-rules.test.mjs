import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NOTICE_TEXT,
  NOTICE_VERSION,
  addIsoDays,
  cleanCoord,
  cleanMessage,
  easternDayBounds,
  easternToday,
  formatHours,
  haversineMiles,
  isAdminRole,
  isFieldRole,
  isIsoDate,
  isUuid,
  overlapHours,
  quotedTime,
  summarizeDay,
  trailMiles,
  unreadCount
} from '../lib/field-rules.js';

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, '../supabase/migrations/20261008_access_clockin.sql'), 'utf8');

assert.equal(isFieldRole('canvasser'), true);
assert.equal(isFieldRole('appointment_setter'), true);
assert.equal(isFieldRole('salesperson'), true);
assert.equal(isFieldRole('admin'), false);
assert.equal(isAdminRole('manager'), true);
assert.equal(isAdminRole('canvasser'), false);
assert.equal(isUuid('11111111-1111-4111-8111-111111111111'), true);
assert.equal(isUuid('not-a-uuid'), false);
assert.equal(isIsoDate('2026-10-08'), true);
assert.equal(isIsoDate('2026-02-31'), false);

assert.equal(cleanCoord(null, null), null);
assert.equal(cleanCoord('', ''), null);
assert.ok(cleanCoord(40.3, null).error);
assert.ok(cleanCoord(91, -82).error);
assert.deepEqual(cleanCoord('40.39', '-82.48'), { lat: 40.39, lng: -82.48 });
assert.equal(cleanMessage('  ').error, 'Write a message first.');
assert.equal(cleanMessage('  Hello office  ').text, 'Hello office');

const mile = haversineMiles(0, 0, 1, 0);
assert.ok(mile > 68 && mile < 70, `expected ~69 miles, got ${mile}`);
const trail = trailMiles([
  { id: 'a', lat: 0, lng: 0, captured_at: '2026-10-08T14:00:00Z' },
  { id: 'b', lat: 1, lng: 0, captured_at: '2026-10-08T15:00:00Z' }
]);
assert.ok(Math.abs(trail.miles - mile) < 0.001);
assert.equal(trail.longGap, true);

assert.equal(easternToday(new Date('2026-10-08T03:30:00Z')), '2026-10-07');
assert.equal(easternToday(new Date('2026-10-08T04:30:00Z')), '2026-10-08');
assert.equal(easternDayBounds('2026-01-15').start.toISOString(), '2026-01-15T05:00:00.000Z');
assert.equal(easternDayBounds('2026-07-15').start.toISOString(), '2026-07-15T04:00:00.000Z');
assert.equal(easternDayBounds('2026-10-08').start.toISOString(), '2026-10-08T04:00:00.000Z');
assert.equal(easternDayBounds('2026-10-08').end.toISOString(), '2026-10-09T04:00:00.000Z');
assert.equal(addIsoDays('2026-10-08', 1), '2026-10-09');

const bounds = easternDayBounds('2026-10-08');
const hours = overlapHours('2026-10-08T03:00:00Z', '2026-10-08T06:00:00Z', bounds.start, bounds.end);
assert.equal(hours, 2);
const openHours = overlapHours('2026-10-08T22:00:00Z', null, bounds.start, bounds.end, new Date('2026-10-09T02:00:00Z'));
assert.equal(openHours, 4);
assert.equal(formatHours(2), '2h 00m');
assert.equal(formatHours(1.5), '1h 30m');

const summary = summarizeDay({
  shifts: [{
    id: 's1',
    rep_id: '11111111-1111-4111-8111-111111111111',
    clock_in_at: '2026-10-08T14:00:00Z',
    clock_out_at: '2026-10-08T16:00:00Z'
  }],
  points: [
    { id: 'p1', rep_id: '11111111-1111-4111-8111-111111111111', lat: 40.39, lng: -82.48, captured_at: '2026-10-08T14:00:00Z', kind: 'clock_in' },
    { id: 'p2', rep_id: '11111111-1111-4111-8111-111111111111', lat: 40.40, lng: -82.48, captured_at: '2026-10-08T15:00:00Z', kind: 'door_status' }
  ],
  reps: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Ada', role: 'canvasser', active: true }],
  consents: [{ rep_id: '11111111-1111-4111-8111-111111111111', consented_at: '2026-10-01T12:00:00Z', notice_version: NOTICE_VERSION }],
  dayStart: bounds.start,
  dayEnd: bounds.end
});
assert.equal(summary.people.length, 1);
assert.equal(summary.people[0].totalHours, 2);
assert.ok(summary.people[0].miles > 0.6 && summary.people[0].miles < 0.8);
assert.equal(summary.people[0].consent.notice_version, NOTICE_VERSION);

const thread = { id: 't1', rep_id: 'rep', rep_last_read_at: '2026-10-08T12:00:00Z', admin_last_read_at: null };
const messages = [
  { thread_id: 't1', sender_rep_id: 'admin', created_at: '2026-10-08T11:00:00Z' },
  { thread_id: 't1', sender_rep_id: 'admin', created_at: '2026-10-08T13:00:00Z' },
  { thread_id: 't1', sender_rep_id: 'rep', created_at: '2026-10-08T13:30:00Z' }
];
assert.equal(unreadCount(messages, thread, 'rep'), 1);
assert.equal(unreadCount(messages, thread, 'admin'), 1);

assert.equal(quotedTime('2026-10-08T04:00:00.000Z'), '"2026-10-08T04:00:00.000Z"');
assert.throws(() => quotedTime('yesterday'), /timestamp/);

assert.ok(sql.includes(NOTICE_VERSION));
assert.ok(sql.includes(NOTICE_TEXT));
assert.match(sql, /enable row level security/);
assert.match(sql, /shifts_one_open_per_rep/);
assert.match(sql, /mark_thread_read/);
assert.match(sql, /current_rep_id/);
assert.match(sql, /revoke all on table public\.shifts from anon/);

await import('../api/field.js');

console.log('field-rules tests passed');

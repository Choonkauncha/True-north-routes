import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { visibleHandoffs } from '../lib/handoff-access.js';
import {
  addressKey,
  adminHomeownerRows,
  handleInspection,
  handlePublicSignup,
  normalizePhone,
  planHomeownerProfile
} from '../lib/homeowner-profile.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const SETTER = '33333333-3333-4333-8333-333333333333';
const SETTER_USER = '44444444-4444-4444-8444-444444444444';
const SALES = '55555555-5555-4555-8555-555555555555';
const secret = 'service-role-secret';
const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
  SUPABASE_SECRET_KEY: secret
};

function createCloud() {
  const db = {
    leads: [],
    homeowner_intakes: [],
    appointments: [],
    lead_activity: [],
    reps: [{ id: SETTER, user_id: SETTER_USER, name: 'Ada Setter', role: 'appointment_setter', active: true }],
    users: { 'setter-token': { id: SETTER_USER } }
  };
  async function fetchImpl(url, options = {}) {
    const u = new URL(String(url));
    const method = options.method || 'GET';
    const headers = options.headers || {};
    const auth = headers.Authorization || headers.authorization || '';
    if (u.pathname.endsWith('/auth/v1/user')) {
      const token = auth.replace(/^Bearer\s+/i, '');
      const user = db.users[token];
      return new Response(JSON.stringify(user || {}), { status: user ? 200 : 401 });
    }
    const table = u.pathname.split('/rest/v1/')[1];
    if (table === 'rpc/password_gate_status') return new Response(JSON.stringify({ must_change: false, impersonating: false }));
    if (table === 'rpc/feature_enabled') return new Response('true');
    if (table === 'rpc/atomic_save_homeowner_profile') {
      const input = JSON.parse(options.body).p_input;
      const plan = planHomeownerProfile({ leads: db.leads, intakes: db.homeowner_intakes, appointments: db.appointments }, input);
      let intakeId = '', appointmentId = '';
      for (const write of plan.writes) {
        let saved;
        if (write.method === 'patch') {
          saved = db[write.table].find(row => row.id === write.id);
          Object.assign(saved, write.body);
        } else { saved = { ...write.body, id: write.body.id || crypto.randomUUID() }; db[write.table].push(saved); }
        if (write.table === 'homeowner_intakes') intakeId = saved.id;
        if (write.table === 'appointments') appointmentId = saved.id;
      }
      return new Response(JSON.stringify({ ok: true, updated: Boolean(plan.match.intake), reference: plan.leadId, lead_id: plan.leadId, intake_id: intakeId, appointment_id: appointmentId || null }));
    }
    if (!table || !db[table]) return new Response(JSON.stringify({ message: 'missing table' }), { status: 404 });
    if (table === 'reps' && !auth.includes(secret)) {
      return new Response(JSON.stringify({ message: 'forbidden' }), { status: 401 });
    }
    if (method === 'GET') {
      const rows = db[table].filter((row) => {
        for (const [key, raw] of u.searchParams) {
          if (key === 'select' || key === 'limit') continue;
          const text = String(raw);
          const op = text.startsWith('ilike.') ? 'ilike' : text.startsWith('eq.') ? 'eq' : '';
          if (!op) continue;
          const expected = text.slice(op.length + 1);
          const actual = String(row[key] ?? '');
          if (op === 'eq' && actual !== expected) return false;
          if (op === 'ilike' && actual.toLowerCase() !== expected.toLowerCase()) return false;
        }
        return true;
      });
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    const body = options.body ? JSON.parse(options.body) : {};
    if (method === 'POST') {
      const row = { ...body, id: body.id || crypto.randomUUID() };
      db[table].push(row);
      return new Response(JSON.stringify([row]), { status: 201 });
    }
    if (method === 'PATCH') {
      const id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
      const current = db[table].find((row) => row.id === id);
      if (!current) return new Response(JSON.stringify([]), { status: 200 });
      Object.assign(current, body);
      return new Response(JSON.stringify([current]), { status: 200 });
    }
    return new Response(JSON.stringify({ message: 'method' }), { status: 405 });
  }
  return { db, fetchImpl };
}

function inspectionBody(overrides = {}) {
  return {
    first_name: 'Alex',
    last_name: 'Morgan',
    phone: '(740) 555-0199',
    email: 'Alex@Example.com',
    address: '18 Public Square',
    city: 'Mount Vernon',
    state: 'OH',
    zip: '43050',
    homeowner_confirmed: true,
    consent_contact: true,
    concern: 'Leak or water spot',
    what_they_noticed: 'Water spot in the upstairs bedroom.',
    other_contractor: 'No',
    timing: 'As soon as practical',
    notes: 'Gate code 1234.',
    scheduled_date: '2026-10-10',
    scheduled_time: '14:30',
    salesperson_id: SALES,
    stage: 'Scheduled',
    ...overrides
  };
}

function post(body, token = 'setter-token') {
  return new Request('https://example.test/api/inspection', {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(body)
  });
}

const { db, fetchImpl } = createCloud();
const firstResponse = await handleInspection(post(inspectionBody()), { env, fetchImpl });
const first = await firstResponse.json();
assert.equal(firstResponse.status, 201);
assert.equal(first.updated, false);
assert.equal(db.leads.length, 1);
assert.equal(db.homeowner_intakes.length, 1);
assert.equal(db.appointments.length, 1);
assert.equal(db.lead_activity.length, 1);
assert.equal(db.leads[0].name, 'Alex Morgan');
assert.equal(db.leads[0].status, 'Appointment');
assert.equal(db.homeowner_intakes[0].status, 'Inspection Scheduled');
assert.equal(db.homeowner_intakes[0].source, 'appointment_setter');
assert.equal(db.homeowner_intakes[0].concern, 'Leak or water spot');
assert.equal(db.homeowner_intakes[0].created_by, SETTER);
assert.equal(db.homeowner_intakes[0].assigned_salesperson_id, SALES);
assert.ok(db.appointments[0].notes.includes('Concern: Leak or water spot'));
assert.ok(db.appointments[0].notes.includes('Gate code 1234.'));
assert.equal(db.appointments[0].stage, 'Scheduled');
assert.equal(db.appointments[0].salesperson_id, SALES);
assert.equal(db.appointments[0].canvasser_id, SETTER);
assert.equal(db.lead_activity[0].action, 'setter_appointment_booked');

const queue = visibleHandoffs({ role: 'appointment_setter', repId: SETTER, appointments: db.appointments });
assert.equal(queue.length, 1);
assert.equal(queue[0].id, db.appointments[0].id);

const adminRows = adminHomeownerRows(db.homeowner_intakes);
assert.equal(adminRows.length, 1);
assert.equal(adminRows[0].name, 'Alex Morgan');
assert.equal(adminRows[0].phone, '(740) 555-0199');
assert.equal(adminRows[0].address, '18 Public Square');

const secondResponse = await handleInspection(post(inspectionBody({
  phone: '7405550199',
  email: 'alex@example.com',
  address: '18 public square',
  notes: 'Bring a ladder.',
  scheduled_time: '15:00'
})), { env, fetchImpl });
const second = await secondResponse.json();
assert.equal(secondResponse.status, 200);
assert.equal(second.updated, true);
assert.equal(second.lead_id, first.lead_id);
assert.equal(second.intake_id, first.intake_id);
assert.equal(second.appointment_id, first.appointment_id);
assert.equal(db.leads.length, 1);
assert.equal(db.homeowner_intakes.length, 1);
assert.equal(db.appointments.length, 1);
assert.equal(db.lead_activity.length, 2);
assert.equal(db.homeowner_intakes[0].phone, '7405550199');
assert.ok(db.homeowner_intakes[0].notes.includes('Bring a ladder.'));
assert.equal(adminHomeownerRows(db.homeowner_intakes).length, 1);
assert.equal(normalizePhone('(740) 555-0199'), normalizePhone('7405550199'));
assert.equal(addressKey('18 Public Square', 'Mount Vernon', '43050'), addressKey('18 public square', 'Mount Vernon', '43050'));

const other = await handleInspection(post(inspectionBody({
  first_name: 'Jo',
  last_name: 'Kim',
  phone: '740-555-0100',
  email: 'jo@example.com',
  notes: 'Different homeowner.'
})), { env, fetchImpl });
assert.equal(other.status, 201);
assert.equal(db.homeowner_intakes.length, 2);
assert.equal(db.leads.length, 2);
assert.deepEqual(adminHomeownerRows(db.homeowner_intakes).map((row) => row.name).sort(), ['Alex Morgan', 'Jo Kim']);

const leadId = 'LEAD-MAP-18';
db.leads.push({ id: leadId, name: 'Property lead', address: '9 West St', city: 'Mount Vernon', state: 'OH', zip: '43050', status: 'New' });
const fromMap = await handleInspection(post(inspectionBody({
  lead_id: leadId,
  first_name: 'Pat',
  last_name: 'Lee',
  phone: '740-555-0177',
  email: 'pat@example.com',
  address: '9 West St',
  notes: 'From the map pin.'
})), { env, fetchImpl });
const mapped = await fromMap.json();
assert.equal(fromMap.status, 201);
assert.equal(mapped.lead_id, leadId);
assert.equal(db.leads.filter((row) => row.id === leadId).length, 1);
assert.equal(db.homeowner_intakes.filter((row) => row.lead_id === leadId).length, 1);
const again = await handleInspection(post(inspectionBody({
  lead_id: leadId,
  first_name: 'Pat',
  last_name: 'Lee',
  phone: '7405550177',
  email: 'pat@example.com',
  address: '9 West St',
  notes: 'Updated from the map pin.'
})), { env, fetchImpl });
assert.equal(again.status, 200);
assert.equal(db.homeowner_intakes.filter((row) => row.lead_id === leadId).length, 1);
assert.ok(db.homeowner_intakes.find((row) => row.lead_id === leadId).notes.includes('Updated from the map pin.'));

const denied = await handleInspection(post(inspectionBody(), ''), { env, fetchImpl });
assert.equal(denied.status, 401);

const publicResponse = await handlePublicSignup(post({
  first_name: 'Sam',
  last_name: 'Public',
  phone: '740-555-0133',
  email: 'sam@example.com',
  address: '4 Oak Ave',
  city: 'Mount Vernon',
  state: 'oh',
  zip: '43050',
  homeowner_confirmed: true,
  consent_contact: true,
  concern: 'Roof age / maintenance',
  what_they_noticed: 'Shingles look worn.',
  preferred_date: '2026-10-12',
  preferred_time_window: 'Morning',
  notes: 'Please call first.'
}), { env, fetchImpl });
const pub = await publicResponse.json();
assert.equal(publicResponse.status, 201);
const publicIntake = db.homeowner_intakes.find((row) => row.lead_id === pub.lead_id);
assert.equal(publicIntake.source, 'public_homeowner_form');
assert.equal(publicIntake.concern, 'Roof age / maintenance');
assert.equal(publicIntake.preferred_time_window, 'Morning');
assert.equal(db.appointments.find((row) => row.lead_id === pub.lead_id).stage, 'Requested');
const publicAgain = await handlePublicSignup(post({
  first_name: 'Sam',
  last_name: 'Public',
  phone: '7405550133',
  email: 'sam@example.com',
  address: '4 Oak Ave',
  city: 'Mount Vernon',
  state: 'OH',
  zip: '43050',
  consent_contact: true,
  notes: 'Afternoon is better.',
  preferred_date: '2026-10-13',
  preferred_time_window: 'Afternoon'
}), { env, fetchImpl });
assert.equal(publicAgain.status, 201);
assert.equal(db.homeowner_intakes.filter((row) => addressKey(row.address, row.city, row.zip) === addressKey('4 Oak Ave', 'Mount Vernon', '43050')).length, 2);
assert.equal(db.appointments.filter((row) => row.lead_id === pub.lead_id).length, 1);

const honeypot = await handlePublicSignup(post({ ...inspectionBody(), website: 'spam' }), { env, fetchImpl });
assert.equal(honeypot.status, 400);

const page = readFileSync(join(root, 'setter.html'), 'utf8');
assert.equal(page.includes('homeowner.html'), false);
assert.ok(page.includes('name="concern"'));
assert.ok(page.includes('name="consent_contact"'));
assert.ok(page.includes('/tn-files/inspection-form.js'));
const homeowner = readFileSync(join(root, 'homeowner.html'), 'utf8');
assert.ok(homeowner.includes('/setter.html'));
assert.ok(homeowner.includes('location.search'));
const index = readFileSync(join(root, 'index.html'), 'utf8');
assert.equal(index.includes('>Homeowner form<'), false);
assert.equal(index.includes('Homeowner Inspection Sign-Up'), false);
const admin = readFileSync(join(root, 'admin.html'), 'utf8');
assert.equal(admin.includes('href="/homeowner.html"'), false);
assert.equal(admin.includes('Copy homeowner form link'), false);

console.log('homeowner-profile.test.mjs ok');

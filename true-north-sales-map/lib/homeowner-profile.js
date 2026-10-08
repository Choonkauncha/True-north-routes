/** One homeowner profile per person at an address. Shared by the inspection form and the public request. */

const STAFF_ROLES = new Set(['appointment_setter', 'canvasser', 'salesperson', 'manager', 'admin']);
const WINDOW_HOUR = { Morning: '09:00', Midday: '12:00', Afternoon: '15:00', Evening: '18:00' };

export function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

export function normalizePhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function addressKey(address, city, zip) {
  return [address, city, zip]
    .map((part) => String(part ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())
    .filter(Boolean)
    .join('|');
}

export function timeWindowFromClock(value) {
  const match = /^(\d{2}):(\d{2})/.exec(String(value || ''));
  if (!match) return '';
  const hour = Number(match[1]);
  if (hour < 11) return 'Morning';
  if (hour < 14) return 'Midday';
  if (hour < 17) return 'Afternoon';
  return 'Evening';
}

export function scheduledFromPreference(date, window) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return '';
  const clock = WINDOW_HOUR[window] || '09:00';
  const when = new Date(`${date}T${clock}`);
  if (Number.isNaN(when.getTime())) return '';
  return when.toISOString();
}

export function composeHandoffNotes(input) {
  const base = clean(input.notes, 4000);
  const extras = [
    input.concern ? `Concern: ${clean(input.concern, 120)}` : '',
    input.what_they_noticed ? `Noticed: ${clean(input.what_they_noticed, 1500)}` : '',
    input.timing ? `Timing: ${clean(input.timing, 60)}` : '',
    input.other_contractor ? `Other contractor: ${clean(input.other_contractor, 40)}` : ''
  ].filter(Boolean);
  const lines = base ? [base] : [];
  const blob = lines.join('\n');
  for (const line of extras) {
    if (!blob.includes(line)) lines.push(line);
  }
  return lines.join('\n').slice(0, 4000);
}

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.public = true;
  return error;
}

export function inspectionInputFromBody(body = {}, { actor = null, source = 'appointment_setter' } = {}) {
  if (source === 'public_homeowner_form' && clean(body.website, 100)) return { error: 'Invalid submission.' };
  const first = clean(body.first_name, 80);
  const last = clean(body.last_name, 80);
  const phone = clean(body.phone, 40);
  const email = clean(body.email, 160);
  const address = clean(body.address, 180);
  const city = clean(body.city, 80) || 'Mount Vernon';
  const state = (clean(body.state, 3) || 'OH').toUpperCase();
  const zip = clean(body.zip, 20);
  const required = { first_name: first, last_name: last, phone, address, city, state, zip };
  for (const [key, value] of Object.entries(required)) {
    if (!value) return { error: `Please provide ${key.replaceAll('_', ' ')}.` };
  }
  const staff = source !== 'public_homeowner_form';
  if (body.consent_contact !== true) {
    return {
      error: staff
        ? 'Please confirm the homeowner agreed to be contacted.'
        : 'Please confirm that True North may contact you about your inspection request.'
    };
  }
  if (staff) {
    if (!actor?.id || !STAFF_ROLES.has(actor.role)) return { error: 'This account cannot save an inspection.' };
    if (!clean(body.scheduled_date, 30) || !clean(body.scheduled_time, 8)) return { error: 'Please choose an inspection date and time.' };
    if (!clean(body.salesperson_id, 80)) return { error: 'Please choose the sales rep.' };
  }
  const scheduledDate = clean(body.scheduled_date, 30);
  const scheduledTime = clean(body.scheduled_time, 8);
  let scheduledAt = '';
  if (scheduledDate && scheduledTime) {
    const when = new Date(`${scheduledDate}T${scheduledTime}`);
    if (Number.isNaN(when.getTime())) return { error: 'Please choose an inspection date and time.' };
    scheduledAt = when.toISOString();
  } else if (!staff) {
    scheduledAt = scheduledFromPreference(clean(body.preferred_date, 30), clean(body.preferred_time_window, 80));
  }
  const requestedStage = clean(body.stage, 40);
  const stage = !scheduledAt
    ? ''
    : staff
      ? (requestedStage === 'Confirmed' ? 'Confirmed' : 'Scheduled')
      : 'Requested';
  return {
    value: {
      lead_id: clean(body.lead_id, 120),
      first_name: first,
      last_name: last,
      phone,
      email,
      address,
      city,
      state,
      zip,
      homeowner_confirmed: body.homeowner_confirmed === true,
      concern: clean(body.concern, 120),
      what_they_noticed: clean(body.what_they_noticed, 1500),
      other_contractor: clean(body.other_contractor, 40),
      timing: clean(body.timing, 60),
      preferred_date: scheduledDate || clean(body.preferred_date, 30),
      preferred_time_window: scheduledTime ? timeWindowFromClock(scheduledTime) : clean(body.preferred_time_window, 80),
      notes: clean(body.notes, 1500),
      consent_contact: true,
      source,
      scheduled_at: scheduledAt,
      stage,
      salesperson_id: staff ? clean(body.salesperson_id, 80) : '',
      actor_id: actor?.id || null,
      now: body.now || new Date().toISOString()
    }
  };
}

function latest(rows) {
  return rows.slice().sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')))[0] || null;
}

export function findHomeownerMatch(store, input) {
  const intakes = store.intakes || [];
  const leads = store.leads || [];
  if (input.lead_id) {
    const lead = leads.find((row) => row.id === input.lead_id) || null;
    const intake = latest(intakes.filter((row) => row.lead_id === input.lead_id));
    if (lead || intake) return { lead, intake, reason: 'lead' };
  }
  const key = addressKey(input.address, input.city, input.zip);
  const phone = normalizePhone(input.phone);
  const email = normalizeEmail(input.email);
  if (!key || (!phone && !email)) return { lead: null, intake: null, reason: 'none' };
  const intake = latest(intakes.filter((row) => {
    if (addressKey(row.address, row.city, row.zip) !== key) return false;
    const phoneHit = phone && normalizePhone(row.phone) === phone;
    const emailHit = email && normalizeEmail(row.email) === email;
    return phoneHit || emailHit;
  }));
  if (!intake) return { lead: null, intake: null, reason: 'none' };
  return { lead: leads.find((row) => row.id === intake.lead_id) || null, intake, reason: 'contact' };
}

function newLeadId(source) {
  const prefix = source === 'public_homeowner_form' ? 'HOME' : 'SET';
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function leadBody(input, existing, leadId) {
  const notes = composeHandoffNotes(input);
  const body = {
    name: `${input.first_name} ${input.last_name}`.trim(),
    address: input.address,
    city: input.city,
    state: input.state,
    zip: input.zip,
    full_address: [input.address, input.city, input.state, input.zip].filter(Boolean).join(', '),
    notes,
    status: input.scheduled_at ? 'Appointment' : (existing?.status || 'Interested'),
    updated_at: input.now
  };
  if (!existing) {
    body.id = leadId;
    body.source = input.source === 'public_homeowner_form' ? 'Homeowner public form' : 'Appointment Setter Intake';
    body.secondary_address = '';
  }
  if (input.actor_id) body.assigned_rep_id = input.actor_id;
  return body;
}

function intakeBody(input, existing, leadId) {
  const scheduled = Boolean(input.scheduled_at) && input.source !== 'public_homeowner_form';
  const body = {
    lead_id: leadId,
    first_name: input.first_name,
    last_name: input.last_name,
    phone: input.phone,
    email: input.email,
    address: input.address,
    city: input.city,
    state: input.state,
    zip: input.zip,
    homeowner_confirmed: input.homeowner_confirmed,
    concern: input.concern,
    what_they_noticed: input.what_they_noticed,
    other_contractor: input.other_contractor,
    timing: input.timing,
    preferred_date: input.preferred_date,
    preferred_time_window: input.preferred_time_window,
    notes: composeHandoffNotes(input),
    consent_contact: true,
    status: scheduled ? 'Inspection Scheduled' : (existing?.status || 'New'),
    updated_at: input.now
  };
  if (!existing) {
    body.source = input.source;
    body.created_by = input.actor_id;
    body.created_at = input.now;
  }
  if (input.salesperson_id) body.assigned_salesperson_id = input.salesperson_id;
  return body;
}

export function planHomeownerProfile(store, input) {
  const match = findHomeownerMatch(store, input);
  const leadId = match.lead?.id || match.intake?.lead_id || input.lead_id || newLeadId(input.source);
  const leadExists = Boolean(match.lead || match.intake);
  const notes = composeHandoffNotes(input);
  const open = (store.appointments || [])
    .filter((row) => row.lead_id === leadId && !['Completed', 'Cancelled'].includes(row.stage));
  const appointment = latest(open);
  const writes = [
    { table: 'leads', method: leadExists ? 'patch' : 'post', id: leadId, body: leadBody(input, leadExists ? (match.lead || { id: leadId }) : null, leadId) },
    { table: 'homeowner_intakes', method: match.intake ? 'patch' : 'post', id: match.intake?.id || '', body: intakeBody(input, match.intake, leadId) }
  ];
  let appointmentWrite = null;
  if (input.scheduled_at) {
    const body = {
      lead_id: leadId,
      salesperson_id: input.salesperson_id || appointment?.salesperson_id || null,
      scheduled_at: input.scheduled_at,
      stage: input.stage || appointment?.stage || 'Scheduled',
      notes
    };
    if (!appointment) {
      body.canvasser_id = input.actor_id;
      body.created_at = input.now;
    }
    appointmentWrite = { table: 'appointments', method: appointment ? 'patch' : 'post', id: appointment?.id || '', body };
    writes.push(appointmentWrite);
  }
  writes.push({
    table: 'lead_activity',
    method: 'post',
    id: '',
    body: {
      lead_id: leadId,
      actor_id: input.actor_id,
      action: input.source === 'public_homeowner_form' ? 'homeowner_request_submitted' : 'setter_appointment_booked',
      metadata: {
        source: input.source,
        updated: Boolean(match.intake),
        to_status: input.scheduled_at ? 'Appointment' : 'Interested',
        salesperson_id: input.salesperson_id || null,
        scheduled_at: input.scheduled_at || null,
        preferred_date: input.preferred_date || '',
        preferred_time_window: input.preferred_time_window || ''
      },
      created_at: input.now
    }
  });
  return { match, leadId, writes, appointmentWrite };
}

async function remember(bucket, rows) {
  for (const row of rows || []) {
    if (row?.id && !bucket.some((item) => item.id === row.id)) bucket.push(row);
  }
}

export async function loadHomeownerCandidates(rest, input) {
  const intakes = [];
  if (input.lead_id) await remember(intakes, await rest.get('homeowner_intakes', { lead_id: input.lead_id }));
  await remember(intakes, await rest.get('homeowner_intakes', { address: input.address, city: input.city }));
  if (normalizeEmail(input.email)) await remember(intakes, await rest.get('homeowner_intakes', { email: input.email }));
  if (normalizePhone(input.phone)) await remember(intakes, await rest.get('homeowner_intakes', { phone: input.phone }));
  const leadIds = new Set(intakes.map((row) => row.lead_id).filter(Boolean));
  if (input.lead_id) leadIds.add(input.lead_id);
  const leads = [];
  const appointments = [];
  for (const id of leadIds) {
    await remember(leads, await rest.get('leads', { id }));
    await remember(appointments, await rest.get('appointments', { lead_id: id }));
  }
  return { leads, intakes, appointments };
}

export async function saveHomeownerProfile(rest, input) {
  const store = await loadHomeownerCandidates(rest, input);
  const plan = planHomeownerProfile(store, input);
  let intakeId = plan.match.intake?.id || '';
  let appointmentId = plan.appointmentWrite?.id || '';
  for (const write of plan.writes) {
    const rows = write.method === 'patch'
      ? await rest.patch(write.table, write.id, write.body)
      : await rest.post(write.table, write.body);
    const saved = Array.isArray(rows) ? rows[0] : rows;
    if (write.table === 'homeowner_intakes' && saved?.id) intakeId = saved.id;
    if (write.table === 'appointments' && saved?.id) appointmentId = saved.id;
  }
  return {
    ok: true,
    updated: Boolean(plan.match.intake),
    reference: plan.leadId,
    lead_id: plan.leadId,
    intake_id: intakeId,
    appointment_id: appointmentId || null,
    message: plan.match.intake
      ? 'Homeowner profile updated.'
      : 'Homeowner profile created.'
  };
}

export function adminHomeownerRows(intakes) {
  return (intakes || []).map((row) => ({
    id: row.id,
    lead_id: row.lead_id,
    name: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
    phone: row.phone || '',
    email: row.email || '',
    address: row.address || '',
    city: row.city || '',
    concern: row.concern || '',
    notes: row.notes || '',
    source: row.source || '',
    status: row.status || ''
  }));
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
}

function cloud(env) {
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '';
  const apikey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '';
  if (!base || !secret) throw fail('Cloud intake is not configured yet.', 503);
  return { base, secret, apikey };
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { message: text.slice(0, 180) }; }
}

export function supabaseRest(env, fetchImpl = fetch) {
  const { base, secret } = cloud(env);
  const headers = {
    apikey: secret,
    Authorization: `Bearer ${secret}`,
    'content-type': 'application/json',
    Prefer: 'return=representation'
  };
  async function call(path, { method = 'GET', body } = {}) {
    const response = await fetchImpl(`${base}/rest/v1/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await readJson(response);
    if (!response.ok) {
      const message = data?.message || data?.error || data?.hint || 'Could not save the homeowner profile.';
      throw fail(String(message).slice(0, 240), response.status >= 500 ? 502 : 400);
    }
    return data;
  }
  const filter = (pairs) => Object.entries(pairs)
    .filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => {
      const op = key === 'id' || key === 'lead_id' ? 'eq' : 'ilike';
      return `${key}=${op}.${encodeURIComponent(value)}`;
    })
    .join('&');
  return {
    get(table, pairs) {
      const query = filter(pairs);
      return call(`${table}?select=*&${query}&limit=50`);
    },
    post(table, body) {
      return call(table, { method: 'POST', body });
    },
    patch(table, id, body) {
      return call(`${table}?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body });
    }
  };
}

async function staffActor(request, env, fetchImpl) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw fail('Sign in required.', 401);
  const { base, secret, apikey } = cloud(env);
  if (!apikey) throw fail('Cloud intake is not configured yet.', 503);
  if (token === secret) throw fail('Sign in required.', 401);
  const userResponse = await fetchImpl(`${base}/auth/v1/user`, {
    headers: { apikey, Authorization: `Bearer ${token}` }
  });
  if (!userResponse.ok) throw fail('Sign in required.', 401);
  const user = await readJson(userResponse);
  if (!user?.id) throw fail('Sign in required.', 401);
  const repsResponse = await fetchImpl(`${base}/rest/v1/reps?user_id=eq.${encodeURIComponent(user.id)}&active=eq.true&select=id,name,role,active&limit=1`, {
    headers: { apikey: secret, Authorization: `Bearer ${secret}` }
  });
  if (!repsResponse.ok) throw fail('Sign in required.', 401);
  const rows = await readJson(repsResponse);
  const rep = Array.isArray(rows) ? rows[0] : null;
  if (!rep?.id || !STAFF_ROLES.has(rep.role)) throw fail('This account cannot save an inspection.', 403);
  return rep;
}

async function readBody(request) {
  try { return await request.json(); } catch { throw fail('Invalid request.', 400); }
}

export async function handlePublicSignup(request, { env = process.env, fetchImpl = fetch } = {}) {
  try {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const body = await readBody(request);
    const parsed = inspectionInputFromBody(body, { source: 'public_homeowner_form' });
    if (parsed.error) return json({ error: parsed.error }, 400);
    const saved = await saveHomeownerProfile(supabaseRest(env, fetchImpl), parsed.value);
    return json(saved, saved.updated ? 200 : 201);
  } catch (error) {
    const status = error.status || 500;
    return json({ error: error.public ? error.message : 'Could not save the homeowner profile.' }, status);
  }
}

export async function handleInspection(request, { env = process.env, fetchImpl = fetch } = {}) {
  try {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const actor = await staffActor(request, env, fetchImpl);
    const body = await readBody(request);
    const parsed = inspectionInputFromBody(body, { actor, source: 'appointment_setter' });
    if (parsed.error) return json({ error: parsed.error }, 400);
    const saved = await saveHomeownerProfile(supabaseRest(env, fetchImpl), parsed.value);
    return json(saved, saved.updated ? 200 : 201);
  } catch (error) {
    const status = error.status || 500;
    return json({ error: error.public ? error.message : 'Could not save the inspection.' }, status);
  }
}

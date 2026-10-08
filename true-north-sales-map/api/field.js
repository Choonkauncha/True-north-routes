import {
  ADMIN_ROLES,
  FIELD_ROLES,
  NOTICE_TEXT,
  NOTICE_VERSION,
  cleanAccuracy,
  cleanCoord,
  cleanDoorStatus,
  cleanLeadId,
  cleanMessage,
  easternDayBounds,
  easternToday,
  isAdminRole,
  isFieldRole,
  isIsoDate,
  isUuid,
  latestMessage,
  quotedTime,
  summarizeDay,
  unreadCount
} from '../lib/field-rules.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

function fail(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.public = true;
  error.code = code || null;
  return error;
}

function cloudConfig() {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const apikey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
  if (!base || !apikey) throw fail('Cloud is not configured for clock-in and messages.', 503);
  return { base, apikey };
}

async function rest(token, path, { method = 'GET', body, headers = {} } = {}) {
  const { base, apikey } = cloudConfig();
  const response = await fetch(`${base}/rest/v1/${path}`, {
    method,
    headers: {
      apikey,
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      Prefer: method === 'GET' ? 'return=representation' : 'return=representation',
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (response.status === 204) return null;
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { message: text.slice(0, 300) }; }
  }
  if (!response.ok) {
    const code = data?.code || '';
    const message = data?.message || 'Request failed.';
    if (response.status === 401) throw fail('Sign in required.', 401);
    if (code === '23505' && /shifts_one_open/.test(message)) throw fail('You are already clocked in.', 409, code);
    if (code === '23505' && /location_consents/.test(message)) throw fail('Location consent is already saved.', 409, code);
    if (code === '23505') throw fail('That record already exists.', 409, code);
    const status = code === '23503' ? 400 : (response.status >= 400 && response.status < 500 ? 400 : 502);
    throw fail(message, status, code);
  }
  return data;
}

async function restAll(token, pathAndQuery) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 20000; offset += pageSize) {
    const joiner = pathAndQuery.includes('?') ? '&' : '?';
    const page = await rest(token, `${pathAndQuery}${joiner}limit=${pageSize}&offset=${offset}`);
    if (!Array.isArray(page) || !page.length) break;
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function caller(request) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw fail('Sign in required.', 401);
  const { base, apikey } = cloudConfig();
  const userResponse = await fetch(`${base}/auth/v1/user`, {
    headers: { apikey, Authorization: `Bearer ${token}` }
  });
  if (!userResponse.ok) throw fail('Sign in required.', 401);
  const user = await userResponse.json();
  if (!isUuid(user?.id)) throw fail('Sign in required.', 401);
  const reps = await rest(token, `reps?user_id=eq.${user.id}&active=eq.true&select=id,name,role&limit=1`);
  const rep = Array.isArray(reps) ? reps[0] : null;
  if (!rep || !isUuid(rep.id)) throw fail('No active team profile is attached to this sign-in.', 403);
  if (![...FIELD_ROLES, ...ADMIN_ROLES].includes(rep.role)) throw fail('This team profile cannot use clock-in or messages.', 403);
  return { token, user, rep };
}

async function openShift(ctx) {
  const rows = await rest(ctx.token, `shifts?rep_id=eq.${ctx.rep.id}&clock_out_at=is.null&select=*&limit=1`);
  return rows?.[0] || null;
}

async function consentRow(ctx) {
  const version = encodeURIComponent(NOTICE_VERSION);
  const rows = await rest(ctx.token, `location_consents?rep_id=eq.${ctx.rep.id}&notice_version=eq.${version}&select=id,rep_id,notice_version,consented_at&limit=1`);
  return rows?.[0] || null;
}

async function threadForRep(ctx, repId) {
  if (!isUuid(repId)) return null;
  const rows = await rest(ctx.token, `message_threads?rep_id=eq.${repId}&select=id,rep_id,rep_last_read_at,admin_last_read_at,last_message_at&limit=1`);
  return rows?.[0] || null;
}

async function ensureThread(ctx, repId) {
  const existing = await threadForRep(ctx, repId);
  if (existing) return existing;
  try {
    const created = await rest(ctx.token, 'message_threads', { method: 'POST', body: { rep_id: repId } });
    return created?.[0] || null;
  } catch (error) {
    if (error.code === '23505') return threadForRep(ctx, repId);
    throw error;
  }
}

async function repById(ctx, repId) {
  const rows = await rest(ctx.token, `reps?id=eq.${repId}&select=id,name,role,active&limit=1`);
  return rows?.[0] || null;
}

async function threadMessages(ctx, threadId) {
  return restAll(ctx.token, `messages?thread_id=eq.${threadId}&select=id,thread_id,sender_rep_id,body,created_at&order=created_at.asc`);
}

function assertThreadAccess(ctx, thread) {
  if (!thread) throw fail('Conversation not found.', 404);
  if (isAdminRole(ctx.rep.role)) return;
  if (thread.rep_id !== ctx.rep.id) throw fail('You can only open your own conversation.', 403);
}

async function viewStatus(ctx) {
  const field = isFieldRole(ctx.rep.role);
  const admin = isAdminRole(ctx.rep.role);
  const consent = field ? await consentRow(ctx) : null;
  const shift = field ? await openShift(ctx) : null;
  let unread = 0;
  let threadId = null;
  let latestIncoming = null;
  if (field) {
    const thread = await threadForRep(ctx, ctx.rep.id);
    threadId = thread?.id || null;
    if (thread) {
      const messages = await threadMessages(ctx, thread.id);
      unread = unreadCount(messages, thread, 'rep');
      latestIncoming = [...messages].reverse().find((message) => message.sender_rep_id !== ctx.rep.id) || null;
    }
  } else if (admin) {
    unread = await adminUnreadTotal(ctx);
    if (isUuid(ctx.rep.id)) {
      const rows = await rest(ctx.token, `messages?sender_rep_id=neq.${ctx.rep.id}&select=id,thread_id,sender_rep_id,body,created_at&order=created_at.desc&limit=1`);
      latestIncoming = Array.isArray(rows) ? rows[0] || null : null;
    }
  }
  return {
    rep: { id: ctx.rep.id, name: ctx.rep.name, role: ctx.rep.role },
    isField: field,
    isAdmin: admin,
    notice: { version: NOTICE_VERSION, text: NOTICE_TEXT },
    consent: consent ? { consented_at: consent.consented_at, notice_version: consent.notice_version } : null,
    openShift: shift,
    unread,
    threadId,
    latestIncoming
  };
}

async function adminUnreadTotal(ctx) {
  const threads = await restAll(ctx.token, 'message_threads?select=id,rep_id,admin_last_read_at');
  if (!threads.length) return 0;
  const messages = await restAll(ctx.token, 'messages?select=id,thread_id,sender_rep_id,created_at&order=created_at.desc');
  return threads.reduce((sum, thread) => sum + unreadCount(messages, thread, 'admin'), 0);
}

async function viewInbox(ctx) {
  if (!isAdminRole(ctx.rep.role)) throw fail('The message inbox is for management.', 403);
  const reps = await restAll(ctx.token, 'reps?active=eq.true&role=in.(appointment_setter,canvasser,salesperson)&select=id,name,role&order=name.asc');
  const threads = await restAll(ctx.token, 'message_threads?select=id,rep_id,rep_last_read_at,admin_last_read_at,last_message_at');
  const messages = threads.length
    ? await restAll(ctx.token, 'messages?select=id,thread_id,sender_rep_id,body,created_at&order=created_at.desc')
    : [];
  const byRep = new Map(threads.map(thread => [thread.rep_id, thread]));
  const list = reps.map(rep => {
    const thread = byRep.get(rep.id) || null;
    const last = thread ? latestMessage(messages, thread.id) : null;
    return {
      rep: { id: rep.id, name: rep.name, role: rep.role },
      threadId: thread?.id || null,
      unread: thread ? unreadCount(messages, thread, 'admin') : 0,
      lastBody: last?.body || '',
      lastAt: last?.created_at || null
    };
  });
  list.sort((a, b) => {
    if (Boolean(b.unread) !== Boolean(a.unread)) return b.unread - a.unread;
    return new Date(b.lastAt || 0) - new Date(a.lastAt || 0) || a.rep.name.localeCompare(b.rep.name);
  });
  return { threads: list };
}

async function viewThread(ctx, url) {
  const requested = url.searchParams.get('repId');
  const repId = requested || (isFieldRole(ctx.rep.role) ? ctx.rep.id : '');
  if (!isUuid(repId)) throw fail('Choose a person to open.', 400);
  if (!isAdminRole(ctx.rep.role) && repId !== ctx.rep.id) throw fail('You can only open your own conversation.', 403);
  if (isAdminRole(ctx.rep.role) && repId !== ctx.rep.id) {
    const target = await repById(ctx, repId);
    if (!target || !isFieldRole(target.role)) throw fail('That person does not have a field thread.', 404);
  }
  const thread = await threadForRep(ctx, repId);
  if (thread) assertThreadAccess(ctx, thread);
  const messages = thread ? await threadMessages(ctx, thread.id) : [];
  const audience = isAdminRole(ctx.rep.role) && repId !== ctx.rep.id ? 'admin' : 'rep';
  return {
    repId,
    thread,
    messages,
    unread: thread ? unreadCount(messages, thread, audience === 'admin' ? 'admin' : 'rep') : 0
  };
}

async function viewShifts(ctx, url) {
  if (!isAdminRole(ctx.rep.role)) throw fail('Shifts and travel trails are for management.', 403);
  const date = url.searchParams.get('date') || easternToday();
  if (!isIsoDate(date)) throw fail('Use a YYYY-MM-DD date.', 400);
  const { start, end, timeZone } = easternDayBounds(date);
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const shiftRows = await restAll(
    ctx.token,
    `shifts?select=id,rep_id,clock_in_at,clock_out_at,clock_in_lat,clock_in_lng,clock_out_lat,clock_out_lng&clock_in_at=lt.${encodeURIComponent(quotedTime(endIso))}&or=${encodeURIComponent(`(clock_out_at.is.null,clock_out_at.gte.${quotedTime(startIso)})`)}&order=clock_in_at.asc`
  );
  const pointRows = await restAll(
    ctx.token,
    `location_points?select=id,rep_id,shift_id,lat,lng,captured_at,kind,lead_id,door_status,accuracy_m&captured_at=gte.${encodeURIComponent(quotedTime(startIso))}&captured_at=lt.${encodeURIComponent(quotedTime(endIso))}&order=captured_at.asc`
  );
  const ids = [...new Set([...shiftRows.map(row => row.rep_id), ...pointRows.map(row => row.rep_id)])].filter(isUuid);
  const reps = ids.length
    ? await restAll(ctx.token, `reps?id=in.(${ids.join(',')})&select=id,name,role,active`)
    : [];
  const consents = ids.length
    ? await restAll(ctx.token, `location_consents?rep_id=in.(${ids.join(',')})&select=rep_id,consented_at,notice_version`)
    : [];
  const summary = summarizeDay({
    shifts: shiftRows,
    points: pointRows,
    reps,
    consents,
    dayStart: start,
    dayEnd: end,
    now: new Date()
  });
  return { date, timeZone, dayStart: startIso, dayEnd: endIso, ...summary };
}

async function insertPoint(ctx, { shiftId, coord, accuracy, kind, leadId, doorStatus }) {
  const payload = {
    shift_id: shiftId,
    lat: coord.lat,
    lng: coord.lng,
    kind,
    accuracy_m: accuracy,
    lead_id: leadId,
    door_status: doorStatus
  };
  try {
    const rows = await rest(ctx.token, 'location_points', { method: 'POST', body: payload });
    return rows?.[0] || null;
  } catch (error) {
    if (error.code === '23503' && payload.lead_id) {
      payload.lead_id = null;
      const rows = await rest(ctx.token, 'location_points', { method: 'POST', body: payload });
      return rows?.[0] || null;
    }
    throw error;
  }
}

async function saveConsent(ctx) {
  if (!isFieldRole(ctx.rep.role)) throw fail('Location consent is for appointment setters and sales reps.', 403);
  try {
    const rows = await rest(ctx.token, 'location_consents', {
      method: 'POST',
      body: { notice_version: NOTICE_VERSION, notice_text: NOTICE_TEXT }
    });
    return { consent: rows?.[0] || null };
  } catch (error) {
    if (error.status === 409) return { consent: await consentRow(ctx), already: true };
    throw error;
  }
}

async function clockIn(ctx, body) {
  if (!isFieldRole(ctx.rep.role)) throw fail('Clock in is for appointment setters and sales reps.', 403);
  if (!await consentRow(ctx)) throw fail('Agree to the location notice before clocking in.', 403, 'CONSENT_REQUIRED');
  if (await openShift(ctx)) throw fail('You are already clocked in.', 409);
  const coord = cleanCoord(body.lat, body.lng);
  if (coord?.error) throw fail(coord.error, 400);
  const created = await rest(ctx.token, 'shifts', {
    method: 'POST',
    body: {
      clock_in_lat: coord?.lat ?? null,
      clock_in_lng: coord?.lng ?? null
    }
  });
  const shift = created?.[0];
  if (!shift?.id) throw fail('Clock in did not save.', 502);
  const point = coord
    ? await insertPoint(ctx, { shiftId: shift.id, coord, accuracy: cleanAccuracy(body.accuracy), kind: 'clock_in', leadId: null, doorStatus: null })
    : null;
  return { shift, point };
}

async function clockOut(ctx, body) {
  if (!isFieldRole(ctx.rep.role)) throw fail('Clock out is for appointment setters and sales reps.', 403);
  const shift = await openShift(ctx);
  if (!shift) throw fail('You are not clocked in.', 409);
  const coord = cleanCoord(body.lat, body.lng);
  if (coord?.error) throw fail(coord.error, 400);
  const point = coord
    ? await insertPoint(ctx, { shiftId: shift.id, coord, accuracy: cleanAccuracy(body.accuracy), kind: 'clock_out', leadId: null, doorStatus: null })
    : null;
  const updated = await rest(ctx.token, `shifts?id=eq.${shift.id}`, {
    method: 'PATCH',
    body: {
      clock_out_lat: coord?.lat ?? null,
      clock_out_lng: coord?.lng ?? null
    }
  });
  return { shift: updated?.[0] || null, point };
}

async function doorPoint(ctx, body) {
  if (!isFieldRole(ctx.rep.role)) return { skipped: true, reason: 'role' };
  const shift = await openShift(ctx);
  if (!shift) return { skipped: true, reason: 'not_clocked_in' };
  const coord = cleanCoord(body.lat, body.lng);
  if (!coord || coord.error) throw fail(coord?.error || 'A location is required to record a door point.', 400);
  const point = await insertPoint(ctx, {
    shiftId: shift.id,
    coord,
    accuracy: cleanAccuracy(body.accuracy),
    kind: 'door_status',
    leadId: cleanLeadId(body.leadId),
    doorStatus: cleanDoorStatus(body.status)
  });
  return { point, shiftId: shift.id };
}

async function sendMessage(ctx, body) {
  const cleaned = cleanMessage(body.body);
  if (cleaned.error) throw fail(cleaned.error, 400);
  let repId = ctx.rep.id;
  if (isAdminRole(ctx.rep.role)) {
    if (!isUuid(body.repId)) throw fail('Choose a person to message.', 400);
    if (body.repId === ctx.rep.id) throw fail('Message an appointment setter or sales rep.', 400);
    const target = await repById(ctx, body.repId);
    if (!target || !isFieldRole(target.role) || target.active === false) throw fail('That person does not have a field thread.', 404);
    repId = body.repId;
  } else if (!isFieldRole(ctx.rep.role)) {
    throw fail('Messages are for the field team and management.', 403);
  }
  const thread = await ensureThread(ctx, repId);
  if (!thread?.id) throw fail('Conversation could not be opened.', 502);
  const rows = await rest(ctx.token, 'messages', { method: 'POST', body: { thread_id: thread.id, body: cleaned.text } });
  return { threadId: thread.id, message: rows?.[0] || null };
}

async function markRead(ctx, body) {
  if (!isUuid(body.threadId)) throw fail('Missing conversation.', 400);
  const thread = await rest(ctx.token, 'rpc/mark_thread_read', { method: 'POST', body: { p_thread_id: body.threadId } });
  return { thread };
}

async function handleGet(ctx, url) {
  const view = url.searchParams.get('view') || 'status';
  if (view === 'status') return viewStatus(ctx);
  if (view === 'inbox') return viewInbox(ctx);
  if (view === 'thread') return viewThread(ctx, url);
  if (view === 'shifts') return viewShifts(ctx, url);
  throw fail('Unknown view.', 404);
}

async function handlePost(ctx, body) {
  const action = body?.action;
  if (action === 'consent') return saveConsent(ctx);
  if (action === 'clock-in') return clockIn(ctx, body);
  if (action === 'clock-out') return clockOut(ctx, body);
  if (action === 'door') return doorPoint(ctx, body);
  if (action === 'send') return sendMessage(ctx, body);
  if (action === 'read') return markRead(ctx, body);
  throw fail('Unknown action.', 404);
}

export default {
  async fetch(request) {
    try {
      if (request.method !== 'GET' && request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      const ctx = await caller(request);
      const url = new URL(request.url);
      if (request.method === 'GET') return json(await handleGet(ctx, url));
      let body = {};
      try { body = await request.json(); } catch { throw fail('Invalid request.', 400); }
      return json(await handlePost(ctx, body));
    } catch (error) {
      const status = error.status || 500;
      const message = error.public ? error.message : 'Something went wrong. Try again.';
      if (!error.public) console.error(error);
      return json({ error: message, code: error.code || null }, status);
    }
  }
};

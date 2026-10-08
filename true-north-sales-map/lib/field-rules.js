/** Shared rules for clock-in, door locations, and office messages. */

export const FIELD_ROLES = Object.freeze(['appointment_setter', 'canvasser', 'salesperson']);
export const ADMIN_ROLES = Object.freeze(['admin', 'manager']);
export const NOTICE_VERSION = '2026-10-08';
export const NOTICE_TEXT = 'While you are clocked in, True North saves your location when you clock in, when you clock out, and when you mark a door. Your location is not tracked in the background, and it is not saved while you are clocked out. Your browser will ask for location permission. That permission is used only for those clock-in, clock-out, and door points.';
export const EASTERN_TZ = 'America/New_York';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isFieldRole(role) {
  return FIELD_ROLES.includes(role);
}

export function isAdminRole(role) {
  return ADMIN_ROLES.includes(role);
}

export function isUuid(value) {
  return UUID_RE.test(String(value || ''));
}

export function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const [year, month, day] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

export function roleLabel(role) {
  return {
    appointment_setter: 'Appointment setter',
    canvasser: 'Appointment setter',
    salesperson: 'Sales rep',
    manager: 'Manager',
    admin: 'Admin'
  }[role] || role || '';
}

export function cleanMessage(value) {
  const text = String(value ?? '').trim();
  if (!text) return { error: 'Write a message first.' };
  if (text.length > 4000) return { error: 'Message is too long. Keep it under 4,000 characters.' };
  return { text };
}

export function cleanCoord(lat, lng) {
  const missing = (lat == null || lat === '') && (lng == null || lng === '');
  if (missing) return null;
  if (lat == null || lat === '' || lng == null || lng === '') {
    return { error: 'Location must include both latitude and longitude.' };
  }
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { error: 'Location must be a valid latitude and longitude.' };
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return { error: 'Location is out of range.' };
  }
  return { lat: latitude, lng: longitude };
}

export function cleanAccuracy(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100000) return null;
  return Math.round(n);
}

export function cleanLeadId(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (!text || text.length > 120) return null;
  return text;
}

export function cleanDoorStatus(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim().slice(0, 40);
  return text || null;
}

export function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.7613;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function trailMiles(points) {
  const ordered = (points || [])
    .filter(p => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)))
    .slice()
    .sort((a, b) => new Date(a.captured_at) - new Date(b.captured_at) || String(a.id || '').localeCompare(String(b.id || '')));
  let miles = 0;
  let longGap = false;
  for (let i = 1; i < ordered.length; i++) {
    const leg = haversineMiles(
      Number(ordered[i - 1].lat),
      Number(ordered[i - 1].lng),
      Number(ordered[i].lat),
      Number(ordered[i].lng)
    );
    miles += leg;
    if (leg > 30) longGap = true;
  }
  return { miles, longGap, count: ordered.length };
}

export function easternToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: EASTERN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

function zoneParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const bag = {};
  for (const part of fmt.formatToParts(date)) bag[part.type] = part.value;
  let hour = Number(bag.hour);
  let day = Number(bag.day);
  let month = Number(bag.month);
  let year = Number(bag.year);
  if (hour === 24) hour = 0;
  return { year, month, day, hour, minute: Number(bag.minute), second: Number(bag.second) };
}

export function addIsoDays(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** UTC instant when the clock in `timeZone` reads `dateStr` at 00:00:00. */
export function zonedMidnight(dateStr, timeZone = EASTERN_TZ) {
  if (!isIsoDate(dateStr)) throw new Error('Use a YYYY-MM-DD date.');
  const [year, month, day] = dateStr.split('-').map(Number);
  let utc = Date.UTC(year, month - 1, day, 0, 0, 0);
  for (let i = 0; i < 4; i++) {
    const parts = zoneParts(new Date(utc), timeZone);
    const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const desired = Date.UTC(year, month - 1, day, 0, 0, 0);
    const delta = desired - shown;
    if (delta === 0) break;
    utc += delta;
  }
  return new Date(utc);
}

export function easternDayBounds(dateStr) {
  const start = zonedMidnight(dateStr, EASTERN_TZ);
  const end = zonedMidnight(addIsoDays(dateStr, 1), EASTERN_TZ);
  return { start, end, timeZone: EASTERN_TZ };
}

export function overlapHours(clockIn, clockOut, dayStart, dayEnd, now = new Date()) {
  const start = new Date(clockIn).getTime();
  const end = new Date(clockOut || now).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  const from = Math.max(start, dayStart.getTime());
  const to = Math.min(end, dayEnd.getTime());
  if (!(to > from)) return 0;
  return (to - from) / 3600000;
}

export function formatHours(hours) {
  const totalMin = Math.max(0, Math.round(Number(hours) * 60));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export function formatMiles(miles) {
  const n = Number(miles) || 0;
  return n < 10 ? `${n.toFixed(1)} mi` : `${Math.round(n)} mi`;
}

export function pointLabel(point) {
  if (point?.kind === 'clock_in') return 'Clock in';
  if (point?.kind === 'clock_out') return 'Clock out';
  if (point?.kind === 'door_status') return point.door_status ? `Door · ${point.door_status}` : 'Door';
  return 'Location';
}

export function unreadCount(messages, thread, audience) {
  const since = new Date(audience === 'admin' ? thread.admin_last_read_at : thread.rep_last_read_at).getTime();
  const cutoff = Number.isFinite(since) ? since : 0;
  return (messages || []).filter(message => {
    if (message.thread_id !== thread.id) return false;
    if (new Date(message.created_at).getTime() <= cutoff) return false;
    if (audience === 'admin') return message.sender_rep_id === thread.rep_id;
    return message.sender_rep_id !== thread.rep_id;
  }).length;
}

/** Decide whether a newly seen message should toast. Never alerts the sender. */
export function incomingAlert(message, { meId, seenIds, viewingThreadId } = {}) {
  if (!message?.id) return { notify: false, quiet: false, reason: 'empty' };
  if (seenIds?.has?.(message.id)) return { notify: false, quiet: false, reason: 'seen' };
  if (meId && message.sender_rep_id === meId) return { notify: false, quiet: false, reason: 'self' };
  if (viewingThreadId && message.thread_id === viewingThreadId) {
    return { notify: false, quiet: true, reason: 'open' };
  }
  return { notify: true, quiet: false, reason: 'new' };
}

export function latestMessage(messages, threadId) {
  let best = null;
  for (const message of messages || []) {
    if (message.thread_id !== threadId) continue;
    if (!best || new Date(message.created_at) > new Date(best.created_at)) best = message;
  }
  return best;
}

export function summarizeDay({ shifts, points, reps, consents, dayStart, dayEnd, now = new Date() }) {
  const ids = [...new Set([...(shifts || []).map(s => s.rep_id), ...(points || []).map(p => p.rep_id)])];
  const people = ids.map(id => {
    const rep = (reps || []).find(r => r.id === id) || { id, name: 'Former teammate', role: '', active: false };
    const shiftRows = (shifts || [])
      .filter(s => s.rep_id === id)
      .map(s => ({
        ...s,
        hours: overlapHours(s.clock_in_at, s.clock_out_at, dayStart, dayEnd, now),
        open: !s.clock_out_at
      }))
      .sort((a, b) => new Date(a.clock_in_at) - new Date(b.clock_in_at));
    const orderedPoints = (points || [])
      .filter(p => p.rep_id === id)
      .slice()
      .sort((a, b) => new Date(a.captured_at) - new Date(b.captured_at) || String(a.id || '').localeCompare(String(b.id || '')));
    const trail = trailMiles(orderedPoints);
    const consent = (consents || []).find(c => c.rep_id === id) || null;
    return {
      rep: { id: rep.id, name: rep.name, role: rep.role, active: rep.active !== false },
      consent: consent ? { consented_at: consent.consented_at, notice_version: consent.notice_version } : null,
      shifts: shiftRows,
      totalHours: shiftRows.reduce((sum, s) => sum + s.hours, 0),
      miles: trail.miles,
      longGap: trail.longGap,
      points: orderedPoints
    };
  }).sort((a, b) => String(a.rep.name).localeCompare(String(b.rep.name)));
  return {
    totalHours: people.reduce((sum, person) => sum + person.totalHours, 0),
    totalMiles: people.reduce((sum, person) => sum + person.miles, 0),
    people
  };
}

/** Quoted timestamps so PostgREST does not split on the milliseconds dot. */
export function quotedTime(iso) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(iso)) {
    throw new Error('Unexpected timestamp.');
  }
  return `"${iso}"`;
}

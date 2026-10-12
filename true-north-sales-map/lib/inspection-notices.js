import { addIsoDays, easternDayBounds, easternToday } from './field-rules.js';

/** People who should hear about a setter-booked inspection. */
export const NOTICE_ROLES = Object.freeze(['admin', 'manager', 'owner']);
const OPEN_BOOKED = new Set(['Scheduled', 'Confirmed']);
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

export function receivesInspectionNotices(role) {
  return NOTICE_ROLES.includes(role);
}

/** True when a setter booking should fan out a fresh unread notice. */
export function inspectionBookingChanged(before, after) {
  if (!after?.scheduled_at || !after.canvasser_id) return false;
  if (!OPEN_BOOKED.has(after.stage)) return false;
  if (!before) return true;
  if (String(before.scheduled_at || '') !== String(after.scheduled_at || '')) return true;
  if (!OPEN_BOOKED.has(before.stage)) return true;
  return false;
}

export function noticeRecipients(reps = [], canvasserId = '') {
  return (reps || []).filter((rep) =>
    rep?.active && NOTICE_ROLES.includes(rep.role) && String(rep.id) !== String(canvasserId || '')
  );
}

export function unreadNotices(rows = []) {
  return (rows || []).filter((row) => row && !row.read_at);
}

export function withNoticeRead(rows = [], id, at) {
  return (rows || []).map((row) => (
    String(row.id) === String(id) ? { ...row, read_at: row.read_at || at } : row
  ));
}

export function phoneForLead(homes = [], leadId) {
  let best = '';
  let bestTime = -1;
  for (const home of homes || []) {
    if (String(home?.lead_id) !== String(leadId) || !home.phone) continue;
    const time = new Date(home.updated_at || home.created_at || 0).getTime();
    const stamp = Number.isFinite(time) ? time : 0;
    if (stamp >= bestTime) {
      bestTime = stamp;
      best = String(home.phone);
    }
  }
  return best;
}

function finiteCoord(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function inspectionPlaceQuery(lead = {}) {
  const lat = finiteCoord(lead.lat);
  const lng = finiteCoord(lead.lng);
  if (lat != null && lng != null) return `${lat},${lng}`;
  return [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(', ');
}

export function inspectionDirectionsUrl(lead = {}) {
  const query = inspectionPlaceQuery(lead);
  if (!query) return '';
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`;
}

export function inspectionMapUrl(lead = {}) {
  const query = inspectionPlaceQuery(lead);
  if (!query) return '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function formatInspectionWhen(value, now = new Date()) {
  const when = new Date(value);
  if (!Number.isFinite(when.getTime())) return 'Time not set';
  const today = easternToday(now);
  const day = easternToday(when);
  const clock = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit'
  }).format(when);
  if (day === today) return `Today · ${clock} ET`;
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  }).format(when);
  return `${date} · ${clock} ET`;
}

function weekdayIndex(now) {
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short'
  }).format(now);
  return WEEKDAYS[label] ?? 0;
}

export function inspectionInRange(scheduledAt, range = 'all', now = new Date()) {
  if (!range || range === 'all') return true;
  const when = new Date(scheduledAt);
  if (!Number.isFinite(when.getTime())) return false;
  const today = easternToday(now);
  if (range === 'today') {
    const { start, end } = easternDayBounds(today);
    return when >= start && when < end;
  }
  if (range === 'week') {
    const index = weekdayIndex(now);
    const start = easternDayBounds(addIsoDays(today, -index)).start;
    const end = easternDayBounds(addIsoDays(today, 7 - index)).start;
    return when >= start && when < end;
  }
  return true;
}

export function sortInspections(rows = [], now = new Date()) {
  const stamp = now.getTime();
  return [...(rows || [])].sort((a, b) => {
    const at = new Date(a?.scheduled_at).getTime();
    const bt = new Date(b?.scheduled_at).getTime();
    const aUp = Number.isFinite(at) && at >= stamp;
    const bUp = Number.isFinite(bt) && bt >= stamp;
    if (aUp !== bUp) return aUp ? -1 : 1;
    if (aUp && bUp) return at - bt;
    return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0);
  });
}

function personName(embedded, reps, id) {
  if (embedded?.name) return embedded.name;
  const match = (reps || []).find((rep) => String(rep.id) === String(id || ''));
  return match?.name || '';
}

export function prepareInspections({
  appointments = [],
  leads = [],
  homes = [],
  reps = [],
  range = 'all',
  now = new Date(),
  query = '',
  stage = '',
  focus = ''
} = {}) {
  const leadList = Array.isArray(leads) ? leads : [...(leads?.values?.() || [])];
  const byLead = new Map(leadList.map((lead) => [lead.id, lead]));
  const needle = String(query || '').trim().toLowerCase();
  const open = new Set(['Requested', 'Scheduled', 'Confirmed']);
  return sortInspections(appointments, now).filter((row) => {
    const lead = byLead.get(row.lead_id) || {};
    const blob = [lead.name, lead.address, lead.city, phoneForLead(homes, row.lead_id)].join(' ').toLowerCase();
    const focused = !focus || (
      open.has(row.stage) && (
        focus === 'unassigned'
          ? !row.salesperson_id
          : row.scheduled_at && new Date(row.scheduled_at) < now
      )
    );
    return focused
      && (!needle || blob.includes(needle))
      && (!stage || row.stage === stage)
      && inspectionInRange(row.scheduled_at, range, now);
  }).map((row) => {
    const lead = byLead.get(row.lead_id) || {};
    const when = new Date(row.scheduled_at);
    return {
      id: row.id,
      leadId: row.lead_id,
      whenLabel: formatInspectionWhen(row.scheduled_at, now),
      upcoming: Number.isFinite(when.getTime()) && when.getTime() >= now.getTime(),
      homeowner: lead.name || 'Homeowner',
      address: [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(', '),
      directionsUrl: inspectionDirectionsUrl(lead),
      mapUrl: inspectionMapUrl(lead),
      phone: phoneForLead(homes, row.lead_id),
      setter: personName(row.canvasser, reps, row.canvasser_id) || '—',
      rep: personName(row.salesperson, reps, row.salesperson_id) || 'Unassigned',
      notes: row.notes || '',
      stage: row.stage || 'Scheduled'
    };
  });
}

export function inspectionCardsHtml(items = []) {
  if (!items.length) {
    return '<div class="empty">No inspections in this view.</div>';
  }
  return items.map((item) => `
    <article class="inspectionCard${item.upcoming ? ' isUpcoming' : ''}">
      <button type="button" class="inspectionCardOpen" data-inspection="${esc(item.id)}">
        <span class="inspectionWhen">${esc(item.whenLabel)}</span>
        <strong>${esc(item.homeowner)}</strong>
        <span class="inspectionStage">${esc(item.stage)}</span>
      </button>
      <div class="inspectionCardBody">
        ${item.address ? `<a class="inspectionAddress" href="${esc(item.directionsUrl)}" target="_blank" rel="noopener">${esc(item.address)}</a>` : '<span class="inspectionAddress">Address not on file</span>'}
        ${item.phone ? `<a class="inspectionPhone" href="tel:${esc(item.phone.replace(/[^\d+]/g, ''))}">${esc(item.phone)}</a>` : '<span class="inspectionPhone">No phone</span>'}
        <span>Setter ${esc(item.setter)}</span>
        <span>Rep ${esc(item.rep)}</span>
        ${item.notes ? `<p>${esc(item.notes)}</p>` : ''}
      </div>
    </article>`).join('');
}

export function inspectionDetailHtml(item) {
  if (!item) return '';
  return `
    <div class="inspectionDetailCard" role="dialog" aria-labelledby="inspectionDetailTitle">
      <div class="inspectionDetailBar">
        <button type="button" class="btn" data-inspection-close>Close</button>
        <span class="inspectionStage">${esc(item.stage)}</span>
      </div>
      <p class="inspectionWhen">${esc(item.whenLabel)}</p>
      <h2 id="inspectionDetailTitle">${esc(item.homeowner)}</h2>
      ${item.address ? `<a class="inspectionAddress" href="${esc(item.directionsUrl)}" target="_blank" rel="noopener">${esc(item.address)}</a>` : '<p>Address not on file</p>'}
      <div class="inspectionDetailActions">
        ${item.directionsUrl ? `<a class="btn primary" href="${esc(item.directionsUrl)}" target="_blank" rel="noopener">Directions</a>` : ''}
        ${item.mapUrl ? `<a class="btn" href="${esc(item.mapUrl)}" target="_blank" rel="noopener">Open on map</a>` : ''}
        ${item.phone ? `<a class="btn" href="tel:${esc(item.phone.replace(/[^\d+]/g, ''))}">${esc(item.phone)}</a>` : ''}
      </div>
      <dl>
        <div><dt>Setter</dt><dd>${esc(item.setter)}</dd></div>
        <div><dt>Assigned rep</dt><dd>${esc(item.rep)}</dd></div>
        <div><dt>Status</dt><dd>${esc(item.stage)}</dd></div>
      </dl>
      <h3>Notes</h3>
      <p>${item.notes ? esc(item.notes) : 'No notes yet.'}</p>
    </div>`;
}

export function noticeListHtml(rows = []) {
  if (!rows.length) return '<p class="inspectionBellEmpty">No inspection alerts yet.</p>';
  return rows.map((row) => `
    <button type="button" class="inspectionNotice${row.read_at ? '' : ' isUnread'}" data-notice="${esc(row.id)}" data-appointment="${esc(row.appointment_id || '')}">
      <strong>${esc(row.title || 'Inspection scheduled')}</strong>
      <span>${esc(row.body || '')}</span>
    </button>`).join('');
}

/** Browser notification when permission is already granted and the tab is in the background. */
export function pushInspectionNotice(row, { NotificationApi, permission, hidden } = {}) {
  if (!row || !hidden || permission !== 'granted' || typeof NotificationApi !== 'function') return false;
  try {
    new NotificationApi(row.title || 'Inspection scheduled', {
      body: row.body || '',
      tag: row.id ? `inspection-${row.id}` : 'inspection-scheduled'
    });
    return true;
  } catch {
    return false;
  }
}

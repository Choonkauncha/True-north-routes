import {
  esc,
  noticeListHtml,
  pushInspectionNotice,
  receivesInspectionNotices,
  unreadNotices,
  withNoticeRead
} from '../lib/inspection-notices.js';

function ensureToast() {
  let el = document.getElementById('inspectionToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'inspectionToast';
    el.className = 'inspectionToast';
    el.setAttribute('role', 'status');
    el.hidden = true;
    document.body.append(el);
  }
  return el;
}

function showToast(row) {
  const el = ensureToast();
  el.innerHTML = `<b>${esc(row.title || 'Inspection scheduled')}</b><span>${esc(row.body || '')}</span>`;
  el.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.hidden = true; }, 6000);
}

async function requestBrowserAlerts() {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try { return await Notification.requestPermission(); } catch { return Notification.permission; }
}

export function startInspectionAlerts({ supabase, rep, onOpen } = {}) {
  const bell = document.getElementById('inspectionBell');
  const panel = document.getElementById('inspectionBellPanel');
  const count = document.getElementById('inspectionBellCount');
  const stop = () => {};
  if (!bell || !panel || !count) return { stop };
  if (!receivesInspectionNotices(rep?.role) || !rep?.id || !supabase) {
    bell.hidden = true;
    return { stop };
  }
  bell.hidden = false;
  const badge = () => document.getElementById('inspectionBellCount');
  let rows = [];
  let ready = false;
  const seen = new Set();
  const pending = new Set();
  let channel = null;
  const abort = new AbortController();
  const listen = { signal: abort.signal };

  function paint() {
    const unread = unreadNotices(rows);
    const chip = badge();
    if (chip) {
      chip.textContent = unread.length > 9 ? '9+' : String(unread.length);
      chip.hidden = unread.length === 0;
    }
    bell.setAttribute('aria-label', unread.length ? `${unread.length} unread inspection alerts` : 'Inspection notifications');
    const prompt = typeof Notification === 'undefined'
      ? ''
      : Notification.permission === 'granted'
        ? '<p class="inspectionPushNote">Browser alerts are on for this device.</p>'
        : Notification.permission === 'denied'
          ? '<p class="inspectionPushNote">Browser alerts are blocked. You will still see them in this bell.</p>'
          : '<button type="button" class="inspectionPush" data-inspection-push>Turn on alerts for this browser</button><p class="inspectionPushNote">Shows a notification when a setter books an inspection and this tab is in the background.</p>';
    panel.innerHTML = `<h2>Scheduled inspections</h2>${noticeListHtml(rows.slice(0, 12))}${prompt}`;
  }

  function announce(row) {
    if (!row || row.read_at || seen.has(row.id)) return;
    if (!ready) {
      pending.add(row.id);
      return;
    }
    seen.add(row.id);
    pending.delete(row.id);
    showToast(row);
    pushInspectionNotice(row, {
      NotificationApi: typeof Notification === 'function' ? Notification : null,
      permission: typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
      hidden: document.hidden
    });
  }

  function absorb(next) {
    rows = next || [];
    ready = true;
    for (const row of rows) {
      if (pending.has(row.id)) announce(row);
      else seen.add(row.id);
    }
    paint();
  }

  async function load() {
    const result = await supabase
      .from('inspection_notifications')
      .select('id,appointment_id,recipient_id,title,body,read_at,created_at')
      .eq('recipient_id', rep.id)
      .order('created_at', { ascending: false })
      .limit(40);
    if (result.error) return;
    absorb(result.data || []);
  }

  async function markRead(id) {
    const at = new Date().toISOString();
    rows = withNoticeRead(rows, id, at);
    paint();
    await supabase.from('inspection_notifications').update({ read_at: at }).eq('id', id).eq('recipient_id', rep.id);
  }

  function toggle(force) {
    const open = typeof force === 'boolean' ? force : panel.hidden;
    panel.hidden = !open;
    bell.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  document.addEventListener('tn-inspection-viewed', (event) => {
    const appointmentId = event.detail?.id;
    if (!appointmentId) return;
    rows.filter((row) => String(row.appointment_id) === String(appointmentId) && !row.read_at)
      .forEach((row) => { markRead(row.id); });
  }, listen);
  bell.addEventListener('click', (event) => {
    event.stopPropagation();
    toggle();
  }, listen);
  panel.addEventListener('click', async (event) => {
    const push = event.target.closest('[data-inspection-push]');
    if (push) {
      await requestBrowserAlerts();
      paint();
      return;
    }
    const button = event.target.closest('[data-notice]');
    if (!button) return;
    const id = button.dataset.notice;
    const appointmentId = button.dataset.appointment;
    await markRead(id);
    toggle(false);
    if (appointmentId) onOpen?.(appointmentId);
  }, listen);
  document.addEventListener('click', (event) => {
    if (!panel.hidden && !bell.contains(event.target) && !panel.contains(event.target)) toggle(false);
  }, listen);

  channel = supabase.channel(`tn-inspection-notices-${rep.id}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'inspection_notifications',
      filter: `recipient_id=eq.${rep.id}`
    }, (payload) => {
      if (payload.eventType === 'DELETE') {
        rows = rows.filter((row) => row.id !== payload.old?.id);
        paint();
        return;
      }
      const incoming = payload.new;
      if (!incoming?.id) return;
      const idx = rows.findIndex((row) => row.id === incoming.id);
      if (idx >= 0) rows[idx] = { ...rows[idx], ...incoming };
      else rows = [incoming, ...rows];
      announce(incoming);
      paint();
    })
    .subscribe();

  load().catch(() => {});
  return {
    stop() {
      abort.abort();
      if (channel) supabase.removeChannel(channel);
      channel = null;
    }
  };
}

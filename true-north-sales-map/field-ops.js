import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import './tn-files/password-reset.js';
import { formatHours, formatMiles, incomingAlert, pointLabel, roleLabel } from './lib/field-rules.js';
import { canUsePhotoBank, fieldHomeLinks } from './lib/role-access.js';
import { mountSignInScreen, revealApp } from './brand/loader.js';

const state = {
  sb: null,
  cfg: null,
  token: null,
  status: null,
  msgOpen: false,
  threads: [],
  thread: null,
  messages: [],
  activeRepId: null,
  draft: '',
  chatMode: 'chat',
  clockBusy: false,
  locationWarned: false,
  poll: null,
  ticker: null,
  channel: null,
  alertsPrimed: false,
  seenMessageIds: new Set(),
  alertsUnlocked: false,
  audioCtx: null,
  shifts: null,
  shiftDate: '',
  selectedRepId: null,
  shiftFocus: false,
  map: null,
  trailLayer: null
};

let markReady = () => {};
const ready = new Promise(resolve => { markReady = resolve; });
let doorChain = Promise.resolve();

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[ch]));

function ensureCss() {
  if (document.querySelector('link[data-tn-field]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/field-ops.css';
  link.dataset.tnField = '1';
  document.head.appendChild(link);
}

function toast(message, { hold = 2800 } = {}) {
  let node = document.getElementById('tnToast');
  if (!node) {
    node = document.createElement('div');
    node.id = 'tnToast';
    node.className = 'tnToast';
    node.setAttribute('role', 'status');
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => node.classList.remove('show'), hold);
}

function unlockAlertSound() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  if (!state.audioCtx) state.audioCtx = new Ctx();
  state.audioCtx.resume?.();
}

function playAlertSound() {
  const ctx = state.audioCtx;
  if (!ctx || ctx.state === 'suspended') return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.05;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
    osc.stop(ctx.currentTime + 0.14);
  } catch {
    /* A blocked sound should not stop the on-screen alert. */
  }
}

function announceMessage(text) {
  toast(text, { hold: 6000 });
  try { navigator.vibrate?.(80); } catch { /* vibration is optional */ }
  playAlertSound();
  if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try { new Notification('True North', { body: text }); } catch { /* permission can change under us */ }
  }
}

function noteIncoming(message) {
  const viewing = state.msgOpen && state.chatMode === 'chat' && state.thread?.id === message?.thread_id
    ? state.thread.id
    : null;
  const decision = incomingAlert(message, {
    meId: state.status?.rep?.id,
    seenIds: state.seenMessageIds,
    viewingThreadId: viewing
  });
  if (message?.id) state.seenMessageIds.add(message.id);
  if (decision.quiet && state.activeRepId) {
    loadThread(state.activeRepId, { quiet: true }).catch(() => {});
    return;
  }
  if (!decision.notify) return;
  const body = String(message.body || '').replace(/\s+/g, ' ').trim().slice(0, 140);
  announceMessage(body ? `New message: ${body}` : 'New message');
}

function watchIncoming(status) {
  const incoming = status?.latestIncoming;
  if (!state.alertsPrimed) {
    state.alertsPrimed = true;
    if (incoming?.id) state.seenMessageIds.add(incoming.id);
    return;
  }
  if (incoming) noteIncoming(incoming);
}

function stopAlerts() {
  state.alertsPrimed = false;
  state.seenMessageIds.clear();
  if (state.channel && state.sb) state.sb.removeChannel(state.channel);
  state.channel = null;
}

async function ensureRealtime() {
  if (state.channel || !state.cfg?.url || !state.token) return;
  try {
    if (!state.sb) state.sb = createClient(state.cfg.url, state.cfg.publishableKey);
    const existing = await state.sb.auth.getSession();
    if (!existing.data?.session) {
      const stored = readStoredSession();
      if (stored?.access_token && stored.refresh_token) {
        await state.sb.auth.setSession({
          access_token: stored.access_token,
          refresh_token: stored.refresh_token
        });
      }
    }
    state.channel = state.sb.channel(`tn-messages-${state.status?.rep?.id || 'office'}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        if (payload?.new) noteIncoming(payload.new);
        refreshStatus().catch(() => {});
      })
      .subscribe();
  } catch (error) {
    console.warn('Message alerts are using refresh until realtime connects.', error);
  }
}

function alertsNeedTap() {
  if (typeof Notification === 'undefined') return !state.alertsUnlocked;
  return Notification.permission === 'default';
}

async function enableMessageAlerts() {
  state.alertsUnlocked = true;
  unlockAlertSound();
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch { /* the in-app banner still works */ }
  }
  const button = document.getElementById('tnAlerts');
  if (button) button.hidden = !alertsNeedTap();
}

function easternStamp(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(iso));
}

function easternDayLabel(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(Date.UTC(year, month - 1, day, 16, 0, 0)));
}

async function loadConfig() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) return null;
    const cfg = await response.json();
    return cfg?.configured ? cfg : null;
  } catch {
    return null;
  }
}

async function api(path, { method = 'GET', body, retried = false } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && !retried) {
    const stored = readStoredSession();
    if (stored?.access_token && stored.access_token !== state.token) {
      state.token = stored.access_token;
      return api(path, { method, body, retried: true });
    }
    if (state.sb) {
      const refreshed = await state.sb.auth.refreshSession();
      if (refreshed.data?.session) {
        state.token = refreshed.data.session.access_token;
        return api(path, { method, body, retried: true });
      }
    }
  }
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed.');
    error.status = response.status;
    error.code = data.code || null;
    throw error;
  }
  return data;
}

/** One browser fix. This is not a background watch. */
function geolocate() {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      position => resolve({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy
      }),
      () => resolve(null),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 }
    );
  });
}

function hostForWidget() {
  return document.querySelector('#topRight, .topRight, .headerLinks');
}

function mountPhoneMenu() {
  const bar = document.querySelector('.topbar .topRight');
  if (!bar || document.getElementById('tnMore')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'tnMore';
  button.className = 'tnMore';
  button.textContent = 'More';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'tnMoreMenu');
  const menu = document.createElement('div');
  menu.id = 'tnMoreMenu';
  menu.className = 'tnMoreMenu';
  menu.hidden = true;
  const route = document.getElementById('routeBtn');
  if (route) bar.insertBefore(button, route);
  else bar.appendChild(button);
  bar.appendChild(menu);
  const close = () => {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };
  button.onclick = event => {
    event.stopPropagation();
    menu.hidden = !menu.hidden;
    button.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
  };
  document.addEventListener('click', event => {
    if (!menu.hidden && !menu.contains(event.target) && event.target !== button) close();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
  });
  fillRoleMenu();
  watchAdminButton();
}

function fillRoleMenu() {
  const menu = document.getElementById('tnMoreMenu');
  if (!menu) return;
  const role = state.status?.rep?.role || '';
  const open = !menu.hidden;
  menu.innerHTML = fieldHomeLinks(role).map(item => (
    item.action === 'message'
      ? `<button type="button" data-tn-action="message">${esc(item.label)}</button>`
      : `<a href="${esc(item.href)}">${esc(item.label)}</a>`
  )).join('');
  menu.hidden = !open;
  menu.querySelector('[data-tn-action="message"]')?.addEventListener('click', () => {
    menu.hidden = true;
    document.getElementById('tnMore')?.setAttribute('aria-expanded', 'false');
    openMessages();
  });
  const showPhotos = Boolean(role) && canUsePhotoBank(role);
  document.querySelectorAll('a[href="/rep.html"], a[href="/rep"]').forEach(link => {
    if (link.closest('#tnMoreMenu')) return;
    link.classList.toggle('hidden', !showPhotos);
  });
  syncMoreManagement();
}

function managementAllowed() {
  const admin = document.getElementById('adminBtn');
  return Boolean(admin && !admin.classList.contains('hidden'));
}

function showManagementLink(link, allowed) {
  link.hidden = !allowed;
  link.classList.toggle('hidden', !allowed);
}

function syncHeaderManagement() {
  const allowed = managementAllowed() || state.status?.rep?.role === 'admin';
  document.querySelectorAll('a.tnManageLink').forEach((link) => showManagementLink(link, allowed));
}

function syncMoreManagement() {
  const menu = document.getElementById('tnMoreMenu');
  syncHeaderManagement();
  if (!menu) return;
  const existing = document.getElementById('tnMoreAdmin');
  if (!managementAllowed()) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const link = document.createElement('a');
  link.id = 'tnMoreAdmin';
  link.href = '/admin';
  link.textContent = 'Management';
  menu.prepend(link);
}

function watchAdminButton() {
  const admin = document.getElementById('adminBtn');
  syncMoreManagement();
  if (!admin || admin.dataset.tnWatch) return;
  admin.dataset.tnWatch = '1';
  new MutationObserver(syncMoreManagement).observe(admin, { attributes: true, attributeFilter: ['class'] });
}

function doorSheetIsOpen() {
  return [...document.querySelectorAll('#doorSheet, .doorSheet')].some(sheet => (
    sheet.classList.contains('open') && !sheet.classList.contains('hidden')
  ));
}

function syncSheetClass() {
  const open = doorSheetIsOpen();
  const body = document.body;
  if (!body) return;
  if (open) {
    if (!body.classList.contains('sheet-open')) body.dataset.tnSheetHook = 'door';
    else if (!body.dataset.tnSheetHook) body.dataset.tnSheetHook = 'external';
    body.classList.add('sheet-open');
  } else if (body.dataset.tnSheetHook === 'door') {
    body.classList.remove('sheet-open');
    delete body.dataset.tnSheetHook;
  }
}

function setRootVar(name, value) {
  const style = document.documentElement.style;
  if (!value) {
    if (style.getPropertyValue(name)) style.removeProperty(name);
    return;
  }
  if (style.getPropertyValue(name) !== value) style.setProperty(name, value);
}

function elementShown(el) {
  if (!el || el.hidden || el.classList.contains('hidden')) return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const box = el.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
}

function tallestShownTop(selector) {
  let top = null;
  const band = window.innerHeight * 0.5;
  document.querySelectorAll(selector).forEach(el => {
    if (!elementShown(el)) return;
    const box = el.getBoundingClientRect();
    if (box.bottom < band) return;
    if (top === null || box.top < top) top = box.top;
  });
  return top;
}

function syncListSheet() {
  syncMobileChrome();
  const root = document.documentElement;
  const sheet = document.getElementById('listSheet');
  const phone = window.matchMedia('(max-width: 700px)').matches;
  if (!phone) {
    root.classList.remove('tn-list-half', 'tn-list-full', 'tn-chrome-stack');
    setRootVar('--tn-list-half-bottom', '');
    setRootVar('--tn-chrome-bottom', '');
    return;
  }
  if (sheet?.classList.contains('sheet-full')) {
    root.classList.add('tn-list-full');
    root.classList.remove('tn-list-half', 'tn-chrome-stack');
    setRootVar('--tn-chrome-bottom', '');
    return;
  }
  root.classList.remove('tn-list-full');
  if (sheet?.classList.contains('sheet-half')) {
    const top = sheet.getBoundingClientRect().top;
    const room = window.innerHeight - top;
    root.classList.remove('tn-chrome-stack');
    setRootVar('--tn-chrome-bottom', '');
    if (room < 48) return;
    if (top < 72) {
      root.classList.remove('tn-list-half');
      root.classList.add('tn-list-full');
      return;
    }
    setRootVar('--tn-list-half-bottom', `${Math.round(room + 8)}px`);
    root.classList.add('tn-list-half');
    return;
  }
  root.classList.remove('tn-list-half');
  setRootVar('--tn-list-half-bottom', '');
  const chromeTop = tallestShownTop('.mapLegend, .routeTray');
  if (chromeTop === null) {
    root.classList.remove('tn-chrome-stack');
    setRootVar('--tn-chrome-bottom', '');
    return;
  }
  setRootVar('--tn-chrome-bottom', `${Math.round(window.innerHeight - chromeTop + 8)}px`);
  root.classList.add('tn-chrome-stack');
}

function watchListSheet() {
  const seen = new WeakSet();
  const resizeObserver = new ResizeObserver(syncListSheet);
  const watchNode = node => {
    if (!node || seen.has(node)) return;
    seen.add(node);
    resizeObserver.observe(node);
    new MutationObserver(syncListSheet).observe(node, {
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden']
    });
  };
  const attach = () => {
    watchNode(document.getElementById('listSheet'));
    document.querySelectorAll('.mapLegend, .routeTray').forEach(watchNode);
    syncListSheet();
  };
  attach();
  new MutationObserver(mutations => {
    const hit = mutations.some(mutation => {
      if (mutation.type === 'attributes' && mutation.target?.id === 'listSheet') return true;
      const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
      return nodes.some(node => node.nodeType === 1 && (
        node.id === 'listSheet'
        || node.classList?.contains('mapLegend')
        || node.classList?.contains('routeTray')
        || node.querySelector?.('#listSheet, .mapLegend, .routeTray')
      ));
    });
    if (hit) attach();
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['id'] });
  new MutationObserver(syncListSheet).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style']
  });
  window.addEventListener('resize', syncListSheet);
}

function watchSheets() {
  const seen = new WeakSet();
  const attach = () => {
    document.querySelectorAll('#doorSheet, .doorSheet').forEach(sheet => {
      if (seen.has(sheet)) return;
      seen.add(sheet);
      new MutationObserver(syncSheetClass).observe(sheet, { attributes: true, attributeFilter: ['class', 'aria-hidden'] });
    });
    syncSheetClass();
  };
  attach();
  new MutationObserver(mutations => {
    const added = mutations.some(mutation => [...mutation.addedNodes].some(node => (
      node.nodeType === 1 && (
        node.id === 'doorSheet'
        || node.classList?.contains('doorSheet')
        || node.querySelector?.('#doorSheet, .doorSheet')
      )
    )));
    if (added) attach();
  }).observe(document.body, { childList: true, subtree: true });
}

function placeFieldOps(wrap) {
  const bar = document.getElementById('mobileBar');
  const phoneBar = bar && window.matchMedia('(max-width: 700px)').matches;
  if (phoneBar) {
    if (wrap.parentElement !== bar) bar.appendChild(wrap);
    return;
  }
  const host = hostForWidget();
  if (!host) return;
  const userMenu = document.getElementById('userMenu');
  if (userMenu && userMenu.parentElement === host) {
    if (wrap.parentElement !== host || wrap.nextElementSibling !== userMenu) host.insertBefore(wrap, userMenu);
  } else if (wrap.parentElement !== host) host.prepend(wrap);
}

function syncMobileChrome() {
  const wrap = document.getElementById('tnFieldOps');
  if (wrap) placeFieldOps(wrap);
  const root = document.documentElement;
  const bar = document.getElementById('mobileBar');
  const phone = window.matchMedia('(max-width: 700px)').matches && bar && getComputedStyle(bar).display !== 'none';
  if (!phone) {
    if (root.dataset.tnBarInset) {
      setRootVar('--list-sheet-bottom', '');
      const bottom = getComputedStyle(root).getPropertyValue('--list-sheet-bottom').trim() || '78px';
      const grabH = Math.round(document.getElementById('listSheetGrab')?.getBoundingClientRect().height || 52);
      setRootVar('--list-sheet-peek', `calc(${grabH}px + ${bottom})`);
      delete root.dataset.tnBarInset;
    }
    return;
  }
  const height = Math.ceil(bar.getBoundingClientRect().height);
  if (height < 8) return;
  const bottom = `${height + 15}px`;
  setRootVar('--list-sheet-bottom', bottom);
  const grabH = Math.round(document.getElementById('listSheetGrab')?.getBoundingClientRect().height || 52);
  setRootVar('--list-sheet-peek', `calc(${grabH}px + ${bottom})`);
  root.dataset.tnBarInset = '1';
}

function mountWidget() {
  const host = hostForWidget();
  if (!host || document.getElementById('tnFieldOps')) return;
  const wrap = document.createElement('div');
  wrap.className = 'tnFieldOps';
  wrap.id = 'tnFieldOps';
  wrap.innerHTML = `
    <button type="button" id="tnClockBtn" class="tnClockBtn isIn">
      <span id="tnClockLabel">Clock In</span>
      <span id="tnClockTimer" hidden></span>
    </button>
    <button type="button" id="tnMsgBtn" class="tnMsgBtn" aria-haspopup="dialog">
      Messages
      <span id="tnUnread" class="tnBadge hidden">0</span>
    </button>
    <a id="tnShiftsLink" class="tnShiftsLink" href="/shifts.html">Shifts</a>`;
  host.prepend(wrap);
  placeFieldOps(wrap);
  document.getElementById('tnClockBtn').onclick = onClock;
  document.getElementById('tnMsgBtn').onclick = () => { state.msgOpen ? closeMessages() : openMessages(); };
  syncMobileChrome();
}

function renderWidget() {
  syncHeaderManagement();
  const status = state.status;
  const root = document.getElementById('tnFieldOps');
  if (!status || !root) return;
  const onShifts = Boolean(document.getElementById('shiftsApp'));
  const clock = document.getElementById('tnClockBtn');
  const messages = document.getElementById('tnMsgBtn');
  const shifts = document.getElementById('tnShiftsLink');
  clock.hidden = !status.isField;
  messages.hidden = !(status.isField || status.isAdmin);
  shifts.hidden = !status.isAdmin || onShifts;
  clock.disabled = state.clockBusy;
  const badge = document.getElementById('tnUnread');
  const unread = Number(status.unread) || 0;
  badge.textContent = unread > 9 ? '9+' : String(unread);
  badge.classList.toggle('hidden', unread < 1);
  messages.setAttribute('aria-expanded', state.msgOpen ? 'true' : 'false');
  fillRoleMenu();
  renderClockLabel();
  syncMobileChrome();
}

function formatTimer(fromIso) {
  const total = Math.max(0, Math.floor((Date.now() - new Date(fromIso).getTime()) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function renderClockLabel() {
  const button = document.getElementById('tnClockBtn');
  const label = document.getElementById('tnClockLabel');
  const timer = document.getElementById('tnClockTimer');
  if (!button || !label || state.clockBusy) return;
  const shift = state.status?.openShift;
  button.classList.toggle('isOut', Boolean(shift));
  button.classList.toggle('isIn', !shift);
  if (!shift) {
    label.textContent = 'Clock In';
    if (timer) timer.hidden = true;
    button.setAttribute('aria-label', 'Clock In');
    return;
  }
  label.textContent = 'Clock Out';
  const elapsed = formatTimer(shift.clock_in_at);
  if (timer) {
    timer.hidden = false;
    timer.textContent = elapsed;
  }
  button.setAttribute('aria-label', `Clock Out. On shift for ${elapsed}.`);
}

function setClockBusy(label) {
  state.clockBusy = true;
  const labelNode = document.getElementById('tnClockLabel');
  const timer = document.getElementById('tnClockTimer');
  const button = document.getElementById('tnClockBtn');
  if (labelNode) labelNode.textContent = label;
  if (timer) timer.hidden = true;
  if (button) button.disabled = true;
}

async function refreshStatus() {
  if (!state.token) return;
  state.status = await api('/api/field?view=status');
  renderWidget();
  watchIncoming(state.status);
  ensureRealtime().catch(() => {});
}

function askConsent() {
  return new Promise(resolve => {
    const text = state.status?.notice?.text
      || 'While you are clocked in, True North saves your location when you clock in, clock out, and mark a door. It does not track you in the background.';
    const overlay = document.createElement('div');
    overlay.className = 'tnConsent';
    overlay.innerHTML = `
      <div class="tnSheet" role="dialog" aria-modal="true" aria-labelledby="tnConsentTitle">
        <h2 id="tnConsentTitle">Location while you are clocked in</h2>
        <p>${esc(text)}</p>
        <button type="button" id="tnConsentYes">Got it</button>
      </div>`;
    document.body.appendChild(overlay);
    const yes = overlay.querySelector('#tnConsentYes');
    yes.onclick = () => { overlay.remove(); resolve(true); };
    yes.focus();
  });
}

async function onClock() {
  if (!state.status?.isField || state.clockBusy) return;
  try {
    if (state.status.openShift) await doClockOut();
    else await doClockIn();
  } catch (error) {
    toast(error.message || 'Clock update failed.');
  } finally {
    state.clockBusy = false;
    renderWidget();
  }
}

async function doClockIn() {
  if (!state.status.consent) {
    const agreed = await askConsent();
    if (!agreed) return;
    setClockBusy('Clocking in…');
    const saved = await api('/api/field', { method: 'POST', body: { action: 'consent' } });
    state.status.consent = saved.consent || { consented_at: new Date().toISOString() };
  }
  setClockBusy('Clocking in…');
  const loc = await geolocate();
  if (!loc) toast('Clocked in without a location. Allow location so the next door can save a point.');
  setClockBusy('Clocking in…');
  const result = await api('/api/field', {
    method: 'POST',
    body: { action: 'clock-in', lat: loc?.lat ?? null, lng: loc?.lng ?? null, accuracy: loc?.accuracy ?? null }
  });
  state.status.openShift = result.shift;
  toast(loc ? 'Clocked in.' : 'Clocked in. No location this time.');
}

async function doClockOut() {
  setClockBusy('Clocking out…');
  const loc = await geolocate();
  if (!loc) toast('Clocked out without a location.');
  setClockBusy('Clocking out…');
  await api('/api/field', {
    method: 'POST',
    body: { action: 'clock-out', lat: loc?.lat ?? null, lng: loc?.lng ?? null, accuracy: loc?.accuracy ?? null }
  });
  state.status.openShift = null;
  toast('Clocked out.');
}

async function openMessages() {
  state.msgOpen = true;
  renderPanelShell();
  try {
    if (state.status?.isAdmin) {
      const inbox = await api('/api/field?view=inbox');
      state.threads = inbox.threads || [];
      state.chatMode = 'list';
      state.activeRepId = null;
      renderPanel();
    } else {
      state.chatMode = 'chat';
      state.activeRepId = state.status?.rep?.id || null;
      state.threads = [];
      if (state.activeRepId) await loadThread(state.activeRepId, { stick: true });
      else renderPanel();
    }
  } catch (error) {
    toast(error.message || 'Messages did not load.');
  }
}

function closeMessages() {
  state.msgOpen = false;
  state.draft = document.getElementById('tnMsgInput')?.value || state.draft;
  document.getElementById('tnMsgOverlay')?.remove();
  renderWidget();
}

function renderPanelShell() {
  if (document.getElementById('tnMsgOverlay')) return;
  const overlay = document.createElement('div');
  overlay.className = 'tnMsgOverlay';
  overlay.id = 'tnMsgOverlay';
  overlay.innerHTML = `
    <section class="tnMsgPanel" data-tn-panel="messages" data-tn-rank="primary" role="dialog" aria-modal="true" aria-labelledby="tnMsgTitle">
      <header class="tnMsgHead">
        <button type="button" class="tnBack" id="tnMsgBack">Back</button>
        <h2 id="tnMsgTitle">Messages</h2>
        <button type="button" class="tnMsgClose" id="tnMsgClose">Close</button>
      </header>
      <button type="button" id="tnAlerts" class="tnAlerts">Turn on alerts</button>
      <div id="tnMsgBody"></div>
    </section>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#tnMsgClose').onclick = closeMessages;
  overlay.querySelector('#tnAlerts').onclick = () => { enableMessageAlerts().catch(() => {}); };
  overlay.querySelector('#tnAlerts').hidden = !alertsNeedTap();
  overlay.querySelector('#tnMsgBack').onclick = () => {
    state.chatMode = 'list';
    state.activeRepId = null;
    state.draft = '';
    renderPanel();
  };
}

function renderPanel() {
  const body = document.getElementById('tnMsgBody');
  if (!body) return;
  const admin = Boolean(state.status?.isAdmin);
  const listing = admin && state.chatMode !== 'chat';
  const active = state.threads.find(thread => thread.rep.id === state.activeRepId);
  const title = document.getElementById('tnMsgTitle');
  const back = document.getElementById('tnMsgBack');
  if (title) title.textContent = listing ? 'Messages' : (admin ? (active?.rep.name || 'Messages') : 'Message management');
  if (back) back.hidden = !admin || listing;
  body.className = `tnMsgLayout ${listing ? 'listOnly' : 'chatOnly'}`;
  const list = admin ? `<section class="tnThreadList" data-tn-panel="message-threads" data-tn-rank="primary"><h3>People</h3>${state.threads.map(thread => `
      <button type="button" class="tnThreadBtn" data-rep="${esc(thread.rep.id)}">
        <b>${thread.unread ? '<span class="tnDot"></span>' : ''}${esc(thread.rep.name)}</b>
        <small>${esc(roleLabel(thread.rep.role))}${thread.lastBody ? ` · ${esc(thread.lastBody)}` : ' · No messages yet'}</small>
      </button>`).join('') || '<div class="tnEmpty">No one is on the roster yet.</div>'}</section>` : '';
  const mineId = state.status?.rep?.id;
  const bubbles = state.messages.length ? state.messages.map(message => {
    const mine = message.sender_rep_id === mineId;
    const who = mine ? 'You' : (message.sender_rep_id === state.activeRepId ? (active?.rep.name || 'Field') : 'Office');
    return `<article class="tnBubble${mine ? ' mine' : ''}"><b>${esc(who)}</b><p>${esc(message.body)}</p><time>${esc(easternStamp(message.created_at))}</time></article>`;
  }).join('') : `<div class="tnEmpty">${admin ? 'No messages yet. Write the first one below.' : 'No messages yet. Write management here. This is separate from GroupMe.'}</div>`;
  body.innerHTML = `${list}<div class="tnConvo">
      <div class="tnBubbles" id="tnBubbles">${bubbles}</div>
      <form class="tnComposer" id="tnComposer">
        <label class="srOnly" for="tnMsgInput">Message</label>
        <textarea id="tnMsgInput" maxlength="4000" placeholder="Write a message…"></textarea>
        <button type="submit">Send</button>
      </form>
    </div>`;
  const input = document.getElementById('tnMsgInput');
  input.value = state.draft || '';
  input.addEventListener('input', () => { state.draft = input.value; });
  document.getElementById('tnComposer').onsubmit = sendCurrent;
  body.querySelectorAll('[data-rep]').forEach(button => {
    button.onclick = () => {
      state.chatMode = 'chat';
      state.draft = '';
      state.activeRepId = button.dataset.rep;
      loadThread(state.activeRepId, { stick: true }).catch(error => toast(error.message));
    };
  });
  renderWidget();
}

async function loadThread(repId, { stick = false, quiet = false } = {}) {
  const data = await api(`/api/field?view=thread&repId=${encodeURIComponent(repId)}`);
  const next = data.messages || [];
  const unchanged = quiet
    && state.thread?.id === data.thread?.id
    && state.messages.length === next.length
    && state.messages.at(-1)?.id === next.at(-1)?.id;
  state.thread = data.thread;
  state.messages = next;
  if (data.thread?.id && !unchanged) {
    await api('/api/field', { method: 'POST', body: { action: 'read', threadId: data.thread.id } });
    const row = state.threads.find(thread => thread.rep.id === repId);
    if (row) row.unread = 0;
    await refreshStatus().catch(() => {});
  }
  if (unchanged) return;
  const focused = document.activeElement?.id === 'tnMsgInput';
  state.draft = document.getElementById('tnMsgInput')?.value ?? state.draft;
  renderPanel();
  if (stick || quiet) {
    const box = document.getElementById('tnBubbles');
    if (box) box.scrollTop = box.scrollHeight;
  }
  if (focused) document.getElementById('tnMsgInput')?.focus();
}

async function sendCurrent(event) {
  event.preventDefault();
  const input = document.getElementById('tnMsgInput');
  const text = input.value.trim();
  if (!text || !state.activeRepId) return;
  input.disabled = true;
  try {
    await api('/api/field', { method: 'POST', body: { action: 'send', body: text, repId: state.activeRepId } });
    state.draft = '';
    input.value = '';
    if (state.status?.isAdmin) {
      const inbox = await api('/api/field?view=inbox');
      state.threads = inbox.threads || [];
    }
    await loadThread(state.activeRepId, { stick: true });
  } catch (error) {
    toast(error.message || 'Message was not sent.');
  } finally {
    input.disabled = false;
    input.focus();
  }
}

function startWatchers() {
  clearInterval(state.poll);
  clearInterval(state.ticker);
  state.poll = setInterval(() => {
    refreshStatus().catch(() => {});
    if (state.msgOpen && state.chatMode === 'chat' && state.activeRepId) {
      loadThread(state.activeRepId, { quiet: true }).catch(() => {});
    }
  }, 15000);
  state.ticker = setInterval(renderClockLabel, 1000);
}

function authStorageKey() {
  if (!state.cfg?.url) return null;
  return `sb-${new URL(state.cfg.url).hostname.split('.')[0]}-auth-token`;
}

function readStoredSession() {
  const key = authStorageKey();
  if (!key) return null;
  try {
    const session = JSON.parse(localStorage.getItem(key) || 'null');
    return session?.access_token ? session : null;
  } catch {
    return null;
  }
}

async function syncSession(session) {
  state.token = session?.access_token || null;
  if (!session) {
    state.status = null;
    stopAlerts();
    document.getElementById('tnFieldOps')?.remove();
    closeMessages();
    return;
  }
  mountWidget();
  try {
    await refreshStatus();
    startWatchers();
  } catch (error) {
    document.getElementById('tnFieldOps')?.remove();
    throw error;
  }
}

function showLocalNoticePreview() {
  ensureCss();
  mountWidget();
  state.status = {
    isField: true,
    isAdmin: false,
    unread: 1,
    rep: { id: 'preview', name: 'Preview', role: 'appointment_setter' }
  };
  renderWidget();
  announceMessage('New message from the office');
}

async function bootWidget() {
  const cfg = await loadConfig();
  const preview = new URLSearchParams(location.search).get('previewNotice') === '1';
  if (!cfg) {
    if (preview) showLocalNoticePreview();
    return;
  }
  state.cfg = cfg;
  await syncSession(readStoredSession());
  if (new URLSearchParams(location.search).get('open') === 'messages' && state.status?.rep) openMessages();
  window.addEventListener('storage', () => {
    syncSession(readStoredSession()).catch(error => console.warn(error));
  });
  setInterval(() => {
    const next = readStoredSession();
    const token = next?.access_token || null;
    if (token !== state.token || (token && !state.status)) {
      syncSession(next).catch(error => console.warn(error));
    }
  }, 1500);
}

async function captureDoorStatusNow(info) {
  try {
    await ready;
    if (!state.status?.isField || !state.status?.openShift) return { skipped: true };
    const loc = await geolocate();
    if (!loc) {
      if (!state.locationWarned) {
        state.locationWarned = true;
        toast('You are clocked in, but this door did not get a location point. Allow location while you are on shift.');
      }
      return { skipped: true, reason: 'no_location' };
    }
    return await api('/api/field', {
      method: 'POST',
      body: {
        action: 'door',
        lat: loc.lat,
        lng: loc.lng,
        accuracy: loc.accuracy,
        leadId: info?.leadId || null,
        status: info?.status || null
      }
    });
  } catch (error) {
    toast(error.message || 'Location point was not saved.');
    return { error: true };
  }
}

window.TrueNorthField = {
  captureDoorStatus(info) {
    const run = doorChain.then(() => captureDoorStatusNow(info));
    doorChain = run.catch(() => {});
    return run;
  }
};

function renderShiftsMessage(html) {
  destroyShiftMap();
  const root = document.getElementById('shiftsApp');
  if (root) root.innerHTML = html;
}

function renderShiftsLogin(message = '') {
  destroyShiftMap();
  state.token = null;
  state.status = null;
  state.shifts = null;
  state.threads = [];
  state.messages = [];
  const root = document.getElementById('shiftsApp');
  mountSignInScreen(root);
  renderShiftsMessage(`
    <div class="authCard card"><div class="pad">
      <img class="signInLogo" src="/brand/logo-full.webp" alt="True North Restorations" width="320" height="242">
      <div class="eyebrow">SHIFTS AND TRAILS</div>
      <h1 style="font-size:24px">Sign in to management.</h1>
      <p>Hours and travel trails are visible to admin and manager profiles.</p>
      <form id="shiftsLogin">
        <div class="field"><label for="shiftsEmail">Email</label><input id="shiftsEmail" type="email" autocomplete="email" required></div>
        <div class="field"><label for="shiftsPassword">Password</label><input id="shiftsPassword" type="password" autocomplete="current-password" required></div>
        <button class="btn dark" type="submit">Sign in</button>
      </form>
      <div class="error" id="shiftsLoginError">${esc(message)}</div>
      <button type="button" class="tnForgot" data-forgot>Forgot password?</button>
      <form data-forgot-form class="tnForgotForm hidden">
        <div class="field"><label for="shiftsForgotEmail">Email</label><input id="shiftsForgotEmail" data-forgot-email type="email" autocomplete="email" required></div>
        <button class="btn dark" type="submit">Send reset link</button>
        <p data-forgot-msg class="tnResetMsg"></p>
      </form>
    </div></div>`);
  document.getElementById('shiftsLogin').onsubmit = async event => {
    event.preventDefault();
    document.getElementById('shiftsLoginError').textContent = 'Signing in…';
    const result = await state.sb.auth.signInWithPassword({
      email: document.getElementById('shiftsEmail').value.trim(),
      password: document.getElementById('shiftsPassword').value
    });
    if (result.error) document.getElementById('shiftsLoginError').textContent = result.error.message;
  };
}

async function bootShifts() {
  const signOut = document.getElementById('shiftsSignOut');
  if (signOut) signOut.onclick = () => {
    document.documentElement.classList.add('tn-signed-out', 'tn-hold-login');
    const boot = document.getElementById('tnBootHold');
    if (boot) boot.classList.remove('isGone', 'isDone');
    destroyShiftMap();
    state.token = null;
    state.status = null;
    state.shifts = null;
    state.threads = [];
    state.messages = [];
    const root = document.getElementById('shiftsApp');
    if (root) root.replaceChildren();
    (state.sb ? state.sb.auth.signOut() : Promise.resolve()).then(() => location.reload());
  };
  const cfg = await loadConfig();
  if (!cfg) {
    revealApp();
    renderShiftsMessage('<div class="card pad"><h1>Shifts need cloud setup.</h1><p>Add the Supabase environment variables and apply the clock-in migration, then reload.</p></div>');
    return;
  }
  state.cfg = cfg;
  state.sb = createClient(cfg.url, cfg.publishableKey);
  state.sb.auth.onAuthStateChange((event, session) => {
    if (session) enterShifts(session).catch(error => console.warn(error));
    else if (event === 'SIGNED_OUT') enterShifts(null).catch(error => console.warn(error));
  });
  const existing = await state.sb.auth.getSession();
  await enterShifts(existing.data.session);
}

let shiftsTicket = 0;

async function enterShifts(session) {
  const ticket = ++shiftsTicket;
  const stale = () => ticket !== shiftsTicket;
  if (!session) {
    state.token = null;
    state.status = null;
    stopAlerts();
    document.getElementById('tnFieldOps')?.remove();
    renderShiftsLogin();
    return;
  }
  revealApp();
  state.token = session.access_token;
  mountWidget();
  try {
    state.status = await api('/api/field?view=status');
    watchIncoming(state.status);
    ensureRealtime().catch(() => {});
  } catch (error) {
    if (stale()) return;
    document.getElementById('tnFieldOps')?.remove();
    renderShiftsLogin(error.message);
    return;
  }
  if (stale()) return;
  renderWidget();
  startWatchers();
  if (!state.status.isAdmin) {
    renderShiftsMessage(`<div class="card pad"><h1>This page is for the office.</h1><p>Clock in and messages are on the field map and setter intake.</p><p><a class="btn" href="/">Field map</a> <a class="btn" href="/setter.html">Setter intake</a></p></div>`);
    return;
  }
  if (!state.shiftDate) {
    state.shiftDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
  if (!stale()) await loadShiftDay(state.shiftDate);
}

function destroyShiftMap() {
  if (!state.map) return;
  state.map.remove();
  state.map = null;
  state.trailLayer = null;
}

async function loadShiftDay(date) {
  state.shiftDate = date;
  destroyShiftMap();
  renderShiftsMessage('<p class="small">Loading shifts…</p>');
  try {
    state.shifts = await api(`/api/field?view=shifts&date=${encodeURIComponent(date)}`);
  } catch (error) {
    renderShiftsMessage(`<div class="card pad"><h1>Could not load shifts.</h1><p>${esc(error.message)}</p></div>`);
    return;
  }
  if (state.selectedRepId && !state.shifts.people.some(person => person.rep.id === state.selectedRepId)) {
    state.selectedRepId = null;
    state.shiftFocus = false;
  }
  renderShiftBoard();
}

function personLine(person) {
  const open = person.shifts.some(shift => shift.open);
  const bits = [
    roleLabel(person.rep.role),
    `${formatMiles(person.miles)} today`,
    formatHours(person.totalHours)
  ];
  if (open) bits.unshift('Clocked in');
  if (person.longGap) bits.push('one long gap between points');
  return bits.join(' · ');
}

function renderShiftBoard() {
  destroyShiftMap();
  const data = state.shifts;
  const clockedIn = data.people.filter(person => person.shifts.some(shift => shift.open));
  const selected = data.people.find(person => person.rep.id === state.selectedRepId) || null;
  const phoneFocus = state.shiftFocus && selected;
  const buttonFor = person => `<button type="button" class="tnPersonBtn${person.rep.id === state.selectedRepId ? ' selected' : ''}" data-rep="${esc(person.rep.id)}">
      <strong>${person.shifts.some(shift => shift.open) ? '<span class="tnLive"></span>' : ''}${esc(person.rep.name)}</strong>
      <span>${esc(personLine(person))}</span>
    </button>`;
  renderShiftsMessage(`
    <div class="hero">
      <div>
        <div class="eyebrow">FIELD TIME</div>
        <h1>Shifts</h1>
        <p class="tnShiftNote">${esc(easternDayLabel(data.date))}. Tap a person to see where they went and the miles for the day. Miles are straight lines between saved points, not driving miles.</p>
      </div>
    </div>
    <div class="tnDayBar">
      <div class="field"><label for="shiftDate">Day</label><input id="shiftDate" type="date" value="${esc(data.date)}"></div>
      <button type="button" class="btn" id="shiftToday">Today</button>
    </div>
    <div class="tnShiftLayout">
      <div class="${phoneFocus ? 'tnPhoneHide' : ''}">
        <section class="tnNow" data-tn-panel="shift-now" data-tn-rank="primary">
          <h2>Clocked in now</h2>
          ${clockedIn.length ? clockedIn.map(buttonFor).join('') : '<p class="tnShiftNote">Nobody is clocked in right now.</p>'}
        </section>
        <section class="tnDayList" data-tn-panel="shift-day" data-tn-rank="secondary">
          <h2>This day</h2>
          ${data.people.length ? data.people.map(buttonFor).join('') : '<p class="tnShiftNote">No shifts or location points on this day.</p>'}
        </section>
      </div>
      <div class="${phoneFocus ? '' : 'tnPhoneHide'}" data-tn-panel="shift-trail" data-tn-rank="primary">
        <header>
          <button type="button" class="tnBack" id="tnShiftBack">Back</button>
          <h2 style="margin:8px 0 0;color:#0c1424">${selected ? esc(selected.rep.name) : 'Trail'}</h2>
        </header>
        ${selected ? `<p class="tnMilesBig">${esc(formatMiles(selected.miles))} today</p>
          <p class="tnShiftNote">${esc(formatHours(selected.totalHours))} on this day. ${selected.points.length} location point${selected.points.length === 1 ? '' : 's'}. ${selected.consent ? `Location agreed ${esc(easternStamp(selected.consent.consented_at))}.` : 'Has not agreed to location yet.'}</p>` : '<p class="tnShiftNote">Tap a person to see where they went today.</p>'}
        <div id="shiftMap" class="tnShiftMap"></div>
        <p class="tnPointMeta" id="shiftMapCaption"></p>
      </div>
    </div>`);
  document.getElementById('shiftDate').onchange = event => {
    state.shiftFocus = false;
    loadShiftDay(event.target.value);
  };
  document.getElementById('shiftToday').onclick = () => {
    state.shiftFocus = false;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    loadShiftDay(today);
  };
  document.getElementById('tnShiftBack').onclick = () => {
    state.shiftFocus = false;
    renderShiftBoard();
  };
  document.querySelectorAll('.tnPersonBtn').forEach(button => {
    button.onclick = () => {
      state.selectedRepId = button.dataset.rep;
      state.shiftFocus = true;
      renderShiftBoard();
    };
  });
  drawTrails();
}

function drawTrails() {
  const caption = document.getElementById('shiftMapCaption');
  const mapEl = document.getElementById('shiftMap');
  const phone = window.matchMedia('(max-width: 700px)').matches;
  if (phone && mapEl?.closest('.tnPhoneHide')) return;
  if (!window.L || !mapEl) {
    if (caption) caption.textContent = 'Map tiles did not load. The hours table is still current.';
    return;
  }
  if (!state.map) {
    state.map = L.map('shiftMap', { zoomControl: true }).setView([40.393, -82.486], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(state.map);
    state.trailLayer = L.layerGroup().addTo(state.map);
  }
  state.trailLayer.clearLayers();
  const colors = ['#1e6bff', '#0c1424', '#2E6B4B', '#467c9e', '#A44835', '#A66B19', '#3E4E59'];
  const people = state.shifts?.people || [];
  const visible = people.filter(person => person.rep.id === state.selectedRepId);
  const bounds = [];
  visible.forEach((person, index) => {
    if (person.points.length < 1) return;
    const selected = person.rep.id === state.selectedRepId;
    const color = selected ? '#1e6bff' : colors[index % colors.length];
    const latLngs = person.points.map(point => [Number(point.lat), Number(point.lng)]);
    if (latLngs.length > 1) {
      L.polyline(latLngs, { color, weight: selected ? 5 : 3, opacity: selected ? 0.95 : 0.55 }).addTo(state.trailLayer);
    }
    person.points.forEach(point => {
      const marker = L.circleMarker([Number(point.lat), Number(point.lng)], {
        radius: selected ? 7 : 5,
        color,
        weight: 2,
        fillColor: '#fff',
        fillOpacity: 0.95
      });
      const accuracy = point.accuracy_m ? `<br>± ${esc(Math.round(Number(point.accuracy_m)))} m` : '';
      marker.bindPopup(`<b>${esc(person.rep.name)}</b><br>${esc(pointLabel(point))}<br>${esc(easternStamp(point.captured_at))}${accuracy}`);
      marker.addTo(state.trailLayer);
      if (selected || !state.selectedRepId) bounds.push([Number(point.lat), Number(point.lng)]);
    });
  });
  const selected = people.find(person => person.rep.id === state.selectedRepId);
  if (caption) {
    caption.textContent = selected
      ? `${selected.rep.name}: ${formatMiles(selected.miles)} across ${selected.points.length} point${selected.points.length === 1 ? '' : 's'}.`
      : 'Select a person to highlight their trail.';
  }
  setTimeout(() => state.map.invalidateSize(), 60);
  if (bounds.length) state.map.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 });
}

async function boot() {
  try {
    ensureCss();
    mountPhoneMenu();
    document.getElementById('openMessages')?.addEventListener('click', () => {
      if (state.msgOpen) closeMessages();
      else openMessages();
    });
    watchSheets();
    watchListSheet();
    const bar = document.getElementById('mobileBar');
    if (bar && typeof ResizeObserver !== 'undefined') new ResizeObserver(() => syncMobileChrome()).observe(bar);
    if (document.getElementById('shiftsApp')) await bootShifts();
    else await bootWidget();
  } catch (error) {
    console.warn('Field tools did not start', error);
  } finally {
    markReady();
  }
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && state.msgOpen) closeMessages();
});
document.addEventListener('tn-panel-toggle', event => {
  if (event.detail?.id === 'shift-trail' && event.detail.collapsed === false) {
    setTimeout(() => state.map?.invalidateSize(), 240);
  }
});

boot();

import { PASSWORD_RULE } from '../lib/password-reset.js';
import {
  PASSWORD_SAVED,
  needsPasswordGate,
  passwordGateProblem,
  passwordUpdateError
} from '../lib/must-change-password.js';
import { readStoredUser } from '../lib/management-gate.js';
import { loaderHoldHtml } from '../brand/loader.js';

const HOLD_ID = 'tnPasswordHold';

export function passwordGateMarkup({ error = '', done = false } = {}) {
  if (done) {
    return `<div class="tnGateCard"><img class="signInLogo" src="/brand/logo-full.webp" alt="True North Restorations" width="168" height="128"><div class="eyebrow">TRUE NORTH</div><h1>Password saved</h1><p class="tnGateOk">${PASSWORD_SAVED}</p><p>Opening the app…</p></div>`;
  }
  return `<div class="tnGateCard"><img class="signInLogo" src="/brand/logo-full.webp" alt="True North Restorations" width="168" height="128"><div class="eyebrow">TRUE NORTH</div><h1>Choose a new password</h1><p>This login is still using a password someone else set. Choose your own before continuing.</p><form id="tnGateForm"><label for="tnGate1">New password</label><div class="tnGateField"><input id="tnGate1" type="password" autocomplete="new-password" minlength="8" required><button type="button" data-toggle="tnGate1">Show</button></div><label for="tnGate2">Type it again</label><div class="tnGateField"><input id="tnGate2" type="password" autocomplete="new-password" minlength="8" required><button type="button" data-toggle="tnGate2">Show</button></div><p class="tnGateHelp">${PASSWORD_RULE}</p><p id="tnGateError" class="tnGateError" role="alert">${error}</p><button class="tnGateSave" type="submit">Save password</button></form><button type="button" id="tnGateOut" class="tnGateOut">Sign out</button></div>`;
}

function styles() {
  if (document.getElementById('tnGateStyles')) return;
  const style = document.createElement('style');
  style.id = 'tnGateStyles';
  style.textContent = `#tnPasswordHold{position:fixed;inset:0;z-index:100000;display:grid;place-items:center;padding:16px;padding-bottom:calc(16px + env(safe-area-inset-bottom));background:#0c1424;color:#17252d;overflow:auto}#tnPasswordHold .tnGateCard{width:min(440px,100%);background:#fff;border-radius:16px;padding:18px 16px 16px}#tnPasswordHold h1{margin:0 0 8px;font-size:24px;line-height:1.15;color:#0c1424}#tnPasswordHold p{margin:0 0 12px;color:#5c6d76;font-size:15px;line-height:1.4}#tnPasswordHold label{display:block;font-size:15px;font-weight:800;color:#0c1424;margin:12px 0 6px}#tnPasswordHold .tnGateField{display:flex;gap:8px;align-items:center}#tnPasswordHold input{flex:1;min-width:0;min-height:48px;border:1px solid #d4dee2;border-radius:12px;padding:12px 14px;font-size:16px}#tnPasswordHold .tnGateField button,.tnGateSave,.tnGateOut{min-height:48px;border-radius:12px;font-size:16px;font-weight:800}#tnPasswordHold .tnGateField button{min-width:64px;border:1px solid #d4dee2;background:#fff;color:#0c1424}#tnGateSave{width:100%;margin-top:14px;border:0;background:#0c1424;color:#fff}#tnGateOut{width:100%;margin-top:8px;border:2px solid #0c1424;background:#fff;color:#0c1424}.tnGateError{min-height:1.2em;color:#A44835;font-weight:700}.tnGateOk{color:#16315f;font-weight:800}.tnGateHelp{font-size:13px}`;
  document.head.appendChild(style);
}

function host() {
  let el = document.getElementById(HOLD_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = HOLD_ID;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'tnGateTitle');
    (document.body || document.documentElement).appendChild(el);
  }
  styles();
  return el;
}

function lockPage(on) {
  const hold = document.getElementById(HOLD_ID);
  document.querySelectorAll('body > *').forEach((el) => {
    if (el === hold) return;
    if (on) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  });
}

function showGate(ctx) {
  const el = host();
  el.innerHTML = passwordGateMarkup();
  lockPage(true);
  const error = document.getElementById('tnGateError');
  const form = document.getElementById('tnGateForm');
  const clear = () => { if (error) error.textContent = ''; };
  form.querySelectorAll('input').forEach((input) => input.addEventListener('input', clear));
  el.querySelectorAll('[data-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.toggle);
      const hidden = input.type === 'password';
      input.type = hidden ? 'text' : 'password';
      button.textContent = hidden ? 'Hide' : 'Show';
    });
  });
  document.getElementById('tnGateOut').onclick = () => signOut(ctx);
  form.onsubmit = (event) => save(event, ctx, error);
}

function showSaved() {
  const el = host();
  el.innerHTML = passwordGateMarkup({ done: true });
  lockPage(true);
}

async function signOut(ctx) {
  try {
    await fetch(`${ctx.url}/auth/v1/logout`, {
      method: 'POST',
      headers: { apikey: ctx.key, Authorization: `Bearer ${ctx.token}`, 'content-type': 'application/json' }
    });
  } catch { /* still drop the local session */ }
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith('sb-') && key.includes('-auth-token')) localStorage.removeItem(key);
    }
  } catch { /* private mode */ }
  location.replace('/');
}

async function save(event, ctx, errorEl) {
  event.preventDefault();
  const first = document.getElementById('tnGate1').value;
  const second = document.getElementById('tnGate2').value;
  const problem = passwordGateProblem(first, second);
  if (problem) { errorEl.textContent = problem; return; }
  errorEl.textContent = '';
  const saved = await fetch(`${ctx.url}/auth/v1/user`, {
    method: 'PUT',
    headers: { apikey: ctx.key, Authorization: `Bearer ${ctx.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ password: first })
  });
  const body = await saved.json().catch(() => ({}));
  if (!saved.ok) { errorEl.textContent = passwordUpdateError(body, first); return; }
  const cleared = await fetch(`${ctx.url}/rest/v1/rpc/clear_must_change_password`, {
    method: 'POST',
    headers: { apikey: ctx.key, Authorization: `Bearer ${ctx.token}`, 'content-type': 'application/json' },
    body: '{}'
  });
  if (!cleared.ok) {
    const failure = await cleared.json().catch(() => ({}));
    errorEl.textContent = passwordUpdateError(failure, first);
    return;
  }
  showSaved();
  setTimeout(() => location.reload(), 700);
}

function storageKeys(url) {
  let ref = '';
  try { ref = new URL(url).hostname.split('.')[0]; } catch { ref = ''; }
  const keys = [];
  if (ref) keys.push(`sb-${ref}-auth-token`);
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && /^sb-.+-auth-token$/.test(key) && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

function readSession(url) {
  for (const key of storageKeys(url)) {
    let raw = localStorage.getItem(key) || '';
    if (!raw) {
      const chunks = [];
      for (let i = 0; ; i += 1) {
        const chunk = localStorage.getItem(`${key}.${i}`);
        if (!chunk) break;
        chunks.push(chunk);
      }
      raw = chunks.join('');
    }
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const session = parsed?.access_token ? parsed : parsed?.currentSession;
      if (session?.access_token) return { key, session };
    } catch { /* skip */ }
  }
  return null;
}

function writeSession(key, session) {
  localStorage.setItem(key, JSON.stringify(session));
}

async function refresh(ctx, key, session) {
  const response = await fetch(`${ctx.url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: ctx.key, 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: session.refresh_token })
  });
  if (!response.ok) return session;
  const next = await response.json();
  if (!next?.access_token) return session;
  writeSession(key, next);
  return next;
}

async function claimOpen(ctx) {
  const grantId = new URLSearchParams(location.search).get('tn_open');
  if (!grantId) return false;
  const response = await fetch(`${ctx.url}/rest/v1/rpc/claim_impersonation`, {
    method: 'POST',
    headers: { apikey: ctx.key, Authorization: `Bearer ${ctx.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ grant_id: grantId })
  });
  if (!response.ok) return false;
  const data = await response.json().catch(() => false);
  return data === true;
}

function skipPath() {
  return /\/reset-password\/?$/.test(location.pathname) || location.pathname.endsWith('/reset-password.html');
}

async function boot() {
  const waiting = document.getElementById(HOLD_ID);
  if (waiting && !waiting.querySelector('.bootOutlineTravel')) waiting.innerHTML = loaderHoldHtml();
  if (skipPath()) {
    document.getElementById(HOLD_ID)?.remove();
    return;
  }
  let cfg = null;
  try {
    const response = await fetch('/api/config');
    if (response.ok) cfg = await response.json();
  } catch { /* static preview */ }
  if (!cfg?.configured) {
    document.getElementById(HOLD_ID)?.remove();
    return;
  }
  const stored = readSession(cfg.url);
  if (!stored && !readStoredUser(localStorage)) {
    document.getElementById(HOLD_ID)?.remove();
    return;
  }
  const ctx = { url: String(cfg.url).replace(/\/$/, ''), key: cfg.publishableKey };
  let session = stored?.session;
  if (session?.refresh_token) session = await refresh(ctx, stored.key, session);
  if (!session?.access_token) {
    document.getElementById(HOLD_ID)?.remove();
    return;
  }
  ctx.token = session.access_token;
  const impersonating = await claimOpen(ctx);
  const statusResponse = await fetch(`${ctx.url}/rest/v1/rpc/password_gate_status`, {
    method: 'POST',
    headers: { apikey: ctx.key, Authorization: `Bearer ${ctx.token}`, 'content-type': 'application/json' },
    body: '{}'
  });
  const status = statusResponse.ok ? await statusResponse.json().catch(() => ({})) : {};
  if (!needsPasswordGate({ mustChange: status?.must_change, impersonating: impersonating || status?.impersonating })) {
    document.getElementById(HOLD_ID)?.remove();
    lockPage(false);
    return;
  }
  showGate(ctx);
}

if (typeof document !== 'undefined') boot();

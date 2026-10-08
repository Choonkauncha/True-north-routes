import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import {
  RESET_LINK_BAD,
  passwordChangeError,
  recoveryFromLocation
} from '../lib/password-reset.js';
import { passwordUpdateError } from '../lib/must-change-password.js';
import './password-reset.js';

const app = document.getElementById('app');

function logo() {
  return `<img class="signInLogo" src="/brand/logo-full.webp" alt="True North Restorations" width="320" height="242">`;
}

function requestForm() {
  return `<form data-forgot-form class="tnForgotForm"><label class="tnLabel" for="tnForgotEmail">Email</label><input class="tnInput" id="tnForgotEmail" data-forgot-email type="email" autocomplete="email" required><button class="tnTap dark" type="submit">Send reset link</button><p data-forgot-msg class="tnResetMsg"></p></form><p class="tnAccountBtns" style="margin-top:16px"><a class="tnTap tnOutline" href="/">Back to sign in</a></p>`;
}

function renderExpired() {
  app.innerHTML = `<div class="authCard card"><div class="pad">${logo()}<div class="eyebrow">TRUE NORTH</div><h1 class="tnTitle">Reset link expired</h1><p class="tnSub">${RESET_LINK_BAD}</p>${requestForm()}</div></div>`;
}

function renderForm(sb) {
  app.innerHTML = `<div class="authCard card"><div class="pad">${logo()}<div class="eyebrow">TRUE NORTH</div><h1 class="tnTitle">Choose a new password</h1><form id="resetForm"><label class="tnLabel" for="pw1">New password</label><input class="tnInput" id="pw1" type="password" autocomplete="new-password" minlength="8" required><label class="tnLabel" for="pw2">Type it again</label><input class="tnInput" id="pw2" type="password" autocomplete="new-password" minlength="8" required><p class="tnHelp">At least 8 characters. Use this the next time you sign in.</p><button class="tnTap dark" type="submit">Save password</button><p id="pwMsg" class="tnResetMsg"></p></form></div></div>`;
  document.getElementById('resetForm').onsubmit = (event) => save(event, sb);
}

async function sessionFromRecovery(sb) {
  const { data, error } = await sb.auth.getSession();
  if (!error && data?.session) return data.session;
  if (typeof sb.auth.getSessionFromUrl === 'function') {
    try {
      const result = await sb.auth.getSessionFromUrl({ storeSession: true });
      return result?.data?.session || result?.session || null;
    } catch { /* hash already consumed or missing */ }
  }
  const code = new URLSearchParams(location.search).get('code');
  if (code && typeof sb.auth.exchangeCodeForSession === 'function') {
    const exchanged = await sb.auth.exchangeCodeForSession(code);
    if (!exchanged.error && exchanged.data?.session) return exchanged.data.session;
  }
  return null;
}

async function save(event, sb) {
  event.preventDefault();
  const msg = document.getElementById('pwMsg');
  const first = document.getElementById('pw1').value;
  const second = document.getElementById('pw2').value;
  const problem = passwordChangeError(first, second);
  msg.classList.remove('isOk', 'isBad');
  if (problem) {
    msg.textContent = problem;
    msg.classList.add('isBad');
    return;
  }
  msg.textContent = 'Saving…';
  msg.classList.add('isOk');
  const { error } = await sb.auth.updateUser({ password: first });
  if (error) {
    msg.textContent = passwordUpdateError(error, first);
    msg.classList.remove('isOk');
    msg.classList.add('isBad');
    return;
  }
  const cleared = await sb.rpc('clear_must_change_password');
  if (cleared.error) {
    msg.textContent = passwordUpdateError(cleared.error, first);
    msg.classList.remove('isOk');
    msg.classList.add('isBad');
    return;
  }
  await sb.auth.signOut();
  location.href = '/?reset=1';
}

async function start() {
  let cfg = null;
  try {
    const response = await fetch('/api/config');
    if (response.ok) cfg = await response.json();
  } catch { /* static preview */ }
  const link = recoveryFromLocation(location);
  if (!cfg?.configured || link === 'missing' || link === 'expired') {
    renderExpired();
    return;
  }
  try {
    const sb = createClient(cfg.url, cfg.publishableKey, {
      auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true }
    });
    const session = await sessionFromRecovery(sb);
    if (!session) renderExpired();
    else renderForm(sb);
  } catch {
    renderExpired();
  }
}

start();

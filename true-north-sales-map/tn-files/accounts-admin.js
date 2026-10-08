import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { esc } from './ui.js';
import { canManageAccount, roleLabel } from '../lib/account-rules.js';

const FIELD = [
  ['appointment_setter', 'Appointment setter'],
  ['canvasser', 'Canvasser'],
  ['salesperson', 'Sales rep']
];
const ADMIN_EXTRA = [
  ['manager', 'Manager'],
  ['admin', 'Admin']
];

function mount() {
  const rail = document.querySelector('#app .rail');
  const main = document.querySelector('#app .dashMain');
  if (!rail || !main || document.getElementById('tab-accounts')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.tab = 'accounts';
  button.textContent = 'Accounts';
  const files = rail.querySelector('[data-tab="files"]');
  if (files) files.insertAdjacentElement('afterend', button);
  else rail.appendChild(button);
  const section = document.createElement('section');
  section.id = 'tab-accounts';
  section.className = 'hidden';
  section.innerHTML = '<div id="tnAccounts"></div>';
  main.appendChild(section);
  button.onclick = () => {
    document.querySelectorAll('#app [data-tab]').forEach((item) => item.classList.toggle('active', item === button));
    document.querySelectorAll('#app main section[id^=tab-]').forEach((item) => item.classList.toggle('hidden', item.id !== 'tab-accounts'));
    show();
  };
}

let sb = null;
let me = null;
let session = null;
let people = [];
let detail = null;
let notice = '';
let openLink = null;
let resetId = '';

async function show() {
  const root = document.getElementById('tnAccounts');
  if (!root) return;
  root.innerHTML = '<p class="tnSub">Loading accounts…</p>';
  try {
    if (!sb) {
      const response = await fetch('/api/config');
      const cfg = response.ok ? await response.json() : null;
      if (!cfg?.configured) {
        root.innerHTML = '<h1 class="tnTitle">Accounts</h1><p class="tnSub">Connect Supabase before creating logins. Run supabase/setup_all.sql, then add the server secret key.</p>';
        return;
      }
      sb = createClient(cfg.url, cfg.publishableKey);
    }
    const got = await sb.auth.getSession();
    session = got.data.session;
    if (!session) {
      root.innerHTML = '<h1 class="tnTitle">Accounts</h1><p class="tnSub">Sign in as an admin or manager.</p>';
      return;
    }
    const row = await sb.from('reps').select('id,name,email,role').eq('user_id', session.user.id).eq('active', true).maybeSingle();
    me = row.data;
    if (!me || !['admin', 'manager'].includes(me.role)) {
      root.innerHTML = '<h1 class="tnTitle">Accounts</h1><p class="tnSub">Only an admin or manager can manage logins.</p>';
      return;
    }
    const listed = await sb.from('reps').select('id,user_id,name,email,role,active').order('name');
    if (listed.error) throw listed.error;
    people = listed.data || [];
    render();
  } catch (error) {
    root.innerHTML = `<h1 class="tnTitle">Accounts</h1><p class="tnError">${esc(error.message)}</p>`;
  }
}

function rolesForMe() {
  return me?.role === 'admin' ? [...FIELD, ...ADMIN_EXTRA] : FIELD;
}

function render() {
  const root = document.getElementById('tnAccounts');
  const options = rolesForMe().map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
  const cards = people.map((person) => {
    const mine = person.id === me.id;
    const can = canManageAccount(me.role, person.role, 'reset');
    const canOff = canManageAccount(me.role, person.role, person.active ? 'deactivate' : 'reactivate') && !mine;
    const canOpen = canManageAccount(me.role, person.role, 'open_as') && person.active && !mine;
    return `<article class="tnAccountCard" data-rep="${esc(person.id)}">
      <b>${esc(person.name)}</b>
      <span>${esc(person.email || 'No email')} · ${esc(roleLabel(person.role))} · ${person.active ? 'Active' : 'Off'}</span>
      <div class="tnAccountBtns">
        ${can ? '<button type="button" data-act="reset">Reset password</button>' : ''}
        ${canOff ? `<button type="button" data-act="active">${person.active ? 'Turn off' : 'Turn on'}</button>` : ''}
        ${canOpen ? '<button type="button" data-act="open">Open as this user</button>' : ''}
        <button type="button" data-act="work">Activity, files, forms</button>
      </div>
      ${resetId === person.id ? '<form class="tnResetForm"><input class="tnInput" type="password" minlength="8" placeholder="New password" required autocomplete="new-password"><button class="tnTap dark" type="submit">Save password</button></form>' : ''}
      ${detail?.id === person.id ? detailHtml() : ''}
      ${openLink?.id === person.id ? linkHtml() : ''}
    </article>`;
  }).join('');
  root.innerHTML = `<div class="dashTitle"><div><div class="eyebrow">LOGINS</div><h1 class="tnTitle">Accounts</h1><p class="tnSub">Create a login, reset a password, or turn a person off. They change their own password under My account.</p></div></div>
    ${notice ? `<p class="tnBanner">${esc(notice)}</p>` : ''}
    <form id="tnCreateAccount" class="tnCard">
      <label class="tnLabel" for="acctName">Name</label>
      <input class="tnInput" id="acctName" required autocomplete="name">
      <label class="tnLabel" for="acctEmail">Email</label>
      <input class="tnInput" id="acctEmail" type="email" required autocomplete="off">
      <label class="tnLabel" for="acctRole">Role</label>
      <select class="tnSelect" id="acctRole">${options}</select>
      <label class="tnLabel" for="acctPassword">Initial password</label>
      <input class="tnInput" id="acctPassword" type="password" required minlength="8" autocomplete="new-password">
      <button class="tnTap dark" type="submit">Create login</button>
    </form>
    <div class="tnAccountList">${cards || '<p class="tnSub">No people yet.</p>'}</div>`;
  document.getElementById('tnCreateAccount').onsubmit = createAccount;
  root.querySelectorAll('[data-act]').forEach((button) => {
    button.onclick = () => act(button.dataset.act, button.closest('[data-rep]').dataset.rep);
  });
  root.querySelectorAll('.tnResetForm').forEach((form) => {
    form.onsubmit = (event) => saveReset(event, form.closest('[data-rep]').dataset.rep, form.querySelector('input').value);
  });
}

function linkHtml() {
  return `<div class="tnBanner">
    <p>One-time link for ${esc(openLink.name)}. Open it in a private window so you stay signed in here.</p>
    <div class="tnAccountBtns">
      <button type="button" id="tnCopyLink">Copy link</button>
      <a class="tnTap tnOutline" href="${esc(openLink.url)}" target="_blank" rel="noopener">Open in new tab</a>
    </div>
  </div>`;
}

function detailHtml() {
  const block = (title, rows) => `<h2>${title}</h2>${rows.length ? rows.join('') : '<p class="tnHelp">None yet.</p>'}`;
  return `<div class="tnAccountDetail">
    ${block('Activity', detail.activity.map((row) => `<p><b>${esc(row.action)}</b> · ${esc(row.lead_id || '')}<span>${esc(when(row.created_at))}</span></p>`))}
    ${block('Photos', detail.photos.map((row) => `<p><a href="/photo.html?lead=${encodeURIComponent(row.lead_id)}">${esc(row.lead_id)}</a><span>${esc(when(row.created_at))}</span></p>`))}
    ${block('Forms', detail.forms.map((row) => `<p><a href="/form-print.html?id=${encodeURIComponent(row.id)}">${esc(row.template_name)}</a> ${esc(row.homeowner_name || '')}<span>${esc(when(row.created_at))}</span></p>`))}
  </div>`;
}

function when(iso) {
  try { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)); }
  catch { return ''; }
}

async function post(body) {
  const response = await fetch('/api/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Could not update that account.');
  return data;
}

async function createAccount(event) {
  event.preventDefault();
  notice = '';
  try {
    await post({
      action: 'create',
      name: document.getElementById('acctName').value,
      email: document.getElementById('acctEmail').value,
      role: document.getElementById('acctRole').value,
      password: document.getElementById('acctPassword').value
    });
    notice = 'Login created. Ask them to change the password under My account.';
    resetId = '';
    detail = null;
    openLink = null;
    await show();
  } catch (error) {
    notice = error.message;
    render();
  }
}

async function act(action, repId) {
  const person = people.find((item) => item.id === repId);
  notice = '';
  openLink = null;
  try {
    if (action === 'reset') {
      resetId = repId;
      render();
      return;
    } else if (action === 'active') {
      await post({ action: 'set-active', repId, active: !person.active });
      notice = person.active ? 'Login turned off.' : 'Login turned on.';
    } else if (action === 'open') {
      const result = await post({ action: 'open-as', repId });
      openLink = { id: repId, url: result.url, name: result.name || person?.name || '' };
      notice = 'Sign-in link ready.';
    } else if (action === 'work') {
      detail = { id: repId, activity: [], photos: [], forms: [] };
      const [activity, photos, forms] = await Promise.all([
        sb.from('lead_activity').select('action,lead_id,created_at').eq('actor_id', repId).order('created_at', { ascending: false }).limit(12),
        sb.from('lead_photos').select('id,lead_id,created_at').eq('uploaded_by', repId).order('created_at', { ascending: false }).limit(12),
        sb.from('form_submissions').select('id,template_name,homeowner_name,created_at').eq('submitted_by', repId).order('created_at', { ascending: false }).limit(12)
      ]);
      detail.activity = activity.data || [];
      detail.photos = photos.data || [];
      detail.forms = forms.data || [];
    }
    if (action !== 'work') detail = null;
    await refreshPeople();
    render();
    if (openLink) document.getElementById('tnCopyLink').onclick = copyLink;
  } catch (error) {
    notice = error.message;
    render();
  }
}

async function saveReset(event, repId, password) {
  event.preventDefault();
  notice = '';
  try {
    await post({ action: 'reset', repId, password });
    resetId = '';
    notice = 'Password reset.';
    render();
  } catch (error) {
    notice = error.message;
    render();
  }
}

async function refreshPeople() {
  const listed = await sb.from('reps').select('id,user_id,name,email,role,active').order('name');
  if (!listed.error) people = listed.data || [];
}

async function copyLink() {
  try { await navigator.clipboard.writeText(openLink.url); notice = 'Link copied.'; }
  catch { notice = openLink.url; }
  render();
  document.getElementById('tnCopyLink').onclick = copyLink;
}

mount();

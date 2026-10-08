import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const $ = (id) => document.getElementById(id);
const ALLOWED = ['appointment_setter', 'canvasser', 'salesperson', 'manager', 'admin'];

let cfg;
let sb;
let session;
let rep;
const params = new URLSearchParams(location.search);
let leadParam = params.get('lead');

async function loadConfig() {
  const response = await fetch('/api/config');
  return response.json();
}

async function load() {
  cfg = await loadConfig();
  if (!cfg.configured) {
    $('loginError').textContent = 'Cloud is not configured for this deployment.';
    return;
  }
  sb = createClient(cfg.url, cfg.publishableKey);
  const { data } = await sb.auth.getSession();
  if (data.session) await enter(data.session);
  sb.auth.onAuthStateChange((_event, next) => { if (next) enter(next); });
}

function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts.at(-1) };
}

async function enter(nextSession) {
  session = nextSession;
  const { data, error } = await sb.from('reps').select('id,user_id,name,role,active,created_at').eq('user_id', nextSession.user.id).eq('active', true).maybeSingle();
  if (error || !data) {
    $('loginError').textContent = 'Your account is signed in, but there is no active True North team profile for it.';
    return;
  }
  rep = data;
  try {
    if (nextSession.user?.id && rep.role) localStorage.setItem(`tn-role:${nextSession.user.id}`, rep.role);
  } catch { /* storage unavailable */ }
  const manageLink = document.querySelector('a.tnManageLink');
  if (manageLink) {
    const office = rep.role === 'admin';
    manageLink.hidden = !office;
    manageLink.classList.toggle('hidden', !office);
  }
  if (!ALLOWED.includes(rep.role)) {
    $('loginError').textContent = 'This account is not enabled for the field intake workflow.';
    return;
  }
  $('loginCard').classList.add('hidden');
  $('setterApp').classList.remove('hidden');
  $('whoAmI').textContent = `Signed in as ${rep.name} · ${rep.role}`;
  const listed = await sb.from('reps').select('id,name,role,active').eq('active', true).order('name');
  const sales = (listed.data || []).filter((row) => ['salesperson', 'manager', 'admin'].includes(row.role));
  $('salesperson').innerHTML = '<option value="">Select salesperson</option>' + sales.map((row) => `<option value="${row.id}">${row.name} · ${row.role}</option>`).join('');
  if (leadParam) {
    $('lead_id').value = leadParam;
    const { data: lead } = await sb.from('leads').select('id,name,address,city,state,zip,notes').eq('id', leadParam).maybeSingle();
    if (lead) {
      const name = splitName(lead.name);
      if (name.first) $('s_first_name').value = name.first;
      if (name.last) $('s_last_name').value = name.last;
      $('address').value = lead.address || '';
      $('city').value = lead.city || 'Mount Vernon';
      $('state').value = lead.state || 'OH';
      $('zip').value = lead.zip || '';
      if (lead.notes) $('s_notes').value = lead.notes;
    }
  }
  await metrics();
}

async function metrics() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const { data: acts } = await sb.from('lead_activity').select('metadata,created_at').eq('actor_id', rep.id).gte('created_at', start.toISOString());
  const { data: appts } = await sb.from('appointments').select('id').eq('canvasser_id', rep.id).gte('created_at', start.toISOString());
  $('todayWorked').textContent = (acts || []).filter((row) => ['Knocked', 'No Answer', 'Interested', 'Not Interested', 'Do Not Knock'].includes(row.metadata?.to_status)).length;
  $('todayAppts').textContent = (appts || []).length;
}

async function submit(event) {
  event.preventDefault();
  $('saveError').textContent = '';
  $('saveStatus').textContent = 'Saving…';
  const form = $('setterForm');
  const data = Object.fromEntries(new FormData(form).entries());
  data.homeowner_confirmed = form.querySelector('[name=homeowner_confirmed]').checked;
  data.consent_contact = form.querySelector('[name=consent_contact]').checked;
  data.lead_id = leadParam || '';
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  try {
    const response = await fetch('/api/inspection', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify(data)
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Could not save the inspection.');
    $('saveStatus').textContent = payload.updated ? 'Updated the homeowner profile ✓' : 'Saved ✓';
    await metrics();
    setTimeout(() => {
      $('saveStatus').textContent = '';
      form.reset();
      $('city').value = 'Mount Vernon';
      $('state').value = 'OH';
      leadParam = null;
      $('lead_id').value = '';
      history.replaceState({}, '', location.pathname);
    }, 900);
  } catch (error) {
    $('saveError').textContent = error.message || 'Could not save the inspection.';
    $('saveStatus').textContent = '';
  } finally {
    button.disabled = false;
  }
}

$('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('loginError').textContent = 'Signing in…';
  const result = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
  if (result.error) $('loginError').textContent = result.error.message;
});

$('signOut').onclick = () => {
  try { if (session?.user) localStorage.removeItem(`tn-role:${session.user.id}`); } catch { /* storage unavailable */ }
  (sb ? sb.auth.signOut() : Promise.resolve()).then(() => location.reload());
};

$('setterForm').addEventListener('submit', submit);
$('clearForm').onclick = () => {
  leadParam = null;
  $('lead_id').value = '';
  $('setterForm').reset();
  $('city').value = 'Mount Vernon';
  $('state').value = 'OH';
};

load();

import {
  canManageAccount,
  normalizeEmail,
  validateEmail,
  validateName,
  validatePassword
} from '../lib/account-rules.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

function fail(message, status) {
  const error = new Error(message);
  error.status = status;
  error.public = true;
  return error;
}

function cloud(env) {
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const apikey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '';
  const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!base || !apikey || !secret) throw fail('Account tools are not configured yet.', 503);
  return { base, apikey, secret };
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { message: text.slice(0, 180) }; }
}

function authHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json' };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function caller(request, env, fetchImpl) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw fail('Sign in required.', 401);
  const { base, apikey, secret } = cloud(env);
  if (token === secret) throw fail('Sign in required.', 401);
  const userResponse = await fetchImpl(`${base}/auth/v1/user`, {
    headers: { apikey, Authorization: `Bearer ${token}` }
  });
  if (!userResponse.ok) throw fail('Sign in required.', 401);
  const user = await readJson(userResponse);
  if (!user?.id) throw fail('Sign in required.', 401);
  const repsResponse = await fetchImpl(`${base}/rest/v1/reps?user_id=eq.${user.id}&active=eq.true&select=id,name,email,role&limit=1`, {
    headers: { ...authHeaders(apikey), Authorization: `Bearer ${token}` }
  });
  if (!repsResponse.ok) throw fail('Sign in required.', 401);
  const rows = await readJson(repsResponse);
  const rep = Array.isArray(rows) ? rows[0] : null;
  if (!rep?.id || !['admin', 'manager'].includes(rep.role)) throw fail('Only an admin or manager can do that.', 403);
  return { token, user, rep };
}

async function serviceFetch(env, fetchImpl, path, { method = 'GET', body, admin = false } = {}) {
  const { base, secret } = cloud(env);
  const url = `${base}${admin ? '/auth/v1' : '/rest/v1'}${path}`;
  const response = await fetchImpl(url, {
    method,
    headers: { ...authHeaders(secret), Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await readJson(response);
  if (!response.ok) {
    const message = data?.msg || data?.message || data?.error_description || 'The account service rejected that request.';
    throw fail(String(message).slice(0, 180), response.status >= 500 ? 502 : 400);
  }
  return data;
}

async function findAuthUser(env, fetchImpl, email) {
  for (let page = 1; page <= 20; page += 1) {
    const data = await serviceFetch(env, fetchImpl, `/admin/users?page=${page}&per_page=200`, { admin: true });
    const users = data?.users || [];
    const found = users.find((user) => normalizeEmail(user.email) === email);
    if (found) return found;
    if (users.length < 200) return null;
  }
  return null;
}

async function audit(env, fetchImpl, row) {
  await serviceFetch(env, fetchImpl, '/account_audit', { method: 'POST', body: row });
}

async function repById(env, fetchImpl, id) {
  if (!UUID.test(String(id || ''))) throw fail('That person was not found.', 404);
  const rows = await serviceFetch(env, fetchImpl, `/reps?id=eq.${id}&select=id,user_id,name,email,role,active&limit=1`);
  return Array.isArray(rows) ? rows[0] : null;
}

export async function handleAccounts(request, { env = process.env, fetchImpl = fetch } = {}) {
  try {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const actor = await caller(request, env, fetchImpl);
    let body;
    try { body = await request.json(); } catch { throw fail('Invalid request.', 400); }
    const action = String(body.action || '');
    if (action === 'create') return json(await createLogin(actor, body, env, fetchImpl));
    if (action === 'reset') return json(await resetPassword(actor, body, env, fetchImpl));
    if (action === 'set-active') return json(await setActive(actor, body, env, fetchImpl));
    if (action === 'open-as') return json(await openAs(actor, body, request, env, fetchImpl));
    throw fail('Unknown action.', 400);
  } catch (error) {
    const status = error.status || 500;
    return json({ error: error.public ? error.message : 'Could not update that account.' }, status);
  }
}

async function saveRep(env, fetchImpl, row) {
  try {
    const rows = await serviceFetch(env, fetchImpl, '/reps', { method: 'POST', body: row });
    return Array.isArray(rows) ? rows[0] : rows;
  } catch (error) {
    const message = String(error.message || '').toLowerCase();
    if (!message.includes('duplicate') && !message.includes('already')) throw error;
    const existing = await serviceFetch(env, fetchImpl, `/reps?user_id=eq.${row.user_id}&select=id&limit=1`);
    const found = Array.isArray(existing) ? existing[0] : null;
    if (!found?.id) throw fail('That email already has a login.', 409);
    const rows = await serviceFetch(env, fetchImpl, `/reps?id=eq.${found.id}`, {
      method: 'PATCH',
      body: { name: row.name, email: row.email, role: row.role, active: true }
    });
    return Array.isArray(rows) ? rows[0] : rows;
  }
}

async function createLogin(actor, body, env, fetchImpl) {
  const name = validateName(body.name);
  const email = validateEmail(body.email);
  const password = validatePassword(body.password);
  const role = String(body.role || '');
  if (!name) throw fail('Enter the person’s name.', 400);
  if (!email) throw fail('Enter a valid email.', 400);
  if (!password) throw fail('Use a password of 8 to 72 characters.', 400);
  if (!canManageAccount(actor.rep.role, role, 'create')) throw fail('You cannot create that kind of account.', 403);
  const existingRep = await serviceFetch(env, fetchImpl, `/reps?email=eq.${encodeURIComponent(email)}&select=id&limit=1`);
  if (Array.isArray(existingRep) && existingRep.length) throw fail('That email already has a login.', 409);

  let authUser = null;
  const created = await fetchImpl(`${cloud(env).base}/auth/v1/admin/users`, {
    method: 'POST',
    headers: authHeaders(cloud(env).secret),
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name } })
  });
  const createdBody = await readJson(created);
  if (created.ok) authUser = createdBody;
  else authUser = await findAuthUser(env, fetchImpl, email);
  if (!authUser?.id) throw fail(createdBody?.msg || createdBody?.message || 'Could not create that login.', 400);

  const rep = await saveRep(env, fetchImpl, { user_id: authUser.id, name, email, role, active: true });
  await audit(env, fetchImpl, {
    actor_rep_id: actor.rep.id,
    target_rep_id: rep?.id || null,
    action: 'user_created',
    target_email: email,
    metadata: { role }
  });
  return { ok: true, rep };
}

async function resetPassword(actor, body, env, fetchImpl) {
  const password = validatePassword(body.password);
  if (!password) throw fail('Use a password of 8 to 72 characters.', 400);
  const target = await repById(env, fetchImpl, body.repId);
  if (!target) throw fail('That person was not found.', 404);
  if (!canManageAccount(actor.rep.role, target.role, 'reset')) throw fail('You cannot reset that password.', 403);
  await serviceFetch(env, fetchImpl, `/admin/users/${target.user_id}`, {
    admin: true,
    method: 'PUT',
    body: { password }
  });
  await audit(env, fetchImpl, {
    actor_rep_id: actor.rep.id,
    target_rep_id: target.id,
    action: 'password_reset',
    target_email: target.email || '',
    metadata: { role: target.role }
  });
  return { ok: true };
}

async function setActive(actor, body, env, fetchImpl) {
  const active = body.active === true;
  const target = await repById(env, fetchImpl, body.repId);
  if (!target) throw fail('That person was not found.', 404);
  if (target.id === actor.rep.id) throw fail('You cannot turn off your own login.', 400);
  const action = active ? 'reactivate' : 'deactivate';
  if (!canManageAccount(actor.rep.role, target.role, action)) throw fail('You cannot change that login.', 403);
  await serviceFetch(env, fetchImpl, `/admin/users/${target.user_id}`, {
    admin: true,
    method: 'PUT',
    body: { ban_duration: active ? 'none' : '876000h' }
  });
  await serviceFetch(env, fetchImpl, `/reps?id=eq.${target.id}`, { method: 'PATCH', body: { active } });
  await audit(env, fetchImpl, {
    actor_rep_id: actor.rep.id,
    target_rep_id: target.id,
    action: active ? 'user_reactivated' : 'user_deactivated',
    target_email: target.email || '',
    metadata: { role: target.role }
  });
  return { ok: true, active };
}

async function openAs(actor, body, request, env, fetchImpl) {
  const target = await repById(env, fetchImpl, body.repId);
  if (!target) throw fail('That person was not found.', 404);
  if (!target.active) throw fail('Turn this login back on before opening it.', 400);
  if (target.id === actor.rep.id) throw fail('You are already signed in as yourself.', 400);
  if (!canManageAccount(actor.rep.role, target.role, 'open_as')) throw fail('Only an admin can open another account.', 403);
  const origin = new URL(request.url).origin;
  const link = await serviceFetch(env, fetchImpl, '/admin/generate_link', {
    admin: true,
    method: 'POST',
    body: { type: 'magiclink', email: target.email, options: { redirect_to: `${origin}/` } }
  });
  const url = link?.action_link || '';
  if (!url) throw fail('Could not create a one-time sign-in link.', 502);
  await audit(env, fetchImpl, {
    actor_rep_id: actor.rep.id,
    target_rep_id: target.id,
    action: 'open_as',
    target_email: target.email || '',
    metadata: { role: target.role }
  });
  return { ok: true, url, email: target.email, name: target.name };
}

export default {
  async fetch(request) {
    return handleAccounts(request);
  }
};

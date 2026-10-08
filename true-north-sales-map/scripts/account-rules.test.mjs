import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BOOTSTRAP_ADMIN_EMAILS,
  MANAGEMENT_LINKS,
  canManageAccount,
  canOpenManagement,
  managementProfile,
  validateEmail,
  validatePassword
} from '../lib/account-rules.js';
import { adminHashTarget, bindAdminTabs } from '../lib/admin-tabs.js';
import { handleAccounts } from '../api/accounts.js';
import { buildSetupSql } from './build-setup-sql.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

assert.equal(canManageAccount('manager', 'salesperson', 'create'), true);
assert.equal(canManageAccount('manager', 'appointment_setter', 'reset'), true);
assert.equal(canManageAccount('manager', 'canvasser', 'deactivate'), true);
assert.equal(canManageAccount('manager', 'admin', 'create'), false);
assert.equal(canManageAccount('manager', 'manager', 'reset'), false);
assert.equal(canManageAccount('manager', 'salesperson', 'open_as'), false);
assert.equal(canManageAccount('admin', 'admin', 'create'), true);
assert.equal(canManageAccount('admin', 'manager', 'reset'), true);
assert.equal(canManageAccount('admin', 'salesperson', 'open_as'), true);
assert.equal(canManageAccount('salesperson', 'canvasser', 'create'), false);
assert.equal(validatePassword('short'), '');
assert.equal(validatePassword('long-enough'), 'long-enough');
assert.equal(validateEmail(' TravisBishopMackie@gmail.com '), 'travisbishopmackie@gmail.com');
assert.deepEqual(BOOTSTRAP_ADMIN_EMAILS, ['travisbishopmackie@gmail.com', 'truenorthrestorationss@gmail.com']);

const accountsSql = read('supabase/accounts.sql');
for (const email of BOOTSTRAP_ADMIN_EMAILS) assert.ok(accountsSql.includes(email));
assert.ok(accountsSql.includes('account_audit'));
assert.ok(accountsSql.includes('reps_bootstrap_admin'));
assert.ok(accountsSql.includes('open_as'));

const setup = read('supabase/setup_all.sql');
assert.equal(setup, buildSetupSql(root));
const repsAt = setup.indexOf('create table if not exists public.reps');
const shiftsAt = setup.indexOf('create table if not exists public.shifts');
const photosAt = setup.indexOf('create table if not exists public.lead_photos');
const auditAt = setup.indexOf('create table if not exists public.account_audit');
assert.ok(repsAt >= 0 && repsAt < shiftsAt && shiftsAt < photosAt && photosAt < auditAt);

const ADMIN_USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MANAGER_USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN_REP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MANAGER_REP = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SALES_REP = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SALES_USER = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const NEW_USER = '11111111-1111-4111-8111-111111111111';
const NEW_REP = '22222222-2222-4222-8222-222222222222';
const people = {
  [SALES_REP]: { id: SALES_REP, user_id: SALES_USER, name: 'Sam Sales', email: 'sam@example.com', role: 'salesperson', active: true },
  [ADMIN_REP]: { id: ADMIN_REP, user_id: ADMIN_USER, name: 'Ian', email: 'travisbishopmackie@gmail.com', role: 'admin', active: true }
};

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function run(action, body, token, extraEnv = {}) {
  const calls = [];
  const env = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
    SUPABASE_SECRET_KEY: 'service-role-secret',
    ...extraEnv
  };
  async function fetchImpl(url, options = {}) {
    const method = options.method || 'GET';
    calls.push({ url: String(url), method, headers: options.headers || {}, body: options.body || '' });
    const u = String(url);
    if (u.endsWith('/auth/v1/user')) {
      const bearer = options.headers.Authorization || '';
      if (bearer.endsWith('admin-token')) return response({ id: ADMIN_USER });
      if (bearer.endsWith('manager-token')) return response({ id: MANAGER_USER });
      return response({ message: 'no' }, 401);
    }
    if (u.includes('/rest/v1/reps?user_id=')) {
      if (u.includes(ADMIN_USER)) return response([{ id: ADMIN_REP, role: 'admin', name: 'Ian', email: 'travisbishopmackie@gmail.com' }]);
      if (u.includes(MANAGER_USER)) return response([{ id: MANAGER_REP, role: 'manager', name: 'Pat', email: 'pat@example.com' }]);
      return response([]);
    }
    if (u.includes('/rest/v1/reps?email=')) return response([]);
    if (u.includes('/rest/v1/reps?id=eq.') && method === 'GET') {
      const id = u.split('id=eq.')[1].split('&')[0];
      return response(people[id] ? [people[id]] : []);
    }
    if (u.endsWith('/auth/v1/admin/users') && method === 'POST') return response({ id: NEW_USER });
    if (u.endsWith('/rest/v1/reps') && method === 'POST') return response([{ id: NEW_REP, role: 'salesperson' }]);
    if (u.includes('/rest/v1/account_audit') && method === 'POST') return response([{}]);
    if (u.includes('/admin/generate_link') && method === 'POST') return response({ action_link: 'https://example.supabase.co/auth/v1/verify?token=once&type=magiclink' });
    if (u.includes('/auth/v1/admin/users/') && method === 'PUT') return response({});
    if (u.includes('/rest/v1/reps?id=eq.') && method === 'PATCH') return response([{}]);
    throw new Error(`unexpected ${method} ${u}`);
  }
  const result = await handleAccounts(new Request('https://map.example/api/accounts', {
    method: 'POST',
    headers: { authorization: token ? `Bearer ${token}` : '', 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...body })
  }), { env, fetchImpl });
  return { status: result.status, body: await result.json(), calls };
}

const missing = await run('create', {}, '');
assert.equal(missing.status, 401);

const managerCreate = await run('create', {
  name: 'Sam Sales', email: 'sam@example.com', role: 'salesperson', password: 'first-password'
}, 'manager-token');
assert.equal(managerCreate.status, 200);
assert.ok(managerCreate.calls.some((call) => call.url.endsWith('/auth/v1/admin/users') && call.method === 'POST'));
assert.ok(!JSON.stringify(managerCreate.body).includes('service-role-secret'));
const audit = managerCreate.calls.find((call) => call.url.includes('account_audit'));
assert.ok(audit);
assert.equal(JSON.parse(audit.body).action, 'user_created');
assert.ok(!audit.body.includes('first-password'));

const managerAdmin = await run('create', {
  name: 'Other Admin', email: 'other@example.com', role: 'admin', password: 'first-password'
}, 'manager-token');
assert.equal(managerAdmin.status, 403);
assert.ok(!managerAdmin.calls.some((call) => call.url.includes('/admin/users')));

const managerOpen = await run('open-as', { repId: SALES_REP }, 'manager-token');
assert.equal(managerOpen.status, 403);
assert.ok(!managerOpen.calls.some((call) => call.url.includes('generate_link')));

const adminOpen = await run('open-as', { repId: SALES_REP }, 'admin-token');
assert.equal(adminOpen.status, 200);
assert.equal(adminOpen.body.url, 'https://example.supabase.co/auth/v1/verify?token=once&type=magiclink');
assert.ok(!JSON.stringify(adminOpen.body).includes('service-role-secret'));
const openAudit = adminOpen.calls.find((call) => call.url.includes('account_audit'));
assert.equal(JSON.parse(openAudit.body).action, 'open_as');
assert.equal(JSON.parse(openAudit.body).actor_rep_id, ADMIN_REP);

const selfOff = await run('set-active', { repId: ADMIN_REP, active: false }, 'admin-token');
assert.equal(selfOff.status, 400);

const userCall = adminOpen.calls.find((call) => call.url.endsWith('/auth/v1/user'));
assert.equal(userCall.headers.Authorization, 'Bearer admin-token');
assert.ok(!userCall.headers.apikey.includes('service-role'));

const fallback = await run('create', {
  name: 'Sam Sales', email: 'sam@example.com', role: 'salesperson', password: 'first-password'
}, 'manager-token', { SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret' });
assert.equal(fallback.status, 200);
const secretHeader = fallback.calls.find((call) => call.url.endsWith('/auth/v1/admin/users'));
assert.equal(secretHeader.headers.apikey, 'service-role-secret');
assert.ok(!JSON.stringify(fallback.body).includes('service-role-secret'));

function fakeTab(tab) {
  const listeners = [];
  return {
    dataset: { tab },
    addEventListener(_type, fn) { listeners.push(fn); },
    click() { listeners.forEach((fn) => fn()); },
    listeners
  };
}

const overview = fakeTab('overview');
const accounts = fakeTab('accounts');
const shown = [];
accounts.dataset.tnTabBound = '1';
accounts.addEventListener('click', () => shown.push('accounts-form'));
const tabRoot = { querySelectorAll: (selector) => selector === '[data-tab]' ? [overview, accounts] : [] };
bindAdminTabs(tabRoot, (tab) => shown.push(`showTab:${tab}`));
bindAdminTabs(tabRoot, (tab) => shown.push(`showTab:${tab}`));
accounts.click();
overview.click();
assert.deepEqual(shown, ['accounts-form', 'showTab:overview']);
assert.equal(accounts.listeners.length, 1);
assert.equal(overview.listeners.length, 1);

const adminHtml = read('admin.html');
const accountsJs = read('tn-files/accounts-admin.js');
assert.ok(adminHtml.includes('bindAdminTabs(document, showTab)'));
assert.ok(!adminHtml.includes("querySelectorAll('[data-tab]').forEach(b=>b.onclick"));
assert.ok(adminHtml.includes('Add setter or rep'));
const mountSource = accountsJs.slice(accountsJs.indexOf('function mount'), accountsJs.indexOf('let sb'));
assert.ok(mountSource.includes("addEventListener('click'"));
assert.ok(mountSource.includes("dataset.tnTabBound = '1'"));
assert.ok(!mountSource.includes('.onclick'));
assert.ok(read('field-ops.js').includes("link.textContent = 'Management'"));
assert.ok(read('field-ops.js').includes("link.href = '/admin'"));
assert.ok(read('field-ops.js').includes('tnMoreAdmin'));

for (const email of BOOTSTRAP_ADMIN_EMAILS) {
  const missing = managementProfile({ email, rep: null, userId: 'user-1' });
  assert.equal(missing.role, 'admin');
  assert.equal(missing.active, true);
  assert.equal(missing.email, email);
  assert.equal(canOpenManagement({ email, rep: null, adminEmails: BOOTSTRAP_ADMIN_EMAILS }), true);
}
const travis = managementProfile({
  email: 'TravisBishopMackie@gmail.com',
  rep: { id: 'rep-travis', role: 'salesperson', name: 'Travis Mackie', active: true },
  userId: 'user-travis'
});
assert.equal(travis.role, 'admin');
assert.equal(travis.name, 'Travis Mackie');
assert.equal(travis.id, 'rep-travis');
assert.equal(canOpenManagement({
  email: 'travisbishopmackie@gmail.com',
  rep: null,
  adminEmails: ['other@example.com']
}), false);
assert.equal(canOpenManagement({
  email: 'ada@example.com',
  rep: { role: 'appointment_setter', email: 'ada@example.com' },
  adminEmails: BOOTSTRAP_ADMIN_EMAILS
}), false);
assert.equal(canOpenManagement({
  email: 'sam@example.com',
  rep: { role: 'salesperson', email: 'sam@example.com' },
  adminEmails: [...BOOTSTRAP_ADMIN_EMAILS, 'sam@example.com']
}), false);
assert.equal(canOpenManagement({
  email: 'mgr@example.com',
  rep: { role: 'manager', email: 'mgr@example.com' },
  adminEmails: [...BOOTSTRAP_ADMIN_EMAILS, 'mgr@example.com']
}), true);
assert.equal(canOpenManagement({
  email: 'boss@example.com',
  rep: { role: 'admin', email: 'boss@example.com' },
  adminEmails: BOOTSTRAP_ADMIN_EMAILS
}), false);
assert.equal(canOpenManagement({
  email: 'boss@example.com',
  rep: { role: 'admin', email: 'boss@example.com' },
  adminEmails: []
}), true);
assert.deepEqual(MANAGEMENT_LINKS.map((link) => [link.href, link.label]), [
  ['/admin#accounts', 'Accounts'],
  ['/admin#team', 'Team & roles'],
  ['/admin#files', 'Documents'],
  ['/admin#messages', 'Messages from the field'],
  ['/admin#builder', 'Form library'],
  ['/admin#library', 'Document folders']
]);
assert.deepEqual(adminHashTarget('#accounts'), { tab: 'accounts', messages: false, builder: false });
assert.deepEqual(adminHashTarget('#team'), { tab: 'team', messages: false, builder: false });
assert.deepEqual(adminHashTarget('#files'), { tab: 'files', messages: false, builder: false });
assert.equal(adminHashTarget('#messages').messages, true);
assert.equal(adminHashTarget('#messages').tab, 'overview');
assert.equal(adminHashTarget('#builder').builder, true);
assert.equal(adminHashTarget('#builder').tab, 'files');
assert.equal(adminHashTarget('#property=18%20public').tab, 'files');
assert.ok(read('tn-files/account-page.js').includes('Management dashboard'));
assert.ok(adminHtml.includes('function applyAdminHash'));
assert.ok(adminHtml.includes('managementProfile'));
const openAdmin = read('app.js').slice(read('app.js').indexOf('function openAdmin'), read('app.js').indexOf('function renderTerritoryAdmin'));
assert.ok(openAdmin.includes("accounts.href='/admin#accounts'"));
const indexHtml = read('index.html');
assert.ok(indexHtml.includes('id="postSignIn"'));
assert.ok(indexHtml.includes('id="adminAccountsLink"'));
assert.ok(indexHtml.includes('>Management</a>'));

console.log('account-rules tests ok');

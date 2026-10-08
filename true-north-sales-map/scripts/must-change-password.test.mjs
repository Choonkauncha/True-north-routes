import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MUST_CHANGE_BACKFILL_EMAIL,
  PASSWORD_REUSE,
  PASSWORD_SAVED,
  canClearMustChange,
  impersonationAllowed,
  isOtherAdmin,
  needsPasswordGate,
  passwordGateProblem,
  passwordUpdateError,
  sameAccount
} from '../lib/must-change-password.js';
import {
  cachedRole,
  earlyManagementDecision,
  forgetRole,
  rememberRole
} from '../lib/management-gate.js';
import { passwordGateMarkup } from '../tn-files/password-gate.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

const TRAVIS = { id: 'rep-travis', userId: 'user-travis', role: 'admin' };
const SPENCER = { id: 'rep-spencer', userId: 'user-spencer', role: 'admin' };
const SAM = { id: 'rep-sam', userId: 'user-sam', role: 'salesperson' };

assert.equal(needsPasswordGate({ mustChange: true, impersonating: false }), true);
assert.equal(needsPasswordGate({ mustChange: true, impersonating: true }), false);
assert.equal(needsPasswordGate({ mustChange: false, impersonating: false }), false);
assert.equal(needsPasswordGate({}), false);

assert.equal(canClearMustChange({
  mustChange: true,
  passwordChangedAt: '2026-10-08T12:00:00.000Z',
  mustChangeSetAt: '2026-10-08T11:00:00.000Z'
}), true);
assert.equal(canClearMustChange({
  mustChange: true,
  passwordChangedAt: '2026-10-08T11:00:00.000Z',
  mustChangeSetAt: '2026-10-08T12:00:00.000Z'
}), false);
assert.equal(canClearMustChange({ mustChange: true, passwordChangedAt: null, mustChangeSetAt: '2026-10-08T12:00:00.000Z' }), false);
assert.equal(canClearMustChange({ mustChange: false }), true);

assert.equal(impersonationAllowed([{ method: 'otp' }]), true);
assert.equal(impersonationAllowed([{ method: 'magiclink' }]), true);
assert.equal(impersonationAllowed([{ method: 'password' }]), false);
assert.equal(impersonationAllowed([{ method: 'otp' }, { method: 'password' }]), false);
assert.equal(impersonationAllowed([]), false);

assert.equal(sameAccount(TRAVIS, { id: 'rep-travis', user_id: 'other' }), true);
assert.equal(sameAccount({ user_id: 'user-spencer' }, SPENCER), true);
assert.equal(isOtherAdmin(TRAVIS, SPENCER), true);
assert.equal(isOtherAdmin(SPENCER, SPENCER), false);
assert.equal(isOtherAdmin(TRAVIS, SAM), false);
assert.equal(isOtherAdmin({ userId: 'user-sam', role: 'manager' }, SPENCER), true);

const secret = 'typed-secret-value';
assert.equal(passwordUpdateError({ message: `Password should be different from ${secret}` }, secret).includes(secret), false);
assert.equal(passwordUpdateError({ message: 'New password should be different from the old password.' }, secret), PASSWORD_REUSE);
assert.equal(passwordGateProblem('short', 'short'), 'Use 8 to 72 characters.');
assert.equal(passwordGateProblem('long-enough', 'different1'), 'Those passwords do not match.');
assert.equal(passwordGateProblem('long-enough', 'long-enough'), '');

const form = passwordGateMarkup();
assert.ok(form.includes('Choose a new password'));
assert.ok(form.includes('Show'));
assert.ok(form.includes('Sign out'));
assert.equal(form.includes(secret), false);
const saved = passwordGateMarkup({ done: true });
assert.ok(saved.includes('Password saved'));
assert.ok(saved.includes(PASSWORD_SAVED));
assert.equal(saved.includes('<form'), false);

function memoryStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key(index) { return [...map.keys()][index] ?? null; },
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); }
  };
}

function sessionJson(id, extra = {}) {
  return JSON.stringify({ access_token: 'token', user: { id, email: 'person@example.com' }, ...extra });
}

assert.equal(earlyManagementDecision(memoryStorage()), 'redirect');
assert.equal(earlyManagementDecision(memoryStorage({
  'sb-qdovtewieuojjsebipex-auth-token': sessionJson('user-sam'),
  'tn-role:user-sam': 'salesperson'
})), 'redirect');
assert.equal(earlyManagementDecision(memoryStorage({
  'sb-qdovtewieuojjsebipex-auth-token': sessionJson('user-travis'),
  'tn-role:user-travis': 'admin'
})), 'wait');
assert.equal(earlyManagementDecision(memoryStorage({
  'sb-qdovtewieuojjsebipex-auth-token': sessionJson('user-pat'),
  'tn-role:user-pat': 'manager'
})), 'redirect');
assert.equal(earlyManagementDecision(memoryStorage({
  'sb-qdovtewieuojjsebipex-auth-token': sessionJson('user-new')
})), 'wait');

const chunked = memoryStorage({ 'sb-ref-auth-token': '' });
const raw = sessionJson('user-chunk');
chunked.setItem('sb-ref-auth-token.0', raw.slice(0, 20));
chunked.setItem('sb-ref-auth-token.1', raw.slice(20));
chunked.setItem('tn-role:user-chunk', 'admin');
assert.equal(earlyManagementDecision(chunked), 'wait');

const store = memoryStorage();
rememberRole(store, 'user-1', 'admin');
assert.equal(cachedRole(store, 'user-1'), 'admin');
forgetRole(store, 'user-1');
assert.equal(cachedRole(store, 'user-1'), '');

const sql = read('supabase/migrations/20261008_must_change_password.sql');
assert.equal(MUST_CHANGE_BACKFILL_EMAIL, 'truenorthrestorationss@gmail.com');
assert.ok(sql.includes(MUST_CHANGE_BACKFILL_EMAIL));
assert.equal(sql.includes("lower(email) = 'travisbishopmackie@gmail.com'"), false);
assert.ok(sql.includes('clear_must_change_password'));
assert.ok(sql.includes('row.password_changed_at <= row.must_change_set_at'));
assert.ok(sql.includes("raise exception 'Only that admin can change this account'"));
assert.ok(sql.includes("raise exception 'You cannot promote yourself to admin'"));
assert.ok(sql.includes('account_directory'));
assert.ok(sql.includes("r.role = 'admin' and r.user_id is distinct from auth.uid() then null else r.email"));
assert.ok(sql.includes('hides_admin_audit'));
assert.ok(sql.includes('claim_impersonation'));
assert.ok(sql.includes("and must_change_password = false"));
assert.ok(sql.includes('and password_changed_at is null'));
const backfill = sql.slice(sql.lastIndexOf('update public.reps'));
assert.equal(backfill.includes('travisbishopmackie'), false);

const adminHtml = read('admin.html');
assert.ok(adminHtml.includes('#auth{display:none!important}'));
assert.ok(adminHtml.includes("location.replace('/')"));
assert.ok(adminHtml.includes('tn-role:'));
assert.ok(adminHtml.includes("key+'.'+n"));
assert.equal(adminHtml.toLowerCase().includes('not authorized'), false);
const leave = adminHtml.slice(adminHtml.indexOf('function leaveAdmin'), adminHtml.indexOf('function rememberAdminRole'));
assert.equal(leave.includes('signOut'), false);
assert.ok(leave.includes("location.replace('/')"));
assert.ok(adminHtml.includes('if(!canOpenManagement({email,rep:profile,adminEmails:cfg.adminEmails})){leaveAdmin();return}'));

const pages = {
  'index.html': 'id="adminBtn" href="/admin" class="adminBtn hidden" hidden>Management</a>',
  'account.html': 'class="tnManageLink hidden" href="/admin" hidden>Management</a>',
  'setter.html': 'class="tnManageLink hidden" href="/admin" hidden>Management</a>',
  'shifts.html': 'class="tnManageLink hidden" href="/admin" hidden>Management</a>',
  'files.html': 'class="tnManageLink hidden" href="/admin" hidden>Management</a>'
};
for (const [path, snippet] of Object.entries(pages)) {
  assert.ok(read(path).includes(snippet), path);
}
assert.equal(read('reset-password.html').includes('/admin'), false);
const inspectionForm = read('tn-files/inspection-form.js');
assert.ok(inspectionForm.includes('manageLink.hidden = !office'));
assert.ok(inspectionForm.includes("const office = rep.role === 'admin'"));
assert.ok(read('field-ops.js').includes("state.status?.rep?.role === 'admin'"));
assert.ok(read('field-ops.js').includes('link.hidden = !allowed'));
assert.ok(read('admin.html').includes("decision=role&&role!=='admin'?'redirect':'wait'"));
assert.ok(read('app.js').includes("$('adminBtn').hidden = !open"));
assert.ok(read('tn-files/accounts-admin.js').includes('Only this admin can open this account.'));
assert.ok(read('tn-files/account-page.js').includes('clear_must_change_password'));
assert.ok(read('tn-files/reset-page.js').includes('clear_must_change_password'));

console.log('must-change-password tests ok');

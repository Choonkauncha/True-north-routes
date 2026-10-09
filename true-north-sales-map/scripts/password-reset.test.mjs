import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePassword } from '../lib/account-rules.js';
import {
  PASSWORD_MISMATCH,
  PASSWORD_RULE,
  PASSWORD_UPDATED,
  RESET_LINK_BAD,
  RESET_SENT,
  passwordChangeError,
  plainPasswordSaveError,
  recoveryFromLocation,
  resetEmailError,
  resetRedirectTo,
  resetRequestMessage
} from '../lib/password-reset.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

assert.equal(passwordChangeError('short', 'short'), PASSWORD_RULE);
assert.equal(passwordChangeError('        ', '        '), PASSWORD_RULE);
assert.equal(passwordChangeError('long-enough', 'other-pass'), PASSWORD_MISMATCH);
assert.equal(passwordChangeError('long-enough', 'long-enough'), '');
assert.equal(validatePassword('long-enough'), passwordChangeError('long-enough', 'long-enough') || 'long-enough');

assert.equal(resetEmailError('not-an-email'), 'Enter the email you use to sign in.');
assert.equal(resetEmailError('rep@example.com'), '');
assert.equal(resetRedirectTo('https://map.example.com/'), 'https://truenorthmaps.vercel.app/reset-password');
assert.equal(resetRedirectTo(), 'https://truenorthmaps.vercel.app/reset-password');
assert.equal(resetRedirectTo('https://old-preview.vercel.app'), 'https://truenorthmaps.vercel.app/reset-password');

assert.deepEqual(resetRequestMessage(null), { ok: true, message: RESET_SENT });
assert.deepEqual(resetRequestMessage({ message: 'User not found' }), { ok: true, message: RESET_SENT });
assert.equal(resetRequestMessage({ message: 'Email rate limit exceeded' }).ok, false);
assert.equal(resetRequestMessage({ message: 'Email rate limit exceeded' }).message.includes('rep@'), false);
assert.equal(RESET_SENT.includes('does not exist'), false);
assert.equal(plainPasswordSaveError({ message: 'New password should be different' }), 'New password should be different');
assert.equal(plainPasswordSaveError({ message: 'boom https://secret.example' }), 'Could not save that password. Request a new reset link.');

assert.equal(recoveryFromLocation({}), 'missing');
assert.equal(recoveryFromLocation({ hash: '#error=access_denied&error_code=otp_expired' }), 'expired');
assert.equal(recoveryFromLocation({ hash: '#type=recovery' }), 'expired');
assert.equal(recoveryFromLocation({ hash: '#access_token=a&refresh_token=b&type=recovery' }), 'present');
assert.equal(recoveryFromLocation({ search: '?code=abc' }), 'present');

const index = read('index.html');
const admin = read('admin.html') + read('admin-dashboard.js');
const card = read('tn-files/ui.js');
const account = read('tn-files/account-page.js');
const resetPage = read('tn-files/reset-page.js');
const sender = read('tn-files/password-reset.js');
assert.ok(index.includes('Forgot password?'));
assert.ok(admin.includes('Forgot password?'));
assert.ok(card.includes('forgotPasswordMarkup()'));
assert.ok(read('tn-files/password-reset.js').includes('Forgot password?'));
assert.ok(read('field-ops.js').includes('Forgot password?'));
assert.ok(sender.includes('resetPasswordForEmail'));
assert.ok(sender.includes('redirectTo'));
assert.ok(resetPage.includes('detectSessionInUrl'));
assert.ok(resetPage.includes('getSessionFromUrl'));
assert.ok(resetPage.includes('updateUser'));
assert.ok(account.includes('passwordChangeError'));
assert.ok(read('reset-password.html').includes('logo-full.webp'));
assert.equal(PASSWORD_UPDATED, 'Password updated. Sign in with your new password.');
assert.ok(RESET_LINK_BAD.includes('missing or expired'));

console.log('password-reset tests ok');

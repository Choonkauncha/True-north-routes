import { validateEmail, validatePassword } from './account-rules.js';

export const RESET_SENT = 'If that email has an account, we sent a reset link.';
export const RESET_LINK_BAD = 'This reset link is missing or expired. Request a new one.';
export const PASSWORD_RULE = 'Use 8 to 72 characters.';
export const PASSWORD_MISMATCH = 'Those passwords do not match.';
export const PASSWORD_UPDATED = 'Password updated. Sign in with your new password.';

export function resetRedirectTo(origin) {
  return `${String(origin || '').replace(/\/$/, '')}/reset-password`;
}

/** Same rules as My account and the admin password reset. */
export function passwordChangeError(first, second) {
  if (!validatePassword(first)) return PASSWORD_RULE;
  if (first !== second) return PASSWORD_MISMATCH;
  return '';
}

/**
 * Map a resetPasswordForEmail result to a message.
 * Success and unknown-account errors use the same sentence so the screen does not reveal whether the email exists.
 */
export function resetRequestMessage(error) {
  if (!error) return { ok: true, message: RESET_SENT };
  const text = String(error.message || error || '').toLowerCase();
  if (/not found|no user|does not exist|invalid/.test(text) && /user|email|account|signup/.test(text)) {
    return { ok: true, message: RESET_SENT };
  }
  if (/rate|too many|once every|security purposes/.test(text)) {
    return { ok: false, message: 'Wait a minute, then try again.' };
  }
  return { ok: false, message: 'Could not send the reset link. Try again.' };
}

export function plainPasswordSaveError(error) {
  const text = String(error?.message || '').trim();
  if (/password/i.test(text) && text.length > 0 && text.length < 140 && !text.includes('http')) return text;
  return 'Could not save that password. Request a new reset link.';
}

/** Classify the URL the reset email opens. Tokens stay in the hash for the implicit flow. */
export function recoveryFromLocation({ hash = '', search = '' } = {}) {
  const hashParams = new URLSearchParams(String(hash).replace(/^#/, ''));
  const query = new URLSearchParams(String(search).replace(/^\?/, ''));
  const error = hashParams.get('error') || hashParams.get('error_code') || query.get('error') || query.get('error_code');
  if (error) return 'expired';
  const type = (hashParams.get('type') || query.get('type') || '').toLowerCase();
  const hasHashTokens = hashParams.has('access_token') && (hashParams.has('refresh_token') || type === 'recovery');
  const hasCode = query.has('code');
  if (type === 'recovery' && !hasHashTokens && !hasCode) return 'expired';
  if (hasHashTokens || hasCode) return 'present';
  return 'missing';
}

export function resetEmailError(value) {
  return validateEmail(value) ? '' : 'Enter the email you use to sign in.';
}

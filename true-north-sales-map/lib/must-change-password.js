import { passwordChangeError, plainPasswordSaveError } from './password-reset.js';

export const MUST_CHANGE_BACKFILL_EMAIL = 'truenorthrestorationss@gmail.com';
export const PASSWORD_REUSE = 'Choose a different password than the one you use now.';
export const PASSWORD_SAVED = 'Password saved.';

/** True when this sign-in must stop on the choose-a-password screen. Impersonation never counts. */
export function needsPasswordGate({ mustChange = false, impersonating = false } = {}) {
  return Boolean(mustChange) && !impersonating;
}

/**
 * The flag clears only after a password change that happened after it was set.
 * An admin reset updates the password and then stamps the flag, so that reset does not count.
 */
export function canClearMustChange({ mustChange = true, passwordChangedAt = null, mustChangeSetAt = null } = {}) {
  if (!mustChange) return true;
  const changed = Date.parse(passwordChangedAt || '');
  const setAt = Date.parse(mustChangeSetAt || '');
  if (!Number.isFinite(changed) || !Number.isFinite(setAt)) return false;
  return changed > setAt;
}

/** Magic-link impersonation is an OTP session. A password sign-in cannot claim it. */
export function impersonationAllowed(amr) {
  const methods = (Array.isArray(amr) ? amr : [])
    .map((item) => String(item?.method || item || '').toLowerCase())
    .filter(Boolean);
  if (!methods.length || methods.includes('password')) return false;
  return methods.includes('otp') || methods.includes('magiclink');
}

export function sameAccount(actor, target) {
  if (!actor || !target) return false;
  const actorUser = actor.userId || actor.user_id || '';
  const targetUser = target.userId || target.user_id || '';
  if (actorUser && targetUser && actorUser === targetUser) return true;
  if (actor.id && target.id && actor.id === target.id) return true;
  return false;
}

/** Another admin's account is locked to everyone except that admin. */
export function isOtherAdmin(actor, target) {
  return target?.role === 'admin' && !sameAccount(actor, target);
}

export function passwordReuseMessage(error) {
  const text = String(error?.message || error || '');
  if (/different from the old|should be different|same password|previously used/i.test(text)) return PASSWORD_REUSE;
  return '';
}

/** Never echo a submitted password or a URL back onto the screen. */
export function passwordUpdateError(error, submitted = '') {
  const text = String(error?.message || '');
  if (submitted && text.includes(submitted)) return 'Could not save that password. Try again.';
  return passwordReuseMessage(error) || plainPasswordSaveError(error);
}

export function passwordGateProblem(first, second) {
  return passwordChangeError(first, second);
}

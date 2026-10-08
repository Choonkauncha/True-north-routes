/** Decide what /admin may paint before the network round trip. Mirrors the inline script in admin.html. */

export const ROLE_KEY_PREFIX = 'tn-role:';
/** The Management entry is admin-only. Managers keep their database access; they do not see this link. */
export const MANAGEMENT_ROLES = Object.freeze(['admin']);

export function readStoredUser(storage) {
  if (!storage) return null;
  try {
    const keys = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && /^sb-.+-auth-token$/.test(key)) keys.push(key);
    }
    for (const key of keys) {
      let raw = storage.getItem(key) || '';
      if (!raw) {
        const chunks = [];
        for (let i = 0; ; i += 1) {
          const chunk = storage.getItem(`${key}.${i}`);
          if (!chunk) break;
          chunks.push(chunk);
        }
        raw = chunks.join('');
      }
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const session = parsed?.access_token ? parsed : parsed?.currentSession;
      const user = session?.user;
      if (session?.access_token && user?.id) return { id: user.id, email: user.email || '' };
    }
  } catch { /* damaged storage stays signed out */ }
  return null;
}

export function cachedRole(storage, userId) {
  if (!storage || !userId) return '';
  try { return storage.getItem(ROLE_KEY_PREFIX + userId) || ''; }
  catch { return ''; }
}

export function rememberRole(storage, userId, role) {
  if (!storage || !userId || !role) return;
  try { storage.setItem(ROLE_KEY_PREFIX + userId, role); } catch { /* private mode */ }
}

export function forgetRole(storage, userId) {
  if (!storage || !userId) return;
  try { storage.removeItem(ROLE_KEY_PREFIX + userId); } catch { /* private mode */ }
}

/**
 * redirect: do not paint management or a login form.
 * wait: a session exists and the role is still unknown or already admin. Show a blank hold.
 */
export function earlyManagementDecision(storage) {
  const user = readStoredUser(storage);
  if (!user) return 'redirect';
  const role = cachedRole(storage, user.id);
  if (role && !MANAGEMENT_ROLES.includes(role)) return 'redirect';
  return 'wait';
}

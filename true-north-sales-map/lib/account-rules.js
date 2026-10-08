export const FIELD_ROLES = ['appointment_setter', 'canvasser', 'salesperson'];
export const MANAGEMENT_ROLES = ['admin', 'manager'];
export const ALL_ROLES = [...FIELD_ROLES, ...MANAGEMENT_ROLES];
export const BOOTSTRAP_ADMIN_EMAILS = ['travisbishopmackie@gmail.com', 'truenorthrestorationss@gmail.com'];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function validateEmail(value) {
  const email = normalizeEmail(value);
  if (!EMAIL.test(email) || email.length > 160) return '';
  return email;
}

export function validatePassword(value) {
  const password = String(value || '');
  if (password.length < 8 || password.length > 72) return '';
  if (/^\s+$/.test(password)) return '';
  return password;
}

export function validateName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) return '';
  return name;
}

export function isFieldRole(role) {
  return FIELD_ROLES.includes(role);
}

/** Managers can create and reset setters and sales reps, and can still reset or turn off an older canvasser login. Only an admin can touch admin or manager accounts, or open as someone. New canvasser logins are not created. */
export function canManageAccount(actorRole, targetRole, action) {
  if (!MANAGEMENT_ROLES.includes(actorRole)) return false;
  if (!ALL_ROLES.includes(targetRole)) return false;
  if (action === 'open_as') return actorRole === 'admin';
  if (!['create', 'reset', 'deactivate', 'reactivate'].includes(action)) return false;
  if (action === 'create' && targetRole === 'canvasser') return false;
  if (targetRole === 'admin' || targetRole === 'manager') return actorRole === 'admin';
  return true;
}

export function roleLabel(role) {
  return {
    admin: 'Admin',
    manager: 'Manager',
    appointment_setter: 'Appointment setter',
    canvasser: 'Appointment setter',
    salesperson: 'Sales rep'
  }[role] || role;
}

/** Profile shortcuts. Each one opens /admin already signed in. */
export const MANAGEMENT_LINKS = Object.freeze([
  { href: '/admin#accounts', label: 'Accounts', hint: 'Create a setter or sales rep login' },
  { href: '/admin#team', label: 'Team & roles', hint: 'See who is on the team' },
  { href: '/admin#files', label: 'Documents', hint: 'Paperwork by property' },
  { href: '/admin#messages', label: 'Messages from the field', hint: 'Reply to setters and sales reps' },
  { href: '/admin#builder', label: 'Form library', hint: 'Upload and assign forms' },
  { href: '/admin#library', label: 'Document folders', hint: 'Contingency, agreements, receipts, and estimates' }
]);

/**
 * Travis and Spencer stay admin even when the reps row is missing.
 * That matches the reps_bootstrap_admin trigger. An existing row keeps its
 * name and id; the role is still admin.
 */
export function managementProfile({ email, rep, userId, name } = {}) {
  const normalized = normalizeEmail(email || rep?.email);
  if (BOOTSTRAP_ADMIN_EMAILS.includes(normalized)) {
    return {
      ...(rep || {}),
      id: rep?.id || null,
      user_id: rep?.user_id || userId || null,
      email: normalized,
      name: rep?.name || String(name || '').trim() || normalized.split('@')[0],
      role: 'admin',
      active: true
    };
  }
  return rep || null;
}

/** Allow-list first, then admin or manager. An empty list allows every management role. */
export function canOpenManagement({ email, rep, adminEmails } = {}) {
  const list = Array.isArray(adminEmails) ? adminEmails.map(normalizeEmail).filter(Boolean) : [];
  const normalized = normalizeEmail(email || rep?.email);
  if (list.length && !list.includes(normalized)) return false;
  const profile = managementProfile({ email: normalized, rep, name: rep?.name });
  return profile?.role === 'admin' || profile?.role === 'manager';
}

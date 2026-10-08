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

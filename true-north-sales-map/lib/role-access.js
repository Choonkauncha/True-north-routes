/** Who sees the map, photos, forms, and office messages. */

import { isAdminRole } from './field-rules.js';

export const CREATABLE_FIELD_ROLES = Object.freeze([
  ['appointment_setter', 'Appointment setter'],
  ['salesperson', 'Sales rep']
]);

/** Stored `canvasser` rows stay valid and behave as appointment setters. */
export function isSetterRole(role) {
  return role === 'appointment_setter' || role === 'canvasser';
}

export function isSalesRep(role) {
  return role === 'salesperson';
}

export function roleLabel(role) {
  if (isSetterRole(role)) return 'Appointment setter';
  if (role === 'salesperson') return 'Sales rep';
  if (role === 'manager') return 'Manager';
  if (role === 'admin') return 'Admin';
  return role || '';
}

export function canUsePhotoBank(role, mode = 'cloud') {
  if (mode === 'local' && !role) return true;
  return role === 'salesperson' || isAdminRole(role);
}

export function canMessageManagement(role) {
  return isSetterRole(role) || isSalesRep(role) || isAdminRole(role);
}

/** Links for the field home. Setters do not get the photo bank. */
export function fieldHomeLinks(role) {
  const links = [
    { href: '/', label: 'Map and routes', id: 'map' },
    { href: '/setter.html', label: 'Inspection form', id: 'inspection' },
    { href: '/forms.html', label: 'My forms', id: 'forms' },
    { action: 'message', label: 'Message management', id: 'message' }
  ];
  if (canUsePhotoBank(role)) links.push({ href: '/rep.html', label: 'Roof photos', id: 'photos' });
  links.push({ href: '/training.html', label: 'Training', id: 'training' });
  links.push({ href: '/account.html', label: 'My account', id: 'account' });
  return links;
}

/**
 * A form is visible when its audience matches the role, or when this person
 * is on the assignment list. Management sees every form.
 */
export function canSeeForm(role, template, { repId = '', assignments = [], mode = 'cloud' } = {}) {
  if (!template) return false;
  if (mode === 'local' && !role) return true;
  if (isAdminRole(role)) return true;
  if (template.active === false) return false;
  const assigned = (assignments || []).some((row) => row.template_id === template.id && row.rep_id === repId);
  if (assigned) return true;
  if (template.audience === 'people') return false;
  if (isSetterRole(role)) return template.audience === 'setter' || template.audience === 'both';
  if (isSalesRep(role)) return template.audience === 'rep' || template.audience === 'both';
  return false;
}

export function cleanPhotoNote(value) {
  const text = String(value ?? '').trim();
  if (text.length > 500) return { error: 'Keep the photo note under 500 characters.' };
  return { text };
}

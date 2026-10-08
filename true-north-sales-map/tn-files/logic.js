/** Pure helpers for the photo bank and forms. No browser or network calls. */

export const FIELD_TYPES = [
  ['text', 'Text'],
  ['textarea', 'Long text'],
  ['number', 'Number'],
  ['date', 'Date'],
  ['checkbox', 'Checkbox'],
  ['select', 'Select'],
  ['signature', 'Signature'],
  ['photo', 'Photo']
];

export const PREFILLS = [
  ['none', 'Leave blank'],
  ['name', 'Homeowner name'],
  ['address', 'Property address'],
  ['date', 'Today’s date']
];

export const DRAFT_NOTICE = 'Draft only. Replace this wording with True North’s own agreement before a homeowner signs.';

const SCOPE_HELP = 'Describe the work in plain language. Replace this with True North’s own scope wording.';

function fieldsForAgreement() {
  return [
    { id: 'homeowner_name', type: 'text', label: 'Homeowner name', required: true, section: 'Homeowner', prefill: 'name', options: [] },
    { id: 'property_address', type: 'text', label: 'Property address', required: true, section: 'Homeowner', prefill: 'address', options: [] },
    { id: 'insurance_carrier', type: 'text', label: 'Insurance carrier', required: false, section: 'Insurance', prefill: 'none', options: [] },
    { id: 'claim_number', type: 'text', label: 'Claim number', required: false, section: 'Insurance', prefill: 'none', options: [] },
    { id: 'scope', type: 'textarea', label: 'Scope of work', required: false, section: 'Scope of work', prefill: 'none', help: SCOPE_HELP, options: [] },
    { id: 'homeowner_signature', type: 'signature', label: 'Homeowner signature', required: true, section: 'Signatures', prefill: 'none', options: [] },
    { id: 'rep_signature', type: 'signature', label: 'Rep signature', required: true, section: 'Signatures', prefill: 'none', options: [] },
    { id: 'agreement_date', type: 'date', label: 'Date', required: true, section: 'Signatures', prefill: 'date', options: [] }
  ];
}

export const STARTER_TEMPLATES = [
  {
    id: 'a1111111-1111-4111-8111-111111111111',
    name: 'Closing / Deal Agreement',
    description: 'Placeholder. This is not True North’s agreement until the company replaces the wording.',
    audience: 'rep',
    fields: fieldsForAgreement(),
    is_draft: true,
    draft_notice: DRAFT_NOTICE,
    active: true
  },
  {
    id: 'a2222222-2222-4222-8222-222222222222',
    name: 'Contingency Agreement',
    description: 'Placeholder. This is not True North’s agreement until the company replaces the wording.',
    audience: 'rep',
    fields: fieldsForAgreement(),
    is_draft: true,
    draft_notice: DRAFT_NOTICE,
    active: true
  }
];

export const PREVIEW_LEAD = {
  id: 'preview-house',
  name: 'Alex Morgan',
  address: '18 Public Square',
  city: 'Mount Vernon',
  state: 'OH',
  zip: '43050'
};

export function todayISO(now = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${z(now.getMonth() + 1)}-${z(now.getDate())}`;
}

export function formatAddress(lead) {
  if (!lead) return '';
  if (lead.full_address) return lead.full_address;
  if (lead.fullAddress) return lead.fullAddress;
  return [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(', ');
}

export { canUsePhotoBank, canSeeForm } from '../lib/role-access.js';
import { canSeeForm } from '../lib/role-access.js';

export function canFillAudience(role, audience, mode = 'cloud') {
  return canSeeForm(role, { id: 'audience-only', active: true, audience }, { mode });
}

export function isManagement(role) {
  return role === 'admin' || role === 'manager';
}

/** One screen per section. Blank section = that field alone. Same section name shares a screen. */
export function screensFromFields(fields) {
  const screens = [];
  const indexByKey = new Map();
  (fields || []).forEach((field) => {
    const key = String(field.section || '').trim();
    if (!key) {
      screens.push({ title: field.label || 'Question', fields: [field] });
      return;
    }
    if (!indexByKey.has(key)) {
      indexByKey.set(key, screens.length);
      screens.push({ title: key, fields: [field] });
    } else {
      screens[indexByKey.get(key)].fields.push(field);
    }
  });
  return screens;
}

export function prefillValue(field, lead, now = new Date()) {
  if (!field || field.prefill === 'none' || !field.prefill) return '';
  if (field.prefill === 'name') return lead?.name || '';
  if (field.prefill === 'address') return formatAddress(lead);
  if (field.prefill === 'date') return todayISO(now);
  return '';
}

export function initialAnswers(fields, lead, now = new Date()) {
  const answers = {};
  for (const field of fields || []) {
    if (field.type === 'checkbox') answers[field.id] = false;
    else if (field.type === 'signature' || field.type === 'photo') answers[field.id] = null;
    else answers[field.id] = prefillValue(field, lead, now);
  }
  return answers;
}

export function validateField(field, value) {
  const missing = () => {
    if (field.type === 'signature') return 'Sign in the box.';
    if (field.type === 'photo') return 'Add a photo.';
    if (field.type === 'checkbox') return 'Tap to confirm.';
    if (field.type === 'number') return 'Enter a number.';
    return 'Fill this in.';
  };
  if (field.type === 'number' && value !== '' && value != null && Number.isNaN(Number(value))) return 'Enter a number.';
  if (!field.required) return '';
  if (field.type === 'checkbox') return value === true ? '' : missing();
  if (field.type === 'signature' || field.type === 'photo') return value ? '' : missing();
  if (field.type === 'number') return value !== '' && value != null && !Number.isNaN(Number(value)) ? '' : missing();
  return String(value ?? '').trim() ? '' : missing();
}

export function validateScreen(fields, answers) {
  const errors = {};
  for (const field of fields || []) {
    const message = validateField(field, answers?.[field.id]);
    if (message) errors[field.id] = message;
  }
  return errors;
}

export function newFieldId(label = 'field') {
  const base = String(label || 'field').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'field';
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

export function blankField() {
  return { id: newFieldId('field'), type: 'text', label: '', required: false, section: '', prefill: 'none', help: '', options: [] };
}

export function snapshotHomeowner(fields, answers) {
  const field = (fields || []).find((item) => item.prefill === 'name') || (fields || []).find((item) => /name/i.test(item.label || ''));
  return field ? String(answers?.[field.id] || '').trim() : '';
}

export function normalizeAddressKey(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function audienceLabel(audience) {
  if (audience === 'setter') return 'All setters';
  if (audience === 'rep') return 'All sales reps';
  if (audience === 'both') return 'Setters and sales reps';
  if (audience === 'people') return 'Specific people';
  return audience || '';
}

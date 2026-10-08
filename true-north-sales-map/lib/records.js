/** Categories, library files, receipts, and estimates. No network calls. */

export const LIBRARY_LIMIT = 25 * 1024 * 1024;

export const UNCATEGORIZED_SLUG = 'uncategorized';

export const LIBRARY_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.gif,.heic,.heif,.doc,.docx,.xls,.xlsx,application/pdf,image/*';

export const RECORD_ACCEPT = 'image/*,application/pdf';

export const ESTIMATE_STATUSES = Object.freeze([
  ['draft', 'Draft'],
  ['sent', 'Sent'],
  ['accepted', 'Accepted'],
  ['declined', 'Declined']
]);

const STATUS_LABEL = Object.fromEntries(ESTIMATE_STATUSES);

const OFFICE_TYPES = Object.freeze({
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
});

const ALLOWED_MIME = new Set(Object.values(OFFICE_TYPES));

export function seedCategories() {
  return [
    { id: 'c1000000-0000-4000-8000-000000000001', name: 'Contingency', slug: 'contingency', sort_order: 10, system: false },
    { id: 'c1000000-0000-4000-8000-000000000002', name: 'Agreements', slug: 'agreements', sort_order: 20, system: false },
    { id: 'c1000000-0000-4000-8000-000000000003', name: 'Other', slug: 'other', sort_order: 30, system: false },
    { id: 'c1000000-0000-4000-8000-000000000004', name: 'Uncategorized', slug: UNCATEGORIZED_SLUG, sort_order: 40, system: true }
  ];
}

export function statusLabel(status) {
  return STATUS_LABEL[status] || 'Draft';
}

export function sortCategories(rows) {
  return [...(rows || [])].sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));
}

export function formatMoney(amount) {
  if (amount === null || amount === undefined || amount === '') return '';
  const value = Number(amount);
  if (!Number.isFinite(value)) return '';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

export function parseAmount(value) {
  const raw = String(value ?? '').trim().replace(/[$,\s]/g, '');
  if (!raw) return { amount: null };
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return { error: 'Enter the amount in dollars, like 1250.00.' };
  const amount = Number(raw);
  if (amount > 100000000) return { error: 'That amount is too large.' };
  return { amount };
}

export function libraryFileKind(file, { imagesAndPdfOnly = false } = {}) {
  const name = String(file?.name || '').trim();
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  const stated = String(file?.type || '').toLowerCase();
  let mime = OFFICE_TYPES[ext] || '';
  if (!mime && ALLOWED_MIME.has(stated)) mime = stated;
  if (!mime && stated.startsWith('image/')) mime = stated;
  const imageOk = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'].includes(mime);
  const pdfOk = mime === 'application/pdf';
  const officeOk = ALLOWED_MIME.has(mime) && !mime.startsWith('image/');
  if (imagesAndPdfOnly) {
    if (!pdfOk && !imageOk) return { error: 'Upload a PDF or an image.' };
  } else if (!pdfOk && !imageOk && !officeOk) {
    return { error: 'Upload a PDF, an image, a Word document, or an Excel spreadsheet.' };
  }
  const size = Number(file?.size || 0);
  if (!size) return { error: 'That file is empty.' };
  if (size > LIBRARY_LIMIT) return { error: 'That file is over 25 MB.' };
  return { mime, name: name || 'document' };
}

function cleanName(name) {
  const cleaned = String(name || '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return { error: 'Name the category.' };
  if (cleaned.length > 60) return { error: 'Keep the category name under 60 characters.' };
  return { name: cleaned };
}

export function addCategory(categories, name) {
  const cleaned = cleanName(name);
  if (cleaned.error) return cleaned;
  if ((categories || []).some((row) => row.name.toLowerCase() === cleaned.name.toLowerCase())) {
    return { error: 'That category already exists.' };
  }
  const slugBase = cleaned.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'category';
  let slug = slugBase;
  let n = 2;
  while ((categories || []).some((row) => row.slug === slug)) slug = `${slugBase}-${n++}`;
  const sort_order = Math.max(0, ...(categories || []).map((row) => Number(row.sort_order) || 0)) + 10;
  const id = globalThis.crypto?.randomUUID?.() || `cat-${slug}-${sort_order}`;
  return { category: { id, name: cleaned.name, slug, sort_order, system: false } };
}

export function renameCategory(categories, id, name) {
  const cleaned = cleanName(name);
  if (cleaned.error) return cleaned;
  if ((categories || []).some((row) => row.id !== id && row.name.toLowerCase() === cleaned.name.toLowerCase())) {
    return { error: 'That category already exists.' };
  }
  return {
    categories: (categories || []).map((row) => (row.id === id ? { ...row, name: cleaned.name } : row))
  };
}

export function reorderCategory(categories, id, direction) {
  const sorted = sortCategories(categories).map((row) => ({ ...row }));
  const index = sorted.findIndex((row) => row.id === id);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= sorted.length) return sorted;
  const currentOrder = sorted[index].sort_order;
  sorted[index].sort_order = sorted[next].sort_order;
  sorted[next].sort_order = currentOrder;
  if (sorted[index].sort_order === sorted[next].sort_order) {
    sorted.forEach((row, position) => { row.sort_order = (position + 1) * 10; });
    const [item] = sorted.splice(index, 1);
    sorted.splice(next, 0, item);
    sorted.forEach((row, position) => { row.sort_order = (position + 1) * 10; });
  }
  return sortCategories(sorted);
}

export function removeCategory(categories, documents, id) {
  const target = (categories || []).find((row) => row.id === id);
  if (!target) return { error: 'That category is already gone.' };
  if (target.system || target.slug === UNCATEGORIZED_SLUG) {
    return { error: `${target.name} stays so documents always have a folder.` };
  }
  const fallback = (categories || []).find((row) => row.slug === UNCATEGORIZED_SLUG && row.id !== id);
  if (!fallback) return { error: 'Uncategorized is missing. Reload and try again.' };
  const moving = (documents || []).filter((doc) => doc.category_id === id);
  return {
    categories: (categories || []).filter((row) => row.id !== id),
    documents: (documents || []).map((doc) => (doc.category_id === id ? { ...doc, category_id: fallback.id } : doc)),
    moved: moving.length,
    fallbackId: fallback.id,
    message: moving.length ? `Moved ${moving.length} document${moving.length === 1 ? '' : 's'} to ${fallback.name}.` : 'Category removed.'
  };
}

export function groupLibrary(categories, documents) {
  const groups = sortCategories(categories).map((row) => ({ ...row, documents: [] }));
  const byId = new Map(groups.map((group) => [group.id, group]));
  const fallback = groups.find((group) => group.slug === UNCATEGORIZED_SLUG) || groups[groups.length - 1];
  for (const doc of documents || []) {
    const group = byId.get(doc.category_id) || fallback;
    if (group) group.documents.push(doc);
  }
  for (const group of groups) {
    group.documents.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }
  return groups;
}

export function filterRecords(rows, { query = '', from = '', to = '', status = '' } = {}) {
  const needle = String(query || '').trim().toLowerCase();
  return (rows || []).filter((row) => {
    if (status && row.status !== status) return false;
    const day = String(row.record_date || '').slice(0, 10);
    if (from && (!day || day < from)) return false;
    if (to && (!day || day > to)) return false;
    if (!needle) return true;
    return [row.vendor, row.homeowner_name, row.address_snapshot, row.note, row.file_name, row.amount, statusLabel(row.status)]
      .join(' ')
      .toLowerCase()
      .includes(needle);
  }).sort((a, b) => String(b.record_date || b.created_at || '').localeCompare(String(a.record_date || a.created_at || '')));
}

export function canDeleteRecord(role, record, repId) {
  if (role === 'admin' || role === 'manager') return true;
  return Boolean(repId && record?.uploaded_by && record.uploaded_by === repId);
}

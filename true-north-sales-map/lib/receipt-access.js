/** Who can upload or read a receipt. No network calls. */

const ADMIN_ROLES = new Set(['admin', 'manager']);

export function canBrowseDocumentLibrary(role) {
  return ADMIN_ROLES.has(role);
}

/**
 * A sales rep can upload a general receipt, or one tied to an inspection assigned to them.
 * Management can upload either. Setters cannot.
 */
export function canUploadReceipt({ role = '', repId = '', leadId = null, appointments = [] } = {}) {
  if (ADMIN_ROLES.has(role)) return { ok: true };
  if (role !== 'salesperson' || !repId) return { error: 'Only sales reps can upload receipts.' };
  if (!leadId) return { ok: true };
  const assigned = (appointments || []).some((row) =>
    row.lead_id === leadId
    && row.salesperson_id === repId
    && row.stage !== 'Cancelled'
  );
  if (!assigned) return { error: 'You can upload a receipt only for an inspection assigned to you.' };
  return { ok: true };
}

export function canSeeReceipt({ role = '', repId = '', receipt = null } = {}) {
  if (!receipt) return false;
  if (ADMIN_ROLES.has(role)) return true;
  return role === 'salesperson' && Boolean(repId) && receipt.uploaded_by === repId;
}

export function receiptDeleteAllowed(role) {
  return ADMIN_ROLES.has(role);
}

export function receiptInsertAllowed({ role = '', repId = '', uploadedBy = '', storagePath = '', leadId = null, appointments = [] } = {}) {
  if (!repId || uploadedBy !== repId) return false;
  if (!String(storagePath || '').startsWith(`receipts/${repId}/`)) return false;
  return Boolean(canUploadReceipt({ role, repId, leadId, appointments }).ok);
}

/** form-assets object name. Receipts are limited to the uploader's own folder. */
export function receiptStorageAllowed({ role = '', repId = '', objectName = '', action = 'select' } = {}) {
  const [prefix, owner] = String(objectName || '').split('/');
  if (action === 'delete') return ADMIN_ROLES.has(role);
  if (ADMIN_ROLES.has(role)) {
    if (action === 'insert') return ['library', 'receipts', 'estimates'].includes(prefix) || owner === String(repId);
    return true;
  }
  if (prefix === 'estimates' || prefix === 'library') return false;
  if (prefix === 'receipts') return role === 'salesperson' && owner === String(repId) && (action === 'select' || action === 'insert');
  if (!repId || owner !== String(repId)) return false;
  return action === 'select' || action === 'insert';
}

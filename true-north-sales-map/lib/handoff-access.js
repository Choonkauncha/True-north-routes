/** Who can view or change an inspection handoff. No network calls. */

const SETTER_ROLES = new Set(['appointment_setter', 'canvasser']);
const ADMIN_ROLES = new Set(['admin', 'manager']);

export function isHandoffAdmin(role) {
  return ADMIN_ROLES.has(role);
}

export function isHandoffSetter(role) {
  return SETTER_ROLES.has(role);
}

export function handoffPermissions({ role = '', repId = '', appointment = null } = {}) {
  const stage = appointment?.stage || '';
  const cancelled = stage === 'Cancelled';
  const completed = stage === 'Completed';
  const admin = isHandoffAdmin(role);
  const assigned = role === 'salesperson' && Boolean(appointment?.salesperson_id) && appointment.salesperson_id === repId;
  const writer = (admin || assigned) && !cancelled;
  return {
    view: Boolean(appointment),
    assign: admin && !cancelled,
    schedule: admin && !cancelled,
    notes: writer,
    photos: writer,
    complete: writer && !completed,
    reopen: admin && completed
  };
}

function changed(patch, before, key) {
  return Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== before[key];
}

/** Reject a handoff update the role is not allowed to make. */
export function validateHandoffPatch({ role = '', repId = '', before, patch = {} } = {}) {
  if (!before?.id) return { error: 'Missing inspection.' };
  const perms = handoffPermissions({ role, repId, appointment: before });
  if (changed(patch, before, 'lead_id') || changed(patch, before, 'canvasser_id') || changed(patch, before, 'id')) {
    return { error: 'This handoff cannot be reassigned that way.' };
  }
  const touched = ['salesperson_id', 'notes', 'stage', 'scheduled_at'].some((key) => changed(patch, before, key));
  if (touched && isHandoffSetter(role)) return { error: 'Appointment setters can view handoffs only.' };
  if (touched && !isHandoffAdmin(role) && role !== 'salesperson') return { error: 'You can view this handoff only.' };
  if (changed(patch, before, 'salesperson_id') && !perms.assign) {
    return { error: 'Only management can assign the sales rep.' };
  }
  if (changed(patch, before, 'scheduled_at') && !perms.schedule) {
    return { error: 'Only management can change the inspection time.' };
  }
  if (changed(patch, before, 'notes') && !perms.notes) {
    return { error: 'You can view this handoff, not edit the notes.' };
  }
  if (changed(patch, before, 'stage')) {
    if (before.stage === 'Completed' && patch.stage !== 'Completed') {
      if (!perms.reopen) return { error: 'Only management can reopen an inspection.' };
    } else if (patch.stage === 'Completed') {
      if (!perms.complete) return { error: 'You cannot mark this inspection completed.' };
    } else if (!perms.assign) {
      return { error: 'You cannot change this inspection stage.' };
    }
  }
  return { ok: true, next: { ...before, ...patch } };
}

export function assertHandoffPhoto({ role = '', repId = '', appointment } = {}) {
  const perms = handoffPermissions({ role, repId, appointment });
  if (!perms.photos) return { error: 'You cannot add a photo to this inspection.' };
  return { ok: true };
}

/**
 * Open inspections stay on the team queue. Management also sees completed ones so they can reopen them.
 * A setter always keeps the inspections they created, even if a later filter narrows the queue.
 */
export function visibleHandoffs({ role = '', repId = '', appointments = [] } = {}) {
  const rows = Array.isArray(appointments) ? appointments : [];
  const open = rows.filter((row) => row.stage !== 'Completed' && row.stage !== 'Cancelled');
  const created = open.filter((row) => repId && (row.canvasser_id === repId || row.salesperson_id === repId));
  const queue = open.slice();
  const seen = new Set(queue.map((row) => row.id));
  for (const row of created) {
    if (!seen.has(row.id)) queue.push(row);
  }
  const sorted = queue.sort((a, b) => String(a.scheduled_at || '').localeCompare(String(b.scheduled_at || '')));
  if (!isHandoffAdmin(role)) return sorted;
  const done = rows
    .filter((row) => row.stage === 'Completed')
    .sort((a, b) => String(b.scheduled_at || '').localeCompare(String(a.scheduled_at || '')));
  return [...sorted, ...done];
}

// Deleting an appointment is admin-only. Cloud mode deletes the row (RLS enforces admin);
// local mode (no Supabase client) remembers the deletion on this device.
export const LOCAL_DELETED_KEY = 'tn-local-deleted-appointments';

export function canDeleteAppointments(me) {
  return Boolean(me && me.active !== false && me.role === 'admin');
}

function localDeleted(storage) {
  try { return new Set(JSON.parse(storage?.getItem(LOCAL_DELETED_KEY) || '[]')); } catch { return new Set(); }
}

export function withoutLocallyDeleted(list, storage) {
  const gone = localDeleted(storage);
  return gone.size ? list.filter(a => !gone.has(a.id)) : list;
}

export async function deleteAppointment({ sb, id, list, storage, me }) {
  if (!canDeleteAppointments(me)) throw new Error('Only admins can delete appointments.');
  if (!id) throw new Error('Missing appointment.');
  if (sb) {
    const { data, error } = await sb.from('appointments').delete().eq('id', id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('Appointment was not deleted. Check that your account is an active admin.');
  } else {
    const gone = localDeleted(storage);
    gone.add(id);
    storage?.setItem(LOCAL_DELETED_KEY, JSON.stringify([...gone]));
  }
  return list.filter(a => a.id !== id);
}

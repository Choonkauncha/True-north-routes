/** In-memory training drafts, serialized so an older request cannot win last. */
export function createTrainingSaver({ write, onChange = () => {} }) {
  const states = new Map();
  const tails = new Map();
  const key = ({ userId, repId, itemId }) => JSON.stringify([userId, repId, itemId]);
  const copy = (row) => row ? JSON.parse(JSON.stringify(row)) : null;
  function stateFor(identity) { return states.get(key(identity)) || null; }
  function enqueue({ identity, row, keepalive = false }) {
    const id = key(identity);
    const previous = states.get(id);
    const state = {
      identity: { ...identity }, row: copy(row), revision: (previous?.revision || 0) + 1,
      confirmed: previous?.confirmed || null, status: 'saving', error: ''
    };
    states.set(id, state);
    onChange(state);
    const run = async () => {
      // Completion already accepted by the server must never be undone by a
      // subsequent snapshot captured while that earlier write was in flight.
      const current = states.get(id);
      const outgoing = { ...state.row, completed_at: current?.confirmed?.completed_at || state.row.completed_at || null };
      try {
        await write({ identity: state.identity, row: outgoing, keepalive });
        const latest = states.get(id);
        latest.confirmed = copy(outgoing);
        if (latest.revision === state.revision) {
          latest.status = 'saved';
          latest.error = '';
        }
        onChange(latest);
        return { row: outgoing };
      } catch (error) {
        const latest = states.get(id);
        if (latest.revision === state.revision) {
          latest.status = 'error';
          latest.error = error?.message || 'Training progress could not be saved.';
        }
        onChange(latest);
        return { error: error?.message || 'Training progress could not be saved.' };
      }
    };
    const previousTail = tails.get(id) || Promise.resolve();
    const pending = previousTail.then(run);
    const nextTail = pending.then(() => undefined, () => undefined);
    tails.set(id, nextTail);
    nextTail.finally(() => { if (tails.get(id) === nextTail) tails.delete(id); });
    return pending;
  }
  return {
    enqueue,
    stateFor,
    pendingFor(identity) {
      const state = stateFor(identity);
      return state && state.status !== 'saved' ? copy(state.row) : null;
    },
    unsavedFor(userId, repId) {
      return [...states.values()].filter((state) => state.identity.userId === userId && state.identity.repId === repId && state.status !== 'saved');
    },
    retry(identity, keepalive = false) {
      const state = stateFor(identity);
      return state ? enqueue({ identity, row: state.row, keepalive }) : Promise.resolve(null);
    }
  };
}

export async function saveTrainingRow({ sb, cfg, identity, row, keepalive = false, fetchImpl = fetch }) {
  const { data, error } = await sb.auth.getSession();
  const session = data?.session;
  if (error || !session?.access_token || !identity.userId || session.user?.id !== identity.userId) {
    throw new Error('Sign in again with the same account, then retry saving your training.');
  }
  if (row.rep_id !== identity.repId || row.item_id !== identity.itemId) {
    throw new Error('Training progress does not match this account or lesson. Reopen the lesson before saving.');
  }
  let response;
  try {
    response = await fetchImpl(`${cfg.url}/rest/v1/training_progress?on_conflict=rep_id,item_id`, {
      method: 'POST', keepalive,
      headers: {
        apikey: cfg.publishableKey, Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(row)
    });
  } catch {
    throw new Error('Progress is unsaved. Check your connection, then retry. Keep this page open to retain your progress.');
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Training save was not authorized. Sign in again with the same account, then retry.');
    }
    throw new Error(`Training save failed (${response.status}). Retry when the service is available. Keep this page open to retain your progress.`);
  }
}

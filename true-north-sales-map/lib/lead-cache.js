/** Lead dataset cache stamps and delta merges. No network calls. */

export function localStamp(manifest) {
  return `local:${manifest?.generated || ''}:${manifest?.totalRecords || 0}:${manifest?.mappedRecords || 0}`;
}

export function newestUpdatedAt(leads) {
  let newest = '';
  for (const lead of leads || []) {
    const value = String(lead?.updated_at || lead?.updatedAt || '');
    if (value > newest) newest = value;
  }
  return newest;
}

export function planLeadSync({ cachedStamp = '', cachedCount = 0, remoteCount = null, remoteUpdatedAt = '' } = {}) {
  if (!cachedCount) return 'full';
  if (remoteCount != null && Number(remoteCount) !== Number(cachedCount)) return 'full';
  if (!remoteUpdatedAt) return cachedStamp ? 'use-cache' : 'full';
  if (cachedStamp === remoteUpdatedAt) return 'use-cache';
  if (cachedStamp && remoteUpdatedAt > cachedStamp) return 'delta';
  return 'full';
}

export function mergeLeadDelta(leads, delta) {
  if (!delta?.length) return leads || [];
  const byId = new Map((leads || []).map((lead) => [lead.id, lead]));
  delta.forEach((row) => { if (row?.id) byId.set(row.id, row); });
  return [...byId.values()];
}

export function createArrayCursor() {
  return { i: 0, depth: 0, inString: false, escape: false };
}

/** Index just past the next `count` top-level objects. Resumes inside a JSON array. */
export function nextObjectEnd(text, cursor, count) {
  const source = String(text || '');
  const target = Math.max(1, count || 1);
  let found = 0;
  for (let i = cursor.i; i < source.length; i++) {
    const char = source[i];
    if (cursor.inString) {
      if (cursor.escape) cursor.escape = false;
      else if (char === '\\') cursor.escape = true;
      else if (char === '"') cursor.inString = false;
      continue;
    }
    if (char === '"') { cursor.inString = true; continue; }
    if (char === '{' || char === '[') { cursor.depth++; continue; }
    if (char === '}' || char === ']') {
      cursor.depth--;
      if (char === '}' && cursor.depth === 1) {
        found++;
        if (found >= target) { cursor.i = i + 1; return cursor.i; }
      }
    }
  }
  cursor.i = source.length;
  return source.length;
}

/** Parse one slice of a JSON array, including a middle slice that starts on a comma. */
export function parseJsonArraySlice(text, start, end) {
  let slice = String(text || '').slice(start, end).trim();
  if (slice.startsWith(',')) slice = slice.slice(1).trim();
  if (slice.endsWith(']')) slice = slice.slice(0, -1).trim();
  if (slice.endsWith(',')) slice = slice.slice(0, -1).trim();
  if (slice.startsWith('[')) slice = slice.slice(1).trim();
  if (!slice) return [];
  return JSON.parse(`[${slice}]`);
}

/** Keep a built route when houses are added or removed after optimization. */

function hasCoords(lead) {
  return lead?.lat != null && lead?.lng != null && String(lead.lat).trim() !== '' && String(lead.lng).trim() !== ''
    && Number.isFinite(Number(lead.lat)) && Number.isFinite(Number(lead.lng))
    && Math.abs(Number(lead.lat)) <= 90 && Math.abs(Number(lead.lng)) <= 180;
}

export function routeKeyParts(key) {
  const text = String(key || '');
  const modeEnd = text.indexOf(':');
  const capEnd = modeEnd < 0 ? -1 : text.indexOf(':', modeEnd + 1);
  if (modeEnd < 0 || capEnd < 0) return { mode: '', cap: '', ids: '' };
  return { mode: text.slice(0, modeEnd), cap: text.slice(modeEnd + 1, capEnd), ids: text.slice(capEnd + 1) };
}

/** True when only the selected houses changed, not travel mode or the max-stop cap. */
export function selectionOnlyChange(previousKey, nextKey) {
  if (!previousKey || previousKey === nextKey) return false;
  const previous = routeKeyParts(previousKey);
  const next = routeKeyParts(nextKey);
  return previous.mode === next.mode && previous.cap === next.cap && previous.ids !== next.ids;
}

/**
 * Drop houses that left the selection and append newly selected mapped houses.
 * Existing stop order stays put until the user re-optimizes.
 */
export function reviseBuiltRoute(stops, selectedIds, leadsById) {
  const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
  const kept = (stops || []).filter((stop) => stop && selected.has(stop.id));
  const have = new Set(kept.map((stop) => stop.id));
  const added = [];
  for (const id of selected) {
    if (have.has(id)) continue;
    const lead = leadsById?.get?.(id);
    if (!hasCoords(lead)) continue;
    added.push(lead);
    have.add(id);
  }
  return { stops: [...kept, ...added], appended: added.length, removed: (stops || []).length - kept.length };
}

/** Built stop order when a route exists; otherwise the selection order. */
export function routeStopOrder(stops, selectedIds) {
  if (stops?.length) return stops.map((stop) => stop.id).filter(Boolean);
  return [...(selectedIds || [])];
}

/** Saved ids follow the built stop order, then any selected house that is not a stop yet. */
export function orderedRouteIds(stops, selectedIds) {
  const ids = [];
  const seen = new Set();
  for (const id of routeStopOrder(stops, [])) {
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  for (const id of selectedIds || []) {
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** Cold lead sync plans. No network calls. */

export const STATIC_LEAD_SOURCES = ['Roofing Leads CSV', 'Knox Owner-Occupied', 'Knox Walk List'];

export const LEAD_OVERLAY_COLUMNS = 'id,status,assigned_rep_id,territory_id,roof_age_years,roof_age_verified,notes,updated_at,updated_by,lat,lng,geocode_match';

/** PostgREST `or` filter matching lead_map_boot's overlay predicate. */
export const LEAD_OVERLAY_OR = 'status.neq.New,assigned_rep_id.not.is.null,territory_id.not.is.null,roof_age_years.not.is.null,roof_age_verified.eq.true,notes.not.is.null,updated_by.not.is.null';

export function pageRanges(count, step = 1000) {
  const total = Math.max(0, Number(count) || 0);
  const size = Math.max(1, step || 1000);
  const ranges = [];
  for (let from = 0; from < total; from += size) ranges.push([from, Math.min(total, from + size) - 1]);
  return ranges;
}

/** Static houses plus the cloud fields that change, plus leads the file does not contain. */
export function mergeLeadOverlay(base, overlay, added) {
  const byId = new Map((base || []).map((lead) => [lead.id, { ...lead }]));
  for (const row of overlay || []) {
    if (!row?.id) continue;
    const prev = byId.get(row.id);
    if (!prev) {
      byId.set(row.id, { ...row });
      continue;
    }
    const next = { ...prev };
    for (const [key, value] of Object.entries(row)) {
      if (value !== null && value !== undefined) next[key] = value;
    }
    byId.set(row.id, next);
  }
  for (const row of added || []) {
    if (!row?.id) continue;
    byId.set(row.id, { ...(byId.get(row.id) || {}), ...row });
  }
  return [...byId.values()];
}

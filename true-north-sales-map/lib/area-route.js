import { ROUTE_STOP_LIMIT, pickRouteStops } from './route-picks.js';

/** Ray cast. Points outside the ring's box are outside the polygon. */
export function pointInPolygon(point, ring) {
  const x = Number(point?.lng);
  const y = Number(point?.lat);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Array.isArray(ring)) return false;
  const pts = ring.filter((p) => Number.isFinite(Number(p?.lat)) && Number.isFinite(Number(p?.lng)));
  if (pts.length > 3) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (Number(first.lat) === Number(last.lat) && Number(first.lng) === Number(last.lng)) pts.pop();
  }
  if (pts.length < 3) return false;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of pts) {
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  if (y < minLat || y > maxLat || x < minLng || x > maxLng) return false;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const yi = Number(pts[i].lat);
    const xi = Number(pts[i].lng);
    const yj = Number(pts[j].lat);
    const xj = Number(pts[j].lng);
    const dy = yj - yi;
    const crosses = (yi > y) !== (yj > y);
    if (crosses && x < ((xj - xi) * (y - yi)) / (dy === 0 ? 1e-12 : dy) + xi) inside = !inside;
  }
  return inside;
}

function milesBetween(a, b) {
  const lat1 = Number(a?.lat);
  const lng1 = Number(a?.lng);
  const lat2 = Number(b?.lat);
  const lng2 = Number(b?.lng);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Infinity;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 3958.7613 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Greedy nearest neighbor. `start` is the current location, not a stop. */
export function orderNearest(leads, start) {
  const remaining = (leads || []).slice();
  const out = [];
  let cursor = start;
  while (remaining.length) {
    let best = 0;
    let bestDist = Infinity;
    remaining.forEach((lead, index) => {
      const dist = milesBetween(cursor, lead);
      if (dist < bestDist) {
        bestDist = dist;
        best = index;
      }
    });
    const next = remaining.splice(best, 1)[0];
    out.push(next);
    cursor = next;
  }
  return out;
}

function finitePoint(point) {
  const lat = Number(point?.lat);
  const lng = Number(point?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/**
 * Houses inside the ring that match the caller's filters.
 * `score` uses the same prioritization as the work list: Not interested,
 * do-not-knock, and appointment leads score at or below -100 and are skipped.
 * The highest scores fill the route, then nearest-neighbor orders the drive
 * from the user's location, or from the first kept house.
 */
export function routeFromArea(leads, ring, options = {}) {
  const score = typeof options.score === 'function' ? options.score : () => 0;
  const limit = options.limit ?? ROUTE_STOP_LIMIT;
  const list = Array.isArray(leads) ? leads : [];
  const inside = list.filter((lead) => pointInPolygon(lead, ring));
  const actionable = inside.filter((lead) => score(lead) > -100);
  actionable.sort((a, b) => score(b) - score(a) || String(a.id).localeCompare(String(b.id)));
  const picked = pickRouteStops(actionable.map((lead) => lead.id), [], limit);
  const byId = new Map(actionable.map((lead) => [lead.id, lead]));
  const chosen = picked.chosen.map((id) => byId.get(id)).filter(Boolean);
  if (!chosen.length) {
    return { stops: [], leftOut: picked.leftOut, capped: picked.capped, inside: inside.length };
  }
  const start = finitePoint(options.start) || finitePoint(chosen[0]);
  return {
    stops: orderNearest(chosen, start),
    leftOut: picked.leftOut,
    capped: picked.capped,
    inside: inside.length
  };
}

/** Canvas pin diffs and low-zoom clusters. No Leaflet calls. */

export const STREET_ZOOM = 16;

export function pinDiff(shown, want) {
  const add = [];
  const remove = [];
  shown.forEach((id) => { if (!want.has(id)) remove.push(id); });
  want.forEach((id) => { if (!shown.has(id)) add.push(id); });
  return { add, remove };
}

export function clusterLeads(leads, zoom) {
  const cell = 180 / 2 ** Math.max(1, Math.min(18, Number(zoom) || 1));
  const groups = new Map();
  (leads || []).forEach((lead) => {
    if (lead?.lat == null || lead?.lng == null || lead.lat === '' || lead.lng === '') return;
    const lat = Number(lead.lat);
    const lng = Number(lead.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const key = `${Math.floor(lat / cell)}:${Math.floor(lng / cell)}`;
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = { lat: 0, lng: 0, count: 0 };
      groups.set(key, bucket);
    }
    bucket.lat += lat;
    bucket.lng += lng;
    bucket.count += 1;
  });
  return [...groups.values()].map((bucket) => ({
    lat: bucket.lat / bucket.count,
    lng: bucket.lng / bucket.count,
    count: bucket.count
  }));
}

export function sampleHeat(leads, limit = 4000) {
  const mapped = (leads || []).filter((lead) => lead?.lat != null && lead?.lng != null && lead.lat !== '' && lead.lng !== '' && Number.isFinite(Number(lead.lat)) && Number.isFinite(Number(lead.lng)));
  const step = Math.max(1, Math.ceil(mapped.length / limit));
  const points = [];
  for (let index = 0; index < mapped.length; index += step) points.push(mapped[index]);
  return points;
}

/** Never convert an unmatched Census row's null coordinates into a Gulf pin. */
export function geocodeUpdates(results) {
  return (Array.isArray(results) ? results : []).filter(row => {
    if (row.status !== 'Match' || row.lat == null || row.lng == null) return false;
    if (String(row.lat).trim() === '' || String(row.lng).trim() === '') return false;
    const lat = Number(row.lat), lng = Number(row.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  }).map(row => ({ id: row.id, lat: Number(row.lat), lng: Number(row.lng), geocode_match: row.matchType || row.status }));
}
/** Address matching and parcel centroids describe provenance, not roof precision. */
export function geocodeLabel(lead) {
  const lat = lead?.lat, lng = lead?.lng;
  if (lat == null || lng == null || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return 'Needs geocode';
  const match = String(lead.geocode_match || lead.geocodeMatch || '').toLowerCase();
  if (match.includes('parcel')) return 'Parcel center (approximate)';
  if (match.includes('non_exact')) return 'Approximate address match';
  if (match.includes('exact')) return 'Census address match';
  return 'Mapped location — verify house pin';
}

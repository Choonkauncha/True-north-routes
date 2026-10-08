/** In-app navigation helpers. OSRM foot profile is the walking mode. */
export const ARRIVAL_METERS = 40;
export const NAV_CHOICE_KEY = 'tnrc2:navChoice';

export function osrmProfile(mode) {
  return mode === 'walking' || mode === 'foot' ? 'foot' : 'driving';
}

export function googleTravelMode(mode) {
  return osrmProfile(mode) === 'foot' ? 'walking' : 'driving';
}

export function appleDirFlag(mode) {
  return osrmProfile(mode) === 'foot' ? 'w' : 'd';
}

export function isAppleDevice(ua = '', touchPoints = 0) {
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
}

export function metersBetween(a, b) {
  if (!a || !b) return Infinity;
  const lat1 = Number(a.lat);
  const lng1 = Number(a.lng);
  const lat2 = Number(b.lat);
  const lng2 = Number(b.lng);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Infinity;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function arrivedAtStop(user, stop, meters = ARRIVAL_METERS) {
  return metersBetween(user, stop) <= meters;
}

/** Straight-line fallback when the road router is down. Walking 3 mph, driving 25 mph. */
export function etaSeconds(meters, mode) {
  const mph = osrmProfile(mode) === 'foot' ? 3 : 25;
  const miles = Number(meters) / 1609.344;
  if (!Number.isFinite(miles) || miles < 0) return 0;
  return Math.round((miles / mph) * 3600);
}

export function readNavChoice(value) {
  return value === 'app' || value === 'google' || value === 'apple' ? value : '';
}

export function googleDirectionsUrl(origin, destination, mode) {
  const travel = googleTravelMode(mode);
  const dest = `${Number(destination.lat)},${Number(destination.lng)}`;
  const params = new URLSearchParams({ api: '1', destination: dest, travelmode: travel });
  if (origin && Number.isFinite(Number(origin.lat)) && Number.isFinite(Number(origin.lng))) {
    params.set('origin', `${Number(origin.lat)},${Number(origin.lng)}`);
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function appleDirectionsUrl(origin, stops, mode) {
  const flag = appleDirFlag(mode);
  const points = (stops || []).filter((stop) => Number.isFinite(Number(stop.lat)) && Number.isFinite(Number(stop.lng)));
  const daddr = points.map((stop) => `${Number(stop.lat)},${Number(stop.lng)}`).join('+to:');
  const saddr = origin && Number.isFinite(Number(origin.lat)) ? `${Number(origin.lat)},${Number(origin.lng)}` : '';
  return `https://maps.apple.com/?saddr=${encodeURIComponent(saddr)}&daddr=${daddr}&dirflg=${flag}`;
}

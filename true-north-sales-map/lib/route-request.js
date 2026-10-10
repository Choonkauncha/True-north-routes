export const ROUTE_MIN_COORDINATES = 2;
// The UI permits 80 stops; the request also includes the starting location.
export const ROUTE_MAX_COORDINATES = 81;

function finiteCoordinate(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeRouteRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Send a JSON object with coordinates.' };
  }
  if (!Array.isArray(body.coordinates)
    || body.coordinates.length < ROUTE_MIN_COORDINATES
    || body.coordinates.length > ROUTE_MAX_COORDINATES) {
    return { error: `Send ${ROUTE_MIN_COORDINATES}-${ROUTE_MAX_COORDINATES} coordinates.` };
  }
  const coordinates = [];
  for (let index = 0; index < body.coordinates.length; index += 1) {
    const point = body.coordinates[index];
    const lat = finiteCoordinate(point?.lat);
    const lng = finiteCoordinate(point?.lng);
    if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return { error: `Coordinate ${index + 1} is invalid.` };
    }
    coordinates.push({ lat, lng });
  }
  const profile = body.profile === 'foot' || body.profile === 'walking' ? 'foot' : 'driving';
  const service = body.service === 'route' ? 'route' : 'trip';
  return {
    coordinates,
    profile,
    service,
    wantSteps: body.steps === true && service === 'route'
  };
}

export function routeServiceUrl({ coordinates, profile, service, wantSteps }, env = {}) {
  const base = String(profile === 'foot' ? (env.OSRM_WALKING_BASE_URL || 'https://routing.openstreetmap.de/routed-foot') : (env.OSRM_DRIVING_BASE_URL || 'https://router.project-osrm.org')).replace(/\/$/, '');
  const packed = coordinates.map((point) => `${point.lng},${point.lat}`).join(';');
  return service === 'route'
    ? `${base}/route/v1/${profile}/${packed}?overview=full&geometries=geojson&steps=${wantSteps ? 'true' : 'false'}`
    : `${base}/trip/v1/${profile}/${packed}?roundtrip=false&source=first&destination=any&overview=full&geometries=geojson&steps=false`;
}

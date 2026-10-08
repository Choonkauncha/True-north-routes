/** Smooth in-app navigation: GPS filter, glide, route snap, calm reroute. */
import { metersBetween } from './route-nav.js';

export const SNAP_METERS = 22;
export const OFF_ROUTE_METERS = 40;
export const REROUTE_HOLD_MS = 3500;
export const REROUTE_COOLDOWN_MS = 8000;
export const READOUT_MS = 250;
export const MAX_ACCURACY_METERS = 65;

export function easeInOut(t) {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 2 * x * x : 1 - ((-2 * x + 2) ** 2) / 2;
}

export function bearingDegrees(a, b) {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function lerpAngle(from, to, t) {
  const delta = ((to - from + 540) % 360) - 180;
  return (from + delta * t + 360) % 360;
}

export function lineLatLngs(geometry) {
  const coords = geometry?.type === 'LineString' ? geometry.coordinates
    : geometry?.type === 'Feature' ? geometry.geometry?.coordinates
      : null;
  if (!Array.isArray(coords)) return [];
  return coords
    .map(([lng, lat]) => ({ lng: Number(lng), lat: Number(lat) }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
}

export function normalizeSteps(steps) {
  let along = 0;
  return (steps || []).map((step) => {
    const distance = Number(step.distance) || 0;
    const end = Number(step.endMeters);
    along += distance;
    return {
      type: step.type || step.maneuver?.type || 'continue',
      modifier: step.modifier || step.maneuver?.modifier || '',
      name: step.name || '',
      distance,
      endMeters: Number.isFinite(end) ? end : along
    };
  });
}

export function maneuverText(step) {
  if (!step) return '';
  const modifier = String(step.modifier || '').replace(/-/g, ' ');
  const onto = step.name ? ` onto ${step.name}` : '';
  const type = step.type || 'continue';
  if (type === 'arrive') return step.name ? `Arrive at ${step.name}` : 'Arrive';
  if (type === 'depart') return onto ? `Head${onto}` : 'Head out';
  if (type === 'turn' || type === 'end of road') return `Turn ${modifier}${onto}`.replace(/\s+/g, ' ').trim();
  if (type === 'roundabout' || type === 'rotary') return `Enter the roundabout${onto}`;
  if (type === 'fork' || type === 'merge') return `${type === 'merge' ? 'Merge' : 'Keep'} ${modifier}${onto}`.replace(/\s+/g, ' ').trim();
  if (modifier && type !== 'continue' && type !== 'new name') return `${modifier}${onto}`.trim();
  return `Continue${onto}`.trim();
}

export function activeStep(steps, alongMeters) {
  if (!steps?.length) return null;
  let index = 0;
  for (let i = 0; i < steps.length; i++) {
    index = i;
    if (alongMeters < steps[i].endMeters - 15) break;
  }
  return { index, step: steps[index] };
}

function toLocal(origin, point) {
  const lat0 = origin.lat * Math.PI / 180;
  return {
    x: (point.lng - origin.lng) * 111320 * Math.cos(lat0),
    y: (point.lat - origin.lat) * 110540
  };
}

function fromLocal(origin, x, y) {
  const lat0 = origin.lat * Math.PI / 180;
  return {
    lat: origin.lat + y / 110540,
    lng: origin.lng + x / (111320 * Math.cos(lat0) || 1e-6)
  };
}

/** Closest point on a lat/lng line. `distance` is meters off the line, `along` is meters from the start. */
export function snapToRoute(point, line, maxMeters = SNAP_METERS) {
  if (!point || !line || line.length < 2) {
    return { lat: point?.lat, lng: point?.lng, distance: Infinity, along: 0, snapped: false };
  }
  const origin = line[0];
  const here = toLocal(origin, point);
  let best = Infinity;
  let bestPoint = line[0];
  let along = 0;
  let bestAlong = 0;
  for (let i = 1; i < line.length; i++) {
    const a = toLocal(origin, line[i - 1]);
    const b = toLocal(origin, line[i]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const seg = Math.sqrt(len2);
    const t = len2 ? Math.min(1, Math.max(0, ((here.x - a.x) * dx + (here.y - a.y) * dy) / len2)) : 0;
    const x = a.x + dx * t;
    const y = a.y + dy * t;
    const dist = Math.hypot(here.x - x, here.y - y);
    if (dist < best) {
      best = dist;
      bestPoint = fromLocal(origin, x, y);
      bestAlong = along + seg * t;
    }
    along += seg;
  }
  const snapped = best <= maxMeters;
  return {
    lat: snapped ? bestPoint.lat : point.lat,
    lng: snapped ? bestPoint.lng : point.lng,
    distance: best,
    along: bestAlong,
    total: along,
    snapped
  };
}

/** Walk stays at street level. Drive is a wider view and eases out a little at speed. */
export const WALK_ZOOM = 18;
export const WALK_ZOOM_MOVING = 17.5;
export const DRIVE_ZOOM = 16;
export const DRIVE_ZOOM_CRUISE = 15.75;
export const DRIVE_ZOOM_FAST = 15.5;

export function navZoomFor(mode, speedMps = 0) {
  const walking = mode === 'walking' || mode === 'foot';
  const speed = Number(speedMps);
  const pace = Number.isFinite(speed) && speed > 0 ? speed : 0;
  if (walking) return pace >= 2.2 ? WALK_ZOOM_MOVING : WALK_ZOOM;
  if (pace >= 18) return DRIVE_ZOOM_FAST;
  if (pace >= 11) return DRIVE_ZOOM_CRUISE;
  return DRIVE_ZOOM;
}

export function navLookaheadPixels(mode, heading) {
  if (!Number.isFinite(Number(heading))) return 0;
  return mode === 'walking' || mode === 'foot' ? 112 : 148;
}

/** Shift the camera forward along heading so the marker sits lower and the road ahead fills the view. */
export function offsetCameraPoint(projected, heading, pixels) {
  const rad = (Number(heading) || 0) * Math.PI / 180;
  const shift = Number(pixels) || 0;
  return {
    x: projected.x + Math.sin(rad) * shift,
    y: projected.y - Math.cos(rad) * shift
  };
}

/** Split a routed line into the dim traveled part and the forward path. */
export function splitRoute(line, alongMeters) {
  if (!line || line.length < 2) return { traveled: [], ahead: line ? line.slice() : [] };
  const cut = Math.max(0, Number(alongMeters) || 0);
  let along = 0;
  const traveled = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const seg = metersBetween(a, b);
    if (along + seg <= cut + 0.01) {
      traveled.push(b);
      along += seg;
      continue;
    }
    const t = seg > 0 ? Math.min(1, Math.max(0, (cut - along) / seg)) : 0;
    const mid = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    if (t > 0.02) traveled.push(mid);
    return { traveled, ahead: [mid, b, ...line.slice(i + 1)] };
  }
  const last = line[line.length - 1];
  return { traveled, ahead: [last] };
}

export function createGpsFilter({
  maxAccuracy = MAX_ACCURACY_METERS,
  deadbandMeters = 3.5,
  maxSpeed = 45
} = {}) {
  let lat = null;
  let lng = null;
  let variance = 30 * 30;
  let heading = null;
  let lastAt = 0;
  return {
    reset() {
      lat = null;
      lng = null;
      variance = 30 * 30;
      heading = null;
      lastAt = 0;
    },
    push(fix, now = 0) {
      const nextLat = Number(fix?.lat);
      const nextLng = Number(fix?.lng);
      if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) return null;
      const accuracy = Number(fix.accuracy);
      const acc = Number.isFinite(accuracy) && accuracy > 0 ? accuracy : 30;
      if (acc > maxAccuracy && !(lat == null && acc <= 100)) return null;
      if (lat == null) {
        lat = nextLat;
        lng = nextLng;
        variance = acc * acc;
        heading = Number.isFinite(fix.heading) ? fix.heading : null;
        lastAt = now;
        return { lat, lng, heading, accuracy: acc, at: now, interval: 700 };
      }
      const dt = Math.max(0.05, (now - lastAt) / 1000);
      const jump = metersBetween({ lat, lng }, { lat: nextLat, lng: nextLng });
      if (jump > Math.max(80, acc * 3) && jump / dt > maxSpeed) return null;
      if (jump < Math.max(deadbandMeters, Math.min(8, acc * 0.3)) && dt < 2.2) return null;
      variance += (2.2 * dt) ** 2;
      const gain = Math.min(0.62, variance / (variance + acc * acc));
      const prev = { lat, lng };
      lat += gain * (nextLat - lat);
      lng += gain * (nextLng - lng);
      variance *= (1 - gain);
      let course = heading;
      if (jump > 4) course = bearingDegrees(prev, { lat, lng });
      if (Number.isFinite(fix.heading) && jump > 3) course = fix.heading;
      heading = course == null || heading == null ? course : lerpAngle(heading, course, 0.4);
      const interval = now - lastAt;
      lastAt = now;
      return { lat, lng, heading, accuracy: Math.sqrt(variance), at: now, interval };
    }
  };
}

export function createInterpolator() {
  let from = null;
  let to = null;
  let fromHeading = 0;
  let toHeading = 0;
  let start = 0;
  let duration = 1;
  const api = {
    setTarget(pos, now, instant = false) {
      const current = api.sample(now);
      from = current || pos;
      to = pos;
      fromHeading = current?.heading ?? pos.heading ?? 0;
      toHeading = Number.isFinite(pos.heading) ? pos.heading : fromHeading;
      start = now;
      const gap = Number(pos.interval) || 700;
      duration = instant ? 0 : Math.min(1100, Math.max(280, gap));
    },
    sample(now) {
      if (!to) return null;
      if (!from || duration <= 0) return { lat: to.lat, lng: to.lng, heading: toHeading ?? 0, settled: true };
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      const eased = easeInOut(t);
      return {
        lat: from.lat + (to.lat - from.lat) * eased,
        lng: from.lng + (to.lng - from.lng) * eased,
        heading: lerpAngle(fromHeading, toHeading, eased),
        settled: t >= 1
      };
    }
  };
  return api;
}

export function createRerouteGate({
  offMeters = OFF_ROUTE_METERS,
  holdMs = REROUTE_HOLD_MS,
  cooldownMs = REROUTE_COOLDOWN_MS
} = {}) {
  let offSince = 0;
  let lastRequest = -Infinity;
  return {
    consider(distance, now) {
      if (!(distance > offMeters)) {
        offSince = 0;
        return false;
      }
      if (!offSince) offSince = now;
      if (now - offSince < holdMs) return false;
      if (now - lastRequest < cooldownMs) return false;
      lastRequest = now;
      offSince = now;
      return true;
    }
  };
}

export function createReadoutThrottle(ms = READOUT_MS) {
  let last = -Infinity;
  let title = '';
  let meta = '';
  let pending = null;
  return {
    push(nextTitle, nextMeta, now, immediate = false) {
      if (nextTitle === title && nextMeta === meta) {
        pending = null;
        return null;
      }
      if (immediate || now - last >= ms) {
        last = now;
        title = nextTitle;
        meta = nextMeta;
        pending = null;
        return { title, meta };
      }
      pending = { title: nextTitle, meta: nextMeta };
      return null;
    },
    flush(now) {
      if (!pending || now - last < ms) return null;
      last = now;
      title = pending.title;
      meta = pending.meta;
      pending = null;
      return { title, meta };
    }
  };
}

export async function acquireScreenWakeLock(nav) {
  if (!nav?.wakeLock?.request) return null;
  try { return await nav.wakeLock.request('screen'); }
  catch { return null; }
}

export async function releaseScreenWakeLock(lock) {
  try { await lock?.release?.(); }
  catch { /* already released */ }
}

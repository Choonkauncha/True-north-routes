/** Remembered on the device. `1` collapsed, `0` expanded. Absent means no choice yet. */
export const ROUTE_TRAY_KEY = 'tnrc2:routeTrayCollapsed';

export function routeTraySummary(count, mode) {
  const n = Math.max(0, Number(count) || 0);
  const houses = n === 1 ? '1 house' : `${n} houses`;
  const travel = mode === 'walking' ? 'Walk' : 'Drive';
  return `Route · ${houses} · ${travel}`;
}

/** Phones with an empty route start collapsed until the device has a saved choice. */
export function routeTrayCollapsedByDefault({ saved, phone, houseCount }) {
  if (saved === '1') return true;
  if (saved === '0') return false;
  return Boolean(phone) && !(Number(houseCount) > 0);
}

/** Open the tray when the queue goes from empty to at least one house. */
export function shouldExpandRouteTray(previousCount, nextCount) {
  const prev = Number(previousCount);
  const next = Number(nextCount);
  if (!Number.isFinite(prev) || !Number.isFinite(next)) return false;
  return prev <= 0 && next > 0;
}

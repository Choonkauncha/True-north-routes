/** Shared route-stop limit for /api/route (OSRM trip accepts 2–80 coordinates). */
export const ROUTE_STOP_LIMIT = 80;

export function routeToggleLabel(onRoute) {
  return onRoute ? 'Remove from route' : 'Add to route';
}

/** Houses in the current map view, or the filtered set when the view has none. */
export function visibleRoutePool(inView, filtered) {
  return inView.length ? inView : filtered;
}

/**
 * Add ids that are not already selected, without passing the stop limit.
 * `leftOut` is how many candidates still are not on the route.
 */
export function pickRouteStops(candidateIds, alreadySelected, limit = ROUTE_STOP_LIMIT) {
  const seen = new Set(alreadySelected);
  const chosen = [];
  for (const id of candidateIds) {
    if (seen.has(id)) continue;
    if (seen.size >= limit) break;
    seen.add(id);
    chosen.push(id);
  }
  const leftOut = candidateIds.reduce((count, id) => count + (seen.has(id) ? 0 : 1), 0);
  return { chosen, leftOut, capped: leftOut > 0 };
}

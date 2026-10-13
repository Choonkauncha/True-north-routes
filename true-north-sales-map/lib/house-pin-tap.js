/** Tap a house dot to add it; retap a selected dot to remove it. */

export const ROUTE_PIN_COLOR = '#0f7a32';

/**
 * `open-detail` shows the address sheet or popup.
 * `add` puts the house on the route and leaves the map clear for the next tap.
 * A locked view (an admin looking at someone else's route) does not add.
 */
export function housePinAction({ onRoute, viewOnly }) {
  if (viewOnly) return 'open-detail';
  return onRoute ? 'remove' : 'add';
}

export function routeAddedMessage(address) {
  const place = String(address || '').trim() || 'Property lead';
  return `Added to route · ${place}`;
}

/** Extra pixels beyond the drawn radius. Phone total reach is at least 22px from the center (44px across). */
export function pinClickSlack(phone) {
  return phone ? 18 : 6;
}

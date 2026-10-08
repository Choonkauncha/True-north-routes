import { routeFromArea } from './lib/area-route.js';

/** Freehand lasso. Map panning stays off until the finger lifts or the user cancels. */
export function bindAreaDraw(api) {
  const catcher = document.getElementById('drawCatcher');
  const hud = document.getElementById('drawHud');
  let drawing = false;
  let pointerId = null;
  let points = [];
  let liveLine = null;
  let areaLayer = null;
  let mapLock = null;

  function map() {
    return api.getMap?.() || null;
  }

  function toLatLng(event) {
    const current = map();
    const rect = current.getContainer().getBoundingClientRect();
    return current.containerPointToLatLng(L.point(event.clientX - rect.left, event.clientY - rect.top));
  }

  function pixelDistance(a, b) {
    const current = map();
    if (!current || !a || !b) return Infinity;
    const pa = current.latLngToContainerPoint(a);
    const pb = current.latLngToContainerPoint(b);
    return Math.hypot(pa.x - pb.x, pa.y - pb.y);
  }

  function setDrawing(on) {
    drawing = on;
    document.body.classList.toggle('is-drawing', on);
    if (catcher) catcher.hidden = !on;
    if (hud) hud.hidden = !on;
    api.onDrawing?.(on);
    if (on) document.getElementById('drawCancel')?.focus();
  }

  function lockMap(current) {
    mapLock = {
      dragging: current.dragging.enabled(),
      touchZoom: current.touchZoom.enabled(),
      scroll: current.scrollWheelZoom.enabled(),
      double: current.doubleClickZoom.enabled(),
      box: current.boxZoom.enabled(),
      keyboard: current.keyboard.enabled(),
      tap: current.tap ? current.tap.enabled() : null
    };
    current.dragging.disable();
    current.touchZoom.disable();
    current.scrollWheelZoom.disable();
    current.doubleClickZoom.disable();
    current.boxZoom.disable();
    current.keyboard.disable();
    if (current.tap) current.tap.disable();
  }

  function unlockMap() {
    const current = map();
    const lock = mapLock;
    mapLock = null;
    if (!current || !lock) return;
    if (lock.dragging) current.dragging.enable();
    if (lock.touchZoom) current.touchZoom.enable();
    if (lock.scroll) current.scrollWheelZoom.enable();
    if (lock.double) current.doubleClickZoom.enable();
    if (lock.box) current.boxZoom.enable();
    if (lock.keyboard) current.keyboard.enable();
    if (lock.tap && current.tap) current.tap.enable();
  }

  function clearLive() {
    points = [];
    pointerId = null;
    if (liveLine) {
      liveLine.remove();
      liveLine = null;
    }
  }

  function drawLive() {
    const current = map();
    if (!current) return;
    const latlngs = points.map((point) => [point.lat, point.lng]);
    if (!liveLine) {
      liveLine = L.polyline(latlngs, { color: '#1e6bff', weight: 3, interactive: false }).addTo(current);
      return;
    }
    liveLine.setLatLngs(latlngs);
  }

  function showArea(latlngs) {
    const current = map();
    if (areaLayer) {
      areaLayer.remove();
      areaLayer = null;
    }
    if (!current || latlngs.length < 3) {
      document.getElementById('clearAreaBtn')?.classList.add('hidden');
      return;
    }
    areaLayer = L.polygon(latlngs, {
      color: '#0c1424',
      weight: 2,
      fillColor: '#1e6bff',
      fillOpacity: 0.16,
      interactive: false
    }).addTo(current);
    document.getElementById('clearAreaBtn')?.classList.remove('hidden');
  }

  function finishStroke() {
    const ring = points.slice();
    clearLive();
    if (ring.length < 3) {
      api.toast?.('Draw a larger loop around the houses, then let go.');
      return;
    }
    setDrawing(false);
    unlockMap();
    showArea(ring);
    const result = routeFromArea(api.getLeads?.() || [], ring, {
      score: (lead) => api.scoreLead?.(lead) ?? 0,
      start: api.getStart?.() || null
    });
    api.onRoute?.(result, ring);
  }

  function start() {
    const current = map();
    if (!current) {
      api.toast?.('The map is still loading.');
      return;
    }
    if (drawing) return;
    clearLive();
    setDrawing(true);
    lockMap(current);
  }

  function cancel() {
    clearLive();
    setDrawing(false);
    unlockMap();
  }

  function clearStroke() {
    clearLive();
    if (liveLine) liveLine.remove();
  }

  function clearArea() {
    if (areaLayer) {
      areaLayer.remove();
      areaLayer = null;
    }
    document.getElementById('clearAreaBtn')?.classList.add('hidden');
  }

  document.getElementById('drawAreaBtn')?.addEventListener('click', start);
  document.getElementById('drawAreaTrayBtn')?.addEventListener('click', start);
  document.getElementById('drawCancel')?.addEventListener('click', cancel);
  document.getElementById('drawClear')?.addEventListener('click', clearStroke);
  document.getElementById('clearAreaBtn')?.addEventListener('click', clearArea);

  catcher?.addEventListener('pointerdown', (event) => {
    if (!drawing || event.button > 0 || pointerId != null) return;
    event.preventDefault();
    pointerId = event.pointerId;
    catcher.setPointerCapture?.(event.pointerId);
    points = [toLatLng(event)];
    drawLive();
  }, { passive: false });

  catcher?.addEventListener('pointermove', (event) => {
    if (!drawing || event.pointerId !== pointerId) return;
    event.preventDefault();
    const next = toLatLng(event);
    if (pixelDistance(points[points.length - 1], next) < 8) return;
    points.push(next);
    drawLive();
  }, { passive: false });

  function endPointer(event) {
    if (!drawing || event.pointerId !== pointerId) return;
    event.preventDefault();
    finishStroke();
  }
  catcher?.addEventListener('pointerup', endPointer, { passive: false });
  catcher?.addEventListener('pointercancel', (event) => {
    if (event.pointerId !== pointerId) return;
    event.preventDefault();
    clearLive();
  }, { passive: false });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && drawing) cancel();
  });

  return { start, cancel, clearArea, isDrawing: () => drawing };
}

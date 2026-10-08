/** Heading-up view for Leaflet 1.9, which cannot rotate a map on its own.
 * Tiles and vector layers sit in a pane rotated around the screen center.
 * Marker icons are counter-rotated so labels stay upright.
 */

function rotatePoint(point, degrees, origin) {
  const rad = degrees * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const x = point.x - origin.x;
  const y = point.y - origin.y;
  return L.point(x * cos - y * sin + origin.x, x * sin + y * cos + origin.y);
}

function uprightTransform(el, up) {
  if (!el) return;
  const base = (el.style.transform || '').replace(/\s*rotate\([^)]*\)/g, '').trim();
  el.style.transformOrigin = 'center center';
  el.style.transform = up ? `${base} rotate(${up}deg)`.trim() : base;
}

function patchPrototype(proto, name, wrapper) {
  if (!proto || proto[`_tnPatched_${name}`]) return;
  const original = proto[name];
  if (typeof original !== 'function') return;
  proto[name] = wrapper(original);
  proto[`_tnPatched_${name}`] = true;
}

function installLeafletPatches() {
  patchPrototype(L.Marker.prototype, '_setPos', (original) => function setPos(pos) {
    original.call(this, pos);
    const up = this._map && this._map._tnUp;
    uprightTransform(this._icon, up || 0);
    uprightTransform(this._shadow, up || 0);
  });
  patchPrototype(L.Popup.prototype, '_updatePosition', (original) => function updatePopup() {
    original.apply(this, arguments);
    uprightTransform(this._container, this._map && this._map._tnUp);
  });
  patchPrototype(L.Tooltip.prototype, '_updatePosition', (original) => function updateTip() {
    original.apply(this, arguments);
    uprightTransform(this._container, this._map && this._map._tnUp);
  });
  patchPrototype(L.Renderer.prototype, '_update', (original) => function updateRenderer() {
    const map = this._map;
    if (!map || !map._tnUp) return original.apply(this, arguments);
    if (map._animatingZoom && this._bounds) return;
    const size = map.getSize();
    const pad = Number(this.options.padding) || 0;
    const corners = [
      [-size.x * pad, -size.y * pad],
      [size.x * (1 + pad), -size.y * pad],
      [size.x * (1 + pad), size.y * (1 + pad)],
      [-size.x * pad, size.y * (1 + pad)]
    ].map((pair) => map.containerPointToLayerPoint(pair).round());
    this._bounds = L.bounds(corners);
    this._topLeft = map.layerPointToLatLng(this._bounds.min);
    this._center = map.getCenter();
    this._zoom = map.getZoom();
  });
  patchPrototype(L.GridLayer.prototype, '_getTiledPixelBounds', (original) => function tiledBounds(center) {
    const bounds = original.call(this, center);
    const map = this._map;
    const up = map && map._tnUp;
    if (!up || this._tileZoom == null) return bounds;
    const mapZoom = map._animatingZoom ? Math.max(map._animateToZoom, map.getZoom()) : map.getZoom();
    const scale = map.getZoomScale(mapZoom, this._tileZoom) || 1;
    const size = map.getSize();
    const rad = Math.abs(up) * Math.PI / 180;
    const c = Math.abs(Math.cos(rad));
    const s = Math.abs(Math.sin(rad));
    const half = L.point((size.x * c + size.y * s) / (2 * scale), (size.x * s + size.y * c) / (2 * scale));
    const pixelCenter = bounds.getCenter();
    return L.bounds(pixelCenter.subtract(half), pixelCenter.add(half));
  });
}

function applyRotateTransform(map) {
  const pane = map._tnRotatePane;
  if (!pane) return;
  const up = map._tnUp || 0;
  if (!up) {
    pane.style.transform = '';
    return;
  }
  const center = map.getSize().divideBy(2);
  const origin = center.subtract(map._getMapPanePos());
  pane.style.transform = `translate(${origin.x}px, ${origin.y}px) rotate(${-up}deg) translate(${-origin.x}px, ${-origin.y}px)`;
}

function refreshUprightLayers(map) {
  if (!map._layers) return;
  Object.keys(map._layers).forEach((id) => {
    const layer = map._layers[id];
    if (!layer) return;
    if (typeof layer._setPos === 'function' && typeof layer.getLatLng === 'function') {
      try { layer._setPos(map.latLngToLayerPoint(layer.getLatLng())); } catch { /* layer not on the map */ }
    } else if (typeof layer._updatePosition === 'function') {
      try { layer._updatePosition(); } catch { /* popup not open */ }
    }
  });
}

export function installMapBearing(map) {
  if (!map || map._tnBearingInstalled || typeof L === 'undefined') return;
  installLeafletPatches();
  map._tnBearingInstalled = true;
  map._tnUp = 0;
  const mapPane = map.getPane('mapPane');
  const rotatePane = L.DomUtil.create('div', 'leaflet-pane leaflet-rotate-pane', mapPane);
  rotatePane.style.transformOrigin = '0 0';
  map._tnRotatePane = rotatePane;
  ['tilePane', 'overlayPane', 'shadowPane', 'markerPane', 'tooltipPane', 'popupPane'].forEach((name) => {
    const pane = map.getPane(name);
    if (pane && pane.parentNode !== rotatePane) rotatePane.appendChild(pane);
  });
  const createPane = map.createPane.bind(map);
  map.createPane = function createRotatingPane(name, container) {
    const fixed = name === 'mapPane' || name === 'rotatePane';
    return createPane(name, container || (fixed ? undefined : rotatePane));
  };
  const containerToLayer = map.containerPointToLayerPoint.bind(map);
  const layerToContainer = map.layerPointToContainerPoint.bind(map);
  const getBounds = map.getBounds.bind(map);
  map.containerPointToLayerPoint = function containerToLayerRotated(point) {
    const next = L.point(point);
    if (!this._tnUp) return containerToLayer(next);
    const center = this.getSize().divideBy(2);
    return rotatePoint(next, this._tnUp, center).subtract(this._getMapPanePos());
  };
  map.layerPointToContainerPoint = function layerToContainerRotated(point) {
    const next = L.point(point);
    if (!this._tnUp) return layerToContainer(next);
    const center = this.getSize().divideBy(2);
    return rotatePoint(next.add(this._getMapPanePos()), -this._tnUp, center);
  };
  map.getBounds = function boundsRotated() {
    if (!this._tnUp) return getBounds();
    const size = this.getSize();
    return L.latLngBounds([
      this.containerPointToLatLng([0, 0]),
      this.containerPointToLatLng([size.x, 0]),
      this.containerPointToLatLng([size.x, size.y]),
      this.containerPointToLatLng([0, size.y])
    ]);
  };
  map.on('move', () => { if (map._tnUp) applyRotateTransform(map); });
}

/** `heading` is the geographic direction that should point up. 0 restores north-up. */
export function setMapHeading(map, heading) {
  if (!map || !map._tnBearingInstalled) return;
  const next = Number.isFinite(Number(heading)) ? ((Number(heading) % 360) + 360) % 360 : 0;
  const changed = Math.abs((((next - (map._tnUp || 0)) + 540) % 360) - 180) > 0.2 || (next === 0 && map._tnUp);
  map._tnUp = next === 0 ? 0 : next;
  applyRotateTransform(map);
  if (!changed && next !== 0) return;
  refreshUprightLayers(map);
  const bucket = Math.round((map._tnUp || 0) / 12);
  if (bucket === map._tnTileBucket) return;
  map._tnTileBucket = bucket;
  if (!map._layers) return;
  const renderers = new Set();
  Object.keys(map._layers).forEach((id) => {
    const layer = map._layers[id];
    if (!layer) return;
    if (layer._url && typeof layer._update === 'function') {
      try { layer._update(); } catch { /* tiles catch up on the next move */ }
    }
    if (layer._renderer) renderers.add(layer._renderer);
  });
  renderers.forEach((renderer) => {
    try { renderer._update(); } catch { /* renderer redraws on the next view reset */ }
  });
}

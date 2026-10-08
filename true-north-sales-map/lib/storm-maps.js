/** Radar frames, warning polygons, and storm reports. No network calls. */
import { validPoint } from './weather.js';

export const STORM_TTL_MS = 10 * 60 * 1000;
export const STORM_CACHE_KEY = 'tn-storm-maps';
export const HAIL_MILES = 3;
export const KNOX_NEAR_MILES = 45;
export const KNOX_CENTER = { lat: 40.3931, lng: -82.4857 };
export const RAINVIEWER_MAPS = 'https://api.rainviewer.com/public/weather-maps.json';
export const NWS_AREA_ALERTS = 'https://api.weather.gov/alerts/active';
export const SPC_REPORTS = [
  ['hail', 'https://www.spc.noaa.gov/climo/reports/today_filtered_hail.csv'],
  ['hail', 'https://www.spc.noaa.gov/climo/reports/yesterday_filtered_hail.csv'],
  ['wind', 'https://www.spc.noaa.gov/climo/reports/today_filtered_wind.csv'],
  ['wind', 'https://www.spc.noaa.gov/climo/reports/yesterday_filtered_wind.csv'],
  ['torn', 'https://www.spc.noaa.gov/climo/reports/today_filtered_torn.csv'],
  ['torn', 'https://www.spc.noaa.gov/climo/reports/yesterday_filtered_torn.csv']
];

export const WARNING_COLORS = {
  tornado: '#c62828',
  hail: '#6a1b9a',
  wind: '#1565c0',
  thunderstorm: '#ef6c00'
};

const MILES = 3958.7613;

export function haversineMiles(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * MILES * Math.asin(Math.sqrt(a));
}

export function readStormCache(storage, now = Date.now()) {
  if (!storage) return null;
  let raw = null;
  try { raw = storage.getItem(STORM_CACHE_KEY); } catch { return null; }
  if (!raw) return null;
  let row;
  try { row = JSON.parse(raw); } catch { return null; }
  if (!row || typeof row.savedAt !== 'number' || now - row.savedAt > STORM_TTL_MS) return null;
  return row.payload || null;
}

export function writeStormCache(storage, payload, now = Date.now()) {
  if (!storage || !payload) return;
  try { storage.setItem(STORM_CACHE_KEY, JSON.stringify({ savedAt: now, payload })); } catch { /* storage can be full */ }
}

export function radarFrames(data, nowSec = Date.now() / 1000) {
  const host = String(data?.host || '').replace(/\/$/, '');
  const past = Array.isArray(data?.radar?.past) ? data.radar.past : [];
  const recent = past.filter((frame) => {
    const time = Number(frame?.time);
    return frame?.path && Number.isFinite(time) && nowSec - time <= 3600 && nowSec - time >= 0;
  });
  return (recent.length ? recent : past.filter((frame) => frame?.path).slice(-6)).slice(-6).map((frame) => ({
    time: Number(frame.time),
    url: `${host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`
  }));
}

function classifyStorm(text) {
  const blob = String(text || '').toLowerCase();
  if (!blob) return '';
  if (blob.includes('tornado')) return 'tornado';
  if (blob.includes('hail')) return 'hail';
  if (blob.includes('wind')) return 'wind';
  if (blob.includes('thunder') || blob.includes('severe')) return 'thunderstorm';
  return '';
}

export function warningKind(event, headline = '') {
  return classifyStorm(event) || classifyStorm(headline);
}

function paramText(value) {
  if (Array.isArray(value)) return String(value[0] || '');
  return String(value || '');
}

function measureLabel(raw, unit) {
  const text = paramText(raw).trim();
  if (!text) return '';
  const num = text.match(/(\d+(?:\.\d+)?)/);
  return num ? `${num[1]} ${unit}` : '';
}

function textMeasure(blob, patterns, unit) {
  for (const pattern of patterns) {
    const match = String(blob || '').match(pattern);
    if (match) return `${match[1]} ${unit}`;
  }
  return '';
}

export function hailLabel(props = {}) {
  const params = props.parameters || {};
  return measureLabel(params.hailSize || params.maxHailSize, 'in')
    || textMeasure(`${props.description || ''} ${props.headline || ''}`, [
      /hail size[^0-9]{0,24}(\d+(?:\.\d+)?)/i,
      /(\d+(?:\.\d+)?)\s*(?:inch|in)\b[^.]{0,16}hail/i
    ], 'in');
}

export function windLabel(props = {}) {
  const params = props.parameters || {};
  return measureLabel(params.windGust || params.maxWindGust, 'mph')
    || textMeasure(`${props.description || ''} ${props.headline || ''}`, [
      /wind gust[^0-9]{0,24}(\d+(?:\.\d+)?)/i,
      /(\d+(?:\.\d+)?)\s*mph\b[^.]{0,16}wind/i
    ], 'mph');
}

export function expiryLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

export function parseWarnings(data) {
  const features = Array.isArray(data) ? data : (data?.features || []);
  const warnings = [];
  features.forEach((feature, index) => {
    const props = feature?.properties || {};
    const geometry = feature?.geometry;
    const event = String(props.event || '');
    const headline = String(props.headline || '').trim();
    const kind = warningKind(event, headline);
    if (!kind || !geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) return;
    const expires = String(props.ends || props.expires || '');
    warnings.push({
      id: String(props.id || `warning-${index}`),
      event: event || 'Warning',
      kind,
      headline,
      hail: hailLabel(props),
      wind: windLabel(props),
      expires,
      expiresLabel: expiryLabel(expires),
      geometry
    });
  });
  return warnings;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1; }
        else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export function formatReportTime(time) {
  const raw = String(time || '').trim();
  if (/^\d{3,4}$/.test(raw)) {
    const padded = raw.padStart(4, '0');
    return `${padded.slice(0, 2)}:${padded.slice(2)}`;
  }
  return raw;
}

export function reportMarkerText(report) {
  const when = formatReportTime(report?.time);
  if (report?.kind === 'wind') return `Wind ${report.measure} mph · ${when}`;
  if (report?.kind === 'torn') return `Tornado ${report.measure} · ${when}`;
  return `Hail ${report?.measure || ''} in · ${when}`;
}

export function parseSpcCsv(text, kind) {
  const out = [];
  parseCsv(text).forEach((cols) => {
    if (cols.length < 7) return;
    const lat = Number(cols[5]);
    const lng = Number(cols[6]);
    const time = String(cols[0] || '').trim();
    if (!validPoint(lat, lng) || !/^\d{3,4}$/.test(time)) return;
    out.push({
      kind: kind === 'torn' ? 'torn' : kind === 'wind' ? 'wind' : 'hail',
      time,
      measure: String(cols[1] || '').trim(),
      location: String(cols[2] || '').trim(),
      county: String(cols[3] || '').trim(),
      state: String(cols[4] || '').trim(),
      lat,
      lng,
      comments: String(cols[7] || '').trim()
    });
  });
  return out;
}

export function reportsNearKnox(reports, center = KNOX_CENTER, miles = KNOX_NEAR_MILES) {
  return (reports || []).filter((report) => {
    if (!validPoint(report.lat, report.lng)) return false;
    const county = String(report.county || '').toLowerCase();
    const state = String(report.state || '').toUpperCase();
    if (county === 'knox' && state === 'OH') return true;
    return haversineMiles(center.lat, center.lng, report.lat, report.lng) <= miles;
  });
}

export function ringContains(ring, lat, lng) {
  if (!ring || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = Number(ring[i][0]);
    const yi = Number(ring[i][1]);
    const xj = Number(ring[j][0]);
    const yj = Number(ring[j][1]);
    const intersect = ((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function geometryContains(geometry, lat, lng) {
  const polygons = geometry?.type === 'Polygon'
    ? [geometry.coordinates]
    : geometry?.type === 'MultiPolygon'
      ? geometry.coordinates
      : [];
  return (polygons || []).some((polygon) => {
    if (!polygon?.length || !ringContains(polygon[0], lat, lng)) return false;
    return !polygon.slice(1).some((hole) => ringContains(hole, lat, lng));
  });
}

export function housesInStorm(leads, warnings, reports, hailMiles = HAIL_MILES) {
  const hail = (reports || []).filter((report) => report.kind === 'hail' && validPoint(report.lat, report.lng));
  const areas = (warnings || []).filter((warning) => warning.geometry);
  return (leads || []).filter((lead) => {
    const lat = Number(lead?.lat);
    const lng = Number(lead?.lng);
    if (!validPoint(lat, lng)) return false;
    if (areas.some((warning) => geometryContains(warning.geometry, lat, lng))) return true;
    return hail.some((report) => haversineMiles(lat, lng, report.lat, report.lng) <= hailMiles);
  });
}

export function buildStormPack({ radarData, alertData, csvTexts } = {}) {
  const reports = [];
  (csvTexts || []).forEach(([kind, text]) => {
    try { reports.push(...parseSpcCsv(text, kind)); } catch { /* one file can be unreadable */ }
  });
  let radar = [];
  let warnings = [];
  try { radar = radarFrames(radarData); } catch { radar = []; }
  try { warnings = parseWarnings(alertData); } catch { warnings = []; }
  return { radar, warnings, reports: reportsNearKnox(reports) };
}

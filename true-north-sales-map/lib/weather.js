/** Live forecast and alerts. No network calls. */

export const WEATHER_TTL_MS = 10 * 60 * 1000;
export const OPEN_METEO_FORECAST = 'https://api.open-meteo.com/v1/forecast';
export const NWS_ALERTS = 'https://api.weather.gov/alerts/active';
export const NWS_USER_AGENT = 'True North Restorations Sales Map';

const SEVERITY_RANK = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3 };

const WMO_LABELS = {
  0: 'Clear',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Fog',
  51: 'Drizzle',
  53: 'Drizzle',
  55: 'Drizzle',
  61: 'Rain',
  63: 'Rain',
  65: 'Rain',
  71: 'Snow',
  73: 'Snow',
  75: 'Snow',
  80: 'Rain showers',
  81: 'Rain showers',
  82: 'Rain showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm',
  99: 'Thunderstorm'
};

export function validPoint(lat, lng) {
  if (lat == null || lng == null || String(lat).trim() === '' || String(lng).trim() === '') return false;
  const latitude = Number(lat);
  const longitude = Number(lng);
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90
    && longitude >= -180 && longitude <= 180;
}

export function weatherCacheKey(lat, lng) {
  if (!validPoint(lat, lng)) return '';
  return `tn-weather:${Number(lat).toFixed(2)}:${Number(lng).toFixed(2)}`;
}

export function readWeatherCache(storage, key, now) {
  if (!key || !storage) return null;
  let raw = null;
  try { raw = storage.getItem(key); } catch { return null; }
  if (!raw) return null;
  let row;
  try { row = JSON.parse(raw); } catch { return null; }
  if (!row || typeof row.savedAt !== 'number' || now - row.savedAt > WEATHER_TTL_MS) return null;
  return row.payload || null;
}

export function writeWeatherCache(storage, key, payload, now) {
  if (!key || !payload || !storage) return;
  try { storage.setItem(key, JSON.stringify({ savedAt: now, payload })); } catch { /* storage can be full */ }
}

export function forecastUrl(lat, lng) {
  const url = new URL(OPEN_METEO_FORECAST);
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lng));
  url.searchParams.set('current', 'temperature_2m,weather_code,wind_speed_10m');
  url.searchParams.set('hourly', 'temperature_2m,precipitation_probability,weather_code');
  url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min');
  url.searchParams.set('temperature_unit', 'fahrenheit');
  url.searchParams.set('wind_speed_unit', 'mph');
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('forecast_days', '1');
  return url.toString();
}

export function alertsUrl(lat, lng) {
  return `${NWS_ALERTS}?point=${encodeURIComponent(`${Number(lat)},${Number(lng)}`)}`;
}

export function weatherLabel(code) {
  return WMO_LABELS[Number(code)] || 'Conditions';
}

function round(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function localHourStamp(now, offsetSeconds) {
  const shifted = new Date(now.getTime() + (Number(offsetSeconds) || 0) * 1000);
  return shifted.toISOString().slice(0, 13);
}

export function formatHourLabel(iso) {
  const match = String(iso || '').match(/T(\d{2})/);
  if (!match) return '';
  const hour = Number(match[1]);
  const clock = hour % 12 || 12;
  return `${clock}${hour < 12 ? 'a' : 'p'}`;
}

/** Current conditions, the next few hours, and today's high and low. */
export function parseForecast(data, now = new Date()) {
  const current = data?.current;
  const hourly = data?.hourly;
  const daily = data?.daily;
  if (!current || !hourly?.time?.length || !daily?.time?.length) return null;
  const temperature = round(current.temperature_2m);
  const windMph = round(current.wind_speed_10m);
  const high = round(daily.temperature_2m_max?.[0]);
  const low = round(daily.temperature_2m_min?.[0]);
  if (temperature == null || high == null || low == null) return null;
  const stamp = localHourStamp(now, data.utc_offset_seconds);
  let start = hourly.time.findIndex((time) => String(time).slice(0, 13) >= stamp);
  if (start < 0) start = Math.max(0, hourly.time.length - 5);
  const hours = [];
  for (let index = start; index < hourly.time.length && hours.length < 5; index += 1) {
    const temp = round(hourly.temperature_2m?.[index]);
    if (temp == null) continue;
    hours.push({
      time: hourly.time[index],
      label: formatHourLabel(hourly.time[index]),
      temp,
      rain: round(hourly.precipitation_probability?.[index])
    });
  }
  const rainChance = hours[0]?.rain ?? null;
  return {
    temperature,
    conditions: weatherLabel(current.weather_code),
    windMph,
    rainChance,
    high,
    low,
    hours
  };
}

function isFieldAlert(properties) {
  const blob = `${properties?.event || ''} ${properties?.headline || ''}`.toLowerCase();
  return /tornado|thunder|storm|hail|wind|hurricane/.test(blob);
}

/** Storm, hail, and wind alerts for a banner. Other products are left out. */
export function parseAlerts(data) {
  const rows = (data?.features || []).map((feature) => feature?.properties || {}).filter(isFieldAlert);
  rows.sort((a, b) => (SEVERITY_RANK[a.severity] ?? 4) - (SEVERITY_RANK[b.severity] ?? 4));
  return rows.slice(0, 3).map((properties) => ({
    id: String(properties.id || properties.event || ''),
    event: String(properties.event || 'Weather alert'),
    severity: String(properties.severity || ''),
    headline: String(properties.headline || properties.event || '').replace(/\s+/g, ' ').trim()
  }));
}

export function alertBannerText(alerts) {
  return (alerts || []).slice(0, 2).map((alert) => {
    const event = String(alert.event || '').trim();
    const headline = String(alert.headline || '').trim();
    if (!event) return headline;
    if (!headline || headline.toLowerCase().startsWith(event.toLowerCase())) return headline || event;
    return `${event}. ${headline}`;
  }).filter(Boolean).join(' ');
}

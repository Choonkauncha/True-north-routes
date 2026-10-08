import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WEATHER_TTL_MS,
  alertBannerText,
  alertsUrl,
  forecastUrl,
  parseAlerts,
  parseForecast,
  readWeatherCache,
  weatherCacheKey,
  writeWeatherCache
} from '../lib/weather.js';

const now = new Date('2026-10-08T18:00:00Z');
const forecast = parseForecast({
  utc_offset_seconds: -4 * 3600,
  current: { temperature_2m: 72.2, weather_code: 2, wind_speed_10m: 8.4 },
  hourly: {
    time: ['2026-10-08T12:00', '2026-10-08T13:00', '2026-10-08T14:00', '2026-10-08T15:00', '2026-10-08T16:00', '2026-10-08T17:00', '2026-10-08T18:00'],
    temperature_2m: [70, 71, 72, 74, 73, 71, 69],
    precipitation_probability: [10, 20, 30, 40, 25, 15, 5]
  },
  daily: { time: ['2026-10-08'], temperature_2m_max: [78.6], temperature_2m_min: [61.2] }
}, now);

assert.equal(forecast.temperature, 72);
assert.equal(forecast.conditions, 'Partly cloudy');
assert.equal(forecast.windMph, 8);
assert.equal(forecast.rainChance, 30);
assert.equal(forecast.high, 79);
assert.equal(forecast.low, 61);
assert.deepEqual(forecast.hours.map((hour) => hour.label), ['2p', '3p', '4p', '5p', '6p']);
assert.equal(forecast.hours[0].temp, 72);

assert.equal(parseForecast({}), null);
assert.equal(parseForecast(null), null);

const alerts = parseAlerts({
  features: [
    { properties: { id: 'frost', event: 'Frost Advisory', severity: 'Minor', headline: 'Frost Advisory' } },
    { properties: { id: 'wind', event: 'Wind Advisory', severity: 'Minor', headline: 'Wind Advisory until 8pm' } },
    { properties: { id: 'storm', event: 'Severe Thunderstorm Warning', severity: 'Severe', headline: 'Hail and damaging wind until 6pm' } }
  ]
});
assert.deepEqual(alerts.map((alert) => alert.event), ['Severe Thunderstorm Warning', 'Wind Advisory']);
assert.ok(alertBannerText(alerts).includes('Hail and damaging wind'));
assert.equal(alertBannerText(alerts).includes('Frost'), false);

assert.ok(forecastUrl(40.39, -82.49).startsWith('https://api.open-meteo.com/v1/forecast?'));
assert.ok(forecastUrl(40.39, -82.49).includes('temperature_unit=fahrenheit'));
assert.ok(alertsUrl(40.39, -82.49).includes('point=40.39%2C-82.49'));

const storage = new Map();
const memory = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
const key = weatherCacheKey(40.393, -82.486);
writeWeatherCache(memory, key, { forecast, alerts }, now.getTime());
assert.equal(readWeatherCache(memory, key, now.getTime() + WEATHER_TTL_MS - 1)?.forecast.temperature, 72);
assert.equal(readWeatherCache(memory, key, now.getTime() + WEATHER_TTL_MS + 1), null);
assert.equal(weatherCacheKey('nope', 1), '');

const root = dirname(fileURLToPath(import.meta.url));
const api = readFileSync(join(root, '../api/weather.js'), 'utf8');
const widget = readFileSync(join(root, '../weather-widget.js'), 'utf8');
const html = readFileSync(join(root, '../index.html'), 'utf8');
assert.ok(api.includes('https://api.open-meteo.com/v1/forecast') || api.includes('forecastUrl'));
assert.ok(api.includes('user-agent'));
assert.ok(api.includes('max-age=600'));
assert.equal(api.includes('alert('), false);
assert.ok(widget.includes('Map center'));
assert.ok(widget.includes('Your location'));
assert.equal(widget.includes('alert('), false);
assert.ok(html.includes('id="weatherWidget"'));
assert.ok(html.includes('id="weatherAlert"'));

console.log('weather.test.mjs ok');

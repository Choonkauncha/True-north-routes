import { alertBannerText, readWeatherCache, weatherCacheKey, writeWeatherCache } from './lib/weather.js';

const HOME = { lat: 40.3931, lng: -82.4857 };
let ticket = 0;
let started = false;

function pointFromMap(map) {
  if (!map) return HOME;
  const center = map.getCenter();
  return { lat: center.lat, lng: center.lng };
}

function fill(forecast, place) {
  const temp = document.getElementById('weatherTemp');
  const placeEl = document.getElementById('weatherPlace');
  const now = document.getElementById('weatherNow');
  const meta = document.getElementById('weatherMeta');
  const range = document.getElementById('weatherRange');
  const hours = document.getElementById('weatherHours');
  if (temp) temp.textContent = `${forecast.temperature}°`;
  if (placeEl) placeEl.textContent = place;
  if (now) now.textContent = forecast.conditions;
  const bits = [];
  if (forecast.windMph != null) bits.push(`Wind ${forecast.windMph} mph`);
  if (forecast.rainChance != null) bits.push(`Rain ${forecast.rainChance}%`);
  if (meta) meta.textContent = bits.join(' · ');
  if (range) range.textContent = `High ${forecast.high}° · Low ${forecast.low}°`;
  if (hours) {
    hours.replaceChildren(...(forecast.hours || []).map((hour) => {
      const cell = document.createElement('div');
      const label = document.createElement('span');
      const value = document.createElement('b');
      label.textContent = hour.label;
      value.textContent = `${hour.temp}°`;
      cell.append(label, value);
      return cell;
    }));
  }
}

function show(payload, place) {
  const stack = document.getElementById('weatherStack');
  const alertEl = document.getElementById('weatherAlert');
  const widget = document.getElementById('weatherWidget');
  if (!stack) return;
  const banner = alertBannerText(payload?.alerts);
  const forecast = payload?.forecast || null;
  if (!forecast && !banner) {
    stack.classList.add('hidden');
    return;
  }
  stack.classList.remove('hidden');
  if (alertEl) {
    alertEl.hidden = !banner;
    alertEl.textContent = banner;
  }
  if (widget) widget.hidden = !forecast;
  if (forecast) fill(forecast, place);
}

async function load(coords, place) {
  const mine = ++ticket;
  const key = weatherCacheKey(coords.lat, coords.lng);
  try {
    const cached = readWeatherCache(sessionStorage, key, Date.now());
    let payload = cached;
    if (!payload) {
      const response = await fetch(`/api/weather?lat=${encodeURIComponent(coords.lat)}&lng=${encodeURIComponent(coords.lng)}`);
      if (!response.ok) throw new Error('weather unavailable');
      payload = await response.json();
      if (payload?.forecast || (payload?.alerts || []).length) writeWeatherCache(sessionStorage, key, payload, Date.now());
    }
    if (mine !== ticket) return;
    show(payload, place);
  } catch {
    /* A down service leaves the widget hidden. */
  }
}

function gpsOnce() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, maximumAge: 10 * 60 * 1000, timeout: 8000 }
    );
  });
}

export function startMapWeather(map) {
  if (!document.getElementById('weatherStack') || started) return;
  started = true;
  const center = pointFromMap(map);
  const gps = gpsOnce();
  const early = new Promise((resolve) => setTimeout(() => resolve('center'), 1200));
  Promise.race([gps.then((coords) => coords || 'denied'), early]).then(async (result) => {
    if (result && result !== 'center' && result !== 'denied') {
      await load(result, 'Your location');
      return;
    }
    if (result === 'denied') {
      await load(center, 'Map center');
      return;
    }
    await load(center, 'Map center');
    const coords = await gps;
    if (coords) await load(coords, 'Your location');
  }).catch(() => {});
}

export function setWeatherLocation(coords) {
  if (!coords || !Number.isFinite(Number(coords.lat)) || !Number.isFinite(Number(coords.lng))) return;
  load({ lat: Number(coords.lat), lng: Number(coords.lng) }, 'Your location');
}

import { alertsUrl, forecastUrl, NWS_USER_AGENT, parseAlerts, parseForecast, validPoint } from '../lib/weather.js';

const headers = { 'content-type': 'application/json', 'cache-control': 'public, max-age=600' };
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers });

async function pull(url, extraHeaders) {
  try {
    const response = await fetch(url, { headers: extraHeaders, signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const lat = url.searchParams.get('lat');
    const lng = url.searchParams.get('lng');
    if (!validPoint(lat, lng)) return json({ forecast: null, alerts: [] });
    const [forecastRaw, alertsRaw] = await Promise.all([
      pull(forecastUrl(lat, lng)),
      pull(alertsUrl(lat, lng), { accept: 'application/geo+json', 'user-agent': NWS_USER_AGENT })
    ]);
    return json({
      forecast: parseForecast(forecastRaw),
      alerts: parseAlerts(alertsRaw)
    });
  }
};

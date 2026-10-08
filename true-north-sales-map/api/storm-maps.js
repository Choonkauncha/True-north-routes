import { NWS_USER_AGENT } from '../lib/weather.js';
import { NWS_AREA_ALERTS, RAINVIEWER_MAPS, SPC_REPORTS, buildStormPack } from '../lib/storm-maps.js';

const headers = { 'content-type': 'application/json', 'cache-control': 'public, max-age=600' };
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers });

async function pullJson(url, extraHeaders) {
  try {
    const response = await fetch(url, { headers: extraHeaders, signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function pullText(url) {
  try {
    const response = await fetch(url, {
      headers: { accept: 'text/csv,*/*', 'user-agent': NWS_USER_AGENT },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return '';
    return await response.text();
  } catch {
    return '';
  }
}

export default {
  async fetch() {
    const [radarData, alertData, ...csvTexts] = await Promise.all([
      pullJson(RAINVIEWER_MAPS, { accept: 'application/json', 'user-agent': NWS_USER_AGENT }),
      pullJson(`${NWS_AREA_ALERTS}?area=OH`, { accept: 'application/geo+json', 'user-agent': NWS_USER_AGENT }),
      ...SPC_REPORTS.map(([, url]) => pullText(url))
    ]);
    return json(buildStormPack({
      radarData,
      alertData,
      csvTexts: SPC_REPORTS.map(([kind], index) => [kind, csvTexts[index]])
    }));
  }
};

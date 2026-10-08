import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HAIL_MILES,
  STORM_TTL_MS,
  buildStormPack,
  formatReportTime,
  geometryContains,
  hailLabel,
  housesInStorm,
  parseSpcCsv,
  parseWarnings,
  radarFrames,
  readStormCache,
  reportMarkerText,
  reportsNearKnox,
  warningKind,
  windLabel,
  writeStormCache
} from '../lib/storm-maps.js';

const nowSec = 1_700_000_000;
const frames = radarFrames({
  host: 'https://tilecache.rainviewer.com',
  radar: {
    past: [
      { time: nowSec - 5000, path: '/v2/radar/old' },
      { time: nowSec - 3000, path: '/v2/radar/50' },
      { time: nowSec - 2400, path: '/v2/radar/40' },
      { time: nowSec - 1800, path: '/v2/radar/30' },
      { time: nowSec - 1200, path: '/v2/radar/20' },
      { time: nowSec - 600, path: '/v2/radar/10' },
      { time: nowSec, path: '/v2/radar/0' },
      { time: nowSec + 600, path: '/v2/radar/future' }
    ]
  }
}, nowSec);
assert.equal(frames.length, 6);
assert.equal(frames[0].url, 'https://tilecache.rainviewer.com/v2/radar/50/256/{z}/{x}/{y}/2/1_1.png');
assert.equal(frames.some((frame) => frame.url.includes('future') || frame.url.includes('/old/')), false);
assert.deepEqual(radarFrames(null), []);

assert.equal(warningKind('Tornado Warning'), 'tornado');
assert.equal(warningKind('Severe Thunderstorm Warning', 'Hail and wind'), 'thunderstorm');
assert.equal(warningKind('High Wind Warning'), 'wind');
assert.equal(warningKind('Special Weather Statement', 'Penny hail downtown'), 'hail');

const warnings = parseWarnings({
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-82.48, 40.39] },
      properties: { event: 'Tornado Warning', headline: 'Skip points' }
    },
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-82.4872, 40.3751],
          [-82.4858, 40.3751],
          [-82.4858, 40.3766],
          [-82.4872, 40.3766],
          [-82.4872, 40.3751]
        ]]
      },
      properties: {
        id: 'svr-1',
        event: 'Severe Thunderstorm Warning',
        headline: 'Severe Thunderstorm Warning for Mount Vernon',
        ends: '2026-10-08T22:00:00-04:00',
        description: 'MAX HAIL SIZE...1.00 IN. MAX WIND GUST...60 MPH.',
        parameters: { hailSize: ['1.75'] }
      }
    }
  ]
});
assert.equal(warnings.length, 1);
assert.equal(warnings[0].kind, 'thunderstorm');
assert.equal(warnings[0].hail, '1.75 in');
assert.equal(warnings[0].wind, '60 mph');
assert.equal(warnings[0].expiresLabel, 'Oct 8, 10:00 PM');
assert.equal(hailLabel({ description: 'MAX HAIL SIZE...1.00 IN' }), '1.00 in');
assert.equal(windLabel({ parameters: { maxWindGust: '70 MPH' } }), '70 mph');

const hole = {
  type: 'Polygon',
  coordinates: [
    [[-83, 40], [-82, 40], [-82, 41], [-83, 41], [-83, 40]],
    [[-82.7, 40.3], [-82.3, 40.3], [-82.3, 40.7], [-82.7, 40.7], [-82.7, 40.3]]
  ]
};
assert.equal(geometryContains(hole, 40.1, -82.9), true);
assert.equal(geometryContains(hole, 40.5, -82.5), false);
assert.equal(geometryContains(warnings[0].geometry, 40.3753, -82.4867), true);
assert.equal(geometryContains(warnings[0].geometry, 40.39, -82.49), false);

const csv = [
  'Time,Size,Location,County,State,Lat,Lon,Comments',
  '1945,1.75,3 E DANVILLE,KNOX,OH,40.45,-82.20,"HAIL, QUARTER SIZED"',
  '0100,1.00,FAR AWAY,KNOX,KY,36.00,-84.00,other state',
  '0200,0.88,CLOSE,LICKING,OH,40.39,-82.40,nearby',
  '0300,2.00,MIAMI,MIAMI-DADE,FL,25.76,-80.19,too far',
  'bad,1,X,KNOX,OH,nope,nope,skip'
].join('\n');
const parsed = parseSpcCsv(csv, 'hail');
assert.equal(parsed.length, 4);
assert.equal(parsed[0].comments, 'HAIL, QUARTER SIZED');
assert.equal(formatReportTime('1945'), '19:45');
assert.equal(reportMarkerText(parsed[0]), 'Hail 1.75 in · 19:45');
const near = reportsNearKnox(parsed);
assert.deepEqual(near.map((row) => row.county), ['KNOX', 'LICKING']);

const wind = parseSpcCsv('Time,Speed,Location,County,State,Lat,Lon,Comments\n1810,60,MOUNT VERNON,KNOX,OH,40.393,-82.486,gust', 'wind');
assert.equal(reportMarkerText(wind[0]), 'Wind 60 mph · 18:10');
const torn = parseSpcCsv('Time,F_Scale,Location,County,State,Lat,Lon,Comments\n1740,EF0,CENTERBURG,KNOX,OH,40.30,-82.45,brief', 'torn');
assert.equal(reportMarkerText(torn[0]), 'Tornado EF0 · 17:40');

const leads = [
  { id: 'inside', lat: 40.3753, lng: -82.4867 },
  { id: 'hole', lat: 40.5, lng: -82.5 },
  { id: 'near-hail', lat: 40.45, lng: -82.20 },
  { id: 'four-miles', lat: 40.50, lng: -82.20 },
  { id: 'by-wind', lat: 40.393, lng: -82.486 },
  { id: 'blank', lat: null, lng: null }
];
const hits = housesInStorm(leads, warnings, [...near, ...wind, ...torn]);
assert.equal(HAIL_MILES, 3);
assert.deepEqual(hits.map((lead) => lead.id).sort(), ['inside', 'near-hail']);

const pack = buildStormPack({
  radarData: { host: 'https://tilecache.rainviewer.com', radar: { past: [{ time: nowSec, path: '/v2/radar/0' }] } },
  alertData: { features: [] },
  csvTexts: [['hail', csv]]
});
assert.equal(pack.radar.length, 1);
assert.equal(pack.warnings.length, 0);
assert.equal(pack.reports.length, 2);
assert.deepEqual(buildStormPack({}), { radar: [], warnings: [], reports: [] });

const storage = new Map();
const memory = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
const savedAt = Date.parse('2026-10-08T18:00:00Z');
writeStormCache(memory, pack, savedAt);
assert.equal(readStormCache(memory, savedAt + STORM_TTL_MS - 1).radar.length, 1);
assert.equal(readStormCache(memory, savedAt + STORM_TTL_MS + 1), null);

const root = dirname(fileURLToPath(import.meta.url));
const api = readFileSync(join(root, '../api/storm-maps.js'), 'utf8');
const app = readFileSync(join(root, '../app.js'), 'utf8');
const html = readFileSync(join(root, '../index.html'), 'utf8');
assert.ok(api.includes('RAINVIEWER_MAPS'));
assert.ok(api.includes('SPC_REPORTS'));
assert.ok(api.includes('user-agent'));
assert.ok(api.includes('max-age=600'));
assert.equal(api.includes('alert('), false);
assert.ok(html.includes('data-layer="radar"'));
assert.ok(html.includes('data-layer="warnings"'));
assert.ok(html.includes('data-layer="reports"'));
assert.ok(html.includes('id="stormHousesBtn"'));
assert.ok(app.includes('housesInStorm'));
assert.ok(app.includes('function housesInStormArea'));
assert.ok(app.includes('stormHouseIds'));
assert.equal(app.slice(app.indexOf('function housesInStormArea'), app.indexOf('function housesInStormArea') + 800).includes('alert('), false);

console.log('storm-maps.test.mjs ok');

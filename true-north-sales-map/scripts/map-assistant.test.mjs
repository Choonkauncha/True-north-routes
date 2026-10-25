import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { clusterLeads } from '../lib/pin-layer.js';
import { planTimedRoute } from '../lib/timed-route.js';
import { validateMapTool, toolDefinitions } from '../lib/voice-tools.js';
import { recentOhioStorms } from '../lib/ohio-storms.js';
import { handleVoiceAction } from '../api/coach.js';
import { clampOrbPosition } from '../tn-files/orb-position.js';

// 1. Core map assistant data & API tests
const leads = Array.from({ length: 100 }, (_, i) => ({ id: `h${i}`, lat: 40 + i * 0.0001, lng: -82, address: `${i + 1} Main St` }));
const clusters = clusterLeads(leads, 10);
assert.equal(clusters.reduce((n, c) => n + c.leadIds.length, 0), 100);
assert.equal(new Set(clusters.flatMap(c => c.leadIds)).size, 100);
const plan = planTimedRoute(leads, { minutes: 120, stopMinutes: 5 });
assert.ok(plan.stops.length <= 24 && plan.stops.length >= 20);
assert.ok(plan.travelMinutes + plan.stops.length * 5 <= 120);
assert.equal(planTimedRoute([], {}).stops.length, 0);
assert.throws(() => planTimedRoute(leads, { minutes: 0 }));
const invalidPoints = [{ lat: null, lng: null }, { lat: ' ', lng: -82 }, { lat: true, lng: -82 }, { lat: 91, lng: -82 }, { lat: 40, lng: -181 }].map((point, i) => ({ id: `invalid-${i}`, ...point }));
const validPlan = planTimedRoute([...invalidPoints, ...leads.slice(0, 2)], { start: { lat: null, lng: null } });
assert.equal(validPlan.available, 2, 'timed routes ignore houses without valid map points');
assert.deepEqual(validPlan.stops.map(stop => stop.id), ['h0', 'h1']);
assert.ok(Number.isFinite(validPlan.travelMinutes), 'invalid starting location falls back to a mapped house');
assert.equal(validateMapTool({ name: 'build_timed_route', args: { minutes: 120 } }).args.stop_minutes, 5);
for (const call of [{ name: 'delete_profile' }, { name: 'build_timed_route', args: { minutes: Infinity } }, { name: 'route_navigation', args: { action: 'eval' } }, { name: 'recent_ohio_storms', args: { days: 100 } }]) {
  assert.throws(() => validateMapTool(call));
}
assert.ok(toolDefinitions('appointment_setter', { map: true })[0].functionDeclarations.some(t => t.name === 'recent_ohio_storms'));
const storms = await recentOhioStorms({
  days: 1,
  now: new Date('2026-10-14T13:00:00Z'),
  fetchImpl: async url => url.includes('weather.gov') ? new Response(JSON.stringify({ features: [] })) : new Response('Time,Size,Location,County,State,Lat,Lon,Comments\n0130,175,Town,Knox,OH,40.39,-82.48,Report\n1400,100,Elsewhere,Other,IN,40,-85,Report')
});
assert.equal(storms.reports.length, 3);
assert.equal(storms.reports[0].capturedAt, '2026-10-15T01:30:00.000Z');
assert.equal(storms.reports.find(r => r.kind === 'hail').measure, 1.75);
assert.equal(storms.partial, false);
const failed = await recentOhioStorms({ days: 1, fetchImpl: async () => new Response('bad', { status: 503 }) });
assert.equal(failed.partial, true);
assert.equal(failed.reportCount, 0);

const rep = '11111111-1111-4111-8111-111111111111', user = '22222222-2222-4222-8222-222222222222';
let enabled = true;
const fetchImpl = async (url, options = {}) => {
  if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: user }));
  if (url.includes('/reps?')) return new Response(JSON.stringify([{ id: rep, name: 'Setter', role: 'appointment_setter' }]));
  if (url.includes('feature_enabled')) return new Response(JSON.stringify(enabled || JSON.parse(options.body).requested !== 'routes'));
  if (url.includes('password_gate_status')) return new Response(JSON.stringify({ must_change: false, impersonating: false }));
  return new Response('[]');
};
const request = (toolCall = { name: 'build_timed_route', args: { minutes: 120 } }) => new Request('https://app.test/api/coach', {
  method: 'POST',
  headers: { authorization: 'Bearer signed-in' },
  body: JSON.stringify({ workspace: 'map', actorId: 'spoof', toolCall })
});
const options = { env: { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'public' }, fetchImpl };
let response = await handleVoiceAction(request(), options);
assert.equal(response.status, 200);
assert.equal((await response.json()).actorId, user);
enabled = false;
response = await handleVoiceAction(request(), options);
assert.equal(response.status, 403);
for (const toolCall of [{ name: 'build_route', args: { count: 12 } }, { name: 'clear_route', args: {} }, { name: 'find_priority_leads', args: { count: 10 } }]) {
  enabled = true;
  const allowed = await handleVoiceAction(request(toolCall), options);
  assert.equal(allowed.status, 200);
  const data = await allowed.json();
  assert.equal(data.actorId, user);
  assert.equal(data.execute.name, toolCall.name);
  enabled = false;
  assert.equal((await handleVoiceAction(request(toolCall), options)).status, 403);
}

// 2. Playwright browser verification of single-sentence inline translucent HUD, Tap-to-Start, and Expanded Capabilities
assert.deepEqual(clampOrbPosition(-40, 9999, 390, 844, 82), { x: 8, y: 754 });

const root = process.cwd();
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/api/config') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ configured: false }));
    return;
  }
  if (url.pathname === '/api/coach') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body || '{}');
    res.writeHead(200, { 'content-type': 'application/json' });
    if (parsed.toolCall?.name === 'recent_ohio_storms') {
      res.end(JSON.stringify({ reportCount: 4, partial: false }));
      return;
    }
    res.end(JSON.stringify({ authorized: true, actorId: 'user-1', execute: parsed.toolCall }));
    return;
  }
  const rel = url.pathname === '/' ? '/account.html' : url.pathname;
  try {
    const file = path.join(root, decodeURIComponent(rel));
    const buf = await readFile(file);
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const page = await browser.newPage({ viewport });
    await page.goto(`${base}/account.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#tnMapAssistant .mapAssistantLauncher canvas');

    // No legacy popup card, no separate button grid, no colored dots, no extra control buttons
    assert.equal(await page.locator('.mapAssistantPanel').count(), 0, 'legacy popup module must not exist');
    assert.equal(await page.locator('.mapAssistantWords').count(), 0, 'no separate 2x2 button grid below whisper');
    assert.equal(await page.locator('.mapAssistantWordDot').count(), 0, 'no colored legend dots');
    assert.equal(await page.locator('#tnMapAssistant [data-pause], #tnMapAssistant [data-end], #tnMapAssistant [data-close]').count(), 0, 'no extra control button chrome');
    assert.equal(await page.locator('#tnMapAssistantHud').isVisible(), false, 'HUD starts hidden until tap-to-start');
    assert.equal(await page.locator('[data-tap-hint]').textContent(), 'Tap to start');

    const box = await page.locator('#tnMapAssistant .mapAssistantLauncher').boundingBox();
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height);

    // Dragging moves the orb without triggering tap-to-start
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(20, 40, { steps: 5 });
    await page.mouse.up();
    const moved = await page.locator('#tnMapAssistant .mapAssistantLauncher').boundingBox();
    assert.ok(moved.x < box.x && moved.y < box.y, 'orb can be dragged across the screen');
    assert.equal(await page.locator('#tnMapAssistantHud').isVisible(), false, 'dragging must not open HUD');

    // Tap-to-start opens the minimalist HUD with Sentence 1 first and hides the tap hint badge
    await page.click('#tnMapAssistant .mapAssistantLauncher');
    await page.waitForSelector('#tnMapAssistantHud', { state: 'visible' });
    assert.equal(await page.locator('[data-tap-hint]').isVisible(), false, 'no LISTENING badge when active');
    assert.equal(await page.locator('[data-whisper-text]').textContent(), "Hi, I'm your True North assistant.");
    assert.equal(await page.locator('[data-whisper-text] .mapAssistantWord').count(), 0, 'no inline buttons on step 1');

    // Sentence 2 renders inline translucent action words inside the single sentence
    await page.waitForFunction(() => document.querySelector('[data-whisper-text]')?.dataset.step === '2');
    assert.equal(await page.locator('[data-whisper-text] .mapAssistantWord').count(), 2, '2 inline action buttons inside sentence 2');

    // Sentence 3 replaces Sentence 2 with its own 2 inline action words (not accumulated)
    await page.waitForFunction(() => document.querySelector('[data-whisper-text]')?.dataset.step === '3');
    assert.equal(await page.locator('[data-whisper-text] .mapAssistantWord').count(), 2, 'only sentence 3 inline action buttons on screen');

    // Sentence 4 rests with 3 inline compact action words inside the single sentence
    await page.waitForFunction(() => document.querySelector('[data-whisper-text]')?.dataset.step === '4');
    assert.equal(await page.locator('[data-whisper-text] .mapAssistantWord').count(), 3, '3 inline action buttons on resting prompt');

    const hudBox = await page.locator('#tnMapAssistantHud').boundingBox();
    assert.ok(hudBox.x >= 0 && hudBox.y >= 0 && hudBox.x + hudBox.width <= viewport.width && hudBox.y + hudBox.height <= viewport.height, 'HUD stays within viewport after drag');

    // Verify translucent glassmorphism on whisper pill and inline action words
    const wordStyle = await page.locator('.mapAssistantWord').first().evaluate(el => {
      const cs = getComputedStyle(el);
      return { backdrop: cs.backdropFilter || cs.webkitBackdropFilter };
    });
    assert.match(wordStyle.backdrop, /blur/i, 'inline action words use translucent glassmorphic blur');

    // Tapping the orb again stops/closes the HUD cleanly
    await page.click('#tnMapAssistant .mapAssistantLauncher');
    assert.equal(await page.locator('#tnMapAssistantHud').isVisible(), false);

    // Verify dialogue stays hidden while agent is loading/connecting and only starts appearing when the agent actually starts talking
    await page.evaluate(async () => {
      const NativeSocket = window.WebSocket;
      class ControlledLiveSocket {
        static OPEN = 1;
        constructor(url) {
          if (!String(url).includes("BidiGenerateContentConstrained")) return new NativeSocket(url);
          this.readyState = 0;
          this.sent = [];
          window.__controlledLive = this;
          setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 10);
        }
        send(raw) {
          const data = JSON.parse(raw);
          this.sent.push(data);
        }
        receive(data) {
          this.onmessage?.({ data: JSON.stringify(data) });
        }
        close() {
          this.readyState = 3;
          this.onclose?.({ code: 1000 });
        }
      }
      window.WebSocket = ControlledLiveSocket;
      const origFetch = window.fetch.bind(window);
      window.fetch = async (url, opts) => {
        if (String(url).includes("/api/live-token")) {
          await new Promise(r => setTimeout(r, 120));
          return new Response(JSON.stringify({
            token: "test-ephemeral-token",
            model: "gemini-3.8-live",
            voice: "Kore",
            expiresAt: new Date(Date.now() + 600000).toISOString(),
            systemInstruction: "Test map assistant."
          }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return origFetch(url, opts);
      };
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: async () => new AudioContext().createMediaStreamDestination().stream
        }
      });
    });

    // Mount with authenticated map context and verify inline action words & spoken intents
    await page.evaluate(async () => {
      const { mountMapAssistant } = await import('/tn-files/map-assistant.js');
      window.__calls = [];
      window.__assistant = mountMapAssistant({
        rep: { id: 'rep-1', user_id: 'user-1', name: 'Rep', role: 'admin' },
        sb: { auth: { getSession: async () => ({ data: { session: { access_token: 't', user: { id: 'user-1' } } } }) } },
        getMapContext: async () => ({ selectedCount: 2, route: [{ id: 'a' }, { id: 'b' }] }),
        executeMapAction: async (name, args) => {
          window.__calls.push({ name, args });
          if (name === 'clear_route') return { status: 'cleared', executed: true, removed: 2 };
          if (name === 'find_priority_leads') return { status: 'prioritized', executed: true, selectedCount: args.count || 12, topAddress: '412 Oak St' };
          if (name === 'filter_leads') return { status: 'filtered', executed: true, filterStatus: args.status, visibleCount: 19 };
          if (name === 'log_door_status') return { status: 'door_logged', executed: true, doorStatus: args.status, label: args.status === 'Knocked' ? 'Answered' : args.status, address: '412 Oak St' };
          if (name === 'summarize_status') return { status: 'summary', executed: true, total: 42, untouched: 28, knocked: 9, interested: 3, routeStops: 6 };
          return { status: 'built', executed: true, stops: 6, estimatedMinutes: args.minutes || 35, approximate: Boolean(args.minutes) };
        }
      });
    });

    await page.click('#tnMapAssistant .mapAssistantLauncher');
    // Immediately after tap, while loading/connecting before the agent talks, the dialogue HUD MUST stay hidden
    assert.equal(await page.locator('#tnMapAssistantHud').isVisible(), false, 'dialogue must not appear before agent is loaded and talking');
    assert.equal(await page.locator('#tnMapAssistant .mapAssistantLauncher').getAttribute('data-voice-state'), 'connecting');
    await page.waitForFunction(() => window.__controlledLive?.sent?.some(s => s.setup));
    // Even after WebSocket setupComplete + mic start, before the agent actually speaks, dialogue is still hidden
    await page.evaluate(() => window.__controlledLive.receive({ setupComplete: {} }));
    await page.waitForFunction(() => window.__controlledLive?.sent?.some(s => s.clientContent));
    assert.equal(await page.locator('#tnMapAssistantHud').isVisible(), false, 'dialogue remains hidden until agent actually starts talking');
    // Now the agent starts talking (audio modelTurn + streaming outputTranscription)
    await page.evaluate(() => {
      window.__controlledLive.receive({
        serverContent: {
          modelTurn: { parts: [{ inlineData: { data: 'AAA=' } }] },
          outputTranscription: { text: 'Hi, ' }
        }
      });
    });
    await page.waitForSelector('#tnMapAssistantHud', { state: 'visible' });
    assert.equal(await page.locator('[data-whisper-text]').textContent(), "Hi, I'm your True North assistant.");
    await page.waitForSelector('[data-whisper-text] [data-command="build_route"]');
    await page.click('[data-whisper-text] [data-command="build_route"]');
    await page.waitForFunction(() => document.querySelector('[data-whisper-text]')?.textContent === 'Built a 6-stop route (~35 min).');
    assert.equal(await page.locator('#tnMapAssistant .mapAssistantWord').count(), 0, 'all inline buttons disappear when result sentence shows');

    // Voice/spoken commands execute all other expanded capabilities while keeping a single result sentence
    await page.evaluate(() => window.__assistant.runSpokenText('Find 12 priority leads'));
    await page.waitForFunction(() => document.querySelector('[data-whisper-text]')?.textContent.includes('Selected 12 priority leads'));
    assert.equal(await page.locator('#tnMapAssistant .mapAssistantWord').count(), 0);

    await page.evaluate(() => window.__assistant.runSpokenText('Log answered'));
    await page.waitForFunction(() => document.querySelector('[data-whisper-text]')?.textContent.includes('Logged Answered at 412 Oak St'));

    await page.evaluate(() => window.__assistant.runSpokenText('Show untouched homes'));
    await page.waitForFunction(() => document.querySelector('[data-whisper-text]')?.textContent.includes('Showing 19 new houses'));

    await page.evaluate(() => window.__assistant.runSpokenText('My stats summary'));
    await page.waitForFunction(() => document.querySelector('[data-whisper-text]')?.textContent.includes('42 houses (28 untouched'));

    await page.evaluate(() => window.__assistant.runSpokenText('Check recent Ohio storms'));
    await page.waitForFunction(() => document.querySelector('[data-whisper-text]')?.textContent.includes('4 recent Ohio storm reports'));

    await page.evaluate(() => window.__assistant.runSpokenText('Clear route'));
    await page.waitForFunction(() => document.querySelector('[data-whisper-text]')?.textContent.includes('Route cleared'));

    const calls = await page.evaluate(() => window.__calls.map(c => c.name));
    assert.deepEqual(calls, ['build_route', 'find_priority_leads', 'log_door_status', 'filter_leads', 'summarize_status', 'clear_route']);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log('Map assistant: single-sentence inline translucent HUD, tap-to-start, and expanded capabilities passed');

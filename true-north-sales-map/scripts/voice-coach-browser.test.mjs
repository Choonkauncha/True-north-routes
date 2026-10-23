/** Live Coach reads Gemini's binary socket frames and shows the transcript. */
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const out = process.env.ARTIFACTS || '/tmp/tn-artifacts';
fs.mkdirSync(out, { recursive: true });
const wavPath = path.join(out, 'voice-coach-mic.wav');
fs.writeFileSync(wavPath, toneWav());

const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mjs': 'text/javascript',
  '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml'
};
const harness = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Voice Coach</title>
<link rel="stylesheet" href="/brand/tokens.css">
<link rel="stylesheet" href="/brand/atlas.css">
<link rel="stylesheet" href="/brand/pages.css">
<link rel="stylesheet" href="/brand/coach.css">
<style>body{margin:0;padding:20px 16px 32px;background:#071014;color:#e8eef4;font-family:"Segoe UI",system-ui,sans-serif}main{max-width:760px;margin:0 auto}</style>
</head>
<body>
<main id="tnCoach"></main>
<script type="module">
import { mountCoach } from '/tn-files/coach-ui.js';
const ctx = {
  session: { user: { id: 'rep-1' } },
  rep: { id: 'rep-1', name: 'Avery Example', role: 'salesperson' },
  sb: {
    auth: {
      async getSession() { return { data: { session: { access_token: 'user-token', user: { id: 'rep-1' } } } }; },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }
    }
  }
};
await mountCoach(document.getElementById('tnCoach'), ctx);
document.documentElement.dataset.coachReady = '1';
</script>
</body>
</html>`;
const snapshot = {
  snapshot: {
    profile: { id: 'rep-1', firstName: 'Avery', name: 'Avery Example', role: 'salesperson', roleLabel: 'Salesperson' },
    focus: { title: 'Build one strong conversation', detail: 'Introduce yourself, ask a genuine question, and agree on one next step.', href: '/', action: 'Open field map' },
    metrics: { touches: 4, upcoming: 1, photos: 2, forms: 1, shiftHours: 6, messages: 3, trainingComplete: 2, interested: 1 },
    metricLimits: {},
    coverage: [{ key: 'activity', available: true, limited: false }],
    privacy: 'Your own activity, assignments, and work counts.',
    period: 'Last 14 days · Eastern time'
  }
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/voice-coach-harness.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(harness);
    return;
  }
  const file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const extraArgs = process.env.PLAYWRIGHT_CHROMIUM_ARGS ? JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS) : ['--no-sandbox'];
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
  headless: true,
  args: [...extraArgs, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wavPath}`]
});

async function openCoach(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__tnVoiceFrames = 0;
    class FakeSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      constructor() { this.readyState = 0; this.binaryType = 'blob'; setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 10); }
      send(raw) {
        const message = JSON.parse(raw);
        if (message.setup) {
          const body = JSON.stringify({ setupComplete: {} });
          setTimeout(() => this.onmessage?.({ data: new Blob([body], { type: 'application/json' }) }), 20);
        }
        const audio = message.realtimeInput?.audio;
        if (audio?.mimeType === 'audio/pcm;rate=16000' && audio.data) {
          window.__tnVoiceFrames += 1;
          if (window.__tnVoiceFrames !== 1) return;
          const reply = JSON.stringify({
            serverContent: {
              inputTranscription: { text: 'The homeowner said they already have a contractor.' },
              outputTranscription: { text: 'Respect that. Ask what matters most to them.' },
              modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AAA=' } }] },
              turnComplete: true
            }
          });
          setTimeout(() => this.onmessage?.({ data: new Blob([reply]) }), 30);
        }
      }
      close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
    }
    window.WebSocket = FakeSocket;
  });
  await page.route('**/api/coach', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(snapshot) }));
  await page.route('**/api/live-token', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ token: 'short-token', model: 'gemini-3.8-live', voice: 'Kore', expiresAt: new Date(Date.now() + 600000).toISOString(), systemInstruction: 'Coach safely.', openingMessage: 'Introduce yourself as my True North voice Coach.' })
  }));
  await page.goto(`${origin}/voice-coach-harness.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.coachReady === '1', null, { timeout: 15000 });
  return errors;
}

try {
  const desktop = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await desktop.context().grantPermissions(['microphone']);
  const desktopErrors = await openCoach(desktop);
  await desktop.getByRole('button', { name: 'Start live voice' }).waitFor();
  await desktop.screenshot({ path: path.join(out, 'voice_coach_ready.png') });
  await desktop.getByRole('button', { name: 'Start live voice' }).click();
  await desktop.waitForFunction(() => {
    const status = document.getElementById('tnCoachLiveStatus')?.textContent || '';
    const thread = document.getElementById('tnCoachLiveThread')?.textContent || '';
    return window.__tnVoiceFrames > 0 && !status.includes('[object Blob]') && thread.includes('Coach') && thread.includes('Ask what matters most');
  }, null, { timeout: 15000 });
  const status = await desktop.locator('#tnCoachLiveStatus').textContent();
  assert.equal(status?.includes('[object Blob]'), false);
  assert.match(status || '', /Listening|speaking|Coach is speaking/i);
  assert.deepEqual(desktopErrors.filter(message => /object Blob|not valid JSON/.test(message)), []);
  await desktop.screenshot({ path: path.join(out, 'voice_coach_transcript.png') });

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.context().grantPermissions(['microphone']);
  await openCoach(phone);
  await phone.getByRole('button', { name: 'Start live voice' }).click();
  await phone.waitForFunction(() => (document.getElementById('tnCoachLiveThread')?.textContent || '').includes('Ask what matters most'), null, { timeout: 15000 });
  await phone.screenshot({ path: path.join(out, 'voice_coach_phone.png') });
  console.log('Voice Coach browser: fake microphone, binary transcript, and screenshots passed.');
} finally {
  await browser.close();
  server.close();
}

function toneWav() {
  const rate = 16000;
  const samples = rate;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

import assert from 'node:assert/strict';
import { createGeminiLiveToken, handleLiveToken } from '../api/live-token.js';
import { createCoachLimiter } from '../api/coach.js';

const REP = 'a22945c0-d43a-4bd4-972f-16d1d7e06530';
const USER = 'd5e9e53e-27d3-4a30-bc5a-6691c3471750';
const NOW = new Date('2026-10-09T12:00:00Z');
const ENV = { SUPABASE_URL: 'https://database.example', SUPABASE_ANON_KEY: 'public-key', GEMINI_API_KEY: 'server-only' };

function request(headers = {}) {
  return new Request('https://app.example/api/live-token', { method: 'POST', headers: { authorization: 'Bearer real-user-token', ...headers } });
}

function fakeFetch() {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: new URL(url), options });
    const parsed = new URL(url);
    if (parsed.origin === 'https://generativelanguage.googleapis.com') return new Response(JSON.stringify({ name: 'ephemeral-live-token' }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (parsed.pathname === '/rest/v1/coach_settings') return new Response(JSON.stringify([{system_prompt:'Company coaching: listen carefully and support the setter.'}]),{status:200});
    if (parsed.pathname === '/auth/v1/user') return new Response(JSON.stringify({ id: USER }), { status: 200 });
    if (parsed.pathname === '/rest/v1/reps') return new Response(JSON.stringify([{ id: REP, name: 'Avery Example', role: 'salesperson' }]), { status: 200 });
    if (parsed.pathname === '/rest/v1/rpc/feature_enabled') return new Response('true', {status:200});
    if (parsed.pathname === '/rest/v1/rpc/password_gate_status') return new Response(JSON.stringify({ must_change: false, impersonating: false }), { status: 200 });
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetchImpl, calls };
}

const { fetchImpl, calls } = fakeFetch();
const result = await handleLiveToken(request(), { env: ENV, fetchImpl, now: NOW });
assert.equal(result.status, 200);
const body = await result.json();
assert.equal(body.token, 'ephemeral-live-token');
assert.equal(body.model, 'gemini-3.8-live');
assert.equal(body.voice, 'Kore');
assert.match(body.systemInstruction, /True North Live Coach/);
assert.match(body.systemInstruction,/Company coaching: listen carefully/);
assert.match(body.systemInstruction,/Authenticated personal context/);
assert.match(body.openingMessage,/Introduce yourself/);
const gemini = calls.find(call => call.url.origin === 'https://generativelanguage.googleapis.com');
assert.ok(gemini);
assert.equal(gemini.options.headers['x-goog-api-key'], 'server-only');
assert.doesNotMatch(JSON.stringify(body), /server-only|public-key|real-user-token/);
const tokenBody = JSON.parse(gemini.options.body);
assert.equal(tokenBody.uses, 1);
assert.equal(tokenBody.liveConnectConstraints,undefined,'SDK field must never be sent to REST');
assert.equal(tokenBody.bidiGenerateContentSetup.systemInstruction.parts[0].text,body.systemInstruction);
assert.equal(tokenBody.bidiGenerateContentSetup.realtimeInputConfig.activityHandling,'START_OF_ACTIVITY_INTERRUPTS');
assert.equal(tokenBody.bidiGenerateContentSetup.model, 'models/gemini-3.8-live');
assert.deepEqual(tokenBody.bidiGenerateContentSetup.generationConfig.responseModalities, ['AUDIO']);

const missing = await handleLiveToken(request(), { env: { ...ENV, GEMINI_API_KEY: '' }, fetchImpl, now: NOW });
assert.equal(missing.status, 503);
assert.match((await missing.json()).error, /not configured/i);
const crossOrigin = await handleLiveToken(request({ origin: 'https://evil.example' }), { env: ENV, fetchImpl, now: NOW });
assert.equal(crossOrigin.status, 403);
const limited = createCoachLimiter({ clock: () => NOW.getTime(), maxRequests: 1, windowMs: 60000 });
assert.equal((await handleLiveToken(request(), { env: ENV, fetchImpl, now: NOW, limiter: limited })).status, 200);
const quota = await handleLiveToken(request(), { env: ENV, fetchImpl, now: NOW, limiter: limited });
assert.equal(quota.status, 429);
assert.ok(Number(quota.headers.get('retry-after')) > 0);
await assert.rejects(() => createGeminiLiveToken({ now: NOW, fetchImpl }), /API key/);
console.log('Gemini Live token: auth, server-only key, ephemeral constraints and origin checks passed.');

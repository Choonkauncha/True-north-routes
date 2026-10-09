import { buildCoachSnapshot, coachGreeting, coachProfileForModel, COACH_INSTRUCTIONS, coachRoleAllowed } from '../lib/coach.js';
import { coachCaller, createCoachLimiter, loadCoachSources } from './coach.js';

const LIVE_MODEL = 'gemini-3.8-live';
const LIVE_VOICE = 'Kore';
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store', 'vary': 'Authorization', ...headers }
});
const fail = (message, status) => Object.assign(new Error(message), { status });
const liveLimiter = createCoachLimiter({ maxRequests: 3, maxPracticeRequests: 3, windowMs: 60000 });

function liveInstructions(snapshot) {
  return `${COACH_INSTRUCTIONS}

You are speaking through the True North Live Coach. Keep each spoken turn concise, natural and conversational. Let the person finish speaking. Give one practical suggestion at a time. When you role-play a homeowner, say “Role-play homeowner:” before the line. Use the authenticated profile below as context only; never reveal private IDs or another person's information.

Authenticated personal context:
${JSON.stringify(coachProfileForModel(snapshot))}`;
}

export async function createGeminiLiveToken({ apiKey, model = LIVE_MODEL, voice = LIVE_VOICE, fetchImpl = fetch, now = new Date() } = {}) {
  if (!apiKey) throw fail('Live voice needs a Gemini API key on the server.', 503);
  model = String(model).replace(/^models\//, '').trim() || LIVE_MODEL;
  voice = String(voice).trim() || LIVE_VOICE;
  const expireTime = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(now.getTime() + 60 * 1000).toISOString();
  const response = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      uses: 1,
      expireTime,
      newSessionExpireTime,
      liveConnectConstraints: {
        model: `models/${model}`,
        config: {
          responseModalities: ['AUDIO'],
          sessionResumption: {}
        }
      }
    }),
    signal: AbortSignal.timeout(10000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload?.name !== 'string' || !payload.name) {
    throw fail('Gemini Live could not be started. Try again.', 502);
  }
  return { token: payload.name, model, voice, expiresAt: expireTime };
}

/** Authenticated, read-only token provisioning. The Gemini key never reaches the browser. */
export async function handleLiveToken(request, { env = process.env, fetchImpl = fetch, now = new Date(), limiter = liveLimiter } = {}) {
  if (request.method !== 'POST') return json({ error: 'Use POST to start Live Coach.' }, 405, { allow: 'POST' });
  let release;
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) throw fail('Open Live Coach from the True North app.', 403);
    const ctx = await coachCaller(request, env, fetchImpl);
    release = limiter.acquire(ctx.userId);
    if (!env.GEMINI_API_KEY) throw fail('Live voice is not configured yet. Text Coach is still available.', 503);
    const snapshot = buildCoachSnapshot(ctx.rep, await loadCoachSources(ctx, now), now);
    const live = await createGeminiLiveToken({
      apiKey: env.GEMINI_API_KEY,
      model: String(env.GEMINI_LIVE_MODEL || LIVE_MODEL).trim() || LIVE_MODEL,
      voice: String(env.GEMINI_LIVE_VOICE || LIVE_VOICE).trim() || LIVE_VOICE,
      fetchImpl,
      now
    });
    return json({ ...live, systemInstruction: liveInstructions(snapshot), greeting: coachGreeting(snapshot), profile: snapshot.profile });
  } catch (error) {
    return json({ error: error.status ? error.message : 'Live Coach could not load. Try again.' }, error.status || 502, error.retryAfter ? { 'retry-after': String(error.retryAfter) } : {});
  } finally { release?.(); }
}

export default { fetch: handleLiveToken };

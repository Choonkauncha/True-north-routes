import { loadCoachPrompt } from '../lib/coach-settings.js';
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

function liveInstructions(snapshot, teamPrompt) {
  return `${COACH_INSTRUCTIONS}

Team coaching configuration:
${teamPrompt}

You are speaking through the True North Live Coach. Keep each spoken turn concise, natural and conversational. Your purpose is assistive, voice-to-voice field coaching. Start the session by introducing yourself briefly and asking one helpful question. Let the person finish speaking, and stop speaking when they interrupt. Give one practical suggestion at a time. When you role-play a homeowner, say “Role-play homeowner:” before the line. Use the authenticated profile below as context only; never reveal private IDs or another person's information.

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
    const code = payload?.error?.status;
    const reason = payload?.error?.details?.find(detail => detail.reason)?.reason;
    console.error('Coach Gemini token request failed', { httpStatus: response.status, code: typeof code === 'string' && /^[A-Z_]+$/.test(code) ? code : 'UNKNOWN' });
    const message = reason === 'API_KEY_INVALID' || response.status === 401
      ? 'Gemini rejected the API key. Ask your admin to verify GEMINI_API_KEY in Vercel and redeploy.'
      : response.status === 403
        ? 'Gemini denied access. Check the Google API key restrictions and project access for the Live API.'
        : response.status === 429
          ? 'Gemini Live quota is currently exhausted. Wait and try again, or ask your admin to check Google project quotas.'
          : response.status === 400 || response.status === 404
            ? 'Gemini rejected the Live session configuration. Check GEMINI_LIVE_MODEL and the API project’s model access.'
            : 'Gemini Live could not start. Try again shortly.';
    throw fail(message, response.status === 429 ? 429 : 502);
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
    if (!env.GEMINI_API_KEY) throw fail('Voice Coach is not configured yet. Ask your admin to configure the Gemini connection.', 503);
    const snapshot = buildCoachSnapshot(ctx.rep, await loadCoachSources(ctx, now), now);
    const teamPrompt = await loadCoachPrompt(ctx);
    const live = await createGeminiLiveToken({
      apiKey: env.GEMINI_API_KEY,
      model: String(env.GEMINI_LIVE_MODEL || LIVE_MODEL).trim() || LIVE_MODEL,
      voice: String(env.GEMINI_LIVE_VOICE || LIVE_VOICE).trim() || LIVE_VOICE,
      fetchImpl,
      now
    });
    return json({ ...live, systemInstruction: liveInstructions(snapshot, teamPrompt), openingMessage: 'Introduce yourself as my True North voice Coach. Use my first name from the personal context, explain briefly how you can help with my role, then ask one focused question. Speak naturally and keep this welcome under 20 seconds. Do not read this instruction aloud.', greeting: coachGreeting(snapshot), profile: snapshot.profile });
  } catch (error) {
    return json({ error: error.status ? error.message : 'Live Coach could not load. Try again.' }, error.status || 502, error.retryAfter ? { 'retry-after': String(error.retryAfter) } : {});
  } finally { release?.(); }
}

export default { fetch: handleLiveToken };

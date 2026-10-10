/** Server-side password gate. Browser overlays are only presentation. */
export async function requirePasswordReady(request, { env = process.env, fetchImpl = fetch } = {}) {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  const fail = (message, status) => Object.assign(new Error(message), { status, public: true });
  if (!token) throw fail('Sign in required.', 401);
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;
  if (!base || !key) throw fail('Account verification is not configured.', 503);
  let response;
  try {
    response = await fetchImpl(`${base}/rest/v1/rpc/password_gate_status`, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}', signal: AbortSignal.timeout(12000)
    });
  } catch { throw fail('Account verification is unavailable. Try again.', 503); }
  if (!response.ok) throw fail('Account verification is unavailable. Try again.', response.status === 401 ? 401 : 503);
  const status = await response.json().catch(() => null);
  if (typeof status?.must_change !== 'boolean' || typeof status?.impersonating !== 'boolean') {
    throw fail('Account verification is unavailable. Try again.', 503);
  }
  if (status.must_change && !status.impersonating) throw fail('Choose your own password before continuing.', 403);
}

import assert from 'node:assert/strict';
import {
  ASSISTANT_GREETING,
  ASSISTANT_GREETING_STEPS,
  ASSISTANT_ACTION_WORDS,
  matchAssistantIntent,
  createAssistantCommandRunner,
  commandResultText
} from '../lib/assistant-command.js';
import { validateMapTool, toolDefinitions } from '../lib/voice-tools.js';
import { createOrbMesh, projectOrbVertex } from '../lib/orb-mesh.js';
import { handleVoiceAction } from '../api/coach.js';

assert.ok(ASSISTANT_GREETING.includes("True North assistant"));
assert.ok(ASSISTANT_GREETING_STEPS.length >= 4);
assert.ok(ASSISTANT_ACTION_WORDS.length >= 10);

for (const role of ['admin', 'salesperson', 'appointment_setter']) {
  const names = toolDefinitions(role, { map: true })[0].functionDeclarations.map(tool => tool.name);
  for (const name of [
    'build_route', 'clear_route', 'build_timed_route', 'find_priority_leads', 'optimize_route',
    'remove_route_stop', 'route_navigation', 'select_visible_addresses', 'filter_leads',
    'search_address', 'focus_location', 'log_door_status', 'book_inspection', 'open_lead_form',
    'summarize_status', 'clock_shift', 'navigate_app', 'recent_ohio_storms'
  ]) {
    assert.ok(names.includes(name), `missing ${name} for ${role}`);
  }
}

assert.deepEqual(validateMapTool({ name: 'build_route', args: { count: 10, mode: 'walking', actorId: 'fake' } }), { name: 'build_route', args: { count: 10, mode: 'walking' } });
for (const args of [{ count: 0 }, { count: 81 }, { count: 2.5 }, { mode: 'flying' }, []]) {
  assert.throws(() => validateMapTool({ name: 'build_route', args }));
}
assert.deepEqual(validateMapTool({ name: 'clear_route', args: { ignored: true } }), { name: 'clear_route', args: {} });
assert.deepEqual(validateMapTool({ name: 'find_priority_leads', args: { count: 12, build: true } }), { name: 'find_priority_leads', args: { count: 12, build: true } });
assert.deepEqual(validateMapTool({ name: 'filter_leads', args: { status: 'New' } }), { name: 'filter_leads', args: { status: 'New' } });
assert.deepEqual(validateMapTool({ name: 'log_door_status', args: { status: 'Knocked' } }), { name: 'log_door_status', args: { status: 'Knocked' } });
assert.deepEqual(validateMapTool({ name: 'route_navigation', args: { action: 'next' } }), { name: 'route_navigation', args: { action: 'next' } });

const order = [];
let active = true;
const run = createAssistantCommandRunner({
  isCurrent: () => active,
  authorize: async call => {
    order.push(`auth:${call.name}`);
    await new Promise(r => setTimeout(r, call.name === 'build_timed_route' ? 20 : 1));
    if (call.name === 'get_live_context') return { snapshot: { profile: { name: 'Rep' } } };
    if (call.name === 'recent_ohio_storms') return { reportCount: 2, partial: true };
    return { authorized: true, actorId: 'u1', execute: call };
  },
  execute: async (name, args) => {
    order.push(`exec:${name}`);
    if (name === 'clear_route') return { status: 'cleared', executed: true, removed: 3 };
    if (name === 'find_priority_leads') return { status: 'prioritized', executed: true, selectedCount: args.count, topAddress: '101 Main St' };
    if (name === 'filter_leads') return { status: 'filtered', executed: true, filterStatus: args.status, visibleCount: 14 };
    if (name === 'log_door_status') return { status: 'door_logged', executed: true, doorStatus: args.status, label: args.status === 'Knocked' ? 'Answered' : args.status, address: '101 Main St' };
    if (name === 'summarize_status') return { status: 'summary', executed: true, total: 50, untouched: 30, knocked: 12, interested: 4, routeStops: 8 };
    return { status: 'built', executed: true, stops: 5, estimatedMinutes: args.minutes, approximate: true };
  },
  getContext: async () => ({ selectedCount: 4, route: [{ id: '1' }] })
});

const [timed, cleared, priority, filtered, logged, summary] = await Promise.all([
  run({ name: 'build_timed_route', args: { minutes: 120 } }),
  run({ name: 'clear_route', args: {} }),
  run({ name: 'find_priority_leads', args: { count: 12 } }),
  run({ name: 'filter_leads', args: { status: 'New' } }),
  run({ name: 'log_door_status', args: { status: 'Knocked' } }),
  run({ name: 'summarize_status', args: {} })
]);
assert.deepEqual(order, [
  'auth:build_timed_route', 'exec:build_timed_route',
  'auth:clear_route', 'exec:clear_route',
  'auth:find_priority_leads', 'exec:find_priority_leads',
  'auth:filter_leads', 'exec:filter_leads',
  'auth:log_door_status', 'exec:log_door_status',
  'auth:summarize_status', 'exec:summarize_status'
]);
assert.match(commandResultText(timed), /5 houses · about 120 minutes/);
assert.equal(commandResultText(cleared), 'Route cleared. 3 selected houses removed.');
assert.match(commandResultText(priority), /12 priority leads selected · Top: 101 Main St/);
assert.equal(commandResultText(filtered), 'Showing 14 new houses.');
assert.equal(commandResultText(logged), 'Logged Answered · 101 Main St.');
assert.match(commandResultText(summary), /50 houses \(30 untouched, 12 knocked, 4 interested\) · 8 route stops/);
assert.equal(commandResultText({ status: 'opening_map', executed: false }), 'Opening the field map to finish your command…');
assert.match(commandResultText({ error: 'Route unavailable' }), /unavailable/);
assert.match(commandResultText(await run({ name: 'get_live_context', args: {} })), /4 houses selected · 1 built stops/);
assert.match(commandResultText(await run({ name: 'recent_ohio_storms', args: { days: 3 } })), /2 recent Ohio storm reports · some sources unavailable/);

// Test natural-language intent matching
assert.deepEqual(matchAssistantIntent('Build route with 15 stops'), { name: 'build_route', args: { count: 15 } });
assert.deepEqual(matchAssistantIntent('Plan a 2 hour route'), { name: 'build_timed_route', args: { minutes: 120, stop_minutes: 5 } });
assert.deepEqual(matchAssistantIntent('Find 10 priority leads'), { name: 'find_priority_leads', args: { count: 10, build: false } });
assert.deepEqual(matchAssistantIntent('Show untouched homes'), { name: 'filter_leads', args: { status: 'New' } });
assert.deepEqual(matchAssistantIntent('Log answered'), { name: 'log_door_status', args: { status: 'Knocked' } });
assert.deepEqual(matchAssistantIntent('Nobody home, no answer'), { name: 'log_door_status', args: { status: 'No Answer' } });
assert.deepEqual(matchAssistantIntent('Book an inspection'), { name: 'book_inspection', args: {} });
assert.deepEqual(matchAssistantIntent('My stats summary'), { name: 'summarize_status', args: {} });
assert.deepEqual(matchAssistantIntent('Clear route'), { name: 'clear_route', args: {} });
assert.deepEqual(matchAssistantIntent('Open admin'), { name: 'navigate_app', args: { target: 'admin' } });
assert.deepEqual(matchAssistantIntent('Search 415 Oak St'), { name: 'search_address', args: { query: '415 Oak St' } });

await assert.rejects(() => createAssistantCommandRunner({
  authorize: async () => ({ authorized: true, actorId: 'u1', execute: { name: 'clear_route', args: {} } }),
  execute: async () => ({ status: 'cleared' }),
  getContext: async () => ({})
})({ name: 'build_route', args: {} }), /did not match/);

const abort = new AbortController();
abort.abort();
await assert.rejects(() => run({ name: 'clear_route' }, { signal: abort.signal }), /Command cancelled/);
active = false;
await assert.rejects(() => run({ name: 'clear_route', args: {} }), /Command cancelled/);

const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'pk' };
const fetchFor = features => async (url, init = {}) => {
  const path = new URL(url).pathname;
  if (path === '/auth/v1/user') return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', email: 'rep@example.com' }), { status: 200 });
  if (path === '/rest/v1/reps') return new Response(JSON.stringify([{ id: '22222222-2222-4222-8222-222222222222', user_id: '11111111-1111-4111-8111-111111111111', name: 'Rep', role: 'appointment_setter', active: true }]), { status: 200 });
  if (path === '/rest/v1/rpc/password_gate_status') return new Response(JSON.stringify({ must_change: false, impersonating: false }), { status: 200 });
  if (path === '/rest/v1/rpc/feature_enabled') {
    const { requested } = JSON.parse(init.body || '{}');
    return new Response(JSON.stringify(features.includes(requested)), { status: 200 });
  }
  return new Response('[]', { status: 200 });
};
const post = toolCall => new Request('https://app.example.com/api/coach', {
  method: 'POST',
  headers: { authorization: 'Bearer token', 'content-type': 'application/json', origin: 'https://app.example.com' },
  body: JSON.stringify({ workspace: 'map', toolCall })
});
const denied = await handleVoiceAction(post({ name: 'build_route', args: {} }), { env, fetchImpl: fetchFor(['coach', 'map']) });
assert.equal(denied.status, 403);
const allowed = await handleVoiceAction(post({ name: 'clear_route', args: {} }), { env, fetchImpl: fetchFor(['coach', 'map', 'routes']) });
assert.equal(allowed.status, 200);
assert.deepEqual(await allowed.json(), { authorized: true, actorId: '11111111-1111-4111-8111-111111111111', execute: { name: 'clear_route', args: {} } });
const allowedFilter = await handleVoiceAction(post({ name: 'filter_leads', args: { status: 'New' } }), { env, fetchImpl: fetchFor(['coach', 'map']) });
assert.equal(allowedFilter.status, 200);

// 3D orb mesh tests
const mesh = createOrbMesh();
assert.ok(mesh.vertices.length > 400);
assert.ok(mesh.triangles.length > 900);
for (const face of mesh.triangles) for (const i of face) assert.ok(i >= 0 && i < mesh.vertices.length);
for (const vertex of mesh.vertices) assert.ok(Math.abs(Math.hypot(...vertex) - 1) < 1e-6);
assert.notDeepEqual(projectOrbVertex([1, 0, 0], 0), projectOrbVertex([1, 0, 0], 1));
assert.notDeepEqual(projectOrbVertex([1, 0, 0], 0, 0, 0), projectOrbVertex([1, 0, 0], 0, 0.8, 0));

console.log('Assistant commands: sequential execution, permission denial, cancellation, model argument validation, intent matching, truthful results, 3D geometry and audio deformation passed');

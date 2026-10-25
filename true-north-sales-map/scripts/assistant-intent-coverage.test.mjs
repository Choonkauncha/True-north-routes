import assert from 'node:assert/strict';
import {
  ASSISTANT_GREETING,
  ASSISTANT_GREETING_STEPS,
  ASSISTANT_ACTION_WORDS,
  singleSentenceText,
  matchAssistantIntent,
  createAssistantCommandRunner,
  commandResultText
} from '../lib/assistant-command.js';
import {
  MAP_TOOLS,
  ROUTE_TOOL_NAMES,
  LEAD_STATUS_FILTERS,
  DOOR_LOG_STATUSES,
  APP_TARGETS,
  validateMapTool,
  toolDefinitions
} from '../lib/voice-tools.js';
import { handleVoiceAction } from '../api/coach.js';
import { handleLiveToken } from '../api/live-token.js';

// ============================================================================
// 1. Exhaustive Natural-Language Utterance Matrix Across All 19 Map Tools
// ============================================================================
const INTENT_CASES = [
  // --- A. Route Building (build_route) ---
  { phrase: 'build route', expected: { name: 'build_route', args: {} } },
  { phrase: 'Build my route', expected: { name: 'build_route', args: {} } },
  { phrase: 'build a 15 stop route', expected: { name: 'build_route', args: { count: 15 } } },
  { phrase: 'Build route with 15 stops', expected: { name: 'build_route', args: { count: 15 } } },
  { phrase: 'make a 20 house route', expected: { name: 'build_route', args: { count: 20 } } },
  { phrase: 'create a route with 12 homes', expected: { name: 'build_route', args: { count: 12 } } },
  { phrase: 'plan a 15 stop route', expected: { name: 'build_route', args: { count: 15 } } },
  { phrase: 'build a walking route with 10 stops', expected: { name: 'build_route', args: { count: 10, mode: 'walking' } } },
  { phrase: 'make a walking route', expected: { name: 'build_route', args: { mode: 'walking' } } },
  { phrase: 'build a ten stop route', expected: { name: 'build_route', args: { count: 10 } } },
  { phrase: 'build a fifteen stop walking route', expected: { name: 'build_route', args: { count: 15, mode: 'walking' } } },
  { phrase: 'route me to 18 houses', expected: { name: 'build_route', args: { count: 18 } } },
  { phrase: 'build 25 stops', expected: { name: 'build_route', args: { count: 25 } } },
  { phrase: 'generate a route with 30 doors', expected: { name: 'build_route', args: { count: 30 } } },

  // --- B. Timed Route Planning (build_timed_route) ---
  { phrase: 'plan 2 hours', expected: { name: 'build_timed_route', args: { minutes: 120, stop_minutes: 5 } } },
  { phrase: 'Plan a 2 hour route', expected: { name: 'build_timed_route', args: { minutes: 120, stop_minutes: 5 } } },
  { phrase: 'plan 3 hours', expected: { name: 'build_timed_route', args: { minutes: 180, stop_minutes: 5 } } },
  { phrase: 'plan two hours', expected: { name: 'build_timed_route', args: { minutes: 120, stop_minutes: 5 } } },
  { phrase: 'build a 1.5 hour route', expected: { name: 'build_timed_route', args: { minutes: 90, stop_minutes: 5 } } },
  { phrase: 'plan an hour and a half route', expected: { name: 'build_timed_route', args: { minutes: 90, stop_minutes: 5 } } },
  { phrase: 'plan a half hour route', expected: { name: 'build_timed_route', args: { minutes: 30, stop_minutes: 5 } } },
  { phrase: 'build a 45 minute route', expected: { name: 'build_timed_route', args: { minutes: 45, stop_minutes: 5 } } },
  { phrase: 'plan 90 minutes', expected: { name: 'build_timed_route', args: { minutes: 90, stop_minutes: 5 } } },
  { phrase: 'work for 2 hours', expected: { name: 'build_timed_route', args: { minutes: 120, stop_minutes: 5 } } },
  { phrase: 'i have 2 hours to knock doors', expected: { name: 'build_timed_route', args: { minutes: 120, stop_minutes: 5 } } },
  { phrase: 'plan a 2 hour walking route', expected: { name: 'build_timed_route', args: { minutes: 120, stop_minutes: 5, mode: 'walking' } } },
  { phrase: 'build a 1 hour 30 minute route', expected: { name: 'build_timed_route', args: { minutes: 90, stop_minutes: 5 } } },

  // --- C. Route Optimization (optimize_route) ---
  { phrase: 'optimize route', expected: { name: 'optimize_route', args: {} } },
  { phrase: 'optimize my route', expected: { name: 'optimize_route', args: {} } },
  { phrase: 're-optimize route', expected: { name: 'optimize_route', args: {} } },
  { phrase: 'reoptimize my route', expected: { name: 'optimize_route', args: {} } },
  { phrase: 'reorder route', expected: { name: 'optimize_route', args: {} } },
  { phrase: 'reorder stops', expected: { name: 'optimize_route', args: {} } },
  { phrase: 'recalculate my route', expected: { name: 'optimize_route', args: {} } },
  { phrase: 'optimize walking route', expected: { name: 'optimize_route', args: { mode: 'walking' } } },

  // --- D. Clear Route & Remove Stop (clear_route, remove_route_stop) ---
  { phrase: 'clear route', expected: { name: 'clear_route', args: {} } },
  { phrase: 'reset route', expected: { name: 'clear_route', args: {} } },
  { phrase: 'empty my route', expected: { name: 'clear_route', args: {} } },
  { phrase: 'clear all stops', expected: { name: 'clear_route', args: {} } },
  { phrase: 'delete my route', expected: { name: 'clear_route', args: {} } },
  { phrase: 'unselect all houses', expected: { name: 'clear_route', args: {} } },
  { phrase: 'remove stop 101 Main St', expected: { name: 'remove_route_stop', args: { stop: '101 Main St' } } },
  { phrase: 'remove 412 Oak St from my route', expected: { name: 'remove_route_stop', args: { stop: '412 Oak St' } } },
  { phrase: 'drop stop 205 Elm St', expected: { name: 'remove_route_stop', args: { stop: '205 Elm St' } } },

  // --- E. Route Navigation (route_navigation) ---
  { phrase: 'start navigation', expected: { name: 'route_navigation', args: { action: 'start' } } },
  { phrase: 'start nav', expected: { name: 'route_navigation', args: { action: 'start' } } },
  { phrase: 'start route navigation', expected: { name: 'route_navigation', args: { action: 'start' } } },
  { phrase: 'start driving', expected: { name: 'route_navigation', args: { action: 'start' } } },
  { phrase: 'turn by turn', expected: { name: 'route_navigation', args: { action: 'start' } } },
  { phrase: 'navigate route', expected: { name: 'route_navigation', args: { action: 'start' } } },
  { phrase: 'next stop', expected: { name: 'route_navigation', args: { action: 'next' } } },
  { phrase: 'advance stop', expected: { name: 'route_navigation', args: { action: 'next' } } },
  { phrase: 'next house', expected: { name: 'route_navigation', args: { action: 'next' } } },
  { phrase: 'skip this stop', expected: { name: 'route_navigation', args: { action: 'next' } } },
  { phrase: 'go to the next stop', expected: { name: 'route_navigation', args: { action: 'next' } } },
  { phrase: 'pause navigation', expected: { name: 'route_navigation', args: { action: 'pause' } } },
  { phrase: 'pause my route', expected: { name: 'route_navigation', args: { action: 'pause' } } },
  { phrase: 'resume navigation', expected: { name: 'route_navigation', args: { action: 'resume' } } },
  { phrase: 'continue route', expected: { name: 'route_navigation', args: { action: 'resume' } } },
  { phrase: 'end navigation', expected: { name: 'route_navigation', args: { action: 'end' } } },
  { phrase: 'stop navigation', expected: { name: 'route_navigation', args: { action: 'end' } } },
  { phrase: 'exit nav', expected: { name: 'route_navigation', args: { action: 'end' } } },
  { phrase: 'cancel navigation', expected: { name: 'route_navigation', args: { action: 'end' } } },

  // --- F. Priority Leads & Discovery (find_priority_leads, select_visible_addresses, focus_location, search_address) ---
  { phrase: 'find priority leads', expected: { name: 'find_priority_leads', args: { count: 12, build: false } } },
  { phrase: 'Find 10 priority leads', expected: { name: 'find_priority_leads', args: { count: 10, build: false } } },
  { phrase: 'route me to top 10 houses', expected: { name: 'find_priority_leads', args: { count: 10, build: true } } },
  { phrase: 'find top 15 houses', expected: { name: 'find_priority_leads', args: { count: 15, build: false } } },
  { phrase: 'show best 20 leads', expected: { name: 'find_priority_leads', args: { count: 20, build: false } } },
  { phrase: 'build route with top 12 priority leads', expected: { name: 'find_priority_leads', args: { count: 12, build: true } } },
  { phrase: 'highest scoring homes', expected: { name: 'find_priority_leads', args: { count: 12, build: false } } },
  { phrase: 'route me to top ten houses', expected: { name: 'find_priority_leads', args: { count: 10, build: true } } },
  { phrase: 'select visible houses', expected: { name: 'select_visible_addresses', args: {} } },
  { phrase: 'select all visible homes', expected: { name: 'select_visible_addresses', args: {} } },
  { phrase: 'select houses on screen', expected: { name: 'select_visible_addresses', args: {} } },
  { phrase: 'select houses', expected: { name: 'select_visible_addresses', args: {} } },
  { phrase: 'add cluster addresses', expected: { name: 'select_visible_addresses', args: {} } },
  { phrase: 'zoom to my location', expected: { name: 'focus_location', args: { target: 'me' } } },
  { phrase: 'center on me', expected: { name: 'focus_location', args: { target: 'me' } } },
  { phrase: 'where am i', expected: { name: 'focus_location', args: { target: 'me' } } },
  { phrase: 'recenter map', expected: { name: 'focus_location', args: { target: 'me' } } },
  { phrase: 'zoom to my route', expected: { name: 'focus_location', args: { target: 'route' } } },
  { phrase: 'zoom to all houses', expected: { name: 'focus_location', args: { target: 'all' } } },
  { phrase: 'Search 415 Oak St', expected: { name: 'search_address', args: { query: '415 Oak St' } } },
  { phrase: 'search for 102 Gambier Rd', expected: { name: 'search_address', args: { query: '102 Gambier Rd' } } },
  { phrase: 'look up 500 E High St', expected: { name: 'search_address', args: { query: '500 E High St' } } },
  { phrase: 'locate 214 Newark Rd', expected: { name: 'search_address', args: { query: '214 Newark Rd' } } },

  // --- G. Lead Filtering (filter_leads) ---
  { phrase: 'show untouched homes', expected: { name: 'filter_leads', args: { status: 'New' } } },
  { phrase: 'untouched homes', expected: { name: 'filter_leads', args: { status: 'New' } } },
  { phrase: 'filter untouched leads', expected: { name: 'filter_leads', args: { status: 'New' } } },
  { phrase: 'show unknocked houses', expected: { name: 'filter_leads', args: { status: 'New' } } },
  { phrase: 'show new leads', expected: { name: 'filter_leads', args: { status: 'New' } } },
  { phrase: 'filter knocked', expected: { name: 'filter_leads', args: { status: 'Knocked' } } },
  { phrase: 'show knocked houses', expected: { name: 'filter_leads', args: { status: 'Knocked' } } },
  { phrase: 'filter interested', expected: { name: 'filter_leads', args: { status: 'Interested' } } },
  { phrase: 'show interested homes', expected: { name: 'filter_leads', args: { status: 'Interested' } } },
  { phrase: 'filter no answer', expected: { name: 'filter_leads', args: { status: 'No Answer' } } },
  { phrase: 'show no answer homes', expected: { name: 'filter_leads', args: { status: 'No Answer' } } },
  { phrase: 'filter not interested', expected: { name: 'filter_leads', args: { status: 'Not Interested' } } },
  { phrase: 'filter do not knock', expected: { name: 'filter_leads', args: { status: 'Do Not Knock' } } },
  { phrase: 'show appointments', expected: { name: 'filter_leads', args: { status: 'Appointment' } } },
  { phrase: 'show all houses', expected: { name: 'filter_leads', args: { status: 'All' } } },
  { phrase: 'clear filter', expected: { name: 'filter_leads', args: { status: 'All' } } },
  { phrase: 'reset filters', expected: { name: 'filter_leads', args: { status: 'All' } } },
  { phrase: 'show my leads', expected: { name: 'filter_leads', args: { status: 'All', mine: true } } },

  // --- H. Door Status & Field Workflow (log_door_status, book_inspection, open_lead_form) ---
  { phrase: 'they answered', expected: { name: 'log_door_status', args: { status: 'Knocked' } } },
  { phrase: 'log answered', expected: { name: 'log_door_status', args: { status: 'Knocked' } } },
  { phrase: 'mark answered', expected: { name: 'log_door_status', args: { status: 'Knocked' } } },
  { phrase: 'mark knocked', expected: { name: 'log_door_status', args: { status: 'Knocked' } } },
  { phrase: 'they came to the door', expected: { name: 'log_door_status', args: { status: 'Knocked' } } },
  { phrase: 'homeowner came to the door', expected: { name: 'log_door_status', args: { status: 'Knocked' } } },
  { phrase: 'homeowner answered', expected: { name: 'log_door_status', args: { status: 'Knocked' } } },
  { phrase: 'answered the door', expected: { name: 'log_door_status', args: { status: 'Knocked' } } },
  { phrase: 'talked to the homeowner', expected: { name: 'log_door_status', args: { status: 'Knocked' } } },
  { phrase: 'spoke with owner', expected: { name: 'log_door_status', args: { status: 'Knocked' } } },
  { phrase: 'mark no answer', expected: { name: 'log_door_status', args: { status: 'No Answer' } } },
  { phrase: 'no answer', expected: { name: 'log_door_status', args: { status: 'No Answer' } } },
  { phrase: 'nobody home', expected: { name: 'log_door_status', args: { status: 'No Answer' } } },
  { phrase: "nobody's home", expected: { name: 'log_door_status', args: { status: 'No Answer' } } },
  { phrase: 'no one home', expected: { name: 'log_door_status', args: { status: 'No Answer' } } },
  { phrase: 'no one answered', expected: { name: 'log_door_status', args: { status: 'No Answer' } } },
  { phrase: "they didn't answer", expected: { name: 'log_door_status', args: { status: 'No Answer' } } },
  { phrase: 'not home', expected: { name: 'log_door_status', args: { status: 'No Answer' } } },
  { phrase: 'left a door hanger', expected: { name: 'log_door_status', args: { status: 'No Answer' } } },
  { phrase: 'mark interested', expected: { name: 'log_door_status', args: { status: 'Interested' } } },
  { phrase: 'homeowner is interested', expected: { name: 'log_door_status', args: { status: 'Interested' } } },
  { phrase: 'mark not interested', expected: { name: 'log_door_status', args: { status: 'Not Interested' } } },
  { phrase: 'mark do not knock', expected: { name: 'log_door_status', args: { status: 'Do Not Knock' } } },
  { phrase: 'book an inspection', expected: { name: 'book_inspection', args: {} } },
  { phrase: 'book inspection', expected: { name: 'book_inspection', args: {} } },
  { phrase: 'schedule roof inspection', expected: { name: 'book_inspection', args: {} } },
  { phrase: 'book a roof inspection', expected: { name: 'book_inspection', args: {} } },
  { phrase: 'schedule an inspection for this house', expected: { name: 'book_inspection', args: {} } },
  { phrase: 'set up an inspection', expected: { name: 'book_inspection', args: {} } },
  { phrase: 'schedule appointment', expected: { name: 'book_inspection', args: {} } },
  { phrase: 'open lead form', expected: { name: 'open_lead_form', args: {} } },
  { phrase: 'open field form', expected: { name: 'open_lead_form', args: {} } },
  { phrase: 'fill out a form', expected: { name: 'open_lead_form', args: {} } },
  { phrase: 'file a form', expected: { name: 'open_lead_form', args: {} } },
  { phrase: 'open the documentation form', expected: { name: 'open_lead_form', args: {} } },

  // --- I. App, Weather, Shifts & Summary (clock_shift, summarize_status, recent_ohio_storms, navigate_app, get_live_context) ---
  { phrase: 'clock in', expected: { name: 'clock_shift', args: { action: 'in' } } },
  { phrase: 'clock me in', expected: { name: 'clock_shift', args: { action: 'in' } } },
  { phrase: 'punch in', expected: { name: 'clock_shift', args: { action: 'in' } } },
  { phrase: 'start my shift', expected: { name: 'clock_shift', args: { action: 'in' } } },
  { phrase: 'clock out', expected: { name: 'clock_shift', args: { action: 'out' } } },
  { phrase: 'clock me out', expected: { name: 'clock_shift', args: { action: 'out' } } },
  { phrase: 'punch out', expected: { name: 'clock_shift', args: { action: 'out' } } },
  { phrase: 'end my shift', expected: { name: 'clock_shift', args: { action: 'out' } } },
  { phrase: 'toggle shift', expected: { name: 'clock_shift', args: { action: 'toggle' } } },
  { phrase: 'my summary', expected: { name: 'summarize_status', args: {} } },
  { phrase: 'My stats summary', expected: { name: 'summarize_status', args: {} } },
  { phrase: 'summarize my day', expected: { name: 'summarize_status', args: {} } },
  { phrase: 'how many doors left', expected: { name: 'summarize_status', args: {} } },
  { phrase: 'how many stops left', expected: { name: 'summarize_status', args: {} } },
  { phrase: 'how many houses do i have', expected: { name: 'summarize_status', args: {} } },
  { phrase: 'status count', expected: { name: 'summarize_status', args: {} } },
  { phrase: 'how am i doing', expected: { name: 'summarize_status', args: {} } },
  { phrase: 'check ohio storms', expected: { name: 'recent_ohio_storms', args: { days: 3 } } },
  { phrase: 'ohio storms', expected: { name: 'recent_ohio_storms', args: { days: 3 } } },
  { phrase: 'show hail map', expected: { name: 'recent_ohio_storms', args: { days: 3 } } },
  { phrase: 'recent wind reports', expected: { name: 'recent_ohio_storms', args: { days: 3 } } },
  { phrase: 'check storms from the last 5 days', expected: { name: 'recent_ohio_storms', args: { days: 5 } } },
  { phrase: 'open setter', expected: { name: 'navigate_app', args: { target: 'setter' } } },
  { phrase: 'go to setter', expected: { name: 'navigate_app', args: { target: 'setter' } } },
  { phrase: 'take me to setter', expected: { name: 'navigate_app', args: { target: 'setter' } } },
  { phrase: 'open admin', expected: { name: 'navigate_app', args: { target: 'admin' } } },
  { phrase: 'go to management', expected: { name: 'navigate_app', args: { target: 'admin' } } },
  { phrase: 'take me to management', expected: { name: 'navigate_app', args: { target: 'admin' } } },
  { phrase: 'open the management dashboard', expected: { name: 'navigate_app', args: { target: 'admin' } } },
  { phrase: 'open training', expected: { name: 'navigate_app', args: { target: 'training' } } },
  { phrase: 'take me to training', expected: { name: 'navigate_app', args: { target: 'training' } } },
  { phrase: 'open shifts', expected: { name: 'navigate_app', args: { target: 'shifts' } } },
  { phrase: 'go to shifts', expected: { name: 'navigate_app', args: { target: 'shifts' } } },
  { phrase: 'open forms', expected: { name: 'navigate_app', args: { target: 'forms' } } },
  { phrase: 'open account', expected: { name: 'navigate_app', args: { target: 'account' } } },
  { phrase: 'open field map', expected: { name: 'navigate_app', args: { target: 'map' } } },
  { phrase: 'back to map', expected: { name: 'navigate_app', args: { target: 'map' } } },
  { phrase: 'get live context', expected: { name: 'get_live_context', args: {} } }
];

for (const { phrase, expected } of INTENT_CASES) {
  const actual = matchAssistantIntent(phrase);
  assert.deepEqual(actual, expected, `Intent mismatch for phrase: "${phrase}" -> got ${JSON.stringify(actual)}`);
}

// Verify all 19 MAP_TOOLS are covered by INTENT_CASES
const coveredTools = new Set(INTENT_CASES.map(c => c.expected.name));
for (const tool of MAP_TOOLS) {
  assert.ok(coveredTools.has(tool.name), `Every MAP_TOOLS declaration must be covered in INTENT_CASES: missing ${tool.name}`);
}

// ============================================================================
// 2. Non-Command / Conversational Guardrails (Must Return null)
// ============================================================================
const NON_COMMAND_PHRASES = [
  '',
  '   ',
  'hello there',
  'thank you so much',
  'what should i say when the homeowner says their roof is only five years old',
  'give me a pitch tip for insurance deductibles',
  'sounds good thanks'
];
for (const phrase of NON_COMMAND_PHRASES) {
  assert.equal(matchAssistantIntent(phrase), null, `Non-command phrase should return null: "${phrase}"`);
}

// ============================================================================
// 3. Minimalist Single-Sentence HUD & Greeting Invariants
// ============================================================================
assert.equal(ASSISTANT_GREETING, "Hi, I'm your True North assistant.");
assert.equal(ASSISTANT_GREETING_STEPS.length, 4);
assert.equal(ASSISTANT_ACTION_WORDS.length, 4);
for (const step of ASSISTANT_GREETING_STEPS) {
  assert.equal(singleSentenceText(step.text), step.text);
  assert.ok(step.text.length <= 80, `Greeting sentence must be concise: "${step.text}"`);
}
assert.equal(
  singleSentenceText('Built a 15-stop route (~75 min). Review the stops before starting navigation. Extra sentence.'),
  'Built a 15-stop route (~75 min).'
);

// ============================================================================
// 4. End-to-End API & Runner Verification Across All 19 Map Tools
// ============================================================================
const USER_ID = '11111111-1111-4111-8111-111111111111';
const REP_ID = '22222222-2222-4222-8222-222222222222';
const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'pk-test',
  GEMINI_API_KEY: 'gemini-server-secret'
};

function makeFetch({ role = 'admin', features = ['map', 'coach', 'routes', 'weather', 'intake', 'forms', 'shifts', 'training', 'account'] } = {}) {
  return async (url, init = {}) => {
    const parsed = new URL(url);
    if (parsed.origin === 'https://generativelanguage.googleapis.com') {
      return new Response(JSON.stringify({ name: 'ephemeral-token-123' }), { status: 200 });
    }
    if (parsed.hostname.includes('weather.gov') || parsed.hostname.includes('spc.noaa.gov')) {
      return new Response(JSON.stringify({ features: [] }), { status: 200 });
    }
    if (parsed.pathname === '/auth/v1/user') {
      return new Response(JSON.stringify({ id: USER_ID, email: 'rep@truenorth.test' }), { status: 200 });
    }
    if (parsed.pathname === '/rest/v1/reps') {
      return new Response(JSON.stringify([{ id: REP_ID, user_id: USER_ID, name: 'Test Rep', role, active: true }]), { status: 200 });
    }
    if (parsed.pathname === '/rest/v1/rpc/password_gate_status') {
      return new Response(JSON.stringify({ must_change: false, impersonating: false }), { status: 200 });
    }
    if (parsed.pathname === '/rest/v1/rpc/feature_enabled') {
      const { requested } = JSON.parse(init.body || '{}');
      return new Response(JSON.stringify(features.includes(requested)), { status: 200 });
    }
    return new Response('[]', { status: 200 });
  };
}

for (const { phrase, expected } of INTENT_CASES) {
  const req = new Request('https://app.truenorth.test/api/coach', {
    method: 'POST',
    headers: {
      authorization: 'Bearer valid-jwt',
      'content-type': 'application/json',
      origin: 'https://app.truenorth.test'
    },
    body: JSON.stringify({ workspace: 'map', toolCall: expected })
  });
  const res = await handleVoiceAction(req, { env: ENV, fetchImpl: makeFetch({ role: 'admin' }) });
  assert.equal(res.status, 200, `API /api/coach failed for "${phrase}" (${expected.name})`);
  const payload = await res.json();
  if (expected.name === 'get_live_context') {
    assert.ok(payload.snapshot, 'get_live_context returns snapshot');
  } else if (expected.name === 'recent_ohio_storms') {
    assert.ok(Number.isFinite(payload.reportCount), 'recent_ohio_storms returns reportCount');
  } else {
    assert.equal(payload.authorized, true);
    assert.equal(payload.actorId, USER_ID);
    assert.deepEqual(payload.execute, expected);
  }
}

// Role gate check: setter cannot navigate to admin via voice
{
  const setterAdminCall = matchAssistantIntent('take me to management');
  const req = new Request('https://app.truenorth.test/api/coach', {
    method: 'POST',
    headers: {
      authorization: 'Bearer valid-jwt',
      'content-type': 'application/json',
      origin: 'https://app.truenorth.test'
    },
    body: JSON.stringify({ workspace: 'map', toolCall: setterAdminCall })
  });
  const res = await handleVoiceAction(req, { env: ENV, fetchImpl: makeFetch({ role: 'appointment_setter' }) });
  assert.equal(res.status, 403, 'Setter must be blocked from navigating to management');
}

// Live token check: map workspace includes all 19 MAP_TOOLS
{
  const req = new Request('https://app.truenorth.test/api/live-token', {
    method: 'POST',
    headers: {
      authorization: 'Bearer valid-jwt',
      'content-type': 'application/json',
      origin: 'https://app.truenorth.test'
    },
    body: JSON.stringify({ workspace: 'map' })
  });
  const res = await handleLiveToken(req, { env: ENV, fetchImpl: makeFetch({ role: 'salesperson' }) });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.workspace, 'map');
  assert.equal(data.tools[0].functionDeclarations.length, MAP_TOOLS.length);
}

console.log(`PASS: ${INTENT_CASES.length} natural-language utterances across all ${MAP_TOOLS.length} map tools, ${NON_COMMAND_PHRASES.length} conversational guards, HUD single-sentence constraints, RBAC gates, and Live token declarations verified.`);

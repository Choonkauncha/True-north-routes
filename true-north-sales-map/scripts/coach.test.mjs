import assert from 'node:assert/strict';
import { handleCoach, handleCoachApi, loadCoachSources, createCoachLimiter } from '../api/coach.js';
import { buildCoachSnapshot, coachWindow, coachProfileForModel, guidedCoachReply } from '../lib/coach.js';

const REP = 'a22945c0-d43a-4bd4-972f-16d1d7e06530';
const USER = 'd5e9e53e-27d3-4a30-bc5a-6691c3471750';
const OTHER = '655b2e3e-c6a2-408b-97cf-b7e3e8efba6c';
const NOW = new Date('2026-10-09T12:00:00Z');
const ENV = { SUPABASE_URL: 'https://database.example', SUPABASE_ANON_KEY: 'public-key', SUPABASE_SERVICE_ROLE_KEY: 'server-only' };
const AI_ENV = { ...ENV, AI_GATEWAY_MODEL: 'test/model', AI_GATEWAY_API_KEY: 'gateway-only' };
const keys = ['activity','leads','appointments','photos','forms','shifts','training','progress','assignments','reminders','messages'];
const tableKeys = { lead_activity:'activity', leads:'leads', appointments:'appointments', lead_photos:'photos', form_submissions:'forms', shifts:'shifts', training_items:'training', training_progress:'progress', training_assignments:'assignments', training_reminders:'reminders', messages:'messages' };
const sources = () => Object.fromEntries(keys.map(key => [key, { ok:true, rows:[], limited:false }]));
const request = (body, headers={}) => new Request('https://app.example/api/coach', { method:body===undefined?'GET':'POST', headers:{ authorization:'Bearer real-user-token', ...headers }, ...(body===undefined?{}:{ body:JSON.stringify(body) }) });
function fakeDatabase({ featureEnabled=true, role='salesperson', gate={must_change:false,impersonating:false}, rows={}, active=true, authStatus=200 }={}) {
  const calls=[];
  const fetchImpl=async (url, options) => {
    const u=new URL(url);calls.push({url:u,options});
    let payload=[];let status=200;
    if(u.pathname==='/auth/v1/user'){ payload={id:USER};status=authStatus; }
    else if(u.pathname==='/rest/v1/reps')payload=active?[{id:REP,name:'Avery Example',role}]:[];
    else if(u.pathname==='/rest/v1/rpc/feature_enabled')payload=featureEnabled;
    else if(u.pathname==='/rest/v1/rpc/password_gate_status')payload=gate;
    else { const key=tableKeys[u.pathname.split('/').pop()]; if(rows[key] instanceof Error)return new Response('{"message":"unavailable"}',{status:503});payload=rows[key]||[]; }
    return new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json'}});
  };
  return {fetchImpl,calls};
}
async function run(req, database=fakeDatabase(), options={}) {
  const response=await handleCoach(req,{env:ENV,fetchImpl:database.fetchImpl,now:NOW,limiter:createCoachLimiter(),...options});
  return {response,body:await response.json(),calls:database.calls};
}
let passed=0;
async function check(name, test) { await test(); passed++; console.log(`PASS ${name}`); }

await check('Eastern 14-day window uses ISO across daylight-saving boundaries',async()=>{
  assert.equal(coachWindow(NOW),'2026-09-26T04:00:00.000Z');
  assert.equal(coachWindow(new Date('2026-11-09T12:00Z')),'2026-10-27T04:00:00.000Z');
  assert.equal(coachWindow(new Date('2026-03-15T12:00Z')),'2026-03-02T05:00:00.000Z');
});
await check('signed-out/service credentials cannot request coaching',async()=>{
  for(const authorization of ['', 'Bearer server-only']) {
    const result=await run(request(undefined,{authorization}));
    assert.equal(result.response.status,401);assert.equal(result.calls.length,0);
  }
});
await check('authentication refresh and active role checks precede personal reads',async()=>{
  assert.equal((await run(request(),fakeDatabase({authStatus:401}))).response.status,401);
  for(const config of [{active:false},{role:'homeowner'}]) {
    const result=await run(request(),fakeDatabase(config));
    assert.equal(result.response.status,403);assert.equal(result.calls.length,2);
  }
});
await check('password gate rejects malformed results and flagged accounts',async()=>{
  for(const gate of [null,[],{}, {must_change:'false',impersonating:false},{must_change:false}]) {
    const result=await run(request(),fakeDatabase({gate}));
    assert.equal(result.response.status,502);assert.equal(result.calls.length,5);
  }
  assert.equal((await run(request(),fakeDatabase({gate:{must_change:true,impersonating:false}}))).response.status,403);
  assert.equal((await run(request(),fakeDatabase({gate:{must_change:true,impersonating:true}}))).response.status,200);
});
await check('cross-origin and unsupported methods do not read app data',async()=>{
  const result=await run(request(undefined,{origin:'https://other.example'}));
  assert.equal(result.response.status,403);assert.equal(result.calls.length,0);
  const method=await run(new Request('https://app.example/api/coach',{method:'DELETE'}));
  assert.equal(method.response.status,405);assert.equal(method.response.headers.get('allow'),'GET');
});
await check('POST on the shared Coach route dispatches to authenticated voice actions',async()=>{
  const response=await handleCoachApi(new Request('https://app.example/api/coach',{method:'POST',body:'{}'}),{env:ENV,fetchImpl:async()=>{throw new Error('unauthenticated request must not fetch');}});
  assert.equal(response.status,401);
  assert.deepEqual(await response.json(),{error:'Sign in to open your Coach.'});
});
await check('queries derive identity, minimize activity data, and fetch only upcoming appointments',async()=>{
  const result=await run(request());
  assert.equal(result.response.status,200);
  const rep=result.calls.find(call=>call.url.pathname==='/rest/v1/reps');
  assert.equal(rep.url.searchParams.get('user_id'),`eq.${USER}`);
  const activity=result.calls.find(call=>call.url.pathname==='/rest/v1/lead_activity').url.searchParams;
  assert.equal(activity.get('actor_id'),`eq.${REP}`);
  assert.equal(activity.get('created_at'),'gte.2026-09-26T04:00:00.000Z');
  assert.equal(activity.get('select'),'actor_id,to_status:metadata->>to_status,created_at');
  const appointments=result.calls.find(call=>call.url.pathname==='/rest/v1/appointments').url.searchParams;
  assert.deepEqual(appointments.getAll('scheduled_at'),['gte.2026-10-09T12:00:00.000Z','lt.2026-10-16T12:00:00.000Z']);
  assert.equal(appointments.get('stage'),'in.(Requested,Scheduled,Confirmed)');
  assert.ok(appointments.get('or').includes(REP));
  for(const call of result.calls)assert.equal(call.options.headers.Authorization,'Bearer real-user-token');
  assert.equal(result.response.headers.get('cache-control'),'private, no-store');
});
await check('every role snapshot excludes teammate data even if a source overreturns',async()=>{
  const src=sources();
  src.activity.rows=[{actor_id:REP,to_status:'Knocked'},{actor_id:OTHER,to_status:'Knocked'}];
  src.leads.rows=[{assigned_rep_id:REP,status:'Interested'},{assigned_rep_id:OTHER,status:'Interested',name:'PRIVATE CONTACT'}];
  src.appointments.rows=[{salesperson_id:REP,stage:'Confirmed',scheduled_at:'2026-10-10T12:00Z'},{salesperson_id:OTHER,stage:'Confirmed',scheduled_at:'2026-10-10T12:00Z'}];
  src.photos.rows=[{uploaded_by:REP},{uploaded_by:OTHER}];src.forms.rows=[{submitted_by:REP},{submitted_by:OTHER}];src.messages.rows=[{sender_rep_id:REP},{sender_rep_id:OTHER,body:'PRIVATE MESSAGE'}];
  src.shifts.rows=[{rep_id:REP,clock_in_at:'2026-10-09T10:00Z',clock_out_at:'2026-10-09T11:00Z'},{rep_id:OTHER,clock_in_at:'2026-10-09T01:00Z',clock_out_at:'2026-10-09T11:00Z'}];
  src.training.rows=[{id:'visible',title:'Listening',active:true,required:true,audience:'both'},{id:'assigned',title:'Own assigned lesson',active:true,required:true,audience:'specific'}];
  src.assignments.rows=[{rep_id:REP,item_id:'assigned'},{rep_id:OTHER,item_id:'elsewhere'}];
  src.progress.rows=[{rep_id:REP,item_id:'visible',percent:20},{rep_id:OTHER,item_id:'visible',percent:100,completed_at:'2026-10-08'}];
  for(const role of ['salesperson','appointment_setter','canvasser','manager','admin']) {
    const snapshot=buildCoachSnapshot({id:REP,name:'Avery',role},src,NOW);
    for(const metric of ['touches','interested','upcoming','photos','forms','messages','shiftHours'])assert.equal(snapshot.metrics[metric],1,`${role} ${metric}`);
    assert.equal(snapshot.lessons.find(row=>row.id==='visible').percent,20);
    assert.equal(snapshot.metrics.trainingComplete,0);
    assert.equal(snapshot.lessons.length,2);
    assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'));
  }
});
await check('missing sources stay unknown and do not invent achievements',async()=>{
  const result=await run(request(),fakeDatabase({rows:Object.fromEntries(keys.map(key=>[key,new Error('unavailable')]))}));
  assert.equal(result.response.status,200);
  for(const value of Object.values(result.body.snapshot.metrics))assert.equal(value,null);
  assert.equal(result.body.snapshot.coverage.filter(row=>!row.available).length,keys.length);
  assert.doesNotMatch(result.body.greeting,/completed|recorded field touch|upcoming inspection/);
});
await check('caps qualify achievements and preserve unknown training progress',async()=>{
  const src=sources();src.activity={ok:true,rows:Array.from({length:500},()=>({actor_id:REP,to_status:'Knocked'})),limited:true};
  src.training.rows=[{id:'missing',title:'Listening',active:true,audience:'both',required:true}];src.progress.limited=true;
  const snapshot=buildCoachSnapshot({id:REP,name:'Avery',role:'salesperson'},src,NOW);
  assert.match(snapshot.win,/At least 500/);assert.equal(snapshot.metricLimits.touches,true);
  assert.equal(snapshot.lessons[0].percent,null);assert.equal(snapshot.lessons[0].completed,null);
  assert.equal(snapshot.metrics.trainingPending,0);assert.equal(snapshot.metricLimits.trainingPending,true);
  const loaded=await loadCoachSources({rep:{id:REP},read:async()=>Array.from({length:501},()=>({}))},NOW);
  assert.equal(loaded.activity.rows.length,500);assert.equal(loaded.activity.limited,true);
});
await check('per-user burst quota, concurrency, expiry and bounded map do not affect another user',async()=>{
  let time=0;const limiter=createCoachLimiter({clock:()=>time,maxRequests:2,maxUsers:2});
  const release=limiter.acquire(USER);assert.throws(()=>limiter.acquire(USER),error=>error.status===429&&error.retryAfter===3);
  const other=limiter.acquire(OTHER);other();release();limiter.acquire(USER)();
  assert.throws(()=>limiter.acquire(USER),error=>error.status===429&&error.retryAfter===60);
  assert.throws(()=>limiter.acquire('third-user'),error=>error.status===429);
  time=60001;limiter.acquire(USER)();
});
await check('required unfinished lessons precede generic catalog entries for model context',async()=>{
  const src=sources();src.training.rows=Array.from({length:15},(_,i)=>({id:String(i),title:`Lesson ${i}`,active:true,audience:'both',required:i===14}));
  const snapshot=buildCoachSnapshot({id:REP,name:'Avery',role:'salesperson'},src,NOW);
  const model=coachProfileForModel(snapshot);assert.equal(model.assignedLessons.length,12);assert.equal(model.assignedLessons[0].title,'Lesson 14');
  assert.match(guidedCoachReply(snapshot,'next step','plan'),/required lesson/);
});
await check('practice gets a separate bounded allowance with shared concurrency',async()=>{
  const limiter=createCoachLimiter({maxRequests:1,maxPracticeRequests:2});
  limiter.acquire(USER)();limiter.acquire(USER,{practice:true})();
  const release=limiter.acquire(USER,{practice:true});
  assert.throws(()=>limiter.acquire(USER),e=>e.status===429);release();
  assert.throws(()=>limiter.acquire(USER,{practice:true}),e=>e.status===429);
});
console.log(`Coach API and personalization: ${passed} checks passed.`);

await check('disabled Coach rejects requests before reading personal activity',async()=>{const result=await run(request(),fakeDatabase({featureEnabled:false}));assert.equal(result.response.status,403);assert.equal(result.calls.length,3);});

await check('text chat is rejected before personal reads',async()=>{const result=await run(request({message:"hello"}));assert.equal(result.response.status,405);assert.equal(result.calls.length,0);});

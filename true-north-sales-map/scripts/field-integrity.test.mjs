import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { easternScheduledAt, inspectionInputFromBody, planHomeownerProfile, handleInspection, saveHomeownerProfile } from '../lib/homeowner-profile.js';
import { bootFiles, replaceAssignments, savePhoto } from '../tn-files/store.js';

const publicBody = { first_name:'New',last_name:'Person',phone:'7405550123',address:'1 Main St',city:'Mount Vernon',state:'OH',zip:'43050',consent_contact:true,lead_id:'victim',now:'2000-01-01T00:00:00Z',preferred_date:'2026-10-12',preferred_time_window:'Morning' };
const parsed = inspectionInputFromBody(publicBody,{source:'public_homeowner_form'}).value;
assert.equal(parsed.lead_id,'');
assert.notEqual(parsed.now,publicBody.now);
const victim = {id:'victim',name:'Original',address:publicBody.address,city:publicBody.city,zip:publicBody.zip};
const intake = {id:'intake',lead_id:'victim',...publicBody};
const appointment = {id:'confirmed',lead_id:'victim',stage:'Confirmed'};
const plan = planHomeownerProfile({leads:[victim],intakes:[intake],appointments:[appointment]},parsed);
assert.ok(plan.writes.every(write=>write.method==='post'));
assert.notEqual(plan.leadId,'victim');
assert.equal(victim.name,'Original');
assert.equal(appointment.stage,'Confirmed');

assert.equal(easternScheduledAt('2026-10-12','09:00'),'2026-10-12T13:00:00.000Z');
assert.equal(easternScheduledAt('2026-01-12','09:00'),'2026-01-12T14:00:00.000Z');
assert.equal(easternScheduledAt('2026-02-30','09:00'),'');
assert.equal(easternScheduledAt('2026-03-08','02:30'),'');
for (const TZ of ['UTC','Asia/Tokyo']) {
  const result=spawnSync(process.execPath,['--input-type=module','-e',"import {easternScheduledAt} from './lib/homeowner-profile.js'; console.log(easternScheduledAt('2026-10-12','09:00'));"],{cwd:new URL('..',import.meta.url),env:{...process.env,TZ},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stdout.trim(),'2026-10-12T13:00:00.000Z');
}

const env={SUPABASE_URL:'https://example.test',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'secret'};
const request=()=>new Request('https://app.test/api/inspection',{method:'POST',headers:{authorization:'Bearer user-token'},body:JSON.stringify(publicBody)});
for (const denied of ['password','feature']) {
  let writes=0;
  const response=await handleInspection(request(),{env,fetchImpl:async(url,options={})=>{
    if (url.endsWith('/auth/v1/user'))return new Response(JSON.stringify({id:'user'}));
    if (url.includes('/reps?'))return new Response(JSON.stringify([{id:'rep',role:'appointment_setter'}]));
    if (url.endsWith('/password_gate_status'))return new Response(JSON.stringify({must_change:denied==='password',impersonating:false}));
    if (url.endsWith('/feature_enabled'))return new Response('false');
    writes++;throw Error('Unexpected write');
  }});
  assert.equal(response.status,403);
  assert.equal(writes,0);
}
let rpcCalls=0;
await assert.rejects(saveHomeownerProfile({rpc:async(name)=>{rpcCalls++;assert.equal(name,'atomic_save_homeowner_profile');throw Error('transaction failed');}},parsed),/transaction failed/);
assert.equal(rpcCalls,1);

for (const fetchImpl of [async()=>{throw Error('offline');},async()=>new Response('{}',{status:503}),async()=>new Response('{"configured":false}')]) {
  await assert.rejects(bootFiles({fetchImpl}),/Cloud connection unavailable/);
}
let assignmentCalls=0;
await assert.rejects(replaceAssignments({mode:'cloud',sb:{rpc:async(name,args)=>{assignmentCalls++;assert.equal(name,'replace_form_assignments');assert.deepEqual(args,{p_template_id:'template',p_rep_ids:['one','two']});return {error:Error('transaction rolled back')};}}},'template',['one','two','one']),/transaction rolled back/);
assert.equal(assignmentCalls,1);

let uploaded='',removed='';
const sb={storage:{from:()=>({upload:async(path)=>{uploaded=path;return{};},remove:async(paths)=>{removed=paths[0];return{};}})},from:()=>({insert:()=>({select:()=>({single:async()=>({error:Error('metadata denied')})})})})};
await assert.rejects(savePhoto({mode:'cloud',rep:{id:'rep'},sb},{lead:{id:'lead',address:'1 Main St'},blob:new Blob(['photo']),caption:''}),/metadata denied/);
assert.ok(uploaded);
assert.equal(removed,uploaded);
console.log('field integrity: append-only public intake, Eastern scheduling, access guards, atomic RPC use, config failure and photo compensation passed');

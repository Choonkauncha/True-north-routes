import assert from 'node:assert/strict';
import { handleAccounts } from '../api/accounts.js';
import { requirePasswordReady } from '../lib/server-access.js';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public',SUPABASE_SECRET_KEY:'secret'};
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',target='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status});
const request=(body)=>new Request('https://app.example/api/accounts',{method:'POST',headers:{authorization:'Bearer user-token','content-type':'application/json'},body:JSON.stringify(body)});
async function run(body,options={}) {
 const calls=[];let profilePatches=0;
 const fetchImpl=async(url,init={})=>{
  const method=init.method||'GET';const payload=init.body?JSON.parse(init.body):null;
  calls.push({url,method,payload});
  if(url.endsWith('/auth/v1/user'))return reply({id:actor});
  if(url.includes('/reps?user_id='))return reply([{id:actor,role:'admin'}]);
  if(url.endsWith('/rpc/password_gate_status'))return reply({must_change:!!options.flagged,impersonating:false});
  if(url.includes('/reps?email='))return reply([]);
  if(url.includes('/reps?id=')&&method==='GET')return reply([{id:target,user_id:target,role:'salesperson',active:true,email:'existing@example.com'}]);
  if(url.endsWith('/admin/users')&&method==='POST')return options.existing?reply({message:'Email exists'},422):reply({id:target});
  if(url.includes('/admin/users?page='))return reply({users:[{id:target,email:'existing@example.com'}]});
  if(url.endsWith('/reps')&&method==='POST')return options.profileFail?reply({message:'profile write failed'},500):reply([{id:target}]);
  if(url.includes('/admin/users/')&&method==='DELETE')return reply({});
  if(url.includes('/reps?id=')&&method==='PATCH'){
   profilePatches++;
   if(options.afterResetFail&&profilePatches>1)return reply({message:'profile write failed'},500);
   return reply([{}]);
  }
  if(url.includes('/admin/users/')&&method==='PUT')return reply({});
  if(url.endsWith('/account_audit'))return options.auditFail?reply({message:'audit unavailable'},500):reply([{}]);
  throw Error('Unexpected '+method+' '+url);
 };
 const response=await handleAccounts(request(body),{env,fetchImpl});
 return {status:response.status,body:await response.json(),calls};
}
const creation={action:'create',name:'New Person',email:'existing@example.com',role:'salesperson',password:'temporary-password'};
let r=await run(creation,{flagged:true});assert.equal(r.status,403);assert.equal(r.calls.some(c=>c.url.endsWith('/admin/users')),false);
r=await run(creation,{existing:true});assert.equal(r.status,409);assert.equal(r.calls.some(c=>c.url.endsWith('/reps')&&c.method==='POST'),false);
r=await run(creation,{profileFail:true});assert.equal(r.status,502);assert.ok(r.calls.some(c=>c.method==='DELETE'&&c.url.includes('/admin/users/')));
r=await run(creation,{auditFail:true});assert.equal(r.status,200);assert.equal(r.body.ok,true);assert.match(r.body.warning,/audit/);
r=await run({action:'reset',repId:target,password:'temporary-password'});assert.equal(r.status,200);
const authIndex=r.calls.findIndex(c=>c.method==='PUT'&&c.payload.password);const patches=r.calls.map((c,i)=>c.method==='PATCH'?i:-1).filter(i=>i>=0);assert.ok(patches[0]<authIndex&&patches[1]>authIndex);
r=await run({action:'reset',repId:target,password:'temporary-password'},{afterResetFail:true});assert.equal(r.status,502);assert.ok(r.calls.some(c=>c.payload?.ban_duration==='876000h'));
r=await run({action:'set-active',repId:target,active:false});assert.equal(r.status,200);assert.ok(r.calls.findIndex(c=>c.payload?.active===false)<r.calls.findIndex(c=>c.payload?.ban_duration));
r=await run({action:'set-active',repId:target,active:true});assert.equal(r.status,200);assert.ok(r.calls.findIndex(c=>c.payload?.ban_duration)<r.calls.findIndex(c=>c.payload?.active===true));
for(const [status,body] of [[404,{}],[200,{}]])await assert.rejects(requirePasswordReady(request({}),{env,fetchImpl:async()=>reply(body,status)}),e=>e.status===503);
await assert.rejects(requirePasswordReady(request({}),{env,fetchImpl:async()=>{throw Error('offline')}}),e=>e.status===503);
await requirePasswordReady(request({}),{env,fetchImpl:async()=>reply({must_change:true,impersonating:true})});
console.log('Account provisioning rollback, fail-closed password checks, reset/deactivation ordering and audit semantics passed');

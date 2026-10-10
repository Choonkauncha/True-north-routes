import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { geocodeLabel, geocodeUpdates } from '../lib/geocode-results.js';
import { validPoint } from '../lib/weather.js';
import { clearLeadCache, leadCacheScope, readLeadCache, writeLeadCache } from '../lib/lead-store.js';
assert.deepEqual(geocodeUpdates([
  {id:'missing',status:'No_Match',lat:null,lng:null},
  {id:'blank',status:'Match',lat:'',lng:''},
  {id:'invalid',status:'Match',lat:91,lng:-82},
  {id:'valid',status:'Match',lat:'40.3',lng:'-82.4',matchType:'Exact'}
]), [{id:'valid',lat:40.3,lng:-82.4,geocode_match:'Exact'}]);
assert.equal(geocodeLabel({lat:40,lng:-82,geocodeMatch:'Parcel centroid'}),'Parcel center (approximate)');
assert.equal(geocodeLabel({lat:40,lng:-82,geocode_match:'Exact'}),'Census address match');
assert.equal(geocodeLabel({lat:40,lng:-82,geocode_match:'Non_Exact'}),'Approximate address match');
for (const pair of [[null,null],['',''],[undefined,-82],[40,' ']]) assert.equal(validPoint(...pair),false);
assert.equal(validPoint(0,0),true);
assert.notEqual(leadCacheScope('project','a'),leadCacheScope('project','b'));
assert.notEqual(leadCacheScope('project','a'),leadCacheScope('other','a'));
assert.equal(await readLeadCache(''),null);
await writeLeadCache({leads:[{id:'private'}]},'');
// Exercise IndexedDB reads/writes against a deterministic store, including legacy data.
const originalIdb=globalThis.indexedDB;
const records=new Map([['dataset',{leads:[{id:'legacy-private'}]}]]);
const database={close(){},transaction(){
  const tx={objectStore(){return{
    get(key){const request={};queueMicrotask(()=>{request.result=records.get(key);request.onsuccess?.();});return request;},
    put(value,key){records.set(key,value);queueMicrotask(()=>tx.oncomplete?.());},
    clear(){records.clear();queueMicrotask(()=>tx.oncomplete?.());}
  }}};return tx;
}};
globalThis.indexedDB={open(){const request={};queueMicrotask(()=>{request.result=database;request.onsuccess?.();});return request;}};
try {
  const accountA=leadCacheScope('project','a'),accountB=leadCacheScope('project','b');
  assert.equal(await readLeadCache(accountA),null,'legacy unscoped rows are never read');
  await writeLeadCache({leads:[{id:'a-private'}]},accountA);
  assert.equal((await readLeadCache(accountA)).leads[0].id,'a-private');
  assert.equal(await readLeadCache(accountB),null,'account B cannot read account A cache');
  await clearLeadCache();assert.equal(records.size,0,'logout clears scoped and legacy cache');
} finally {globalThis.indexedDB=originalIdb;}
// Exercise actual startup: a stale stored login cannot trigger any private reads.
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const boot=source.slice(source.indexOf('async function boot(){'),source.indexOf('async function fetchJSON('));
let login=0,privateReads=0;
const context=vm.createContext({state:{},bindStaticEvents(){},showLogin(){login++},fetchJSON:async()=>null,enterLocal(){},readStoredUser:()=>({id:'stale'}),readLeadCache:()=>{privateReads++;},startStaticLeads:()=>{privateReads++;}});
vm.runInContext(boot,context);await context.boot();
assert.equal(login,1);assert.equal(privateReads,0);
console.log('Map startup privacy, account-scoped cache, geocoding and weather regressions passed.');
// Direct endpoint calls require a password-ready management employee.
const { default: geocodeApi } = await import('../api/geocode.js');
const originalFetch=globalThis.fetch;
const keys=['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY'];
const originals=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
try {
  process.env.SUPABASE_URL='https://test.invalid';process.env.SUPABASE_PUBLISHABLE_KEY='public';process.env.SUPABASE_SECRET_KEY='secret';
  let role='salesperson',upstream=0;
  globalThis.fetch=async(url)=>{
    if(String(url).includes('password_gate_status'))return Response.json({must_change:false,impersonating:false});
    if(String(url).includes('/auth/v1/user'))return Response.json({id:'employee'});
    if(String(url).includes('/reps?'))return Response.json([{id:'rep',role}]);
    upstream++;return new Response('"lead","address","No_Match","","",""');
  };
  const request=()=>new Request('https://app.invalid/api/geocode',{method:'POST',headers:{authorization:'Bearer token','content-type':'application/json'},body:JSON.stringify({addresses:[{id:'lead',address:'existing address'}]})});
  assert.equal((await geocodeApi.fetch(request())).status,403);assert.equal(upstream,0);
  role='admin';const response=await geocodeApi.fetch(request());assert.equal(response.status,200);
  assert.equal((await response.json()).results[0].lat,null);assert.equal(upstream,1);
  assert.equal((await geocodeApi.fetch(new Request('https://app.invalid/api/geocode',{method:'POST'}))).status,401);
} finally {
  globalThis.fetch=originalFetch;
  for(const key of keys)if(originals[key]===undefined)delete process.env[key];else process.env[key]=originals[key];
}
console.log('Batch geocoding endpoint role enforcement passed.');
// Actual cloud entry must reject expired, deactivated and password-gated users
// before setting a cache scope or revealing the map.
const cloudEntry=source.slice(source.indexOf('async function runEnterCloud('),source.indexOf('async function loadCloudData('));
for(const denial of ['invalid-user','inactive-rep','password-required','gate-unavailable']) {
  let revealed=0;
  const sb={auth:{getUser:async()=>denial==='invalid-user'?{error:new Error('expired')}:{data:{user:{id:'verified'}}}},
    from(){return{select(){return this},eq(){return this},maybeSingle:async()=>({data:denial==='inactive-rep'?null:{id:'rep',active:true}})}},
    rpc:async()=>denial==='gate-unavailable'?{error:new Error('unavailable')}:{data:{must_change:denial==='password-required',impersonating:false}}};
  const state={supabase:sb,config:{url:'project'},cacheScope:''};
  const ctx=vm.createContext({authEpoch:1,state,document:{dispatchEvent(){}},CustomEvent:class{},hideLogin(){revealed++},leadCacheScope});
  vm.runInContext(cloudEntry,ctx);
  await assert.rejects(ctx.runEnterCloud({access_token:'token',user:{id:'untrusted'}}));
  assert.equal(revealed,0,denial);assert.equal(state.cacheScope,'',denial);
}
console.log('Verified employee and password gate precede private map cache access.');

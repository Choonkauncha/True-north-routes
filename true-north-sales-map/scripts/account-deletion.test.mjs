import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { canManageAccount } from '../lib/account-rules.js';
import { handleAccounts } from '../api/accounts.js';
const admin='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222', sales='33333333-3333-4333-8333-333333333333';
for(const role of ['manager','appointment_setter','canvasser','salesperson']) assert.equal(canManageAccount('admin',role,'delete'),true);
assert.equal(canManageAccount('manager','salesperson','delete'),false);
assert.equal(canManageAccount('admin','admin','delete',{samePerson:true}),false);
const db=new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role;
create schema auth; create table auth.users(id uuid primary key);
create table reps(id uuid primary key,user_id uuid references auth.users on delete cascade,name text, email text, role text, active boolean);
create table account_audit(actor_rep_id uuid references reps on delete set null,target_rep_id uuid references reps on delete set null,action text,target_email text,metadata jsonb);
create table impersonation_grants(user_id uuid); create table impersonation_sessions(user_id uuid);
create table shifts(id int,rep_id uuid references reps on delete cascade);
create table leads(id int,assigned_rep_id uuid references reps on delete set null);
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
insert into auth.users values('${admin}'),('${other}'),('${sales}');
insert into reps values('${admin}','${admin}','Admin','a@test.com','admin',true),('${other}','${other}','Other','o@test.com','admin',true),('${sales}','${sales}','Sales','s@test.com','salesperson',true);
insert into shifts values(1,'${sales}'); insert into leads values(1,'${sales}');`);
await db.exec(readFileSync(new URL('../supabase/migrations/20261012_account_archive.sql',import.meta.url),'utf8'));
await assert.rejects(db.query('select delete_account_to_archive($1,$2)',[admin,other]),/Admin profiles/);
await assert.rejects(db.query('select delete_account_to_archive($1,$2)',[sales,other]),/Only an active admin/);
await db.exec('drop table impersonation_grants; drop table impersonation_sessions;');
await db.query('select delete_account_to_archive($1,$2)',[admin,sales]);
assert.equal((await db.query('select * from auth.users where id=$1',[sales])).rows.length,0);
assert.equal((await db.query('select * from reps where id=$1',[sales])).rows.length,0);
const archive=(await db.query('select * from account_archive')).rows[0];
assert.equal(archive.profile.archived_history['shifts.rep_id'].length,1);
assert.equal((await db.query('select * from leads')).rows[0].assigned_rep_id,null);
assert.equal((await db.query('select delete_account_to_archive($1,$2) as result',[admin,sales])).rows[0].result.already_deleted,true);
// Simulate a cleanup failure: archive and login must roll back together.
await db.exec(`insert into auth.users values('${sales}'); insert into reps values('${sales}','${sales}','Again','again@test.com','salesperson',true); delete from account_archive; create table blocking_fk(rep_id uuid references reps); insert into blocking_fk values('${sales}');`);
await assert.rejects(db.query('select delete_account_to_archive($1,$2)',[admin,sales]));
assert.equal((await db.query('select * from account_archive')).rows.length,0);
assert.equal((await db.query('select * from auth.users where id=$1',[sales])).rows.length,1);
const env={SUPABASE_URL:'https://example.test',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'secret'};
async function request(role,targetRole,action='delete') {
 const writes=[];
 const fetchImpl=async(url,opts={})=> {
  const response=data=>new Response(JSON.stringify(data));
  if(url.endsWith('/auth/v1/user')) return response({id:admin});
  if(url.includes('reps?user_id=')) return response([{id:admin,role}]);
  if(url.includes('password_gate_status')) return response({must_change:false,impersonating:false});
  if(url.includes('reps?id=')) return response([{id:other,user_id:other,role:targetRole}]);
  writes.push(url); return response({ok:true});
 };
 const result=await handleAccounts(new Request('https://app.test/api/accounts',{method:'POST',headers:{authorization:'Bearer token','content-type':'application/json'},body:JSON.stringify({action,repId:other})}),{env,fetchImpl});
 return {status:result.status,writes};
}
assert.equal((await request('admin','salesperson')).status,200);
for(const [role,target] of [['admin','admin'],['manager','salesperson']]) { const result=await request(role,target); assert.equal(result.status,403); assert.equal(result.writes.length,0); }
assert.equal((await request('manager','salesperson','archive')).status,403);
await db.close();
console.log('Account deletion: permissions, real SQL, archive history, retry and transaction rollback passed');

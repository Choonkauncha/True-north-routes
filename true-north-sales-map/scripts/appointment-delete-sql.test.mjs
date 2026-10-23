import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
const migration = readFileSync(new URL('../supabase/migrations/20261023233000_admin_delete_appointments.sql', import.meta.url), 'utf8');
await db.exec(`create role authenticated; create role anon; create role service_role bypassrls; create role supabase_auth_admin;
  create schema auth; create schema storage; create publication supabase_realtime;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role',true) $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
  create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',encrypted_password text);
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
  create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
  alter table storage.objects enable row level security;
  grant usage on schema public,auth,storage to authenticated,service_role;
  grant all on storage.objects to authenticated;`);
await db.exec(readFileSync(new URL('../supabase/setup_all.sql', import.meta.url), 'utf8').replaceAll('create extension if not exists pgcrypto;', ''));
// A dependent table with a blocking FK (as an older inspection_notifications could have) must not stop deletes.
await db.exec(`create table public.inspection_notifications(id bigserial primary key, appointment_id uuid not null references public.appointments(id));`);
await db.exec(migration); // Reapplying is safe.

const ids = { admin: '11111111-1111-4111-8111-111111111111', adminUser: '22222222-2222-4222-8222-222222222222',
  manager: '55555555-5555-4555-8555-555555555555', managerUser: '66666666-6666-4666-8666-666666666666',
  setter: '33333333-3333-4333-8333-333333333333', setterUser: '44444444-4444-4444-8444-444444444444' };
await db.exec(`insert into auth.users(id,email,encrypted_password) values
  ('${ids.adminUser}','admin@example.test','x'),('${ids.managerUser}','manager@example.test','x'),('${ids.setterUser}','setter@example.test','x');
  insert into reps(id,user_id,name,role,active) values
  ('${ids.admin}','${ids.adminUser}','Admin','admin',true),('${ids.manager}','${ids.managerUser}','Manager','manager',true),('${ids.setter}','${ids.setterUser}','Setter','appointment_setter',true);
  insert into leads(id,source,name,address,city,state) values ('L1','test','Home','1 Main','Mount Vernon','OH');
  insert into appointments(id,lead_id,scheduled_at,stage) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','L1',now(),'Confirmed');
  insert into inspection_notifications(appointment_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');`);

async function as(user) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.role','authenticated',false)", [user]);
  await db.exec('set role authenticated');
}
const del = () => db.query("delete from appointments where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' returning id");

await as(ids.setterUser);
assert.equal((await del()).rows.length, 0, 'Setters cannot delete appointments');
await as(ids.managerUser);
assert.equal((await del()).rows.length, 0, 'Managers cannot delete appointments');
await as(ids.adminUser);
assert.equal((await del()).rows.length, 1, 'Admins can delete appointments');
await db.exec('reset role');
assert.equal((await db.query('select count(*)::int n from inspection_notifications')).rows[0].n, 0, 'Notifications cascade with the appointment');
console.log('Appointment delete SQL tests passed.');

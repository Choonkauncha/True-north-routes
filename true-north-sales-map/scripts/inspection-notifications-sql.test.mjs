import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
await db.exec(`
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
end $$;
grant usage on schema public, auth to authenticated;
create publication supabase_realtime;
create table public.reps (
  id uuid primary key,
  user_id uuid,
  name text,
  role text,
  active boolean
);
create table public.leads (
  id text primary key,
  name text,
  address text,
  city text,
  state text,
  zip text
);
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  lead_id text references public.leads(id),
  canvasser_id uuid references public.reps(id),
  salesperson_id uuid,
  scheduled_at timestamptz,
  stage text,
  notes text,
  updated_at timestamptz default now()
);
grant select on public.reps to authenticated;
`);
const migration = readFileSync(new URL('../supabase/migrations/20261012_inspection_notifications.sql', import.meta.url), 'utf8');
await db.exec(migration);
await db.exec(migration);

const setter = '11111111-1111-4111-8111-111111111111';
const admin = '22222222-2222-4222-8222-222222222222';
const sales = '33333333-3333-4333-8333-333333333333';
const manager = '44444444-4444-4444-8444-444444444444';
const owner = '55555555-5555-4555-8555-555555555555';
const inactive = '66666666-6666-4666-8666-666666666666';
await db.exec(`
insert into public.reps values
  ('${setter}','${setter}','Riley Setter','appointment_setter',true),
  ('${admin}','${admin}','Avery Admin','admin',true),
  ('${sales}','${sales}','Jordan Sales','salesperson',true),
  ('${manager}','${manager}','Morgan Manager','manager',true),
  ('${owner}','${owner}','Owen Owner','owner',true),
  ('${inactive}','${inactive}','Former Admin','admin',false);
insert into public.leads values ('house-1','Ada Home','18 North Main','Mount Vernon','OH','43050');
insert into public.appointments (lead_id, canvasser_id, salesperson_id, scheduled_at, stage, notes)
  values ('house-1','${setter}','${sales}','2026-10-14T18:00:00Z','Scheduled','Hail concern');
`);

const booked = await db.query(`select recipient_id::text, title, body, read_at from public.inspection_notifications order by recipient_id`);
assert.deepEqual(booked.rows.map((row) => row.recipient_id), [admin, manager, owner]);
assert.equal(booked.rows[0].title, 'Inspection scheduled');
assert.match(booked.rows[0].body, /Riley Setter booked Ada Home/);
assert.match(booked.rows[0].body, /18 North Main/);
assert.equal(booked.rows[0].read_at, null);

await db.exec(`insert into public.appointments (lead_id, canvasser_id, salesperson_id, scheduled_at, stage, notes)
  values ('house-1', null, null, '2026-10-15T18:00:00Z', 'Requested', 'Public request')`);
assert.equal((await db.query('select * from public.inspection_notifications')).rows.length, 3, 'a request without a setter does not notify');

await db.exec(`update public.inspection_notifications set read_at = now()`);
await db.exec(`update public.appointments set notes = 'Added a note' where stage = 'Scheduled'`);
assert.equal((await db.query('select count(*)::int as n from public.inspection_notifications where read_at is null')).rows[0].n, 0, 'note edits stay read');
await db.exec(`update public.appointments set scheduled_at = '2026-10-16T18:00:00Z' where stage = 'Scheduled'`);
assert.equal((await db.query('select count(*)::int as n from public.inspection_notifications where read_at is null')).rows[0].n, 3, 'a new time is unread again');
assert.equal((await db.query('select count(*)::int as n from public.inspection_notifications')).rows[0].n, 3, 'reschedule keeps one row per person');

const published = await db.query(`select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'inspection_notifications'`);
assert.equal(published.rows.length, 1);

async function asUser(id) {
  await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${id}',false);`);
}
await asUser(admin);
assert.equal((await db.query('select * from public.inspection_notifications')).rows.length, 1);
await db.exec(`update public.inspection_notifications set read_at = now()`);
assert.equal((await db.query('select count(*)::int as n from public.inspection_notifications where read_at is not null')).rows[0].n, 1);
let blocked = false;
try {
  await db.exec(`update public.inspection_notifications set title = 'Changed'`);
} catch {
  blocked = true;
}
assert.equal(blocked, true, 'a recipient cannot rewrite the alert text');

await asUser(sales);
assert.equal((await db.query('select * from public.inspection_notifications')).rows.length, 0, 'a sales rep does not see management alerts');

await db.exec('reset role');
await db.close();
console.log('Inspection notification SQL: fan-out, reread on reschedule, realtime, and own-row reads passed.');

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
create table public.reps (
  id uuid primary key,
  user_id uuid,
  name text,
  role text,
  active boolean
);
grant select on public.reps to authenticated;
insert into public.reps values
  ('11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','Riley Setter','appointment_setter',true),
  ('22222222-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222222','Avery Admin','admin',true),
  ('33333333-3333-4333-8333-333333333333','33333333-3333-4333-8333-333333333333','Jordan Sales','salesperson',true),
  ('44444444-4444-4444-8444-444444444444','44444444-4444-4444-8444-444444444444','Morgan Manager','manager',true);
`);
const migration = readFileSync(new URL('../supabase/migrations/20261011_assigned_routes.sql', import.meta.url), 'utf8');
await db.exec(migration);
await db.exec(migration);

async function asUser(id) {
  await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${id}',false);`);
}

await asUser('22222222-2222-4222-8222-222222222222');
await db.exec(`insert into public.assigned_routes (assignee_id, created_by, lead_ids) values
  ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',array['h1','h2']),
  ('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222',array['h3'])`);
assert.equal((await db.query('select * from public.assigned_routes')).rows.length, 2, 'admin sees every assigned route');

await asUser('11111111-1111-4111-8111-111111111111');
const own = await db.query('select lead_ids from public.assigned_routes');
assert.equal(own.rows.length, 1, 'setter sees only the route assigned to them');
assert.deepEqual(own.rows[0].lead_ids, ['h1', 'h2']);
let denied = false;
try {
  await db.exec(`insert into public.assigned_routes (assignee_id, created_by, lead_ids) values ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',array['nope'])`);
} catch {
  denied = true;
}
assert.equal(denied, true, 'setter cannot assign a route to someone else');
await db.exec(`update public.assigned_routes set lead_ids = array['h1','h9'] where assignee_id = '11111111-1111-4111-8111-111111111111'`);
assert.deepEqual((await db.query('select lead_ids from public.assigned_routes')).rows[0].lead_ids, ['h1', 'h9']);

await asUser('33333333-3333-4333-8333-333333333333');
assert.equal((await db.query('select * from public.assigned_routes')).rows.length, 1, 'sales rep does not see the setter route');

await asUser('44444444-4444-4444-8444-444444444444');
assert.equal((await db.query('select * from public.assigned_routes')).rows.length, 2, 'manager sees every assigned route');
await db.exec(`delete from public.assigned_routes where assignee_id = '33333333-3333-4333-8333-333333333333'`);
assert.equal((await db.query('select * from public.assigned_routes')).rows.length, 1, 'manager can delete an employee route');

await db.exec("reset role; alter table reps add column must_change_password boolean default false; update reps set must_change_password=true where role='appointment_setter';");
await asUser('11111111-1111-4111-8111-111111111111');
assert.equal((await db.query('select * from assigned_routes')).rows.length,0,'flagged user cannot read routes');
await assert.rejects(db.exec("insert into assigned_routes(assignee_id,created_by,lead_ids) values('55555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111',array['blocked'])"));
await db.close();
console.log('Assigned route SQL: admin and manager see all, a rep sees only their own, rerun is safe');

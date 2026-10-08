-- True North setup, in order, safe to run again.
-- Paste this whole file into the Supabase SQL Editor once on a fresh project.
-- It is schema.sql, then the clock-in migration, then forms_photos.sql, then accounts.sql, then the role form library migration, then the document review migration, then the document library migration, then the management library and live message migration, then the training migration.

-- =============================================================================
-- 1. Base schema (supabase/schema.sql)
-- =============================================================================

-- True North Restorations Field OS — shared management schema
-- Run in Supabase SQL Editor. Keep all secrets in Supabase/Vercel environment variables.
create extension if not exists pgcrypto;

create table if not exists public.reps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  role text not null check (role in ('admin','manager','appointment_setter','canvasser','salesperson')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.territories (
  id uuid primary key default gen_random_uuid(),
  name text unique not null, city text, zip text, assigned_rep_id uuid references public.reps(id) on delete set null,
  center_lat double precision, center_lng double precision, color text, created_at timestamptz not null default now()
);

create table if not exists public.leads (
  id text primary key, source text not null, name text, address text not null, secondary_address text, city text, state text, zip text, full_address text, record_id text, record_type text,
  year_built integer, priority text, owner_occupied text, pdf_page integer, lat double precision, lng double precision, geocode_match text,
  status text not null default 'New' check (status in ('New','Knocked','No Answer','Interested','Appointment','Not Interested','Do Not Knock')),
  assigned_rep_id uuid references public.reps(id) on delete set null, territory_id uuid references public.territories(id) on delete set null, roof_age_years numeric, roof_age_verified boolean not null default false, notes text,
  updated_at timestamptz not null default now(), updated_by uuid references public.reps(id) on delete set null
);

create table if not exists public.homeowner_intakes (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null references public.leads(id) on delete cascade,
  first_name text not null, last_name text not null, phone text not null, email text,
  address text not null, city text not null, state text not null default 'OH', zip text,
  homeowner_confirmed boolean not null default false, concern text, what_they_noticed text, other_contractor text, timing text,
  preferred_date text, preferred_time_window text, notes text, consent_contact boolean not null default false,
  source text not null default 'appointment_setter', status text not null default 'New' check (status in ('New','Contacted','Inspection Scheduled','Completed','Closed','Do Not Contact')),
  created_by uuid references public.reps(id) on delete set null, assigned_salesperson_id uuid references public.reps(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.lead_activity (
  id uuid primary key default gen_random_uuid(), lead_id text not null references public.leads(id) on delete cascade, actor_id uuid references public.reps(id) on delete set null,
  action text not null, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(), lead_id text not null references public.leads(id) on delete cascade, canvasser_id uuid references public.reps(id) on delete set null, salesperson_id uuid references public.reps(id) on delete set null,
  scheduled_at timestamptz not null, stage text not null default 'Scheduled' check (stage in ('Requested','Scheduled','Confirmed','Completed','No-show','Cancelled')), notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create index if not exists leads_city_idx on public.leads(city); create index if not exists leads_status_idx on public.leads(status); create index if not exists leads_assigned_rep_idx on public.leads(assigned_rep_id); create index if not exists leads_coords_idx on public.leads(lat,lng);
create index if not exists activity_actor_idx on public.lead_activity(actor_id,created_at desc); create index if not exists activity_lead_idx on public.lead_activity(lead_id,created_at desc); create index if not exists appointments_schedule_idx on public.appointments(scheduled_at);
create index if not exists homeowner_created_idx on public.homeowner_intakes(created_at desc); create index if not exists homeowner_status_idx on public.homeowner_intakes(status);

-- Add new columns to existing deployments.
alter table public.reps add column if not exists email text; alter table public.reps add column if not exists phone text;
alter table public.homeowner_intakes add column if not exists preferred_date text; alter table public.homeowner_intakes add column if not exists preferred_time_window text;

create or replace function public.is_admin_or_manager() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.reps where user_id=auth.uid() and active=true and role in ('admin','manager'));
$$;
create or replace function public.is_active_rep() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.reps where user_id=auth.uid() and active=true);
$$;
grant execute on function public.is_admin_or_manager() to authenticated; grant execute on function public.is_active_rep() to authenticated;

alter table public.reps enable row level security; alter table public.territories enable row level security; alter table public.leads enable row level security; alter table public.homeowner_intakes enable row level security; alter table public.lead_activity enable row level security; alter table public.appointments enable row level security;
revoke all on table public.reps,public.territories,public.leads,public.homeowner_intakes,public.lead_activity,public.appointments from anon;
grant select,insert,update,delete on public.reps to authenticated; grant select,insert,update,delete on public.territories to authenticated; grant select,insert,update on public.leads to authenticated; grant select,insert,update on public.homeowner_intakes to authenticated; grant select,insert on public.lead_activity to authenticated; grant select,insert,update on public.appointments to authenticated;

drop policy if exists reps_select on public.reps; create policy reps_select on public.reps for select to authenticated using (true);
drop policy if exists reps_manage on public.reps; create policy reps_manage on public.reps for all to authenticated using (public.is_admin_or_manager()) with check (public.is_admin_or_manager());

drop policy if exists territories_select on public.territories; create policy territories_select on public.territories for select to authenticated using (true);
drop policy if exists territories_manage on public.territories; create policy territories_manage on public.territories for all to authenticated using (public.is_admin_or_manager()) with check (public.is_admin_or_manager());

drop policy if exists leads_select on public.leads; create policy leads_select on public.leads for select to authenticated using (true);
drop policy if exists leads_insert on public.leads; create policy leads_insert on public.leads for insert to authenticated with check (public.is_active_rep());
drop policy if exists leads_update on public.leads; create policy leads_update on public.leads for update to authenticated using (true) with check (public.is_active_rep());

drop policy if exists activity_select on public.lead_activity; create policy activity_select on public.lead_activity for select to authenticated using (true);
drop policy if exists activity_insert on public.lead_activity; create policy activity_insert on public.lead_activity for insert to authenticated with check (actor_id is null or exists(select 1 from public.reps r where r.id=actor_id and r.user_id=auth.uid()));

drop policy if exists homeowner_select on public.homeowner_intakes; create policy homeowner_select on public.homeowner_intakes for select to authenticated using (public.is_admin_or_manager());
drop policy if exists homeowner_insert on public.homeowner_intakes; create policy homeowner_insert on public.homeowner_intakes for insert to authenticated with check (public.is_active_rep());
drop policy if exists homeowner_update on public.homeowner_intakes; create policy homeowner_update on public.homeowner_intakes for update to authenticated using (public.is_admin_or_manager()) with check (public.is_admin_or_manager());

drop policy if exists appointments_select on public.appointments; create policy appointments_select on public.appointments for select to authenticated using (public.is_active_rep());
drop policy if exists appointments_insert on public.appointments; create policy appointments_insert on public.appointments for insert to authenticated with check (public.is_active_rep());
drop policy if exists appointments_update on public.appointments; create policy appointments_update on public.appointments for update to authenticated using (public.is_active_rep()) with check (public.is_active_rep());

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
drop trigger if exists leads_touch_updated_at on public.leads; create trigger leads_touch_updated_at before update on public.leads for each row execute function public.touch_updated_at();
drop trigger if exists appointments_touch_updated_at on public.appointments; create trigger appointments_touch_updated_at before update on public.appointments for each row execute function public.touch_updated_at();
drop trigger if exists homeowner_touch_updated_at on public.homeowner_intakes; create trigger homeowner_touch_updated_at before update on public.homeowner_intakes for each row execute function public.touch_updated_at();

-- Explicitly enable the shared tables used by live dashboards.
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='leads') then execute 'alter publication supabase_realtime add table public.leads'; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='appointments') then execute 'alter publication supabase_realtime add table public.appointments'; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='lead_activity') then execute 'alter publication supabase_realtime add table public.lead_activity'; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='homeowner_intakes') then execute 'alter publication supabase_realtime add table public.homeowner_intakes'; end if;
end $$;

-- After creating the Auth users, create/update their management profiles:
-- update public.reps set role='admin',active=true,email='...' where user_id='AUTH-USER-UUID';

-- Clock-in, location trails, and office message threads are additive.
-- After this file, run supabase/migrations/20261008_access_clockin.sql.

-- =============================================================================
-- 2. Clock-in, location, and messages (supabase/migrations/20261008_access_clockin.sql)
-- =============================================================================

-- True North field clock-in, location points, and office messages.
-- Additive migration. Apply in the Supabase SQL Editor after supabase/schema.sql.
-- Safe to run once on a database that already has public.reps. Re-running replaces
-- functions, triggers, and policies without dropping recorded shifts or messages.
--
-- What this adds
--   location_consents  — first-time agreement that location is saved only while clocked in
--   shifts             — clock-in / clock-out for setters, canvassers, and sales reps
--   location_points    — one point at clock-in, clock-out, and each door status during a shift
--   message_threads    — one thread per setter / canvasser / sales rep
--   messages           — posts on that thread
--
-- Access
--   Row owner is taken from auth.uid() inside triggers. Clients cannot assign a record
--   to someone else. Setters and reps can read and write only their own rows. Admins
--   and managers can read every row. The service role bypasses RLS; /api/field does
--   not use it for these tables.

create extension if not exists pgcrypto;

create or replace function public.current_rep_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.reps
  where user_id = auth.uid() and active = true
  limit 1;
$$;

create or replace function public.current_rep_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.reps
  where user_id = auth.uid() and active = true
  limit 1;
$$;

revoke all on function public.current_rep_id() from public, anon;
revoke all on function public.current_rep_role() from public, anon;
grant execute on function public.current_rep_id() to authenticated;
grant execute on function public.current_rep_role() to authenticated;

create table if not exists public.location_consents (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null references public.reps(id) on delete cascade,
  notice_version text not null,
  notice_text text not null,
  consented_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (rep_id, notice_version)
);

create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null references public.reps(id) on delete cascade,
  clock_in_at timestamptz not null default now(),
  clock_out_at timestamptz,
  clock_in_lat double precision,
  clock_in_lng double precision,
  clock_out_lat double precision,
  clock_out_lng double precision,
  created_at timestamptz not null default now(),
  constraint shifts_clock_in_coords check (
    (clock_in_lat is null and clock_in_lng is null)
    or (clock_in_lat between -90 and 90 and clock_in_lng between -180 and 180)
  ),
  constraint shifts_clock_out_coords check (
    (clock_out_lat is null and clock_out_lng is null)
    or (clock_out_lat between -90 and 90 and clock_out_lng between -180 and 180)
  ),
  constraint shifts_clock_order check (clock_out_at is null or clock_out_at >= clock_in_at)
);

create unique index if not exists shifts_one_open_per_rep
  on public.shifts (rep_id)
  where clock_out_at is null;
create index if not exists shifts_rep_clock_in_idx
  on public.shifts (rep_id, clock_in_at desc);

create table if not exists public.location_points (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null references public.reps(id) on delete cascade,
  shift_id uuid not null references public.shifts(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy_m numeric,
  captured_at timestamptz not null default now(),
  kind text not null check (kind in ('clock_in', 'clock_out', 'door_status')),
  lead_id text references public.leads(id) on delete set null,
  door_status text,
  created_at timestamptz not null default now(),
  constraint location_points_coords check (lat between -90 and 90 and lng between -180 and 180),
  constraint location_points_accuracy check (accuracy_m is null or (accuracy_m >= 0 and accuracy_m <= 100000)),
  constraint location_points_status_len check (door_status is null or char_length(door_status) between 1 and 40)
);

create index if not exists location_points_rep_time_idx
  on public.location_points (rep_id, captured_at);
create index if not exists location_points_shift_idx
  on public.location_points (shift_id, captured_at);

create table if not exists public.message_threads (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null unique references public.reps(id) on delete cascade,
  rep_last_read_at timestamptz,
  admin_last_read_at timestamptz,
  last_message_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists message_threads_last_idx
  on public.message_threads (last_message_at desc nulls last);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.message_threads(id) on delete cascade,
  sender_rep_id uuid not null references public.reps(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint messages_body_len check (char_length(body) between 1 and 4000)
);

create index if not exists messages_thread_time_idx
  on public.messages (thread_id, created_at);

create or replace function public.location_consents_stamp()
returns trigger
language plpgsql
as $$
begin
  if public.current_rep_id() is null then
    raise exception 'No active team profile';
  end if;
  if public.current_rep_role() not in ('appointment_setter', 'canvasser', 'salesperson') then
    raise exception 'Location consent is for setters, canvassers, and sales reps';
  end if;
  new.rep_id := public.current_rep_id();
  new.consented_at := now();
  new.notice_version := '2026-10-08';
  new.notice_text := $notice$While you are clocked in, True North saves your location when you clock in, when you clock out, and when you mark a door. Your location is not tracked in the background, and it is not saved while you are clocked out. Your browser will ask for location permission. That permission is used only for those clock-in, clock-out, and door points.$notice$;
  return new;
end;
$$;

create or replace function public.shifts_stamp_owner()
returns trigger
language plpgsql
as $$
begin
  if public.current_rep_id() is null then
    raise exception 'No active team profile';
  end if;
  if public.current_rep_role() not in ('appointment_setter', 'canvasser', 'salesperson') then
    raise exception 'Clock in is for setters, canvassers, and sales reps';
  end if;
  if not exists (
    select 1 from public.location_consents c
    where c.rep_id = public.current_rep_id()
      and c.notice_version = '2026-10-08'
  ) then
    raise exception 'Agree to the location notice before clocking in';
  end if;
  new.rep_id := public.current_rep_id();
  new.clock_in_at := now();
  new.clock_out_at := null;
  new.clock_out_lat := null;
  new.clock_out_lng := null;
  return new;
end;
$$;

create or replace function public.shifts_guard_update()
returns trigger
language plpgsql
as $$
begin
  if new.id is distinct from old.id
     or new.rep_id is distinct from old.rep_id
     or new.clock_in_at is distinct from old.clock_in_at
     or new.clock_in_lat is distinct from old.clock_in_lat
     or new.clock_in_lng is distinct from old.clock_in_lng
     or new.created_at is distinct from old.created_at then
    raise exception 'Only clock-out fields can change';
  end if;
  if old.clock_out_at is not null then
    raise exception 'This shift is already closed';
  end if;
  if public.current_rep_id() is distinct from old.rep_id then
    raise exception 'You can only clock out of your own shift';
  end if;
  new.clock_out_at := now();
  return new;
end;
$$;

create or replace function public.location_points_stamp()
returns trigger
language plpgsql
as $$
begin
  if public.current_rep_id() is null then
    raise exception 'No active team profile';
  end if;
  if public.current_rep_role() not in ('appointment_setter', 'canvasser', 'salesperson') then
    raise exception 'Location points are for setters, canvassers, and sales reps';
  end if;
  new.rep_id := public.current_rep_id();
  new.captured_at := now();
  if not exists (
    select 1 from public.shifts s
    where s.id = new.shift_id
      and s.rep_id = new.rep_id
      and s.clock_out_at is null
  ) then
    raise exception 'Location can only be saved during an open shift';
  end if;
  return new;
end;
$$;

create or replace function public.messages_stamp()
returns trigger
language plpgsql
as $$
begin
  if public.current_rep_id() is null then
    raise exception 'No active team profile';
  end if;
  new.sender_rep_id := public.current_rep_id();
  new.created_at := now();
  new.body := btrim(new.body);
  if new.body is null or char_length(new.body) = 0 then
    raise exception 'Write a message first';
  end if;
  if char_length(new.body) > 4000 then
    raise exception 'Message is too long';
  end if;
  return new;
end;
$$;

create or replace function public.messages_touch_thread()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.message_threads
    set last_message_at = new.created_at
    where id = new.thread_id;
  return new;
end;
$$;

create or replace function public.mark_thread_read(p_thread_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.current_rep_id();
  my_role text := public.current_rep_role();
  thread public.message_threads;
begin
  if me is null then
    raise exception 'No active team profile';
  end if;
  select * into thread from public.message_threads where id = p_thread_id;
  if thread.id is null then
    raise exception 'Conversation not found';
  end if;
  if my_role in ('admin', 'manager') then
    update public.message_threads
      set admin_last_read_at = now()
      where id = p_thread_id
      returning * into thread;
  elsif thread.rep_id = me then
    update public.message_threads
      set rep_last_read_at = now()
      where id = p_thread_id
      returning * into thread;
  else
    raise exception 'You can only open your own conversation';
  end if;
  return json_build_object(
    'id', thread.id,
    'rep_id', thread.rep_id,
    'rep_last_read_at', thread.rep_last_read_at,
    'admin_last_read_at', thread.admin_last_read_at
  );
end;
$$;

revoke all on function public.mark_thread_read(uuid) from public, anon;
grant execute on function public.mark_thread_read(uuid) to authenticated;

revoke all on function public.location_consents_stamp() from public, anon;
revoke all on function public.shifts_stamp_owner() from public, anon;
revoke all on function public.shifts_guard_update() from public, anon;
revoke all on function public.location_points_stamp() from public, anon;
revoke all on function public.messages_stamp() from public, anon;
revoke all on function public.messages_touch_thread() from public, anon;
grant execute on function public.location_consents_stamp() to authenticated;
grant execute on function public.shifts_stamp_owner() to authenticated;
grant execute on function public.shifts_guard_update() to authenticated;
grant execute on function public.location_points_stamp() to authenticated;
grant execute on function public.messages_stamp() to authenticated;
grant execute on function public.messages_touch_thread() to authenticated;

drop trigger if exists location_consents_stamp on public.location_consents;
create trigger location_consents_stamp before insert on public.location_consents
  for each row execute function public.location_consents_stamp();

drop trigger if exists shifts_stamp_owner on public.shifts;
create trigger shifts_stamp_owner before insert on public.shifts
  for each row execute function public.shifts_stamp_owner();

drop trigger if exists shifts_guard_update on public.shifts;
create trigger shifts_guard_update before update on public.shifts
  for each row execute function public.shifts_guard_update();

drop trigger if exists location_points_stamp on public.location_points;
create trigger location_points_stamp before insert on public.location_points
  for each row execute function public.location_points_stamp();

drop trigger if exists messages_stamp on public.messages;
create trigger messages_stamp before insert on public.messages
  for each row execute function public.messages_stamp();

drop trigger if exists messages_touch_thread on public.messages;
create trigger messages_touch_thread after insert on public.messages
  for each row execute function public.messages_touch_thread();

alter table public.location_consents enable row level security;
alter table public.shifts enable row level security;
alter table public.location_points enable row level security;
alter table public.message_threads enable row level security;
alter table public.messages enable row level security;

revoke all on table public.location_consents from anon, public;
revoke all on table public.shifts from anon, public;
revoke all on table public.location_points from anon, public;
revoke all on table public.message_threads from anon, public;
revoke all on table public.messages from anon, public;

revoke update, delete on table public.location_consents from authenticated;
revoke delete on table public.shifts from authenticated;
revoke update, delete on table public.location_points from authenticated;
revoke update, delete on table public.message_threads from authenticated;
revoke update, delete on table public.messages from authenticated;

grant select, insert on public.location_consents to authenticated;
grant select, insert, update on public.shifts to authenticated;
grant select, insert on public.location_points to authenticated;
grant select, insert on public.message_threads to authenticated;
grant select, insert on public.messages to authenticated;

drop policy if exists location_consents_select on public.location_consents;
create policy location_consents_select on public.location_consents
  for select to authenticated
  using (rep_id = public.current_rep_id() or public.is_admin_or_manager());

drop policy if exists location_consents_insert on public.location_consents;
create policy location_consents_insert on public.location_consents
  for insert to authenticated
  with check (rep_id = public.current_rep_id());

drop policy if exists shifts_select on public.shifts;
create policy shifts_select on public.shifts
  for select to authenticated
  using (rep_id = public.current_rep_id() or public.is_admin_or_manager());

drop policy if exists shifts_insert on public.shifts;
create policy shifts_insert on public.shifts
  for insert to authenticated
  with check (
    rep_id = public.current_rep_id()
    and public.current_rep_role() in ('appointment_setter', 'canvasser', 'salesperson')
  );

drop policy if exists shifts_update on public.shifts;
create policy shifts_update on public.shifts
  for update to authenticated
  using (rep_id = public.current_rep_id())
  with check (rep_id = public.current_rep_id());

drop policy if exists location_points_select on public.location_points;
create policy location_points_select on public.location_points
  for select to authenticated
  using (rep_id = public.current_rep_id() or public.is_admin_or_manager());

drop policy if exists location_points_insert on public.location_points;
create policy location_points_insert on public.location_points
  for insert to authenticated
  with check (
    rep_id = public.current_rep_id()
    and public.current_rep_role() in ('appointment_setter', 'canvasser', 'salesperson')
    and exists (
      select 1 from public.shifts s
      where s.id = shift_id
        and s.rep_id = public.current_rep_id()
        and s.clock_out_at is null
    )
  );

drop policy if exists message_threads_select on public.message_threads;
create policy message_threads_select on public.message_threads
  for select to authenticated
  using (rep_id = public.current_rep_id() or public.is_admin_or_manager());

drop policy if exists message_threads_insert on public.message_threads;
create policy message_threads_insert on public.message_threads
  for insert to authenticated
  with check (
    (
      rep_id = public.current_rep_id()
      and public.current_rep_role() in ('appointment_setter', 'canvasser', 'salesperson')
    )
    or (
      public.is_admin_or_manager()
      and exists (
        select 1 from public.reps r
        where r.id = rep_id
          and r.active = true
          and r.role in ('appointment_setter', 'canvasser', 'salesperson')
      )
    )
  );

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated
  using (
    exists (
      select 1 from public.message_threads t
      where t.id = thread_id
        and (t.rep_id = public.current_rep_id() or public.is_admin_or_manager())
    )
  );

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    sender_rep_id = public.current_rep_id()
    and exists (
      select 1 from public.message_threads t
      where t.id = thread_id
        and (t.rep_id = public.current_rep_id() or public.is_admin_or_manager())
    )
  );

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
      execute 'alter publication supabase_realtime add table public.messages';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shifts') then
      execute 'alter publication supabase_realtime add table public.shifts';
    end if;
  end if;
end $$;

comment on table public.location_consents is 'Agreement that location is recorded only while the rep is clocked in.';
comment on table public.shifts is 'Clock-in and clock-out intervals. One open shift per rep.';
comment on table public.location_points is 'Points captured at clock-in, clock-out, and door status changes. Not a background track.';
comment on table public.message_threads is 'One office thread per setter, canvasser, or sales rep.';
comment on table public.messages is 'Messages between a field rep and management. Sender is always the signed-in rep.';

-- =============================================================================
-- 3. Photos and forms (supabase/forms_photos.sql)
-- =============================================================================

-- True North photo bank + forms
-- Run in the Supabase SQL Editor AFTER supabase/schema.sql.
-- Creates private storage buckets, tables, row-level security, and two draft agreement templates.
-- Draft templates are placeholders. Replace the wording with True North's own agreements before use.

create extension if not exists pgcrypto;

alter table public.leads add column if not exists created_by uuid references public.reps(id) on delete set null;

create table if not exists public.lead_photos (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null references public.leads(id) on delete cascade,
  uploaded_by uuid references public.reps(id) on delete set null,
  storage_path text not null,
  address_snapshot text,
  caption text,
  created_at timestamptz not null default now()
);

create table if not exists public.form_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  audience text not null check (audience in ('setter', 'rep', 'both')),
  fields jsonb not null default '[]'::jsonb,
  is_draft boolean not null default true,
  draft_notice text,
  active boolean not null default true,
  created_by uuid references public.reps(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references public.form_templates(id) on delete set null,
  template_name text not null,
  lead_id text references public.leads(id) on delete set null,
  submitted_by uuid references public.reps(id) on delete set null,
  address_snapshot text,
  homeowner_name text,
  fields jsonb not null default '[]'::jsonb,
  answers jsonb not null default '{}'::jsonb,
  is_draft boolean not null default false,
  draft_notice text,
  created_at timestamptz not null default now()
);

create index if not exists lead_photos_lead_idx on public.lead_photos(lead_id, created_at desc);
create index if not exists lead_photos_rep_idx on public.lead_photos(uploaded_by, created_at desc);
create index if not exists form_templates_audience_idx on public.form_templates(audience, active);
create index if not exists form_submissions_lead_idx on public.form_submissions(lead_id, created_at desc);
create index if not exists form_submissions_rep_idx on public.form_submissions(submitted_by, created_at desc);
create index if not exists form_submissions_template_idx on public.form_submissions(template_id, created_at desc);

create or replace function public.current_rep_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.reps where user_id = auth.uid() and active = true limit 1
$$;

create or replace function public.current_rep_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.reps where user_id = auth.uid() and active = true limit 1
$$;

create or replace function public.can_use_photo_bank()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_rep_role() in ('admin', 'manager', 'salesperson')
$$;

-- Sales reps: photos on leads they created or are assigned (lead, appointment, or intake).
-- Canvassers and appointment setters: no photo access. Admin and manager: every lead.
create or replace function public.can_access_lead_files(p_lead_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_lead_id is null or btrim(p_lead_id) = '' then false
    when public.current_rep_role() in ('admin', 'manager') then true
    when public.current_rep_role() = 'salesperson' then
      exists (
        select 1 from public.leads l
        where l.id = p_lead_id
          and (l.assigned_rep_id = public.current_rep_id() or l.created_by = public.current_rep_id())
      )
      or exists (
        select 1 from public.appointments a
        where a.lead_id = p_lead_id and a.salesperson_id = public.current_rep_id()
      )
      or exists (
        select 1 from public.homeowner_intakes h
        where h.lead_id = p_lead_id
          and (h.assigned_salesperson_id = public.current_rep_id() or h.created_by = public.current_rep_id())
      )
      or exists (
        select 1 from public.lead_photos p
        where p.lead_id = p_lead_id and p.uploaded_by = public.current_rep_id()
      )
    else false
  end
$$;

grant execute on function public.current_rep_id() to authenticated;
grant execute on function public.current_rep_role() to authenticated;
grant execute on function public.can_use_photo_bank() to authenticated;
grant execute on function public.can_access_lead_files(text) to authenticated;

alter table public.lead_photos enable row level security;
alter table public.form_templates enable row level security;
alter table public.form_submissions enable row level security;

revoke all on table public.lead_photos, public.form_templates, public.form_submissions from anon;
grant select, insert, delete on public.lead_photos to authenticated;
grant select, insert, update on public.form_templates to authenticated;
grant select, insert, delete on public.form_submissions to authenticated;

drop policy if exists lead_photos_select on public.lead_photos;
create policy lead_photos_select on public.lead_photos
  for select to authenticated
  using (public.can_use_photo_bank() and public.can_access_lead_files(lead_id));

drop policy if exists lead_photos_insert on public.lead_photos;
create policy lead_photos_insert on public.lead_photos
  for insert to authenticated
  with check (
    public.can_use_photo_bank()
    and uploaded_by = public.current_rep_id()
    and public.can_access_lead_files(lead_id)
  );

drop policy if exists lead_photos_delete on public.lead_photos;
create policy lead_photos_delete on public.lead_photos
  for delete to authenticated
  using (public.is_admin_or_manager());

drop policy if exists form_templates_select on public.form_templates;
create policy form_templates_select on public.form_templates
  for select to authenticated
  using (
    public.current_rep_role() in ('admin', 'manager')
    or (
      active = true and public.current_rep_role() in ('canvasser', 'appointment_setter')
      and audience in ('setter', 'both')
    )
    or (
      active = true and public.current_rep_role() = 'salesperson'
      and audience in ('rep', 'both')
    )
  );

drop policy if exists form_templates_write on public.form_templates;
create policy form_templates_write on public.form_templates
  for all to authenticated
  using (public.is_admin_or_manager())
  with check (public.is_admin_or_manager());

drop policy if exists form_submissions_select on public.form_submissions;
create policy form_submissions_select on public.form_submissions
  for select to authenticated
  using (
    public.current_rep_role() in ('admin', 'manager')
    or submitted_by = public.current_rep_id()
    or (
      public.current_rep_role() = 'salesperson'
      and lead_id is not null
      and public.can_access_lead_files(lead_id)
    )
  );

drop policy if exists form_submissions_insert on public.form_submissions;
create policy form_submissions_insert on public.form_submissions
  for insert to authenticated
  with check (
    submitted_by = public.current_rep_id()
    and exists (
      select 1 from public.form_templates t
      where t.id = template_id
        and t.active = true
        and (
          public.current_rep_role() in ('admin', 'manager')
          or (public.current_rep_role() in ('canvasser', 'appointment_setter') and t.audience in ('setter', 'both'))
          or (public.current_rep_role() = 'salesperson' and t.audience in ('rep', 'both'))
        )
    )
  );

drop policy if exists form_submissions_delete on public.form_submissions;
create policy form_submissions_delete on public.form_submissions
  for delete to authenticated
  using (public.is_admin_or_manager());

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

drop trigger if exists form_templates_touch_updated_at on public.form_templates;
create trigger form_templates_touch_updated_at
  before update on public.form_templates
  for each row execute function public.touch_updated_at();

-- Private buckets. The browser uses signed URLs. Objects are not public.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('lead-photos', 'lead-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']::text[]),
  ('form-assets', 'form-assets', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']::text[])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- lead-photos path: {lead_id}/{uuid}.jpg
drop policy if exists lead_photos_storage_read on storage.objects;
create policy lead_photos_storage_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'lead-photos'
    and public.can_access_lead_files(split_part(name, '/', 1))
  );

drop policy if exists lead_photos_storage_insert on storage.objects;
create policy lead_photos_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'lead-photos'
    and public.can_use_photo_bank()
    and public.can_access_lead_files(split_part(name, '/', 1))
  );

drop policy if exists lead_photos_storage_delete on storage.objects;
create policy lead_photos_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'lead-photos' and public.is_admin_or_manager());

-- form-assets path: {lead_id}/{rep_id}/{uuid}.jpg
drop policy if exists form_assets_storage_read on storage.objects;
create policy form_assets_storage_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'form-assets'
    and (
      public.is_admin_or_manager()
      or split_part(name, '/', 2) = public.current_rep_id()::text
      or (
        public.current_rep_role() = 'salesperson'
        and public.can_access_lead_files(split_part(name, '/', 1))
      )
    )
  );

drop policy if exists form_assets_storage_insert on storage.objects;
create policy form_assets_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'form-assets'
    and public.current_rep_id() is not null
    and split_part(name, '/', 2) = public.current_rep_id()::text
  );

drop policy if exists form_assets_storage_delete on storage.objects;
create policy form_assets_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'form-assets' and public.is_admin_or_manager());

-- Starter templates. Draft placeholders only. on conflict do nothing so an admin edit is kept.
insert into public.form_templates (id, name, description, audience, fields, is_draft, draft_notice, active)
values
(
  'a1111111-1111-4111-8111-111111111111',
  'Closing / Deal Agreement',
  'Placeholder. This is not True North’s agreement until the company replaces the wording.',
  'rep',
  $tnfields$[
    {"id":"homeowner_name","type":"text","label":"Homeowner name","required":true,"section":"Homeowner","prefill":"name","options":[]},
    {"id":"property_address","type":"text","label":"Property address","required":true,"section":"Homeowner","prefill":"address","options":[]},
    {"id":"insurance_carrier","type":"text","label":"Insurance carrier","required":false,"section":"Insurance","prefill":"none","options":[]},
    {"id":"claim_number","type":"text","label":"Claim number","required":false,"section":"Insurance","prefill":"none","options":[]},
    {"id":"scope","type":"textarea","label":"Scope of work","required":false,"section":"Scope of work","prefill":"none","help":"Describe the work in plain language. Replace this with True North’s own scope wording.","options":[]},
    {"id":"homeowner_signature","type":"signature","label":"Homeowner signature","required":true,"section":"Signatures","prefill":"none","options":[]},
    {"id":"rep_signature","type":"signature","label":"Rep signature","required":true,"section":"Signatures","prefill":"none","options":[]},
    {"id":"agreement_date","type":"date","label":"Date","required":true,"section":"Signatures","prefill":"date","options":[]}
  ]$tnfields$::jsonb,
  true,
  'Draft only. Replace this wording with True North’s own agreement before a homeowner signs.',
  true
),
(
  'a2222222-2222-4222-8222-222222222222',
  'Contingency Agreement',
  'Placeholder. This is not True North’s agreement until the company replaces the wording.',
  'rep',
  $tnfields$[
    {"id":"homeowner_name","type":"text","label":"Homeowner name","required":true,"section":"Homeowner","prefill":"name","options":[]},
    {"id":"property_address","type":"text","label":"Property address","required":true,"section":"Homeowner","prefill":"address","options":[]},
    {"id":"insurance_carrier","type":"text","label":"Insurance carrier","required":false,"section":"Insurance","prefill":"none","options":[]},
    {"id":"claim_number","type":"text","label":"Claim number","required":false,"section":"Insurance","prefill":"none","options":[]},
    {"id":"scope","type":"textarea","label":"Scope of work","required":false,"section":"Scope of work","prefill":"none","help":"Describe the work in plain language. Replace this with True North’s own scope wording.","options":[]},
    {"id":"homeowner_signature","type":"signature","label":"Homeowner signature","required":true,"section":"Signatures","prefill":"none","options":[]},
    {"id":"rep_signature","type":"signature","label":"Rep signature","required":true,"section":"Signatures","prefill":"none","options":[]},
    {"id":"agreement_date","type":"date","label":"Date","required":true,"section":"Signatures","prefill":"date","options":[]}
  ]$tnfields$::jsonb,
  true,
  'Draft only. Replace this wording with True North’s own agreement before a homeowner signs.',
  true
)
on conflict (id) do nothing;

-- =============================================================================
-- 4. Accounts, audit, and first admin (supabase/accounts.sql)
-- =============================================================================

-- Account management: audit log, first-admin bootstrap, and a guard so
-- managers cannot promote themselves. Apply after schema.sql, the clock-in
-- migration, and forms_photos.sql. Safe to run more than once.

create table if not exists public.account_audit (
  id uuid primary key default gen_random_uuid(),
  actor_rep_id uuid references public.reps(id) on delete set null,
  target_rep_id uuid references public.reps(id) on delete set null,
  action text not null check (action in ('user_created','password_reset','user_deactivated','user_reactivated','open_as')),
  target_email text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists account_audit_created_idx on public.account_audit(created_at desc);
create index if not exists account_audit_target_idx on public.account_audit(target_rep_id, created_at desc);

create unique index if not exists reps_email_lower_idx on public.reps (lower(email)) where email is not null and email <> '';

alter table public.account_audit enable row level security;
revoke all on table public.account_audit from anon;
grant select on public.account_audit to authenticated;

drop policy if exists account_audit_select on public.account_audit;
create policy account_audit_select on public.account_audit
  for select to authenticated
  using (public.is_admin_or_manager());

-- The API writes this table with the service role, which bypasses RLS.
-- Signed-in browsers cannot insert audit rows or forge an actor.

create or replace function public.guard_rep_role()
returns trigger
language plpgsql
as $$
declare
  actor text;
begin
  if current_user in ('postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role')
     or auth.role() = 'service_role' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  select role into actor from public.reps where user_id = auth.uid() and active = true limit 1;
  if actor = 'admin' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if actor is distinct from 'manager' then
    raise exception 'Only management can change team accounts';
  end if;
  if tg_op = 'DELETE' then
    if old.role in ('admin', 'manager') then
      raise exception 'Only an admin can change admin or manager accounts';
    end if;
    return old;
  end if;
  if new.role in ('admin', 'manager') or (tg_op = 'UPDATE' and old.role in ('admin', 'manager')) then
    raise exception 'Only an admin can change admin or manager accounts';
  end if;
  if tg_op = 'UPDATE' and old.user_id is distinct from new.user_id then
    raise exception 'Cannot move a login to a different person';
  end if;
  return new;
end;
$$;

drop trigger if exists reps_guard_role on public.reps;
create trigger reps_guard_role
  before insert or update or delete on public.reps
  for each row execute function public.guard_rep_role();

-- First admin. After this function exists, adding either allow-listed email
-- under Authentication → Add user creates an active admin reps row.
create or replace function public.ensure_bootstrap_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  em text := lower(coalesce(new.email, ''));
  label text;
begin
  if em not in ('travisbishopmackie@gmail.com', 'truenorthrestorationss@gmail.com') then
    return new;
  end if;
  label := coalesce(nullif(new.raw_user_meta_data->>'name', ''), split_part(em, '@', 1));
  insert into public.reps (user_id, name, email, role, active)
  values (new.id, label, em, 'admin', true)
  on conflict (user_id) do update
    set role = 'admin', active = true, email = excluded.email, name = coalesce(public.reps.name, excluded.name);
  return new;
end;
$$;

drop trigger if exists reps_bootstrap_admin on auth.users;
create trigger reps_bootstrap_admin
  after insert on auth.users
  for each row execute function public.ensure_bootstrap_admin();

-- If the Auth user was created before this script, attach the admin row now.
insert into public.reps (user_id, name, email, role, active)
select u.id,
  coalesce(nullif(u.raw_user_meta_data->>'name', ''), split_part(u.email, '@', 1)),
  lower(u.email),
  'admin',
  true
from auth.users u
where lower(u.email) in ('travisbishopmackie@gmail.com', 'truenorthrestorationss@gmail.com')
on conflict (user_id) do update
  set role = 'admin', active = true, email = excluded.email;

-- =============================================================================
-- 5. Role form library and photo notes (supabase/migrations/20261008_role_form_library.sql)
-- =============================================================================

-- Form library assignments, uploaded forms, and editable photo notes.
-- Idempotent. Apply in the Supabase SQL editor after forms_photos.sql.
-- Do not remove `canvasser` from public.reps.role. Existing rows stay valid
-- and the app treats them as appointment setters. New logins are not offered that role.

alter table public.form_templates add column if not exists kind text;
alter table public.form_templates add column if not exists storage_path text;
alter table public.form_templates add column if not exists mime_type text;
alter table public.form_templates add column if not exists file_name text;

update public.form_templates set kind = 'builder' where kind is null or btrim(kind) = '';
alter table public.form_templates alter column kind set default 'builder';
alter table public.form_templates alter column kind set not null;

alter table public.form_templates drop constraint if exists form_templates_kind_check;
alter table public.form_templates
  add constraint form_templates_kind_check check (kind in ('builder', 'file'));

alter table public.form_templates drop constraint if exists form_templates_audience_check;
alter table public.form_templates
  add constraint form_templates_audience_check
  check (audience in ('setter', 'rep', 'both', 'people'));

alter table public.form_submissions add column if not exists attachment_path text;
alter table public.form_submissions add column if not exists attachment_name text;

create table if not exists public.form_assignments (
  template_id uuid not null references public.form_templates(id) on delete cascade,
  rep_id uuid not null references public.reps(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (template_id, rep_id)
);

create index if not exists form_assignments_rep_idx on public.form_assignments (rep_id);

create or replace function public.can_fill_template(p_template_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.form_templates t
    where t.id = p_template_id
      and (
        public.current_rep_role() in ('admin', 'manager')
        or (
          t.active = true
          and (
            exists (
              select 1 from public.form_assignments a
              where a.template_id = t.id
                and a.rep_id = public.current_rep_id()
            )
            or (
              public.current_rep_role() in ('appointment_setter', 'canvasser')
              and t.audience in ('setter', 'both')
            )
            or (
              public.current_rep_role() = 'salesperson'
              and t.audience in ('rep', 'both')
            )
          )
        )
      )
  )
$$;

create or replace function public.can_read_form_library(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.form_templates t
    where t.storage_path = p_name
      and public.can_fill_template(t.id)
  )
$$;

grant execute on function public.can_fill_template(uuid) to authenticated;
grant execute on function public.can_read_form_library(text) to authenticated;

alter table public.form_assignments enable row level security;
revoke all on table public.form_assignments from anon, public;
grant select, insert, update, delete on public.form_assignments to authenticated;

drop policy if exists form_assignments_select on public.form_assignments;
create policy form_assignments_select on public.form_assignments
  for select to authenticated
  using (
    public.is_admin_or_manager()
    or rep_id = public.current_rep_id()
  );

drop policy if exists form_assignments_write on public.form_assignments;
create policy form_assignments_write on public.form_assignments
  for all to authenticated
  using (public.is_admin_or_manager())
  with check (public.is_admin_or_manager());

drop policy if exists form_templates_select on public.form_templates;
create policy form_templates_select on public.form_templates
  for select to authenticated
  using (public.can_fill_template(id));

drop policy if exists form_submissions_insert on public.form_submissions;
create policy form_submissions_insert on public.form_submissions
  for insert to authenticated
  with check (
    submitted_by = public.current_rep_id()
    and public.can_fill_template(template_id)
  );

grant update (caption) on public.lead_photos to authenticated;

drop policy if exists lead_photos_update_caption on public.lead_photos;
create policy lead_photos_update_caption on public.lead_photos
  for update to authenticated
  using (
    public.can_use_photo_bank()
    and (uploaded_by = public.current_rep_id() or public.is_admin_or_manager())
  )
  with check (
    public.can_use_photo_bank()
    and (uploaded_by = public.current_rep_id() or public.is_admin_or_manager())
  );

update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[],
    file_size_limit = 15728640
where id = 'form-assets';

drop policy if exists form_assets_storage_read on storage.objects;
create policy form_assets_storage_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'form-assets'
    and (
      public.is_admin_or_manager()
      or split_part(name, '/', 2) = public.current_rep_id()::text
      or (
        public.current_rep_role() = 'salesperson'
        and public.can_access_lead_files(split_part(name, '/', 1))
      )
      or (
        split_part(name, '/', 1) = 'library'
        and public.can_read_form_library(name)
      )
    )
  );

drop policy if exists form_assets_storage_insert on storage.objects;
create policy form_assets_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'form-assets'
    and public.current_rep_id() is not null
    and (
      split_part(name, '/', 2) = public.current_rep_id()::text
      or (
        public.is_admin_or_manager()
        and split_part(name, '/', 1) = 'library'
      )
    )
  );

comment on table public.form_assignments is 'Extra people who can open a form, including a setter assigned a rep form.';
comment on column public.lead_photos.caption is 'Free-text note the rep can add or edit on this photo.';

-- =============================================================================
-- 6. Document review (supabase/migrations/20261008_document_review.sql)
-- =============================================================================

-- Mark paperwork reviewed from the admin documents page.
-- Idempotent. Apply after 20261008_role_form_library.sql.
-- Does not change public.reps.role.

alter table public.form_submissions add column if not exists reviewed_at timestamptz;
alter table public.lead_photos add column if not exists reviewed_at timestamptz;
alter table public.homeowner_intakes add column if not exists reviewed_at timestamptz;

create or replace function public.guard_document_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reviewed_at is distinct from old.reviewed_at and not public.is_admin_or_manager() then
    raise exception 'Only management can mark a document reviewed.';
  end if;
  return new;
end
$$;

drop trigger if exists form_submissions_guard_review on public.form_submissions;
create trigger form_submissions_guard_review
  before update on public.form_submissions
  for each row execute function public.guard_document_review();

drop trigger if exists lead_photos_guard_review on public.lead_photos;
create trigger lead_photos_guard_review
  before update on public.lead_photos
  for each row execute function public.guard_document_review();

drop trigger if exists homeowner_intakes_guard_review on public.homeowner_intakes;
create trigger homeowner_intakes_guard_review
  before update on public.homeowner_intakes
  for each row execute function public.guard_document_review();

drop policy if exists form_submissions_update_review on public.form_submissions;
create policy form_submissions_update_review on public.form_submissions
  for update to authenticated
  using (public.is_admin_or_manager())
  with check (public.is_admin_or_manager());

grant update (caption, reviewed_at) on public.lead_photos to authenticated;

comment on column public.form_submissions.reviewed_at is 'When management marked this form reviewed. Null means new.';
comment on column public.lead_photos.reviewed_at is 'When management marked this photo reviewed. Null means new.';
comment on column public.homeowner_intakes.reviewed_at is 'When management marked this intake reviewed. Null means new.';

-- =============================================================================
-- 7. Document folders, receipts, and estimates (supabase/migrations/20261008_document_library.sql)
-- =============================================================================

-- Document folders, premade files, receipts, and estimates.
-- Idempotent. Apply after 20261008_document_review.sql.
-- Do not remove `canvasser` from public.reps.role.
-- Does not change already-applied migrations. Reuses the private form-assets bucket.

create table if not exists public.document_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  sort_order integer not null default 0,
  system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_categories_name_len check (char_length(btrim(name)) between 1 and 60)
);

insert into public.document_categories (id, name, slug, sort_order, system)
values
  ('c1000000-0000-4000-8000-000000000001', 'Contingency', 'contingency', 10, false),
  ('c1000000-0000-4000-8000-000000000002', 'Agreements', 'agreements', 20, false),
  ('c1000000-0000-4000-8000-000000000003', 'Other', 'other', 30, false),
  ('c1000000-0000-4000-8000-000000000004', 'Uncategorized', 'uncategorized', 40, true)
on conflict (slug) do nothing;

alter table public.form_templates add column if not exists category_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'form_templates_category_id_fkey'
  ) then
    alter table public.form_templates
      add constraint form_templates_category_id_fkey
      foreign key (category_id) references public.document_categories(id) on delete set null;
  end if;
end $$;

create index if not exists form_templates_category_idx on public.form_templates (category_id);

create or replace function public.guard_document_category()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fallback uuid;
begin
  if tg_op = 'DELETE' then
    if old.system or old.slug = 'uncategorized' then
      raise exception 'Uncategorized stays so documents always have a folder.';
    end if;
    select id into fallback
    from public.document_categories
    where slug = 'uncategorized' and id <> old.id
    limit 1;
    if fallback is null then
      if exists (select 1 from public.form_templates where category_id = old.id) then
        raise exception 'Move the documents out of this category before removing it.';
      end if;
    else
      update public.form_templates set category_id = fallback where category_id = old.id;
    end if;
    return old;
  end if;
  if new.slug = 'uncategorized' then
    new.system = true;
  end if;
  return new;
end
$$;

drop trigger if exists document_categories_guard on public.document_categories;
create trigger document_categories_guard
  before delete or update on public.document_categories
  for each row execute function public.guard_document_category();

drop trigger if exists document_categories_touch_updated_at on public.document_categories;
create trigger document_categories_touch_updated_at
  before update on public.document_categories
  for each row execute function public.touch_updated_at();

create table if not exists public.receipt_records (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid references public.reps(id) on delete set null,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  amount numeric(12, 2),
  vendor text not null default '',
  record_date date,
  lead_id text references public.leads(id) on delete set null,
  address_snapshot text not null default '',
  note text not null default '',
  created_at timestamptz not null default now(),
  constraint receipt_records_amount_check check (amount is null or amount >= 0),
  constraint receipt_records_path_check check (storage_path like 'receipts/%' and storage_path not like '%..%')
);

create table if not exists public.estimate_records (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid references public.reps(id) on delete set null,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  homeowner_name text not null default '',
  amount numeric(12, 2),
  record_date date,
  status text not null default 'draft',
  lead_id text references public.leads(id) on delete set null,
  address_snapshot text not null default '',
  note text not null default '',
  created_at timestamptz not null default now(),
  constraint estimate_records_amount_check check (amount is null or amount >= 0),
  constraint estimate_records_status_check check (status in ('draft', 'sent', 'accepted', 'declined')),
  constraint estimate_records_path_check check (storage_path like 'estimates/%' and storage_path not like '%..%')
);

create index if not exists receipt_records_rep_idx on public.receipt_records (uploaded_by, record_date desc);
create index if not exists estimate_records_rep_idx on public.estimate_records (uploaded_by, record_date desc);

alter table public.document_categories enable row level security;
alter table public.receipt_records enable row level security;
alter table public.estimate_records enable row level security;

revoke all on table public.document_categories, public.receipt_records, public.estimate_records from anon, public;
grant select, insert, update, delete on public.document_categories to authenticated;
grant select, insert, delete on public.receipt_records to authenticated;
grant select, insert, delete on public.estimate_records to authenticated;

drop policy if exists document_categories_select on public.document_categories;
create policy document_categories_select on public.document_categories
  for select to authenticated
  using (public.current_rep_id() is not null or public.is_admin_or_manager());

drop policy if exists document_categories_write on public.document_categories;
create policy document_categories_write on public.document_categories
  for all to authenticated
  using (public.is_admin_or_manager())
  with check (public.is_admin_or_manager());

drop policy if exists receipt_records_select on public.receipt_records;
create policy receipt_records_select on public.receipt_records
  for select to authenticated
  using (public.is_admin_or_manager() or uploaded_by = public.current_rep_id());

drop policy if exists receipt_records_insert on public.receipt_records;
create policy receipt_records_insert on public.receipt_records
  for insert to authenticated
  with check (
    uploaded_by = public.current_rep_id()
    and public.current_rep_id() is not null
    and storage_path like 'receipts/' || public.current_rep_id()::text || '/%'
  );

drop policy if exists receipt_records_delete on public.receipt_records;
create policy receipt_records_delete on public.receipt_records
  for delete to authenticated
  using (public.is_admin_or_manager() or uploaded_by = public.current_rep_id());

drop policy if exists estimate_records_select on public.estimate_records;
create policy estimate_records_select on public.estimate_records
  for select to authenticated
  using (public.is_admin_or_manager() or uploaded_by = public.current_rep_id());

drop policy if exists estimate_records_insert on public.estimate_records;
create policy estimate_records_insert on public.estimate_records
  for insert to authenticated
  with check (
    uploaded_by = public.current_rep_id()
    and public.current_rep_id() is not null
    and storage_path like 'estimates/' || public.current_rep_id()::text || '/%'
  );

drop policy if exists estimate_records_delete on public.estimate_records;
create policy estimate_records_delete on public.estimate_records
  for delete to authenticated
  using (public.is_admin_or_manager() or uploaded_by = public.current_rep_id());

-- 25 MB. PDF, images, Word, and Excel. The bucket stays private; the app uses signed URLs.
update storage.buckets
set allowed_mime_types = array[
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/heic',
      'image/heif',
      'application/pdf',
      'application/msword',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]::text[],
    file_size_limit = 26214400
where id = 'form-assets';

-- Library files stay admin-delete. The uploader can delete their own receipt or estimate.
drop policy if exists form_assets_storage_delete on storage.objects;
create policy form_assets_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'form-assets'
    and (
      public.is_admin_or_manager()
      or (
        split_part(name, '/', 1) in ('receipts', 'estimates')
        and split_part(name, '/', 2) = public.current_rep_id()::text
      )
    )
  );

comment on table public.document_categories is 'Editable folders for premade PDFs and agreements. Uncategorized cannot be removed.';
comment on table public.receipt_records is 'Receipt uploads. Management sees every row. A person sees and deletes their own.';
comment on table public.estimate_records is 'Estimate uploads. Management sees every row. A person sees and deletes their own.';

-- =============================================================================
-- 8. Management library, inspection folders, and live messages (supabase/migrations/20261008_library_admin_alerts.sql)
-- =============================================================================

-- Management-only document library, permanent completed-inspection folders, and live messages.
-- Idempotent. Apply after 20261008_document_library.sql.
-- Do not remove `canvasser` from public.reps.role.
-- Does not change already-applied migrations.

-- A completed inspection is an appointment whose stage is Completed.
-- Requested, Scheduled, and Confirmed are still upcoming. No-show and Cancelled are not inspections that happened.
-- One folder per completed appointment, so two visits at the same house stay separate by date.
-- The folder is kept if the stage later changes. Deleting the appointment clears the link and leaves the folder.

alter table public.document_categories add column if not exists kind text;
alter table public.document_categories add column if not exists appointment_id uuid;
alter table public.document_categories add column if not exists lead_id text;

update public.document_categories
set kind = 'custom'
where kind is null or btrim(kind) = '';

alter table public.document_categories alter column kind set default 'custom';
alter table public.document_categories alter column kind set not null;

alter table public.document_categories drop constraint if exists document_categories_kind_check;
alter table public.document_categories
  add constraint document_categories_kind_check check (kind in ('custom', 'inspection'));

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'document_categories_appointment_id_fkey'
  ) then
    alter table public.document_categories
      add constraint document_categories_appointment_id_fkey
      foreign key (appointment_id) references public.appointments(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'document_categories_lead_id_fkey'
  ) then
    alter table public.document_categories
      add constraint document_categories_lead_id_fkey
      foreign key (lead_id) references public.leads(id) on delete set null;
  end if;
end $$;

create unique index if not exists document_categories_appointment_uidx
  on public.document_categories (appointment_id)
  where appointment_id is not null;

create index if not exists document_categories_kind_idx on public.document_categories (kind);

create or replace function public.inspection_folder_label(p_lead_id text, p_when timestamptz)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select left(
    concat_ws(
      ' · ',
      coalesce(nullif(btrim(l.name), ''), nullif(btrim(l.address), ''), 'Inspection'),
      case
        when nullif(btrim(l.name), '') is not null then nullif(btrim(l.address), '')
        else null
      end,
      to_char(coalesce(p_when, now()) at time zone 'America/New_York', 'Mon FMDD, YYYY')
    ),
    60
  )
  from (select 1) seed
  left join public.leads l on l.id = p_lead_id
$$;

create or replace function public.sync_inspection_folder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.stage is distinct from 'Completed' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.stage is not distinct from 'Completed' then
    return new;
  end if;
  insert into public.document_categories (name, slug, sort_order, system, kind, appointment_id, lead_id)
  values (
    public.inspection_folder_label(new.lead_id, coalesce(new.scheduled_at, new.created_at, now())),
    'inspection-' || new.id::text,
    case
      when new.scheduled_at is null then 0
      else least(2147483647, greatest(0, extract(epoch from new.scheduled_at)::bigint))::integer
    end,
    true,
    'inspection',
    new.id,
    new.lead_id
  )
  on conflict (slug) do nothing;
  return new;
end
$$;

drop trigger if exists appointments_inspection_folder on public.appointments;
create trigger appointments_inspection_folder
  after insert or update of stage on public.appointments
  for each row execute function public.sync_inspection_folder();

insert into public.document_categories (name, slug, sort_order, system, kind, appointment_id, lead_id)
select
  public.inspection_folder_label(a.lead_id, coalesce(a.scheduled_at, a.created_at, now())),
  'inspection-' || a.id::text,
  case
    when a.scheduled_at is null then 0
    else least(2147483647, greatest(0, extract(epoch from a.scheduled_at)::bigint))::integer
  end,
  true,
  'inspection',
  a.id,
  a.lead_id
from public.appointments a
where a.stage = 'Completed'
on conflict (slug) do nothing;

create or replace function public.guard_document_category()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fallback uuid;
begin
  if tg_op = 'DELETE' then
    if old.kind = 'inspection' or old.appointment_id is not null then
      raise exception 'Completed inspection folders stay in the library.';
    end if;
    if old.system or old.slug = 'uncategorized' then
      raise exception 'Uncategorized stays so documents always have a folder.';
    end if;
    select id into fallback
    from public.document_categories
    where slug = 'uncategorized' and id <> old.id
    limit 1;
    if fallback is null then
      if exists (select 1 from public.form_templates where category_id = old.id) then
        raise exception 'Move the documents out of this category before removing it.';
      end if;
    else
      update public.form_templates set category_id = fallback where category_id = old.id;
    end if;
    return old;
  end if;
  if old.kind = 'inspection' or old.appointment_id is not null then
    if new.name is distinct from old.name
      or new.slug is distinct from old.slug
      or new.appointment_id is distinct from old.appointment_id
      or new.kind is distinct from old.kind
      or new.lead_id is distinct from old.lead_id
      or new.system is distinct from old.system
    then
      raise exception 'Completed inspection folders cannot be renamed.';
    end if;
  end if;
  if new.slug = 'uncategorized' then
    new.system = true;
  end if;
  return new;
end
$$;

-- Library rows, receipts, and estimates are management only.
drop policy if exists document_categories_select on public.document_categories;
create policy document_categories_select on public.document_categories
  for select to authenticated
  using (public.is_admin_or_manager());

drop policy if exists receipt_records_select on public.receipt_records;
create policy receipt_records_select on public.receipt_records
  for select to authenticated
  using (public.is_admin_or_manager());

drop policy if exists receipt_records_insert on public.receipt_records;
create policy receipt_records_insert on public.receipt_records
  for insert to authenticated
  with check (
    public.is_admin_or_manager()
    and uploaded_by = public.current_rep_id()
    and public.current_rep_id() is not null
    and storage_path like 'receipts/' || public.current_rep_id()::text || '/%'
  );

drop policy if exists receipt_records_delete on public.receipt_records;
create policy receipt_records_delete on public.receipt_records
  for delete to authenticated
  using (public.is_admin_or_manager());

drop policy if exists estimate_records_select on public.estimate_records;
create policy estimate_records_select on public.estimate_records
  for select to authenticated
  using (public.is_admin_or_manager());

drop policy if exists estimate_records_insert on public.estimate_records;
create policy estimate_records_insert on public.estimate_records
  for insert to authenticated
  with check (
    public.is_admin_or_manager()
    and uploaded_by = public.current_rep_id()
    and public.current_rep_id() is not null
    and storage_path like 'estimates/' || public.current_rep_id()::text || '/%'
  );

drop policy if exists estimate_records_delete on public.estimate_records;
create policy estimate_records_delete on public.estimate_records
  for delete to authenticated
  using (public.is_admin_or_manager());

-- Premade library files (kind file) are management only.
-- Fillable builder forms stay available to setters, canvassers, reps, and people assigned to them.
-- Do not remove `canvasser` from public.reps.role.
create or replace function public.can_fill_template(p_template_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.form_templates t
    where t.id = p_template_id
      and (
        public.current_rep_role() in ('admin', 'manager')
        or (
          t.active = true
          and coalesce(t.kind, 'builder') <> 'file'
          and (
            exists (
              select 1 from public.form_assignments a
              where a.template_id = t.id
                and a.rep_id = public.current_rep_id()
            )
            or (
              public.current_rep_role() in ('appointment_setter', 'canvasser')
              and t.audience in ('setter', 'both')
            )
            or (
              public.current_rep_role() = 'salesperson'
              and t.audience in ('rep', 'both')
            )
          )
        )
      )
  )
$$;

-- receipts/, estimates/, and library/ are management-only.
-- A setter or rep can still read and upload their own form files under other prefixes.
drop policy if exists form_assets_storage_read on storage.objects;
create policy form_assets_storage_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'form-assets'
    and (
      public.is_admin_or_manager()
      or (
        split_part(name, '/', 2) = public.current_rep_id()::text
        and split_part(name, '/', 1) not in ('receipts', 'estimates', 'library')
      )
      or (
        public.current_rep_role() = 'salesperson'
        and public.can_access_lead_files(split_part(name, '/', 1))
        and split_part(name, '/', 1) not in ('receipts', 'estimates', 'library')
      )
    )
  );

drop policy if exists form_assets_storage_insert on storage.objects;
create policy form_assets_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'form-assets'
    and public.current_rep_id() is not null
    and (
      (
        split_part(name, '/', 2) = public.current_rep_id()::text
        and split_part(name, '/', 1) not in ('receipts', 'estimates', 'library')
      )
      or (
        public.is_admin_or_manager()
        and split_part(name, '/', 1) in ('library', 'receipts', 'estimates')
      )
    )
  );

drop policy if exists form_assets_storage_delete on storage.objects;
create policy form_assets_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'form-assets'
    and public.is_admin_or_manager()
  );

-- Live message alerts. Realtime still respects row level security for the signed-in user.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'messages'
     ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

comment on table public.document_categories is 'Management folders. Inspection folders are created when an appointment stage becomes Completed and cannot be renamed or deleted.';
comment on column public.document_categories.kind is 'custom for folders management edits. inspection for a completed appointment.';
comment on table public.receipt_records is 'Receipt uploads. Only admin and manager can read, add, or delete them.';
comment on table public.estimate_records is 'Estimate uploads. Only admin and manager can read, add, or delete them.';
comment on table public.messages is 'Messages between a field rep and management. Included in supabase_realtime so each recipient can be notified. Sender is always the signed-in rep.';

-- =============================================================================
-- 9. Training and practice (supabase/migrations/20261008_training_practice.sql)
-- =============================================================================

-- Training and practice library.
-- Idempotent. Apply once in the Supabase SQL Editor. Safe to run again.
-- Does not modify earlier migrations.
--
-- Storage limits checked against project qdovtewieuojjsebipex on 2026-10-08:
--   Organization TrueNorthRestorations is on the Free plan (tier_free).
--   Free plan global file cap: 50 MB (52,428,800 bytes). Pro and above can go
--   higher (up to 500 GB). The global setting lives in Storage settings, not
--   in Postgres, so this migration cannot read it. It can only set the bucket.
--   Existing buckets are under that cap: lead-photos 5 MB, form-assets 25 MB.
--   The training bucket is therefore capped at 50 MB, the highest value the
--   Free plan allows. The admin screen refuses anything larger before upload
--   and surfaces the storage API error if the dashboard global limit is lower.
--
-- Access
--   Admins and managers read and write every row.
--   Setters (including legacy canvasser) and sales reps read items assigned
--   to their role or to them personally, and read/write only their own progress.

create extension if not exists pgcrypto;

create table if not exists public.training_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  category text not null default '',
  sort_order integer not null default 0,
  audience text not null default 'both',
  required boolean not null default false,
  kind text not null,
  storage_path text,
  original_path text,
  poster_path text,
  mime_type text,
  file_name text,
  byte_size bigint,
  duration_seconds numeric,
  slide_count integer,
  page_count integer,
  external_url text,
  external_provider text,
  active boolean not null default true,
  created_by uuid references public.reps(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.training_items add column if not exists description text not null default '';
alter table public.training_items add column if not exists category text not null default '';
alter table public.training_items add column if not exists sort_order integer not null default 0;
alter table public.training_items add column if not exists audience text not null default 'both';
alter table public.training_items add column if not exists required boolean not null default false;
alter table public.training_items add column if not exists kind text;
alter table public.training_items add column if not exists storage_path text;
alter table public.training_items add column if not exists original_path text;
alter table public.training_items add column if not exists poster_path text;
alter table public.training_items add column if not exists mime_type text;
alter table public.training_items add column if not exists file_name text;
alter table public.training_items add column if not exists byte_size bigint;
alter table public.training_items add column if not exists duration_seconds numeric;
alter table public.training_items add column if not exists slide_count integer;
alter table public.training_items add column if not exists page_count integer;
alter table public.training_items add column if not exists external_url text;
alter table public.training_items add column if not exists external_provider text;
alter table public.training_items add column if not exists active boolean not null default true;
alter table public.training_items add column if not exists created_by uuid references public.reps(id) on delete set null;
alter table public.training_items add column if not exists created_at timestamptz not null default now();
alter table public.training_items add column if not exists updated_at timestamptz not null default now();

alter table public.training_items drop constraint if exists training_items_title_len;
alter table public.training_items add constraint training_items_title_len check (char_length(title) between 2 and 160);
alter table public.training_items drop constraint if exists training_items_description_len;
alter table public.training_items add constraint training_items_description_len check (char_length(description) <= 2000);
alter table public.training_items drop constraint if exists training_items_category_len;
alter table public.training_items add constraint training_items_category_len check (char_length(category) <= 80);
alter table public.training_items drop constraint if exists training_items_audience;
alter table public.training_items add constraint training_items_audience check (audience in ('setters', 'reps', 'both', 'specific'));
alter table public.training_items drop constraint if exists training_items_kind;
alter table public.training_items add constraint training_items_kind check (kind in ('video', 'deck', 'pdf', 'image', 'external'));
alter table public.training_items drop constraint if exists training_items_provider;
alter table public.training_items add constraint training_items_provider check (external_provider is null or external_provider in ('youtube', 'vimeo', 'loom'));
alter table public.training_items drop constraint if exists training_items_sort;
alter table public.training_items add constraint training_items_sort check (sort_order >= 0 and sort_order < 100000);
alter table public.training_items drop constraint if exists training_items_counts;
alter table public.training_items add constraint training_items_counts check (
  (slide_count is null or slide_count >= 0)
  and (page_count is null or page_count >= 0)
  and (duration_seconds is null or duration_seconds >= 0)
  and (byte_size is null or byte_size >= 0)
);

create index if not exists training_items_order_idx on public.training_items (active, sort_order, title);

create table if not exists public.training_assignments (
  item_id uuid not null references public.training_items(id) on delete cascade,
  rep_id uuid not null references public.reps(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item_id, rep_id)
);

create index if not exists training_assignments_rep_idx on public.training_assignments (rep_id);

create table if not exists public.training_reminders (
  item_id uuid not null references public.training_items(id) on delete cascade,
  rep_id uuid not null references public.reps(id) on delete cascade,
  created_by uuid references public.reps(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (item_id, rep_id)
);

create index if not exists training_reminders_rep_idx on public.training_reminders (rep_id);

create table if not exists public.training_progress (
  rep_id uuid not null references public.reps(id) on delete cascade,
  item_id uuid not null references public.training_items(id) on delete cascade,
  started_at timestamptz,
  last_position_seconds numeric not null default 0,
  max_watched_seconds numeric not null default 0,
  percent numeric not null default 0,
  completed_at timestamptz,
  view_count integer not null default 0,
  updated_at timestamptz not null default now(),
  pages_viewed integer[] not null default '{}',
  watched_ranges jsonb not null default '[]'::jsonb,
  primary key (rep_id, item_id)
);

alter table public.training_progress add column if not exists started_at timestamptz;
alter table public.training_progress add column if not exists last_position_seconds numeric not null default 0;
alter table public.training_progress add column if not exists max_watched_seconds numeric not null default 0;
alter table public.training_progress add column if not exists percent numeric not null default 0;
alter table public.training_progress add column if not exists completed_at timestamptz;
alter table public.training_progress add column if not exists view_count integer not null default 0;
alter table public.training_progress add column if not exists updated_at timestamptz not null default now();
alter table public.training_progress add column if not exists pages_viewed integer[] not null default '{}';
alter table public.training_progress add column if not exists watched_ranges jsonb not null default '[]'::jsonb;

alter table public.training_progress drop constraint if exists training_progress_percent;
alter table public.training_progress add constraint training_progress_percent check (percent >= 0 and percent <= 100);
alter table public.training_progress drop constraint if exists training_progress_times;
alter table public.training_progress add constraint training_progress_times check (
  last_position_seconds >= 0
  and max_watched_seconds >= 0
  and view_count >= 0
);

create index if not exists training_progress_item_idx on public.training_progress (item_id);

-- Visibility is security definer so storage policies and item policies can
-- share one rule without recursing through RLS. It uses the existing helpers
-- current_rep_id(), current_rep_role(), and is_admin_or_manager().
create or replace function public.can_view_training_item(target_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.training_items i
    where i.id = target_id
      and (
        public.is_admin_or_manager()
        or (
          i.active
          and (
            (
              i.audience in ('setters', 'both')
              and public.current_rep_role() in ('appointment_setter', 'canvasser')
            )
            or (
              i.audience in ('reps', 'both')
              and public.current_rep_role() = 'salesperson'
            )
            or exists (
              select 1 from public.training_assignments a
              where a.item_id = i.id
                and a.rep_id = public.current_rep_id()
            )
          )
        )
      )
  );
$$;

revoke all on function public.can_view_training_item(uuid) from public, anon;
grant execute on function public.can_view_training_item(uuid) to authenticated;

create or replace function public.training_object_visible(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when split_part(object_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.can_view_training_item(split_part(object_name, '/', 1)::uuid)
    else false
  end;
$$;

revoke all on function public.training_object_visible(text) from public, anon;
grant execute on function public.training_object_visible(text) to authenticated;

create or replace function public.training_progress_stamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.is_admin_or_manager() then
    if public.current_rep_id() is null then
      raise exception 'No active team profile';
    end if;
    if tg_op = 'INSERT' then
      new.rep_id := public.current_rep_id();
    elsif new.rep_id is distinct from old.rep_id or new.item_id is distinct from old.item_id then
      raise exception 'You can only update your own training progress';
    end if;
  end if;
  if new.percent < 0 or new.percent > 100 then
    raise exception 'Percent must be between 0 and 100';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.training_progress_stamp() from public, anon;

drop trigger if exists training_items_touch_updated_at on public.training_items;
create trigger training_items_touch_updated_at
  before update on public.training_items
  for each row execute function public.touch_updated_at();

drop trigger if exists training_progress_stamp on public.training_progress;
create trigger training_progress_stamp
  before insert or update on public.training_progress
  for each row execute function public.training_progress_stamp();

alter table public.training_items enable row level security;
alter table public.training_assignments enable row level security;
alter table public.training_reminders enable row level security;
alter table public.training_progress enable row level security;

revoke all on table public.training_items, public.training_assignments, public.training_reminders, public.training_progress from anon, public;
grant select, insert, update, delete on public.training_items to authenticated;
grant select, insert, update, delete on public.training_assignments to authenticated;
grant select, insert, update, delete on public.training_reminders to authenticated;
grant select, insert, update, delete on public.training_progress to authenticated;

drop policy if exists training_items_select on public.training_items;
create policy training_items_select on public.training_items
  for select to authenticated
  using (public.can_view_training_item(id));

drop policy if exists training_items_write on public.training_items;
create policy training_items_write on public.training_items
  for all to authenticated
  using (public.is_admin_or_manager())
  with check (public.is_admin_or_manager());

drop policy if exists training_assignments_select on public.training_assignments;
create policy training_assignments_select on public.training_assignments
  for select to authenticated
  using (rep_id = public.current_rep_id() or public.is_admin_or_manager());

drop policy if exists training_assignments_write on public.training_assignments;
create policy training_assignments_write on public.training_assignments
  for all to authenticated
  using (public.is_admin_or_manager())
  with check (public.is_admin_or_manager());

drop policy if exists training_reminders_select on public.training_reminders;
create policy training_reminders_select on public.training_reminders
  for select to authenticated
  using (rep_id = public.current_rep_id() or public.is_admin_or_manager());

drop policy if exists training_reminders_write on public.training_reminders;
create policy training_reminders_write on public.training_reminders
  for all to authenticated
  using (public.is_admin_or_manager())
  with check (public.is_admin_or_manager());

drop policy if exists training_progress_select on public.training_progress;
create policy training_progress_select on public.training_progress
  for select to authenticated
  using (rep_id = public.current_rep_id() or public.is_admin_or_manager());

drop policy if exists training_progress_insert on public.training_progress;
create policy training_progress_insert on public.training_progress
  for insert to authenticated
  with check (rep_id = public.current_rep_id() or public.is_admin_or_manager());

drop policy if exists training_progress_update on public.training_progress;
create policy training_progress_update on public.training_progress
  for update to authenticated
  using (rep_id = public.current_rep_id() or public.is_admin_or_manager())
  with check (rep_id = public.current_rep_id() or public.is_admin_or_manager());

drop policy if exists training_progress_delete on public.training_progress;
create policy training_progress_delete on public.training_progress
  for delete to authenticated
  using (public.is_admin_or_manager());

-- Private bucket. Playback uses signed URLs. 50 MB matches the Free plan cap.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'training',
  'training',
  false,
  52428800,
  array[
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-m4v',
    'video/m4v',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
  ]::text[]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists training_storage_select on storage.objects;
create policy training_storage_select on storage.objects
  for select to authenticated
  using (bucket_id = 'training' and public.training_object_visible(name));

drop policy if exists training_storage_insert on storage.objects;
create policy training_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'training' and public.is_admin_or_manager());

drop policy if exists training_storage_update on storage.objects;
create policy training_storage_update on storage.objects
  for update to authenticated
  using (bucket_id = 'training' and public.is_admin_or_manager())
  with check (bucket_id = 'training' and public.is_admin_or_manager());

drop policy if exists training_storage_delete on storage.objects;
create policy training_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'training' and public.is_admin_or_manager());

comment on table public.training_items is 'Training videos, decks, PDFs, images, and external links uploaded by management.';
comment on table public.training_progress is 'One row per person per item. Video percent is played time, not the seek position.';

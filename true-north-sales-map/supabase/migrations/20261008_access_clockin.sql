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

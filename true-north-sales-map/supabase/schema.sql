-- True North Roofing Canvasser Command Center
-- Run this in Supabase SQL Editor before using Cloud mode.

create extension if not exists pgcrypto;

create table if not exists public.reps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete cascade,
  name text not null,
  role text not null check (role in ('admin','manager','canvasser','salesperson')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.territories (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  city text,
  zip text,
  assigned_rep_id uuid references public.reps(id) on delete set null,
  center_lat double precision,
  center_lng double precision,
  color text,
  created_at timestamptz not null default now()
);

create table if not exists public.leads (
  id text primary key,
  source text not null,
  name text,
  address text not null,
  secondary_address text,
  city text,
  state text,
  zip text,
  full_address text,
  record_id text,
  record_type text,
  year_built integer,
  priority text,
  owner_occupied text,
  pdf_page integer,
  lat double precision,
  lng double precision,
  geocode_match text,
  status text not null default 'New' check (status in ('New','Knocked','No Answer','Interested','Appointment','Not Interested','Do Not Knock')),
  assigned_rep_id uuid references public.reps(id) on delete set null,
  territory_id uuid references public.territories(id) on delete set null,
  roof_age_years numeric,
  roof_age_verified boolean not null default false,
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.reps(id) on delete set null
);

create table if not exists public.lead_activity (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null references public.leads(id) on delete cascade,
  actor_id uuid references public.reps(id) on delete set null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null references public.leads(id) on delete cascade,
  canvasser_id uuid references public.reps(id) on delete set null,
  salesperson_id uuid references public.reps(id) on delete set null,
  scheduled_at timestamptz not null,
  stage text not null default 'Scheduled' check (stage in ('Scheduled','Confirmed','Completed','No-show','Cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leads_city_idx on public.leads(city);
create index if not exists leads_status_idx on public.leads(status);
create index if not exists leads_assigned_rep_idx on public.leads(assigned_rep_id);
create index if not exists leads_coords_idx on public.leads(lat,lng);
create index if not exists activity_actor_idx on public.lead_activity(actor_id,created_at desc);
create index if not exists activity_lead_idx on public.lead_activity(lead_id,created_at desc);
create index if not exists appointments_schedule_idx on public.appointments(scheduled_at);

create or replace function public.is_admin_or_manager()
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1 from public.reps
    where user_id=auth.uid() and active=true and role in ('admin','manager')
  );
$$;

grant execute on function public.is_admin_or_manager() to authenticated;

alter table public.reps enable row level security;
alter table public.territories enable row level security;
alter table public.leads enable row level security;
alter table public.lead_activity enable row level security;
alter table public.appointments enable row level security;

-- Explicit API grants: keep the anon role closed and let RLS decide authenticated access.
revoke all on table public.reps, public.territories, public.leads, public.lead_activity, public.appointments from anon;
grant select, insert, update, delete on table public.reps to authenticated;
grant select, insert, update, delete on table public.territories to authenticated;
grant select, insert, update on table public.leads to authenticated;
grant select, insert on table public.lead_activity to authenticated;
grant select, insert, update on table public.appointments to authenticated;

-- Reps: everyone signed in may read the team; admins/managers manage profiles.
drop policy if exists reps_select on public.reps;
create policy reps_select on public.reps for select to authenticated using (true);
drop policy if exists reps_manage on public.reps;
create policy reps_manage on public.reps for all to authenticated using (public.is_admin_or_manager()) with check (public.is_admin_or_manager());

-- Territories: shared read, admin/manager write.
drop policy if exists territories_select on public.territories;
create policy territories_select on public.territories for select to authenticated using (true);
drop policy if exists territories_manage on public.territories;
create policy territories_manage on public.territories for all to authenticated using (public.is_admin_or_manager()) with check (public.is_admin_or_manager());

-- Leads: all signed-in team members can see/update the live canvassing board.
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select to authenticated using (true);
drop policy if exists leads_insert on public.leads;
create policy leads_insert on public.leads for insert to authenticated with check (public.is_admin_or_manager());
drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads for update to authenticated using (true) with check (true);

-- Activity and appointments are shared team records.
drop policy if exists activity_select on public.lead_activity;
create policy activity_select on public.lead_activity for select to authenticated using (true);
drop policy if exists activity_insert on public.lead_activity;
create policy activity_insert on public.lead_activity for insert to authenticated with check (actor_id is null or exists(select 1 from public.reps r where r.id=actor_id and r.user_id=auth.uid()));

drop policy if exists appointments_select on public.appointments;
create policy appointments_select on public.appointments for select to authenticated using (true);
drop policy if exists appointments_insert on public.appointments;
create policy appointments_insert on public.appointments for insert to authenticated with check (canvasser_id is null or exists(select 1 from public.reps r where r.id=canvasser_id and r.user_id=auth.uid()));
drop policy if exists appointments_update on public.appointments;
create policy appointments_update on public.appointments for update to authenticated using (true) with check (true);

-- Automatic timestamps.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at=now();
  return new;
end $$;
drop trigger if exists leads_touch_updated_at on public.leads;
create trigger leads_touch_updated_at before update on public.leads for each row execute function public.touch_updated_at();
drop trigger if exists appointments_touch_updated_at on public.appointments;
create trigger appointments_touch_updated_at before update on public.appointments for each row execute function public.touch_updated_at();

-- IMPORTANT: after creating a Supabase Auth user, insert a matching rep profile.
-- Example (replace UUID/email/name):
-- insert into public.reps(user_id,name,role) values ('AUTH-USER-UUID','Travis','admin');

-- Enable shared realtime events used by the live field board.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='leads') then
    execute 'alter publication supabase_realtime add table public.leads';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='appointments') then
    execute 'alter publication supabase_realtime add table public.appointments';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='lead_activity') then
    execute 'alter publication supabase_realtime add table public.lead_activity';
  end if;
end $$;

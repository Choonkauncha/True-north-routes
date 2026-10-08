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

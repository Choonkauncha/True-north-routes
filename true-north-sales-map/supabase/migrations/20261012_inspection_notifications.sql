-- Inspection notifications for setter-booked appointments.
-- Run this whole file in the Supabase SQL Editor. It is safe to run more than once.
-- When a setter saves a Scheduled or Confirmed inspection, each active admin,
-- manager, and owner gets one unread row. The person who booked it is skipped.
-- A later time change makes that row unread again. Note-only edits do not.
begin;

create or replace function public.current_rep_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.reps
  where user_id = auth.uid() and active = true
  limit 1;
$$;

create table if not exists public.inspection_notifications (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  recipient_id uuid not null references public.reps(id) on delete cascade,
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.inspection_notifications add column if not exists title text;
alter table public.inspection_notifications add column if not exists body text;
alter table public.inspection_notifications add column if not exists read_at timestamptz;
alter table public.inspection_notifications add column if not exists created_at timestamptz not null default now();

create unique index if not exists inspection_notifications_appointment_recipient_key
  on public.inspection_notifications(appointment_id, recipient_id);
create index if not exists inspection_notifications_recipient_idx
  on public.inspection_notifications(recipient_id, created_at desc);

alter table public.inspection_notifications replica identity full;

create or replace function public.notify_inspection_booked()
returns trigger
language plpgsql
security definer
set search_path = public as $$
declare
  setter_name text;
  home_name text;
  home_address text;
  when_label text;
  notice_title text;
  notice_body text;
  material boolean := false;
begin
  if new.scheduled_at is null or new.canvasser_id is null then
    return new;
  end if;
  if new.stage not in ('Scheduled', 'Confirmed') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    material := true;
  else
    material := old.scheduled_at is distinct from new.scheduled_at
      or (old.stage is distinct from new.stage and old.stage not in ('Scheduled', 'Confirmed'));
  end if;
  if not material then
    return new;
  end if;

  select name into setter_name from public.reps where id = new.canvasser_id;
  select coalesce(nullif(btrim(name), ''), nullif(btrim(address), ''), 'Homeowner'),
         nullif(btrim(concat_ws(', ', nullif(btrim(address), ''), nullif(btrim(city), ''), nullif(btrim(state), ''), nullif(btrim(zip), ''))), '')
    into home_name, home_address
  from public.leads where id = new.lead_id;

  when_label := to_char(new.scheduled_at at time zone 'America/New_York', 'Dy, Mon FMDD, FMHH12:MI AM') || ' ET';
  notice_title := 'Inspection scheduled';
  notice_body := left(concat_ws(' · ',
    coalesce(nullif(btrim(setter_name), ''), 'A setter') || ' booked ' || coalesce(home_name, 'a homeowner'),
    home_address,
    when_label
  ), 500);

  insert into public.inspection_notifications (appointment_id, recipient_id, title, body, read_at, created_at)
  select new.id, r.id, notice_title, notice_body, null, now()
  from public.reps r
  where r.active = true
    and r.role in ('admin', 'manager', 'owner')
    and r.id is distinct from new.canvasser_id
  on conflict (appointment_id, recipient_id) do update
    set title = excluded.title,
        body = excluded.body,
        read_at = null,
        created_at = now();
  return new;
end $$;

drop trigger if exists inspection_notifications_on_appointment on public.appointments;
create trigger inspection_notifications_on_appointment
  after insert or update on public.appointments
  for each row execute function public.notify_inspection_booked();

create or replace function public.guard_inspection_notification_read()
returns trigger
language plpgsql
set search_path = public as $$
begin
  if current_user = 'authenticated' then
    if new.appointment_id is distinct from old.appointment_id
       or new.recipient_id is distinct from old.recipient_id
       or new.title is distinct from old.title
       or new.body is distinct from old.body
       or new.created_at is distinct from old.created_at then
      raise exception 'Only the read state of an inspection notification can change';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists inspection_notifications_guard_read on public.inspection_notifications;
create trigger inspection_notifications_guard_read
  before update on public.inspection_notifications
  for each row execute function public.guard_inspection_notification_read();

alter table public.inspection_notifications enable row level security;
revoke all on table public.inspection_notifications from anon;
grant select, update on public.inspection_notifications to authenticated;
grant execute on function public.current_rep_id() to authenticated;

drop policy if exists inspection_notifications_select on public.inspection_notifications;
create policy inspection_notifications_select on public.inspection_notifications
  for select to authenticated
  using (recipient_id = public.current_rep_id());

drop policy if exists inspection_notifications_update on public.inspection_notifications;
create policy inspection_notifications_update on public.inspection_notifications
  for update to authenticated
  using (recipient_id = public.current_rep_id())
  with check (recipient_id = public.current_rep_id());

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'inspection_notifications'
     ) then
    execute 'alter publication supabase_realtime add table public.inspection_notifications';
  end if;
end $$;

commit;

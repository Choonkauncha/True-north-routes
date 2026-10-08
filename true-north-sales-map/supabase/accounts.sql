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

-- Forced password change, and admin accounts that only that admin can open.
-- Idempotent. Apply in the Supabase SQL editor. Do not apply from the app deploy.
-- Safe to run again.
--
-- must_change_password is set when an admin creates a login or resets a password.
-- A signed-in user cannot clear it by editing public.reps. clear_must_change_password()
-- clears it only after auth.users.encrypted_password actually changed later than the flag.
-- Backfill flags truenorthrestorationss@gmail.com (Spencer) only.
-- Do not flag travisbishopmackie@gmail.com.

alter table public.reps add column if not exists must_change_password boolean not null default false;
alter table public.reps add column if not exists must_change_set_at timestamptz;
alter table public.reps add column if not exists password_changed_at timestamptz;

-- Contact fields and the flag are not readable or writable through the Data API.
-- account_directory() returns contact fields, with other admins masked.
revoke select, insert, update, delete on table public.reps from authenticated;
grant select (id, user_id, name, role, active, created_at) on table public.reps to authenticated;
grant insert (id, user_id, name, email, phone, role, active) on table public.reps to authenticated;
grant update (name, email, phone, role, active) on table public.reps to authenticated;
grant delete on table public.reps to authenticated;

create table if not exists public.impersonation_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.impersonation_sessions (
  session_id uuid primary key,
  user_id uuid not null,
  created_at timestamptz not null default now()
);

alter table public.impersonation_grants enable row level security;
alter table public.impersonation_sessions enable row level security;
revoke all on table public.impersonation_grants from anon, authenticated;
revoke all on table public.impersonation_sessions from anon, authenticated;
grant all on table public.impersonation_grants to service_role;
grant all on table public.impersonation_sessions to service_role;

-- Other admins stay visible by name and role so messages, assignments, and handoffs still resolve.
-- Email, phone, and the password flag do not leave the database for a different admin.

create or replace function public.account_directory()
returns table (
  id uuid,
  user_id uuid,
  name text,
  email text,
  phone text,
  role text,
  active boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id,
    r.user_id,
    r.name,
    case when r.role = 'admin' and r.user_id is distinct from auth.uid() then null else r.email end,
    case when r.role = 'admin' and r.user_id is distinct from auth.uid() then null else r.phone end,
    r.role,
    r.active
  from public.reps r
  where auth.uid() is not null
    and public.is_admin_or_manager();
$$;

revoke all on function public.account_directory() from public, anon;
grant execute on function public.account_directory() to authenticated;

create or replace function public.hides_admin_audit(target uuid, em text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.reps r
    where r.role = 'admin'
      and r.user_id is distinct from auth.uid()
      and (
        (target is not null and r.id = target)
        or (em is not null and em <> '' and lower(r.email) = lower(em))
      )
  );
$$;

revoke all on function public.hides_admin_audit(uuid, text) from public, anon;
grant execute on function public.hides_admin_audit(uuid, text) to authenticated;

drop policy if exists account_audit_select on public.account_audit;
create policy account_audit_select on public.account_audit
  for select to authenticated
  using (
    public.is_admin_or_manager()
    and not public.hides_admin_audit(target_rep_id, target_email)
  );

create or replace function public.guard_must_change_password()
returns trigger
language plpgsql
as $$
declare
  privileged boolean := current_user in ('postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role')
    or coalesce(auth.role(), '') = 'service_role';
  clearing boolean := current_setting('tn.clear_must_change', true) = '1';
  noting boolean := current_setting('tn.password_change_note', true) = '1';
begin
  if tg_op = 'INSERT' then
    if not privileged then
      new.must_change_password := false;
      new.must_change_set_at := null;
      new.password_changed_at := null;
    elsif new.must_change_password and new.must_change_set_at is null then
      new.must_change_set_at := clock_timestamp();
    end if;
    return new;
  end if;

  if noting then
    new.password_changed_at := clock_timestamp();
    new.must_change_password := old.must_change_password;
    new.must_change_set_at := old.must_change_set_at;
    return new;
  end if;

  if clearing then
    if auth.uid() is distinct from old.user_id then
      raise exception 'Change your password before continuing';
    end if;
    new.must_change_password := false;
    return new;
  end if;

  if not privileged then
    new.must_change_password := old.must_change_password;
    new.must_change_set_at := old.must_change_set_at;
    new.password_changed_at := old.password_changed_at;
    return new;
  end if;

  if new.must_change_password and (
    old.must_change_password is distinct from true
    or new.must_change_set_at is distinct from old.must_change_set_at
  ) then
    new.must_change_set_at := clock_timestamp();
  end if;
  return new;
end;
$$;

drop trigger if exists reps_guard_must_change_password on public.reps;
create trigger reps_guard_must_change_password
  before insert or update on public.reps
  for each row execute function public.guard_must_change_password();

create or replace function public.note_auth_password_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.encrypted_password is distinct from old.encrypted_password then
    perform set_config('tn.password_change_note', '1', true);
    update public.reps
      set password_changed_at = clock_timestamp()
      where user_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.note_auth_password_change() from public, anon, authenticated;
grant execute on function public.note_auth_password_change() to supabase_auth_admin, service_role;

drop trigger if exists reps_note_password_change on auth.users;
create trigger reps_note_password_change
  after update of encrypted_password on auth.users
  for each row execute function public.note_auth_password_change();

create or replace function public.clear_must_change_password()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.reps%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Change your password before continuing';
  end if;
  select * into row from public.reps
    where user_id = auth.uid() and active = true
    limit 1;
  if row.id is null or not row.must_change_password then
    return;
  end if;
  if row.password_changed_at is null
    or row.must_change_set_at is null
    or row.password_changed_at <= row.must_change_set_at then
    raise exception 'Change your password before continuing';
  end if;
  perform set_config('tn.clear_must_change', '1', true);
  update public.reps
    set must_change_password = false
    where id = row.id and user_id = auth.uid();
end;
$$;

revoke all on function public.clear_must_change_password() from public, anon;
grant execute on function public.clear_must_change_password() to authenticated;

create or replace function public.password_gate_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  flagged boolean := false;
  sid uuid;
  impersonating boolean := false;
begin
  if auth.uid() is null then
    return jsonb_build_object('must_change', false, 'impersonating', false);
  end if;
  select must_change_password into flagged
  from public.reps
  where user_id = auth.uid() and active = true
  limit 1;
  begin
    sid := nullif(auth.jwt()->>'session_id', '')::uuid;
  exception when others then
    sid := null;
  end;
  if sid is not null then
    select exists (
      select 1 from public.impersonation_sessions
      where session_id = sid and user_id = auth.uid()
    ) into impersonating;
  end if;
  return jsonb_build_object(
    'must_change', coalesce(flagged, false),
    'impersonating', coalesce(impersonating, false)
  );
end;
$$;

revoke all on function public.password_gate_status() from public, anon;
grant execute on function public.password_gate_status() to authenticated;

create or replace function public.claim_impersonation(grant_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  grant_row public.impersonation_grants%rowtype;
  sid uuid;
begin
  if auth.uid() is null or grant_id is null then
    return false;
  end if;
  begin
    sid := nullif(auth.jwt()->>'session_id', '')::uuid;
  exception when others then
    return false;
  end;
  if sid is null then
    return false;
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) item
    where lower(coalesce(item->>'method', '')) = 'password'
  ) then
    return false;
  end if;
  if not exists (
    select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) item
    where lower(coalesce(item->>'method', '')) in ('otp', 'magiclink')
  ) then
    return false;
  end if;
  if exists (
    select 1 from public.impersonation_sessions
    where session_id = sid and user_id = auth.uid()
  ) then
    return true;
  end if;
  select * into grant_row
  from public.impersonation_grants
  where id = grant_id
    and user_id = auth.uid()
    and used_at is null
    and expires_at > now()
  for update;
  if grant_row.id is null then
    return false;
  end if;
  update public.impersonation_grants set used_at = now() where id = grant_row.id;
  insert into public.impersonation_sessions (session_id, user_id)
  values (sid, auth.uid())
  on conflict (session_id) do nothing;
  return true;
end;
$$;

revoke all on function public.claim_impersonation(uuid) from public, anon;
grant execute on function public.claim_impersonation(uuid) to authenticated;

-- An admin row can be changed only by that same admin (or the service role, which the
-- accounts API checks before it writes). Nobody can promote their own row to admin.
create or replace function public.guard_rep_role()
returns trigger
language plpgsql
as $$
declare
  actor text;
  privileged boolean := current_user in ('postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role')
    or coalesce(auth.role(), '') = 'service_role';
begin
  if tg_op = 'DELETE' then
    if old.role = 'admin' and old.user_id is distinct from auth.uid() and not privileged then
      raise exception 'Only that admin can change this account';
    end if;
  elsif tg_op = 'UPDATE' then
    if old.role = 'admin' and old.user_id is distinct from auth.uid() and not privileged then
      raise exception 'Only that admin can change this account';
    end if;
    if new.role is distinct from old.role and old.role = 'admin' and old.user_id is distinct from auth.uid() then
      raise exception 'Only that admin can change this account';
    end if;
    if new.role = 'admin' and old.role is distinct from 'admin'
      and (old.user_id is not distinct from auth.uid() or new.user_id is not distinct from auth.uid())
      and not privileged then
      raise exception 'You cannot promote yourself to admin';
    end if;
  elsif tg_op = 'INSERT' and new.role = 'admin' and new.user_id is not distinct from auth.uid() and not privileged then
    if not exists (
      select 1 from public.reps where user_id = auth.uid() and role = 'admin'
    ) then
      raise exception 'You cannot promote yourself to admin';
    end if;
  end if;

  if privileged then
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

-- Password flags are managed through the accounts API; setup reruns never reflag recovered users.

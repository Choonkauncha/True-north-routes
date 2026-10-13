-- Apply once before deploying the account deletion update. Transactional, retry-safe.
begin;
-- Does not depend on session_ready(), which older installations lack.
create or replace function public.can_read_account_archive()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.reps r
    where r.user_id=auth.uid() and r.active=true and r.role='admin'
      and not coalesce((to_jsonb(r)->>'must_change_password')::boolean,false));
$$;
revoke all on function public.can_read_account_archive() from public,anon;
grant execute on function public.can_read_account_archive() to authenticated;
create table if not exists public.account_archive (
  id uuid primary key, name text not null, email text, role text not null,
  deleted_at timestamptz not null default now(), deleted_by uuid,
  profile jsonb not null
);
alter table public.account_archive enable row level security;
revoke all on public.account_archive from public, anon, authenticated;
grant select on public.account_archive to authenticated;
grant all on public.account_archive to service_role;
drop policy if exists archive_admin_read on public.account_archive;
create policy archive_admin_read on public.account_archive for select to authenticated
  using (public.can_read_account_archive());
-- Prevent direct browser deletion from skipping archive/Auth cleanup.
revoke delete on public.reps from authenticated;

create or replace function public.delete_account_to_archive(p_actor_id uuid, p_target_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare actor public.reps%rowtype; target public.reps%rowtype;
  fk record; related jsonb := '{}'::jsonb; rows_json jsonb;
begin
  select * into actor from public.reps where id=p_actor_id for update;
  if actor.id is null or actor.active is distinct from true or actor.role is distinct from 'admin' then
    raise exception 'Only an active admin can delete profiles';
  end if;
  select * into target from public.reps where id=p_target_id for update;
  if target.id is null then
    if exists(select 1 from public.account_archive where id=p_target_id) then
      return jsonb_build_object('ok',true,'already_deleted',true);
    end if;
    raise exception 'That person was not found';
  end if;
  if target.role='admin' or target.id=actor.id or target.user_id=actor.user_id then
    raise exception 'Admin profiles cannot be deleted';
  end if;
  -- Preserve account-owned history that existing cascade FKs would remove.
  for fk in
    select c.conrelid::regclass as child_table, a.attname as child_column
    from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    where c.contype='f' and c.confrelid='public.reps'::regclass and c.confdeltype='c'
  loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from %s t where %I=$1', fk.child_table, fk.child_column)
      into rows_json using target.id;
    related := related || jsonb_build_object(fk.child_table::text || '.' || fk.child_column, rows_json);
  end loop;
  -- Auth deletion and FK cleanup either commit together or roll back together.
  insert into public.account_archive(id,name,email,role,deleted_by,profile)
    values(target.id,target.name,target.email,target.role,actor.id,to_jsonb(target) || jsonb_build_object('archived_history',related));
  insert into public.account_audit(actor_rep_id,target_rep_id,action,target_email,metadata)
    values(actor.id,target.id,'user_deleted',target.email,jsonb_build_object('role',target.role,'archive_id',target.id));
  if to_regclass('public.impersonation_grants') is not null then
    execute 'delete from public.impersonation_grants where user_id=$1' using target.user_id;
  end if;
  if to_regclass('public.impersonation_sessions') is not null then
    execute 'delete from public.impersonation_sessions where user_id=$1' using target.user_id;
  end if;
  delete from auth.users where id=target.user_id;
  -- Also removes orphan profiles without an Auth login. Existing FK rules preserve company records.
  delete from public.reps where id=target.id;
  return jsonb_build_object('ok',true,'archive_id',target.id);
end;
$$;
revoke all on function public.delete_account_to_archive(uuid,uuid) from public,anon,authenticated;
grant execute on function public.delete_account_to_archive(uuid,uuid) to service_role;
alter table public.account_audit drop constraint if exists account_audit_action_check;
alter table public.account_audit add constraint account_audit_action_check check
 (action in ('user_created','password_reset','user_deactivated','user_reactivated','open_as','user_deleted'));
commit;

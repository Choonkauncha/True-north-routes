-- Let admins (only) delete appointments from the Management > Appointments tab.
-- Not applied automatically: run once in the Supabase SQL editor or via migrations.
begin;

create or replace function public.is_active_admin() returns boolean
language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.reps where user_id = auth.uid() and active and role = 'admin'
  );
$$;
revoke all on function public.is_active_admin() from public;
grant execute on function public.is_active_admin() to authenticated;

grant delete on public.appointments to authenticated;

drop policy if exists appointments_delete on public.appointments;
create policy appointments_delete on public.appointments
  for delete to authenticated
  using (public.is_active_admin());

-- Rows that point at an appointment must not block the delete.
-- document_categories / lead_photos already use ON DELETE SET NULL.
-- inspection_notifications (PR #39) is created with ON DELETE CASCADE; enforce it if the table exists.
do $$
declare c record;
begin
  for c in
    select con.conname, rel.relname, att.attname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace and ns.nspname = 'public'
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
    where con.contype = 'f'
      and con.confrelid = 'public.appointments'::regclass
      and con.confdeltype in ('a', 'r')   -- NO ACTION / RESTRICT
      and array_length(con.conkey, 1) = 1
  loop
    execute format('alter table public.%I drop constraint %I', c.relname, c.conname);
    if c.relname = 'inspection_notifications' then
      execute format('alter table public.%I add constraint %I foreign key (%I) references public.appointments(id) on delete cascade', c.relname, c.conname, c.attname);
    else
      execute format('alter table public.%I add constraint %I foreign key (%I) references public.appointments(id) on delete set null', c.relname, c.conname, c.attname);
    end if;
  end loop;
end $$;

commit;

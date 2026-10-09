-- Apply after setup_all.sql. Existing role restrictions remain in place.
begin;
create table if not exists public.feature_permissions (
  role text not null check(role in ('appointment_setter','salesperson')),
  feature text not null check(feature in ('map','routes','weather','intake','forms','photos','training','coach','shifts','messages','account')),
  enabled boolean not null default true,
  primary key(role,feature)
);
alter table public.feature_permissions enable row level security;
grant select on public.feature_permissions to authenticated;
grant insert,update,delete on public.feature_permissions to authenticated;
create or replace function public.feature_enabled(requested text) returns boolean
language sql stable security definer set search_path=public as $$
  select coalesce((select case
    when r.role in ('admin','manager') then true
    else coalesce((select p.enabled from public.feature_permissions p
      where p.role=case when r.role='canvasser' then 'appointment_setter' else r.role end and p.feature=requested),
      requested<>'photos' or r.role='salesperson') end
    from public.reps r where r.user_id=auth.uid() and r.active=true limit 1),false)
    and requested in ('map','routes','weather','intake','forms','photos','training','coach','shifts','messages','account');
$$;
revoke all on function public.feature_enabled(text) from public;
grant execute on function public.feature_enabled(text) to authenticated;
drop policy if exists feature_permissions_read on public.feature_permissions;
create policy feature_permissions_read on public.feature_permissions for select to authenticated using(public.is_active_rep());
drop policy if exists feature_permissions_admin on public.feature_permissions;
create policy feature_permissions_admin on public.feature_permissions for all to authenticated
 using(exists(select 1 from public.reps where user_id=auth.uid() and active=true and role='admin'))
 with check(exists(select 1 from public.reps where user_id=auth.uid() and active=true and role='admin'));
insert into public.feature_permissions(role,feature,enabled)
select role,feature,feature<>'photos' or role='salesperson'
from unnest(array['appointment_setter','salesperson']) role
cross join unnest(array['map','routes','weather','intake','forms','photos','training','coach','shifts','messages','account']) feature
on conflict do nothing;
-- RESTRICTIVE policies intersect the existing ownership/audience policies.
do $$ declare row record; begin
  for row in select * from (values
    ('lead_photos','photos'),('form_templates','forms'),('form_submissions','forms'),
    ('form_assignments','forms'),('receipt_records','forms'),('estimate_records','forms'),
    ('training_items','training'),('training_assignments','training'),('training_progress','training'),
    ('training_reminders','training'),('training_practice_attempts','training'),
    ('shifts','shifts'),('location_points','shifts'),('location_consents','shifts'),
    ('messages','messages'),('message_threads','messages'),('appointments','intake'),
    ('homeowner_intakes','intake')) as features(table_name,feature)
  loop
    if to_regclass('public.'||row.table_name) is not null then
      execute format('drop policy if exists feature_gate on public.%I',row.table_name);
      execute format('create policy feature_gate on public.%I as restrictive for all to authenticated using(public.feature_enabled(%L)) with check(public.feature_enabled(%L))',row.table_name,row.feature,row.feature);
    end if;
  end loop;
end $$;
drop policy if exists feature_storage_gate on storage.objects;
create policy feature_storage_gate on storage.objects as restrictive for all to authenticated
using(case bucket_id when 'lead-photos' then public.feature_enabled('photos') when 'form-assets' then public.feature_enabled('forms') when 'training' then public.feature_enabled('training') else true end)
with check(case bucket_id when 'lead-photos' then public.feature_enabled('photos') when 'form-assets' then public.feature_enabled('forms') when 'training' then public.feature_enabled('training') else true end);
-- Subscribe to role updates when this installation uses Supabase Realtime.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='feature_permissions') then
   alter publication supabase_realtime add table public.feature_permissions;
 end if;
end $$;
commit;

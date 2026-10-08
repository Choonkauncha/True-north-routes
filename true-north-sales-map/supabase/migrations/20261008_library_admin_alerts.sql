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

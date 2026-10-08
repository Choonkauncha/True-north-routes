-- Unified inspection handoffs.
-- Idempotent. Apply after 20261008_must_change_password.sql.
-- Do not remove `canvasser` from public.reps.role.
-- Does not change already-applied migrations.
-- Appointment setters can view handoffs only.
-- An assigned sales rep can add notes, photos, and mark the inspection completed.
-- Management can assign the sales rep, add notes and photos, mark complete, and reopen.
-- Completing an inspection sets appointments.stage to Completed. The existing
-- sync_inspection_folder trigger then creates the permanent document-library folder.
-- Sales reps can upload receipts into receipt_records and form-assets receipts/{rep_id}/.
-- They can read only their own receipts. They cannot browse document_categories.
-- Appointment setters cannot upload receipts. Estimates stay management-only.
-- Delete stays management-only.

alter table public.lead_photos add column if not exists appointment_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'lead_photos_appointment_id_fkey'
  ) then
    alter table public.lead_photos
      add constraint lead_photos_appointment_id_fkey
      foreign key (appointment_id) references public.appointments(id) on delete set null;
  end if;
end $$;

create index if not exists lead_photos_appointment_idx on public.lead_photos (appointment_id);

create or replace function public.can_add_handoff_photo(p_appointment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_appointment_id is null then false
    when public.current_rep_role() in ('admin', 'manager') then true
    when public.current_rep_role() = 'salesperson' and exists (
      select 1 from public.appointments a
      where a.id = p_appointment_id
        and a.salesperson_id = public.current_rep_id()
        and a.stage is distinct from 'Cancelled'
    ) then true
    else false
  end
$$;

grant execute on function public.can_add_handoff_photo(uuid) to authenticated;

drop policy if exists lead_photos_insert on public.lead_photos;
create policy lead_photos_insert on public.lead_photos
  for insert to authenticated
  with check (
    uploaded_by = public.current_rep_id()
    and (
      (
        appointment_id is null
        and public.can_use_photo_bank()
        and public.can_access_lead_files(lead_id)
      )
      or (
        appointment_id is not null
        and public.can_add_handoff_photo(appointment_id)
        and lead_id = (select a.lead_id from public.appointments a where a.id = appointment_id)
      )
    )
  );

create or replace function public.guard_handoff_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid;
  role text;
  admin boolean;
  assigned boolean;
begin
  if auth.uid() is null then
    return new;
  end if;
  select r.id, r.role into actor, role
  from public.reps r
  where r.user_id = auth.uid() and r.active = true
  limit 1;
  admin := role in ('admin', 'manager');
  assigned := role = 'salesperson' and old.salesperson_id is not null and old.salesperson_id = actor;

  if new.lead_id is distinct from old.lead_id
     or new.canvasser_id is distinct from old.canvasser_id
     or new.id is distinct from old.id then
    raise exception 'This handoff cannot be reassigned that way.';
  end if;

  if role in ('appointment_setter', 'canvasser') and (
    new.salesperson_id is distinct from old.salesperson_id
    or new.notes is distinct from old.notes
    or new.stage is distinct from old.stage
    or new.scheduled_at is distinct from old.scheduled_at
  ) then
    raise exception 'Appointment setters can view handoffs only.';
  end if;

  if role is null or role not in ('admin', 'manager', 'salesperson', 'appointment_setter', 'canvasser') then
    if new.salesperson_id is distinct from old.salesperson_id
       or new.notes is distinct from old.notes
       or new.stage is distinct from old.stage
       or new.scheduled_at is distinct from old.scheduled_at then
      raise exception 'You can view this handoff only.';
    end if;
  end if;

  if new.salesperson_id is distinct from old.salesperson_id and not admin then
    raise exception 'Only management can assign the sales rep.';
  end if;

  if new.scheduled_at is distinct from old.scheduled_at and not admin then
    raise exception 'Only management can change the inspection time.';
  end if;

  if new.notes is distinct from old.notes and not (admin or assigned) then
    raise exception 'You can view this handoff, not edit the notes.';
  end if;

  if new.stage is distinct from old.stage then
    if admin then
      null;
    elsif assigned and new.stage = 'Completed' and old.stage is distinct from 'Completed' and old.stage is distinct from 'Cancelled' then
      null;
    elsif old.stage = 'Completed' and new.stage is distinct from 'Completed' then
      raise exception 'Only management can reopen an inspection.';
    elsif new.stage = 'Completed' then
      raise exception 'You cannot mark this inspection completed.';
    else
      raise exception 'You cannot change this inspection stage.';
    end if;
  end if;

  if new.stage is distinct from old.stage and new.stage = 'Completed' then
    insert into public.lead_activity (lead_id, actor_id, action, metadata)
    values (new.lead_id, actor, 'inspection_completed', jsonb_build_object('appointment_id', new.id, 'stage', new.stage));
  elsif old.stage = 'Completed' and new.stage is distinct from 'Completed' then
    insert into public.lead_activity (lead_id, actor_id, action, metadata)
    values (new.lead_id, actor, 'inspection_reopened', jsonb_build_object('appointment_id', new.id, 'stage', new.stage));
  end if;

  if new.salesperson_id is distinct from old.salesperson_id then
    insert into public.lead_activity (lead_id, actor_id, action, metadata)
    values (new.lead_id, actor, 'handoff_assigned', jsonb_build_object('appointment_id', new.id, 'salesperson_id', new.salesperson_id));
  end if;

  if new.notes is distinct from old.notes then
    insert into public.lead_activity (lead_id, actor_id, action, metadata)
    values (new.lead_id, actor, 'handoff_note', jsonb_build_object('appointment_id', new.id));
  end if;

  return new;
end
$$;

drop trigger if exists appointments_guard_handoff on public.appointments;
create trigger appointments_guard_handoff
  before update on public.appointments
  for each row execute function public.guard_handoff_update();

comment on function public.guard_handoff_update() is 'Setters view handoffs only. Assigned sales reps add notes and mark complete. Management assigns, completes, and reopens. Stage Completed still runs sync_inspection_folder.';

-- Receipts reuse receipt_records and the form-assets receipts/ prefix.
-- Management sees every row. A sales rep inserts and reads only their own.
-- A receipt with a lead_id must belong to an inspection assigned to that rep.
-- A receipt with no lead_id is a general upload. Setters cannot insert or select.

create or replace function public.can_upload_receipt(p_lead_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_rep_role() in ('admin', 'manager') then true
    when public.current_rep_role() = 'salesperson'
      and public.current_rep_id() is not null
      and (
        p_lead_id is null
        or exists (
          select 1 from public.appointments a
          where a.lead_id = p_lead_id
            and a.salesperson_id = public.current_rep_id()
            and a.stage is distinct from 'Cancelled'
        )
      ) then true
    else false
  end
$$;

grant execute on function public.can_upload_receipt(text) to authenticated;

drop policy if exists receipt_records_select on public.receipt_records;
create policy receipt_records_select on public.receipt_records
  for select to authenticated
  using (
    public.is_admin_or_manager()
    or (
      public.current_rep_role() = 'salesperson'
      and uploaded_by = public.current_rep_id()
    )
  );

drop policy if exists receipt_records_insert on public.receipt_records;
create policy receipt_records_insert on public.receipt_records
  for insert to authenticated
  with check (
    uploaded_by = public.current_rep_id()
    and public.current_rep_id() is not null
    and storage_path like 'receipts/' || public.current_rep_id()::text || '/%'
    and public.can_upload_receipt(lead_id)
  );

drop policy if exists receipt_records_delete on public.receipt_records;
create policy receipt_records_delete on public.receipt_records
  for delete to authenticated
  using (public.is_admin_or_manager());

-- Keep estimates and library prefixes management-only.
-- Let a sales rep read and upload only receipts/{their rep id}/.
drop policy if exists form_assets_storage_read on storage.objects;
create policy form_assets_storage_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'form-assets'
    and (
      public.is_admin_or_manager()
      or (
        public.current_rep_role() = 'salesperson'
        and split_part(name, '/', 1) = 'receipts'
        and split_part(name, '/', 2) = public.current_rep_id()::text
      )
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
        public.current_rep_role() = 'salesperson'
        and split_part(name, '/', 1) = 'receipts'
        and split_part(name, '/', 2) = public.current_rep_id()::text
      )
      or (
        split_part(name, '/', 2) = public.current_rep_id()::text
        and split_part(name, '/', 1) not in ('receipts', 'estimates', 'library')
      )
      or (
        public.is_admin_or_manager()
        and split_part(name, '/', 1) in ('library', 'receipts', 'estimates')
      )
    )
  );

comment on table public.receipt_records is 'Receipt uploads. Management sees every row. A sales rep can insert and read only their own. Setters cannot. A lead_id links the receipt to that inspection folder.';

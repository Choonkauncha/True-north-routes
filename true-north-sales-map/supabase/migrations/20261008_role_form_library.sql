-- Form library assignments, uploaded forms, and editable photo notes.
-- Idempotent. Apply in the Supabase SQL editor after forms_photos.sql.
-- Do not remove `canvasser` from public.reps.role. Existing rows stay valid
-- and the app treats them as appointment setters. New logins are not offered that role.

alter table public.form_templates add column if not exists kind text;
alter table public.form_templates add column if not exists storage_path text;
alter table public.form_templates add column if not exists mime_type text;
alter table public.form_templates add column if not exists file_name text;

update public.form_templates set kind = 'builder' where kind is null or btrim(kind) = '';
alter table public.form_templates alter column kind set default 'builder';
alter table public.form_templates alter column kind set not null;

alter table public.form_templates drop constraint if exists form_templates_kind_check;
alter table public.form_templates
  add constraint form_templates_kind_check check (kind in ('builder', 'file'));

alter table public.form_templates drop constraint if exists form_templates_audience_check;
alter table public.form_templates
  add constraint form_templates_audience_check
  check (audience in ('setter', 'rep', 'both', 'people'));

alter table public.form_submissions add column if not exists attachment_path text;
alter table public.form_submissions add column if not exists attachment_name text;

create table if not exists public.form_assignments (
  template_id uuid not null references public.form_templates(id) on delete cascade,
  rep_id uuid not null references public.reps(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (template_id, rep_id)
);

create index if not exists form_assignments_rep_idx on public.form_assignments (rep_id);

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

create or replace function public.can_read_form_library(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.form_templates t
    where t.storage_path = p_name
      and public.can_fill_template(t.id)
  )
$$;

grant execute on function public.can_fill_template(uuid) to authenticated;
grant execute on function public.can_read_form_library(text) to authenticated;

alter table public.form_assignments enable row level security;
revoke all on table public.form_assignments from anon, public;
grant select, insert, update, delete on public.form_assignments to authenticated;

drop policy if exists form_assignments_select on public.form_assignments;
create policy form_assignments_select on public.form_assignments
  for select to authenticated
  using (
    public.is_admin_or_manager()
    or rep_id = public.current_rep_id()
  );

drop policy if exists form_assignments_write on public.form_assignments;
create policy form_assignments_write on public.form_assignments
  for all to authenticated
  using (public.is_admin_or_manager())
  with check (public.is_admin_or_manager());

drop policy if exists form_templates_select on public.form_templates;
create policy form_templates_select on public.form_templates
  for select to authenticated
  using (public.can_fill_template(id));

drop policy if exists form_submissions_insert on public.form_submissions;
create policy form_submissions_insert on public.form_submissions
  for insert to authenticated
  with check (
    submitted_by = public.current_rep_id()
    and public.can_fill_template(template_id)
  );

grant update (caption) on public.lead_photos to authenticated;

drop policy if exists lead_photos_update_caption on public.lead_photos;
create policy lead_photos_update_caption on public.lead_photos
  for update to authenticated
  using (
    public.can_use_photo_bank()
    and (uploaded_by = public.current_rep_id() or public.is_admin_or_manager())
  )
  with check (
    public.can_use_photo_bank()
    and (uploaded_by = public.current_rep_id() or public.is_admin_or_manager())
  );

update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[],
    file_size_limit = 15728640
where id = 'form-assets';

drop policy if exists form_assets_storage_read on storage.objects;
create policy form_assets_storage_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'form-assets'
    and (
      public.is_admin_or_manager()
      or split_part(name, '/', 2) = public.current_rep_id()::text
      or (
        public.current_rep_role() = 'salesperson'
        and public.can_access_lead_files(split_part(name, '/', 1))
      )
      or (
        split_part(name, '/', 1) = 'library'
        and public.can_read_form_library(name)
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
      split_part(name, '/', 2) = public.current_rep_id()::text
      or (
        public.is_admin_or_manager()
        and split_part(name, '/', 1) = 'library'
      )
    )
  );

comment on table public.form_assignments is 'Extra people who can open a form, including a setter assigned a rep form.';
comment on column public.lead_photos.caption is 'Free-text note the rep can add or edit on this photo.';

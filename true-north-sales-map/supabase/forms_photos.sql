-- True North photo bank + forms
-- Run in the Supabase SQL Editor AFTER supabase/schema.sql.
-- Creates private storage buckets, tables, row-level security, and two draft agreement templates.
-- Draft templates are placeholders. Replace the wording with True North's own agreements before use.

create extension if not exists pgcrypto;

alter table public.leads add column if not exists created_by uuid references public.reps(id) on delete set null;

create table if not exists public.lead_photos (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null references public.leads(id) on delete cascade,
  uploaded_by uuid references public.reps(id) on delete set null,
  storage_path text not null,
  address_snapshot text,
  caption text,
  created_at timestamptz not null default now()
);

create table if not exists public.form_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  audience text not null check (audience in ('setter', 'rep', 'both')),
  fields jsonb not null default '[]'::jsonb,
  is_draft boolean not null default true,
  draft_notice text,
  active boolean not null default true,
  created_by uuid references public.reps(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references public.form_templates(id) on delete set null,
  template_name text not null,
  lead_id text references public.leads(id) on delete set null,
  submitted_by uuid references public.reps(id) on delete set null,
  address_snapshot text,
  homeowner_name text,
  fields jsonb not null default '[]'::jsonb,
  answers jsonb not null default '{}'::jsonb,
  is_draft boolean not null default false,
  draft_notice text,
  created_at timestamptz not null default now()
);

create index if not exists lead_photos_lead_idx on public.lead_photos(lead_id, created_at desc);
create index if not exists lead_photos_rep_idx on public.lead_photos(uploaded_by, created_at desc);
create index if not exists form_templates_audience_idx on public.form_templates(audience, active);
create index if not exists form_submissions_lead_idx on public.form_submissions(lead_id, created_at desc);
create index if not exists form_submissions_rep_idx on public.form_submissions(submitted_by, created_at desc);
create index if not exists form_submissions_template_idx on public.form_submissions(template_id, created_at desc);

create or replace function public.current_rep_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.reps where user_id = auth.uid() and active = true limit 1
$$;

create or replace function public.current_rep_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.reps where user_id = auth.uid() and active = true limit 1
$$;

create or replace function public.can_use_photo_bank()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_rep_role() in ('admin', 'manager', 'salesperson')
$$;

-- Sales reps: photos on leads they created or are assigned (lead, appointment, or intake).
-- Canvassers and appointment setters: no photo access. Admin and manager: every lead.
create or replace function public.can_access_lead_files(p_lead_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_lead_id is null or btrim(p_lead_id) = '' then false
    when public.current_rep_role() in ('admin', 'manager') then true
    when public.current_rep_role() = 'salesperson' then
      exists (
        select 1 from public.leads l
        where l.id = p_lead_id
          and (l.assigned_rep_id = public.current_rep_id() or l.created_by = public.current_rep_id())
      )
      or exists (
        select 1 from public.appointments a
        where a.lead_id = p_lead_id and a.salesperson_id = public.current_rep_id()
      )
      or exists (
        select 1 from public.homeowner_intakes h
        where h.lead_id = p_lead_id
          and (h.assigned_salesperson_id = public.current_rep_id() or h.created_by = public.current_rep_id())
      )
      or exists (
        select 1 from public.lead_photos p
        where p.lead_id = p_lead_id and p.uploaded_by = public.current_rep_id()
      )
    else false
  end
$$;

grant execute on function public.current_rep_id() to authenticated;
grant execute on function public.current_rep_role() to authenticated;
grant execute on function public.can_use_photo_bank() to authenticated;
grant execute on function public.can_access_lead_files(text) to authenticated;

alter table public.lead_photos enable row level security;
alter table public.form_templates enable row level security;
alter table public.form_submissions enable row level security;

revoke all on table public.lead_photos, public.form_templates, public.form_submissions from anon;
grant select, insert, delete on public.lead_photos to authenticated;
grant select, insert, update on public.form_templates to authenticated;
grant select, insert, delete on public.form_submissions to authenticated;

drop policy if exists lead_photos_select on public.lead_photos;
create policy lead_photos_select on public.lead_photos
  for select to authenticated
  using (public.can_use_photo_bank() and public.can_access_lead_files(lead_id));

drop policy if exists lead_photos_insert on public.lead_photos;
create policy lead_photos_insert on public.lead_photos
  for insert to authenticated
  with check (
    public.can_use_photo_bank()
    and uploaded_by = public.current_rep_id()
    and public.can_access_lead_files(lead_id)
  );

drop policy if exists lead_photos_delete on public.lead_photos;
create policy lead_photos_delete on public.lead_photos
  for delete to authenticated
  using (public.is_admin_or_manager());

drop policy if exists form_templates_select on public.form_templates;
create policy form_templates_select on public.form_templates
  for select to authenticated
  using (
    public.current_rep_role() in ('admin', 'manager')
    or (
      active = true and public.current_rep_role() in ('canvasser', 'appointment_setter')
      and audience in ('setter', 'both')
    )
    or (
      active = true and public.current_rep_role() = 'salesperson'
      and audience in ('rep', 'both')
    )
  );

drop policy if exists form_templates_write on public.form_templates;
create policy form_templates_write on public.form_templates
  for all to authenticated
  using (public.is_admin_or_manager())
  with check (public.is_admin_or_manager());

drop policy if exists form_submissions_select on public.form_submissions;
create policy form_submissions_select on public.form_submissions
  for select to authenticated
  using (
    public.current_rep_role() in ('admin', 'manager')
    or submitted_by = public.current_rep_id()
    or (
      public.current_rep_role() = 'salesperson'
      and lead_id is not null
      and public.can_access_lead_files(lead_id)
    )
  );

drop policy if exists form_submissions_insert on public.form_submissions;
create policy form_submissions_insert on public.form_submissions
  for insert to authenticated
  with check (
    submitted_by = public.current_rep_id()
    and exists (
      select 1 from public.form_templates t
      where t.id = template_id
        and t.active = true
        and (
          public.current_rep_role() in ('admin', 'manager')
          or (public.current_rep_role() in ('canvasser', 'appointment_setter') and t.audience in ('setter', 'both'))
          or (public.current_rep_role() = 'salesperson' and t.audience in ('rep', 'both'))
        )
    )
  );

drop policy if exists form_submissions_delete on public.form_submissions;
create policy form_submissions_delete on public.form_submissions
  for delete to authenticated
  using (public.is_admin_or_manager());

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

drop trigger if exists form_templates_touch_updated_at on public.form_templates;
create trigger form_templates_touch_updated_at
  before update on public.form_templates
  for each row execute function public.touch_updated_at();

-- Private buckets. The browser uses signed URLs. Objects are not public.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('lead-photos', 'lead-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']::text[]),
  ('form-assets', 'form-assets', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']::text[])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- lead-photos path: {lead_id}/{uuid}.jpg
drop policy if exists lead_photos_storage_read on storage.objects;
create policy lead_photos_storage_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'lead-photos'
    and public.can_access_lead_files(split_part(name, '/', 1))
  );

drop policy if exists lead_photos_storage_insert on storage.objects;
create policy lead_photos_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'lead-photos'
    and public.can_use_photo_bank()
    and public.can_access_lead_files(split_part(name, '/', 1))
  );

drop policy if exists lead_photos_storage_delete on storage.objects;
create policy lead_photos_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'lead-photos' and public.is_admin_or_manager());

-- form-assets path: {lead_id}/{rep_id}/{uuid}.jpg
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
    )
  );

drop policy if exists form_assets_storage_insert on storage.objects;
create policy form_assets_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'form-assets'
    and public.current_rep_id() is not null
    and split_part(name, '/', 2) = public.current_rep_id()::text
  );

drop policy if exists form_assets_storage_delete on storage.objects;
create policy form_assets_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'form-assets' and public.is_admin_or_manager());

-- Starter templates. Draft placeholders only. on conflict do nothing so an admin edit is kept.
insert into public.form_templates (id, name, description, audience, fields, is_draft, draft_notice, active)
values
(
  'a1111111-1111-4111-8111-111111111111',
  'Closing / Deal Agreement',
  'Placeholder. This is not True North’s agreement until the company replaces the wording.',
  'rep',
  $tnfields$[
    {"id":"homeowner_name","type":"text","label":"Homeowner name","required":true,"section":"Homeowner","prefill":"name","options":[]},
    {"id":"property_address","type":"text","label":"Property address","required":true,"section":"Homeowner","prefill":"address","options":[]},
    {"id":"insurance_carrier","type":"text","label":"Insurance carrier","required":false,"section":"Insurance","prefill":"none","options":[]},
    {"id":"claim_number","type":"text","label":"Claim number","required":false,"section":"Insurance","prefill":"none","options":[]},
    {"id":"scope","type":"textarea","label":"Scope of work","required":false,"section":"Scope of work","prefill":"none","help":"Describe the work in plain language. Replace this with True North’s own scope wording.","options":[]},
    {"id":"homeowner_signature","type":"signature","label":"Homeowner signature","required":true,"section":"Signatures","prefill":"none","options":[]},
    {"id":"rep_signature","type":"signature","label":"Rep signature","required":true,"section":"Signatures","prefill":"none","options":[]},
    {"id":"agreement_date","type":"date","label":"Date","required":true,"section":"Signatures","prefill":"date","options":[]}
  ]$tnfields$::jsonb,
  true,
  'Draft only. Replace this wording with True North’s own agreement before a homeowner signs.',
  true
),
(
  'a2222222-2222-4222-8222-222222222222',
  'Contingency Agreement',
  'Placeholder. This is not True North’s agreement until the company replaces the wording.',
  'rep',
  $tnfields$[
    {"id":"homeowner_name","type":"text","label":"Homeowner name","required":true,"section":"Homeowner","prefill":"name","options":[]},
    {"id":"property_address","type":"text","label":"Property address","required":true,"section":"Homeowner","prefill":"address","options":[]},
    {"id":"insurance_carrier","type":"text","label":"Insurance carrier","required":false,"section":"Insurance","prefill":"none","options":[]},
    {"id":"claim_number","type":"text","label":"Claim number","required":false,"section":"Insurance","prefill":"none","options":[]},
    {"id":"scope","type":"textarea","label":"Scope of work","required":false,"section":"Scope of work","prefill":"none","help":"Describe the work in plain language. Replace this with True North’s own scope wording.","options":[]},
    {"id":"homeowner_signature","type":"signature","label":"Homeowner signature","required":true,"section":"Signatures","prefill":"none","options":[]},
    {"id":"rep_signature","type":"signature","label":"Rep signature","required":true,"section":"Signatures","prefill":"none","options":[]},
    {"id":"agreement_date","type":"date","label":"Date","required":true,"section":"Signatures","prefill":"date","options":[]}
  ]$tnfields$::jsonb,
  true,
  'Draft only. Replace this wording with True North’s own agreement before a homeowner signs.',
  true
)
on conflict (id) do nothing;

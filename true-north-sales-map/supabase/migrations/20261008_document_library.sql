-- Document folders, premade files, receipts, and estimates.
-- Idempotent. Apply after 20261008_document_review.sql.
-- Do not remove `canvasser` from public.reps.role.
-- Does not change already-applied migrations. Reuses the private form-assets bucket.

create table if not exists public.document_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  sort_order integer not null default 0,
  system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_categories_name_len check (char_length(btrim(name)) between 1 and 60)
);

insert into public.document_categories (id, name, slug, sort_order, system)
values
  ('c1000000-0000-4000-8000-000000000001', 'Contingency', 'contingency', 10, false),
  ('c1000000-0000-4000-8000-000000000002', 'Agreements', 'agreements', 20, false),
  ('c1000000-0000-4000-8000-000000000003', 'Other', 'other', 30, false),
  ('c1000000-0000-4000-8000-000000000004', 'Uncategorized', 'uncategorized', 40, true)
on conflict (slug) do nothing;

alter table public.form_templates add column if not exists category_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'form_templates_category_id_fkey'
  ) then
    alter table public.form_templates
      add constraint form_templates_category_id_fkey
      foreign key (category_id) references public.document_categories(id) on delete set null;
  end if;
end $$;

create index if not exists form_templates_category_idx on public.form_templates (category_id);

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
  if new.slug = 'uncategorized' then
    new.system = true;
  end if;
  return new;
end
$$;

drop trigger if exists document_categories_guard on public.document_categories;
create trigger document_categories_guard
  before delete or update on public.document_categories
  for each row execute function public.guard_document_category();

drop trigger if exists document_categories_touch_updated_at on public.document_categories;
create trigger document_categories_touch_updated_at
  before update on public.document_categories
  for each row execute function public.touch_updated_at();

create table if not exists public.receipt_records (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid references public.reps(id) on delete set null,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  amount numeric(12, 2),
  vendor text not null default '',
  record_date date,
  lead_id text references public.leads(id) on delete set null,
  address_snapshot text not null default '',
  note text not null default '',
  created_at timestamptz not null default now(),
  constraint receipt_records_amount_check check (amount is null or amount >= 0),
  constraint receipt_records_path_check check (storage_path like 'receipts/%' and storage_path not like '%..%')
);

create table if not exists public.estimate_records (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid references public.reps(id) on delete set null,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  homeowner_name text not null default '',
  amount numeric(12, 2),
  record_date date,
  status text not null default 'draft',
  lead_id text references public.leads(id) on delete set null,
  address_snapshot text not null default '',
  note text not null default '',
  created_at timestamptz not null default now(),
  constraint estimate_records_amount_check check (amount is null or amount >= 0),
  constraint estimate_records_status_check check (status in ('draft', 'sent', 'accepted', 'declined')),
  constraint estimate_records_path_check check (storage_path like 'estimates/%' and storage_path not like '%..%')
);

create index if not exists receipt_records_rep_idx on public.receipt_records (uploaded_by, record_date desc);
create index if not exists estimate_records_rep_idx on public.estimate_records (uploaded_by, record_date desc);

alter table public.document_categories enable row level security;
alter table public.receipt_records enable row level security;
alter table public.estimate_records enable row level security;

revoke all on table public.document_categories, public.receipt_records, public.estimate_records from anon, public;
grant select, insert, update, delete on public.document_categories to authenticated;
grant select, insert, delete on public.receipt_records to authenticated;
grant select, insert, delete on public.estimate_records to authenticated;

drop policy if exists document_categories_select on public.document_categories;
create policy document_categories_select on public.document_categories
  for select to authenticated
  using (public.current_rep_id() is not null or public.is_admin_or_manager());

drop policy if exists document_categories_write on public.document_categories;
create policy document_categories_write on public.document_categories
  for all to authenticated
  using (public.is_admin_or_manager())
  with check (public.is_admin_or_manager());

drop policy if exists receipt_records_select on public.receipt_records;
create policy receipt_records_select on public.receipt_records
  for select to authenticated
  using (public.is_admin_or_manager() or uploaded_by = public.current_rep_id());

drop policy if exists receipt_records_insert on public.receipt_records;
create policy receipt_records_insert on public.receipt_records
  for insert to authenticated
  with check (
    uploaded_by = public.current_rep_id()
    and public.current_rep_id() is not null
    and storage_path like 'receipts/' || public.current_rep_id()::text || '/%'
  );

drop policy if exists receipt_records_delete on public.receipt_records;
create policy receipt_records_delete on public.receipt_records
  for delete to authenticated
  using (public.is_admin_or_manager() or uploaded_by = public.current_rep_id());

drop policy if exists estimate_records_select on public.estimate_records;
create policy estimate_records_select on public.estimate_records
  for select to authenticated
  using (public.is_admin_or_manager() or uploaded_by = public.current_rep_id());

drop policy if exists estimate_records_insert on public.estimate_records;
create policy estimate_records_insert on public.estimate_records
  for insert to authenticated
  with check (
    uploaded_by = public.current_rep_id()
    and public.current_rep_id() is not null
    and storage_path like 'estimates/' || public.current_rep_id()::text || '/%'
  );

drop policy if exists estimate_records_delete on public.estimate_records;
create policy estimate_records_delete on public.estimate_records
  for delete to authenticated
  using (public.is_admin_or_manager() or uploaded_by = public.current_rep_id());

-- 25 MB. PDF, images, Word, and Excel. The bucket stays private; the app uses signed URLs.
update storage.buckets
set allowed_mime_types = array[
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/heic',
      'image/heif',
      'application/pdf',
      'application/msword',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]::text[],
    file_size_limit = 26214400
where id = 'form-assets';

-- Library files stay admin-delete. The uploader can delete their own receipt or estimate.
drop policy if exists form_assets_storage_delete on storage.objects;
create policy form_assets_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'form-assets'
    and (
      public.is_admin_or_manager()
      or (
        split_part(name, '/', 1) in ('receipts', 'estimates')
        and split_part(name, '/', 2) = public.current_rep_id()::text
      )
    )
  );

comment on table public.document_categories is 'Editable folders for premade PDFs and agreements. Uncategorized cannot be removed.';
comment on table public.receipt_records is 'Receipt uploads. Management sees every row. A person sees and deletes their own.';
comment on table public.estimate_records is 'Estimate uploads. Management sees every row. A person sees and deletes their own.';

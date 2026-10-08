-- Training and practice library.
-- Idempotent. Apply once in the Supabase SQL Editor. Safe to run again.
-- Does not modify earlier migrations.
--
-- Storage limits checked against project qdovtewieuojjsebipex on 2026-10-08:
--   Organization TrueNorthRestorations is on the Free plan (tier_free).
--   Free plan global file cap: 50 MB (52,428,800 bytes). Pro and above can go
--   higher (up to 500 GB). The global setting lives in Storage settings, not
--   in Postgres, so this migration cannot read it. It can only set the bucket.
--   Existing buckets are under that cap: lead-photos 5 MB, form-assets 25 MB.
--   The training bucket is therefore capped at 50 MB, the highest value the
--   Free plan allows. The admin screen refuses anything larger before upload
--   and surfaces the storage API error if the dashboard global limit is lower.
--
-- Access
--   Admins and managers read and write every row.
--   Setters (including legacy canvasser) and sales reps read items assigned
--   to their role or to them personally, and read/write only their own progress.

create extension if not exists pgcrypto;

create table if not exists public.training_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  category text not null default '',
  sort_order integer not null default 0,
  audience text not null default 'both',
  required boolean not null default false,
  kind text not null,
  storage_path text,
  original_path text,
  poster_path text,
  mime_type text,
  file_name text,
  byte_size bigint,
  duration_seconds numeric,
  slide_count integer,
  page_count integer,
  external_url text,
  external_provider text,
  active boolean not null default true,
  created_by uuid references public.reps(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.training_items add column if not exists description text not null default '';
alter table public.training_items add column if not exists category text not null default '';
alter table public.training_items add column if not exists sort_order integer not null default 0;
alter table public.training_items add column if not exists audience text not null default 'both';
alter table public.training_items add column if not exists required boolean not null default false;
alter table public.training_items add column if not exists kind text;
alter table public.training_items add column if not exists storage_path text;
alter table public.training_items add column if not exists original_path text;
alter table public.training_items add column if not exists poster_path text;
alter table public.training_items add column if not exists mime_type text;
alter table public.training_items add column if not exists file_name text;
alter table public.training_items add column if not exists byte_size bigint;
alter table public.training_items add column if not exists duration_seconds numeric;
alter table public.training_items add column if not exists slide_count integer;
alter table public.training_items add column if not exists page_count integer;
alter table public.training_items add column if not exists external_url text;
alter table public.training_items add column if not exists external_provider text;
alter table public.training_items add column if not exists active boolean not null default true;
alter table public.training_items add column if not exists created_by uuid references public.reps(id) on delete set null;
alter table public.training_items add column if not exists created_at timestamptz not null default now();
alter table public.training_items add column if not exists updated_at timestamptz not null default now();

alter table public.training_items drop constraint if exists training_items_title_len;
alter table public.training_items add constraint training_items_title_len check (char_length(title) between 2 and 160);
alter table public.training_items drop constraint if exists training_items_description_len;
alter table public.training_items add constraint training_items_description_len check (char_length(description) <= 2000);
alter table public.training_items drop constraint if exists training_items_category_len;
alter table public.training_items add constraint training_items_category_len check (char_length(category) <= 80);
alter table public.training_items drop constraint if exists training_items_audience;
alter table public.training_items add constraint training_items_audience check (audience in ('setters', 'reps', 'both', 'specific'));
alter table public.training_items drop constraint if exists training_items_kind;
alter table public.training_items add constraint training_items_kind check (kind in ('video', 'deck', 'pdf', 'image', 'external'));
alter table public.training_items drop constraint if exists training_items_provider;
alter table public.training_items add constraint training_items_provider check (external_provider is null or external_provider in ('youtube', 'vimeo', 'loom'));
alter table public.training_items drop constraint if exists training_items_sort;
alter table public.training_items add constraint training_items_sort check (sort_order >= 0 and sort_order < 100000);
alter table public.training_items drop constraint if exists training_items_counts;
alter table public.training_items add constraint training_items_counts check (
  (slide_count is null or slide_count >= 0)
  and (page_count is null or page_count >= 0)
  and (duration_seconds is null or duration_seconds >= 0)
  and (byte_size is null or byte_size >= 0)
);

create index if not exists training_items_order_idx on public.training_items (active, sort_order, title);

create table if not exists public.training_assignments (
  item_id uuid not null references public.training_items(id) on delete cascade,
  rep_id uuid not null references public.reps(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item_id, rep_id)
);

create index if not exists training_assignments_rep_idx on public.training_assignments (rep_id);

create table if not exists public.training_reminders (
  item_id uuid not null references public.training_items(id) on delete cascade,
  rep_id uuid not null references public.reps(id) on delete cascade,
  created_by uuid references public.reps(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (item_id, rep_id)
);

create index if not exists training_reminders_rep_idx on public.training_reminders (rep_id);

create table if not exists public.training_progress (
  rep_id uuid not null references public.reps(id) on delete cascade,
  item_id uuid not null references public.training_items(id) on delete cascade,
  started_at timestamptz,
  last_position_seconds numeric not null default 0,
  max_watched_seconds numeric not null default 0,
  percent numeric not null default 0,
  completed_at timestamptz,
  view_count integer not null default 0,
  updated_at timestamptz not null default now(),
  pages_viewed integer[] not null default '{}',
  watched_ranges jsonb not null default '[]'::jsonb,
  primary key (rep_id, item_id)
);

alter table public.training_progress add column if not exists started_at timestamptz;
alter table public.training_progress add column if not exists last_position_seconds numeric not null default 0;
alter table public.training_progress add column if not exists max_watched_seconds numeric not null default 0;
alter table public.training_progress add column if not exists percent numeric not null default 0;
alter table public.training_progress add column if not exists completed_at timestamptz;
alter table public.training_progress add column if not exists view_count integer not null default 0;
alter table public.training_progress add column if not exists updated_at timestamptz not null default now();
alter table public.training_progress add column if not exists pages_viewed integer[] not null default '{}';
alter table public.training_progress add column if not exists watched_ranges jsonb not null default '[]'::jsonb;

alter table public.training_progress drop constraint if exists training_progress_percent;
alter table public.training_progress add constraint training_progress_percent check (percent >= 0 and percent <= 100);
alter table public.training_progress drop constraint if exists training_progress_times;
alter table public.training_progress add constraint training_progress_times check (
  last_position_seconds >= 0
  and max_watched_seconds >= 0
  and view_count >= 0
);

create index if not exists training_progress_item_idx on public.training_progress (item_id);

-- Visibility is security definer so storage policies and item policies can
-- share one rule without recursing through RLS. It uses the existing helpers
-- current_rep_id(), current_rep_role(), and is_admin_or_manager().
create or replace function public.can_view_training_item(target_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.training_items i
    where i.id = target_id
      and (
        public.is_admin_or_manager()
        or (
          i.active
          and (
            (
              i.audience in ('setters', 'both')
              and public.current_rep_role() in ('appointment_setter', 'canvasser')
            )
            or (
              i.audience in ('reps', 'both')
              and public.current_rep_role() = 'salesperson'
            )
            or exists (
              select 1 from public.training_assignments a
              where a.item_id = i.id
                and a.rep_id = public.current_rep_id()
            )
          )
        )
      )
  );
$$;

revoke all on function public.can_view_training_item(uuid) from public, anon;
grant execute on function public.can_view_training_item(uuid) to authenticated;

create or replace function public.training_object_visible(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when split_part(object_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.can_view_training_item(split_part(object_name, '/', 1)::uuid)
    else false
  end;
$$;

revoke all on function public.training_object_visible(text) from public, anon;
grant execute on function public.training_object_visible(text) to authenticated;

create or replace function public.training_progress_stamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.is_admin_or_manager() then
    if public.current_rep_id() is null then
      raise exception 'No active team profile';
    end if;
    if tg_op = 'INSERT' then
      new.rep_id := public.current_rep_id();
    elsif new.rep_id is distinct from old.rep_id or new.item_id is distinct from old.item_id then
      raise exception 'You can only update your own training progress';
    end if;
  end if;
  if new.percent < 0 or new.percent > 100 then
    raise exception 'Percent must be between 0 and 100';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.training_progress_stamp() from public, anon;

drop trigger if exists training_items_touch_updated_at on public.training_items;
create trigger training_items_touch_updated_at
  before update on public.training_items
  for each row execute function public.touch_updated_at();

drop trigger if exists training_progress_stamp on public.training_progress;
create trigger training_progress_stamp
  before insert or update on public.training_progress
  for each row execute function public.training_progress_stamp();

alter table public.training_items enable row level security;
alter table public.training_assignments enable row level security;
alter table public.training_reminders enable row level security;
alter table public.training_progress enable row level security;

revoke all on table public.training_items, public.training_assignments, public.training_reminders, public.training_progress from anon, public;
grant select, insert, update, delete on public.training_items to authenticated;
grant select, insert, update, delete on public.training_assignments to authenticated;
grant select, insert, update, delete on public.training_reminders to authenticated;
grant select, insert, update, delete on public.training_progress to authenticated;

drop policy if exists training_items_select on public.training_items;
create policy training_items_select on public.training_items
  for select to authenticated
  using (public.can_view_training_item(id));

drop policy if exists training_items_write on public.training_items;
create policy training_items_write on public.training_items
  for all to authenticated
  using (public.is_admin_or_manager())
  with check (public.is_admin_or_manager());

drop policy if exists training_assignments_select on public.training_assignments;
create policy training_assignments_select on public.training_assignments
  for select to authenticated
  using (rep_id = public.current_rep_id() or public.is_admin_or_manager());

drop policy if exists training_assignments_write on public.training_assignments;
create policy training_assignments_write on public.training_assignments
  for all to authenticated
  using (public.is_admin_or_manager())
  with check (public.is_admin_or_manager());

drop policy if exists training_reminders_select on public.training_reminders;
create policy training_reminders_select on public.training_reminders
  for select to authenticated
  using (rep_id = public.current_rep_id() or public.is_admin_or_manager());

drop policy if exists training_reminders_write on public.training_reminders;
create policy training_reminders_write on public.training_reminders
  for all to authenticated
  using (public.is_admin_or_manager())
  with check (public.is_admin_or_manager());

drop policy if exists training_progress_select on public.training_progress;
create policy training_progress_select on public.training_progress
  for select to authenticated
  using (rep_id = public.current_rep_id() or public.is_admin_or_manager());

drop policy if exists training_progress_insert on public.training_progress;
create policy training_progress_insert on public.training_progress
  for insert to authenticated
  with check (rep_id = public.current_rep_id() or public.is_admin_or_manager());

drop policy if exists training_progress_update on public.training_progress;
create policy training_progress_update on public.training_progress
  for update to authenticated
  using (rep_id = public.current_rep_id() or public.is_admin_or_manager())
  with check (rep_id = public.current_rep_id() or public.is_admin_or_manager());

drop policy if exists training_progress_delete on public.training_progress;
create policy training_progress_delete on public.training_progress
  for delete to authenticated
  using (public.is_admin_or_manager());

-- Private bucket. Playback uses signed URLs. 50 MB matches the Free plan cap.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'training',
  'training',
  false,
  52428800,
  array[
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-m4v',
    'video/m4v',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
  ]::text[]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists training_storage_select on storage.objects;
create policy training_storage_select on storage.objects
  for select to authenticated
  using (bucket_id = 'training' and public.training_object_visible(name));

drop policy if exists training_storage_insert on storage.objects;
create policy training_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'training' and public.is_admin_or_manager());

drop policy if exists training_storage_update on storage.objects;
create policy training_storage_update on storage.objects
  for update to authenticated
  using (bucket_id = 'training' and public.is_admin_or_manager())
  with check (bucket_id = 'training' and public.is_admin_or_manager());

drop policy if exists training_storage_delete on storage.objects;
create policy training_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'training' and public.is_admin_or_manager());

comment on table public.training_items is 'Training videos, decks, PDFs, images, and external links uploaded by management.';
comment on table public.training_progress is 'One row per person per item. Video percent is played time, not the seek position.';

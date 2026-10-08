-- Mark paperwork reviewed from the admin documents page.
-- Idempotent. Apply after 20261008_role_form_library.sql.
-- Does not change public.reps.role.

alter table public.form_submissions add column if not exists reviewed_at timestamptz;
alter table public.lead_photos add column if not exists reviewed_at timestamptz;
alter table public.homeowner_intakes add column if not exists reviewed_at timestamptz;

create or replace function public.guard_document_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reviewed_at is distinct from old.reviewed_at and not public.is_admin_or_manager() then
    raise exception 'Only management can mark a document reviewed.';
  end if;
  return new;
end
$$;

drop trigger if exists form_submissions_guard_review on public.form_submissions;
create trigger form_submissions_guard_review
  before update on public.form_submissions
  for each row execute function public.guard_document_review();

drop trigger if exists lead_photos_guard_review on public.lead_photos;
create trigger lead_photos_guard_review
  before update on public.lead_photos
  for each row execute function public.guard_document_review();

drop trigger if exists homeowner_intakes_guard_review on public.homeowner_intakes;
create trigger homeowner_intakes_guard_review
  before update on public.homeowner_intakes
  for each row execute function public.guard_document_review();

drop policy if exists form_submissions_update_review on public.form_submissions;
create policy form_submissions_update_review on public.form_submissions
  for update to authenticated
  using (public.is_admin_or_manager())
  with check (public.is_admin_or_manager());

grant update (caption, reviewed_at) on public.lead_photos to authenticated;

comment on column public.form_submissions.reviewed_at is 'When management marked this form reviewed. Null means new.';
comment on column public.lead_photos.reviewed_at is 'When management marked this photo reviewed. Null means new.';
comment on column public.homeowner_intakes.reviewed_at is 'When management marked this intake reviewed. Null means new.';

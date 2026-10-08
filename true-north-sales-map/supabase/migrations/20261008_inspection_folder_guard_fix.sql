-- Let a completed-inspection folder survive when its appointment or lead is deleted.
-- The foreign keys set appointment_id and lead_id to null. The previous guard treated
-- that as a rename and raised. Idempotent. Apply after 20261008_library_admin_alerts.sql.
-- Does not change already-applied migrations.

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
      or (new.appointment_id is distinct from old.appointment_id and new.appointment_id is not null)
      or new.kind is distinct from old.kind
      or (new.lead_id is distinct from old.lead_id and new.lead_id is not null)
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

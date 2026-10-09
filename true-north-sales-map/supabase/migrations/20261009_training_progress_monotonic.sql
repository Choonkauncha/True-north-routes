-- Prevent stale tabs/devices from rolling back accepted training progress.
-- This replaces the trigger function created by 20261008_training_practice.sql
-- and applies atomically inside every upsert.
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

  if tg_op = 'UPDATE' then
    new.started_at := coalesce(least(old.started_at, new.started_at), old.started_at, new.started_at);
    new.last_position_seconds := greatest(old.last_position_seconds, new.last_position_seconds);
    new.max_watched_seconds := greatest(old.max_watched_seconds, new.max_watched_seconds);
    new.percent := greatest(old.percent, new.percent);
    new.completed_at := coalesce(old.completed_at, new.completed_at);
    new.view_count := greatest(old.view_count, new.view_count);

    select coalesce(array_agg(distinct page order by page), '{}'::integer[])
      into new.pages_viewed
      from unnest(coalesce(old.pages_viewed, '{}'::integer[]) || coalesce(new.pages_viewed, '{}'::integer[])) as page;

    select coalesce(jsonb_agg(value), '[]'::jsonb)
      into new.watched_ranges
      from (
        select distinct value
        from jsonb_array_elements(coalesce(old.watched_ranges, '[]'::jsonb) || coalesce(new.watched_ranges, '[]'::jsonb))
      ) ranges;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.training_progress_stamp() from public, anon;

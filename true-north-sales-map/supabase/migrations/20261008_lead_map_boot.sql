-- Compact signed-in map boot. Idempotent. Do not apply from the app deploy;
-- run this once in the Supabase SQL editor. Safe to run again.
--
-- lead_map_boot returns, in one round trip:
--   count    total leads visible under the caller's RLS
--   newest   max(updated_at), used as the IndexedDB stamp
--   overlay  mutable columns for rows that are no longer the static defaults
--   added    full rows whose source is not in the published /data/leads.json set
--
-- security invoker so public.leads row level security still applies.
-- The function is granted to authenticated only.

create index if not exists leads_updated_at_idx on public.leads (updated_at desc);

create or replace function public.lead_map_boot()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'count', (select count(*) from public.leads),
    'newest', (select max(updated_at) from public.leads),
    'overlay', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id,
        'status', status,
        'assigned_rep_id', assigned_rep_id,
        'territory_id', territory_id,
        'roof_age_years', roof_age_years,
        'roof_age_verified', roof_age_verified,
        'notes', notes,
        'updated_at', updated_at,
        'updated_by', updated_by,
        'lat', lat,
        'lng', lng,
        'geocode_match', geocode_match
      )), '[]'::jsonb)
      from public.leads
      where status is distinct from 'New'
         or assigned_rep_id is not null
         or territory_id is not null
         or roof_age_years is not null
         or roof_age_verified is true
         or notes is not null
         or updated_by is not null
    ),
    'added', (
      select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb)
      from public.leads l
      where l.source is null
         or l.source not in ('Roofing Leads CSV', 'Knox Owner-Occupied', 'Knox Walk List')
    )
  );
$$;

revoke all on function public.lead_map_boot() from public;
revoke all on function public.lead_map_boot() from anon;
grant execute on function public.lead_map_boot() to authenticated;

comment on function public.lead_map_boot() is 'One payload for the field map: lead count, newest updated_at, changed columns, and leads missing from the static file.';

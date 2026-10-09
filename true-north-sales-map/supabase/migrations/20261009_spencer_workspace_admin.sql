-- Add Spencer's Google Workspace address as a bootstrap admin.
-- Approved by Travis on Oct 9, 2026.
-- Keeps the two original Gmail admins and adds spencer@truenorthrestorationsohio.com.
-- Safe to run more than once.

create or replace function public.ensure_bootstrap_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  em text := lower(coalesce(new.email, ''));
  label text;
begin
  if em not in ('travisbishopmackie@gmail.com', 'truenorthrestorationss@gmail.com', 'spencer@truenorthrestorationsohio.com') then
    return new;
  end if;
  label := coalesce(nullif(new.raw_user_meta_data->>'name', ''), split_part(em, '@', 1));
  insert into public.reps (user_id, name, email, role, active)
  values (new.id, label, em, 'admin', true)
  on conflict (user_id) do update
    set role = 'admin', active = true, email = excluded.email, name = coalesce(public.reps.name, excluded.name);
  return new;
end;
$$;

drop trigger if exists reps_bootstrap_admin on auth.users;
create trigger reps_bootstrap_admin
  after insert on auth.users
  for each row execute function public.ensure_bootstrap_admin();

-- If Spencer's Auth user already exists, make sure the admin row is attached.
insert into public.reps (user_id, name, email, role, active)
select u.id,
  coalesce(nullif(u.raw_user_meta_data->>'name', ''), split_part(u.email, '@', 1)),
  lower(u.email),
  'admin',
  true
from auth.users u
where lower(u.email) = 'spencer@truenorthrestorationsohio.com'
on conflict (user_id) do update
  set role = 'admin', active = true, email = excluded.email;

-- Proves authenticated column grants from 20261008_must_change_password.sql.
-- select * and ungranted columns fail. The explicit client selects succeed.
-- service_role still has table privileges, which is how /api/accounts returns rows.

grant usage on schema public to authenticated, service_role;

drop table if exists public.reps;
create table public.reps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique,
  name text not null,
  email text,
  phone text,
  role text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  must_change_password boolean not null default false,
  must_change_set_at timestamptz,
  password_changed_at timestamptz
);

revoke select, insert, update, delete on table public.reps from authenticated;
grant select (id, user_id, name, role, active, created_at) on table public.reps to authenticated;
grant insert (id, user_id, name, email, phone, role, active) on table public.reps to authenticated;
grant update (name, email, phone, role, active) on table public.reps to authenticated;
grant delete on table public.reps to authenticated;
grant all on table public.reps to service_role;

insert into public.reps (id, user_id, name, email, phone, role)
values (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Travis',
  'travisbishopmackie@gmail.com',
  '555-0100',
  'admin'
);

-- The selects the app issues after the migration.
set role authenticated;
select id, user_id, name, role, active, created_at from public.reps order by name;
select id, user_id, name, role, active from public.reps
  where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and active = true;
select id, name, role from public.reps
  where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and active = true;
select id, user_id, name, role, active from public.reps order by name;
select id, name, role, active from public.reps where active = true order by name;
select name, role from public.reps;
select id, name from public.reps;

insert into public.reps (name, email, role, active)
values ('Sam Sales', 'sam@example.com', 'salesperson', true)
returning id, name, role, active;

update public.reps set name = 'Sam Sales' where role = 'salesperson'
returning id, name, role, active;

do $$
declare
  leaked text;
begin
  begin
    execute 'select * from public.reps';
    raise exception 'select * was allowed for authenticated';
  exception when insufficient_privilege then
    null;
  end;
  foreach leaked in array array[
    'email', 'phone', 'must_change_password', 'must_change_set_at', 'password_changed_at'
  ] loop
    begin
      execute format('select %I from public.reps', leaked);
      raise exception 'authenticated could read %', leaked;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
  begin
    execute $q$insert into public.reps (name, email, role) values ('Pat', 'pat@example.com', 'manager') returning *$q$;
    raise exception 'returning * was allowed for authenticated';
  exception when insufficient_privilege then
    null;
  end;
  begin
    execute $q$update public.reps set phone = '555-0199' where role = 'salesperson' returning *$q$;
    raise exception 'update returning * was allowed for authenticated';
  exception when insufficient_privilege then
    null;
  end;
end $$;

reset role;
set role service_role;
select count(*) from public.reps;
select id, email, must_change_password from public.reps where role = 'admin';
reset role;

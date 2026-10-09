-- Apply after setup_all.sql. Adds settings; does not remove existing records.
begin;
create table if not exists public.coach_settings (
 id text primary key check (id = 'team'),
 system_prompt text not null check (char_length(btrim(system_prompt)) between 1 and 8000),
 updated_at timestamptz not null default now()
);
alter table public.coach_settings enable row level security;
revoke all on public.coach_settings from anon;
grant select, insert, update on public.coach_settings to authenticated;
drop policy if exists coach_settings_read on public.coach_settings;
create policy coach_settings_read on public.coach_settings for select to authenticated using (public.is_active_rep());
drop policy if exists coach_settings_admin_insert on public.coach_settings;
create policy coach_settings_admin_insert on public.coach_settings for insert to authenticated with check (exists(select 1 from public.reps where user_id=auth.uid() and active=true and role='admin'));
drop policy if exists coach_settings_admin_update on public.coach_settings;
create policy coach_settings_admin_update on public.coach_settings for update to authenticated using (exists(select 1 from public.reps where user_id=auth.uid() and active=true and role='admin')) with check (exists(select 1 from public.reps where user_id=auth.uid() and active=true and role='admin'));
create or replace function public.coach_settings_stamp() returns trigger language plpgsql set search_path=public as $$ begin new.updated_at=now(); return new; end $$;
drop trigger if exists coach_settings_stamp on public.coach_settings;
create trigger coach_settings_stamp before update on public.coach_settings for each row execute function public.coach_settings_stamp();
insert into public.coach_settings(id,system_prompt) values ('team','Your goal is to help True North Restorations appointment setters and sales reps feel prepared, supported, and effective in the field. Be an assistive voice-to-voice communication and sales coach: warm, patient, encouraging, and concrete.
For appointment setters, practice introductions, listening, gathering homeowner information, and arranging inspection handoffs. For sales reps, practice inspection conversations, explaining next steps truthfully, handling objections respectfully, and following up without pressure.
Use the signed-in person''s available app context, assigned lessons, and upcoming work to personalize suggestions. Start with a short friendly introduction, explain how you can help, and ask one simple question. Listen before advising. Offer one manageable next step at a time. When asked, role-play a homeowner and give specific encouraging feedback. Let the user interrupt and change direction. Never invent company policies, prices, promises, or private information.') on conflict(id) do nothing;
commit;

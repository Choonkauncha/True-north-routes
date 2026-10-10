-- Existing installations: run after the prior complete setup_all.sql has been installed.
-- Adds missing repairs and atomic RPCs; retains existing data. Apply before app deployment.

-- 20261008_training_upload_rls.sql
-- Fix: training video uploads fail with
--   "tus: unexpected response while creating upload ... new row violates row-level security policy"
--
-- Why it fails
--   The admin screen (tn-files/training-admin.js submit -> storeFile) generates a NEW item id
--   client-side (crypto.randomUUID()) and uploads every file (original-*.mov when "Keep the
--   original file too" is checked, media-*.mp4, poster-*.jpg) to the 'training' bucket under
--   "<id>/..." BEFORE the public.training_items row for <id> is upserted.
--
--   Supabase Storage inserts the storage.objects row with INSERT ... RETURNING (and the client
--   sends x-upsert: true). Postgres requires a row returned by INSERT ... RETURNING / ON CONFLICT
--   DO UPDATE to also pass the table's SELECT policies. The only SELECT policy for the bucket is
--   "training_storage_select":
--       USING (bucket_id = 'training' AND public.training_object_visible(name))
--   training_object_visible() -> can_view_training_item(<id>) requires an EXISTING
--   training_items row, which does not exist yet, so it returns false even for admins.
--   "training_storage_insert" (bucket_id = 'training' AND is_admin_or_manager()) itself passes;
--   the rejection is the SELECT check on the returned row.
--   Verified in a rolled-back transaction as an active admin: plain INSERT = OK,
--   INSERT ... RETURNING = "new row violates row-level security policy for table objects".
--
-- Fix
--   Let admins/managers (the same roles already allowed to INSERT/UPDATE/DELETE in this bucket
--   and to write training_items) SELECT any object in the 'training' bucket. Everyone else keeps
--   the existing per-item visibility rule. Only the 'training' bucket is touched; the
--   lead-photos and form-assets policies are unchanged.
--
-- Idempotent. Safe to run again.

drop policy if exists training_storage_select on storage.objects;
create policy training_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'training'
    and (
      public.is_admin_or_manager()
      or public.training_object_visible(name)
    )
  );

-- Unchanged, restated so the bucket's write rules are explicit alongside the fix.
drop policy if exists training_storage_insert on storage.objects;
create policy training_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'training' and public.is_admin_or_manager());

drop policy if exists training_storage_update on storage.objects;
create policy training_storage_update on storage.objects
  for update to authenticated
  using (bucket_id = 'training' and public.is_admin_or_manager())
  with check (bucket_id = 'training' and public.is_admin_or_manager());


-- 20261008_inspection_folder_guard_fix.sql
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


-- 20261009_coach_settings.sql
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


-- 20261010_integrity_access.sql
-- Additive integrity/access repair. Requires the previously deployed setup_all schema.
-- No historical lead, intake, shift, photo, training or account rows are deleted.
begin;
create or replace function public.session_ready() returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.reps where user_id=auth.uid() and active=true)
    and (not coalesce((public.password_gate_status()->>'must_change')::boolean,false)
      or coalesce((public.password_gate_status()->>'impersonating')::boolean,false));
$$;
revoke all on function public.session_ready() from public,anon;
grant execute on function public.session_ready() to authenticated;
create or replace function public.is_active_rep() returns boolean
language sql stable security definer set search_path=public as $$select public.session_ready()$$;
create or replace function public.is_admin_or_manager() returns boolean
language sql stable security definer set search_path=public as $$
 select public.session_ready() and exists(select 1 from public.reps where user_id=auth.uid() and active and role in ('admin','manager'));
$$;
create or replace function public.current_rep_id() returns uuid
language sql stable security definer set search_path=public as $$
 select id from public.reps where user_id=auth.uid() and active and public.session_ready() limit 1;
$$;
create or replace function public.current_rep_role() returns text
language sql stable security definer set search_path=public as $$
 select role from public.reps where user_id=auth.uid() and active and public.session_ready() limit 1;
$$;
-- Keep own profile/recovery readable even when flagged. All operational tables require readiness.
drop policy if exists reps_select on public.reps;
create policy reps_select on public.reps for select to authenticated
 using(user_id=auth.uid() or public.session_ready());
do $$ declare t text; begin
 foreach t in array array['territories','leads','homeowner_intakes','lead_activity','appointments',
 'location_consents','shifts','location_points','message_threads','messages','lead_photos',
 'form_templates','form_submissions','form_assignments','document_categories','receipt_records',
 'estimate_records','training_items','training_assignments','training_reminders','training_progress',
 'training_practice_attempts','account_audit','feature_permissions','coach_settings'] loop
  if to_regclass('public.'||t) is not null then
   execute format('drop policy if exists session_ready_gate on public.%I',t);
   execute format('create policy session_ready_gate on public.%I as restrictive for all to authenticated using(public.session_ready()) with check(public.session_ready())',t);
  end if;
 end loop;
end $$;
drop policy if exists reps_write_ready on public.reps;
create policy reps_write_ready on public.reps as restrictive for all to authenticated
 using(user_id=auth.uid() or public.session_ready()) with check(public.session_ready());
-- Recovery updates run in a tightly scoped security-definer function and bypass RLS.
drop policy if exists storage_session_ready on storage.objects;
create policy storage_session_ready on storage.objects as restrictive for all to authenticated
 using(public.session_ready()) with check(public.session_ready());
-- Feature RPCs must also respect a required password change.
create or replace function public.feature_enabled(requested text) returns boolean
language sql stable security definer set search_path=public as $$
 select public.session_ready() and coalesce((select case
 when r.role in ('admin','manager') then true
 else coalesce((select p.enabled from public.feature_permissions p
 where p.role=case when r.role='canvasser' then 'appointment_setter' else r.role end and p.feature=requested),requested<>'photos' or r.role='salesperson') end
 from public.reps r where r.user_id=auth.uid() and r.active limit 1),false)
 and requested in ('map','routes','weather','intake','forms','photos','training','coach','shifts','messages','account');
$$;
revoke all on function public.feature_enabled(text) from public,anon;
grant execute on function public.feature_enabled(text) to authenticated;
create or replace function public.replace_form_assignments(p_template_id uuid,p_rep_ids uuid[])
returns setof public.form_assignments language plpgsql security definer set search_path=public as $$
begin
 if not public.is_admin_or_manager() or not public.feature_enabled('forms') then raise exception 'Management access required' using errcode='42501'; end if;
 perform 1 from public.form_templates where id=p_template_id for update;
 if not found then raise exception 'Form not found'; end if;
 if exists(select 1 from unnest(coalesce(p_rep_ids,'{}'::uuid[])) as candidates(rep_id) where candidates.rep_id is null or not exists(select 1 from public.reps r where r.id=candidates.rep_id and r.active)) then raise exception 'Choose active team members'; end if;
 delete from public.form_assignments where template_id=p_template_id;
 insert into public.form_assignments(template_id,rep_id) select p_template_id,id from unnest(coalesce(p_rep_ids,'{}'::uuid[])) id group by id;
 return query select * from public.form_assignments where template_id=p_template_id;
end $$;
revoke all on function public.replace_form_assignments(uuid,uuid[]) from public,anon;
grant execute on function public.replace_form_assignments(uuid,uuid[]) to authenticated;
create or replace function public.save_training_item(p_item jsonb,p_assignee_ids uuid[])
returns setof public.training_items language plpgsql security definer set search_path=public as $$
declare v public.training_items%rowtype; v_id uuid;
begin
 if not public.is_admin_or_manager() or not public.feature_enabled('training') then raise exception 'Management access required' using errcode='42501'; end if;
 v_id := coalesce(nullif(p_item->>'id','')::uuid,gen_random_uuid());
 perform pg_advisory_xact_lock(hashtextextended('training:'||v_id::text,0));
 if exists(select 1 from unnest(coalesce(p_assignee_ids,'{}'::uuid[])) as candidates(rep_id) where candidates.rep_id is null or not exists(select 1 from public.reps r where r.id=candidates.rep_id and r.active)) then raise exception 'Choose active team members'; end if;
 select * into v from public.training_items where id=v_id for update;
 if not found then v.id:=v_id; v.description:=''; v.category:=''; v.sort_order:=0; v.audience:='both'; v.required:=false; v.active:=true; v.created_by:=public.current_rep_id(); v.created_at:=now(); end if;
 v := jsonb_populate_record(v,p_item - array['created_by','created_at','updated_at']);
 v.id:=v_id; v.updated_at:=now();
 insert into public.training_items select v.* on conflict(id) do update set
 title=excluded.title,description=excluded.description,category=excluded.category,sort_order=excluded.sort_order,
 audience=excluded.audience,required=excluded.required,kind=excluded.kind,storage_path=excluded.storage_path,
 original_path=excluded.original_path,poster_path=excluded.poster_path,mime_type=excluded.mime_type,
 file_name=excluded.file_name,byte_size=excluded.byte_size,duration_seconds=excluded.duration_seconds,
 slide_count=excluded.slide_count,page_count=excluded.page_count,external_url=excluded.external_url,
 external_provider=excluded.external_provider,active=excluded.active,updated_at=excluded.updated_at;
 delete from public.training_assignments where item_id=v_id;
 insert into public.training_assignments(item_id,rep_id) select v_id,id from unnest(coalesce(p_assignee_ids,'{}'::uuid[])) id group by id;
 return query select * from public.training_items where id=v_id;
end $$;
revoke all on function public.save_training_item(jsonb,uuid[]) from public,anon;
grant execute on function public.save_training_item(jsonb,uuid[]) to authenticated;
-- Server-only transaction. Public requests always append and cannot claim a known lead.
create or replace function public.atomic_save_homeowner_profile(p_input jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 i jsonb:=p_input; public_request boolean:=coalesce(p_input->>'source','')='public_homeowner_form';
 l public.leads%rowtype; h public.homeowner_intakes%rowtype; a public.appointments%rowtype;
 actor uuid; sales uuid; lid text; hid uuid; aid uuid; existed boolean:=false; stamp timestamptz:=now();
 key text; v_notes text; extra text; phone_key text; email_key text;
begin
 if coalesce(auth.role(),'')<>'service_role' and session_user not in ('postgres','supabase_admin') then raise exception 'Server access required' using errcode='42501'; end if;
 if jsonb_typeof(i)<>'object' or coalesce((i->>'consent_contact')::boolean,false) is not true then raise exception 'Contact consent required'; end if;
 if exists(select 1 from unnest(array['first_name','last_name','phone','address','city','state','zip']) k where nullif(btrim(i->>k),'') is null) then raise exception 'Incomplete homeowner profile'; end if;
 if not public_request then
  actor:=nullif(i->>'actor_id','')::uuid; sales:=nullif(i->>'salesperson_id','')::uuid;
  if not exists(select 1 from public.reps where id=actor and active and role in ('admin','manager','salesperson','appointment_setter','canvasser')) then raise exception 'Active staff required'; end if;
  if exists(select 1 from public.reps r join public.feature_permissions p on p.role=case when r.role='canvasser' then 'appointment_setter' else r.role end and p.feature='intake' where r.id=actor and r.role not in ('admin','manager') and not p.enabled) then raise exception 'Intake disabled'; end if;
  if nullif(i->>'scheduled_at','') is null or sales is null then raise exception 'Inspection time and salesperson required'; end if;
  if not exists(select 1 from public.reps where id=sales and active and role='salesperson') then raise exception 'Choose an active salesperson'; end if;
 end if;
 key:=concat_ws('|',btrim(regexp_replace(lower(i->>'address'),'[^a-z0-9]+',' ','g')),btrim(regexp_replace(lower(i->>'city'),'[^a-z0-9]+',' ','g')),btrim(regexp_replace(lower(i->>'zip'),'[^a-z0-9]+',' ','g')));
 -- Serialize contact/address matching, including first inserts, without altering historical records.
 perform pg_advisory_xact_lock(hashtextextended('homeowner:'||key,0));
 if not public_request then
  lid:=nullif(i->>'lead_id','');
  if lid is not null then
   perform pg_advisory_xact_lock(hashtextextended('lead:'||lid,0));
   select * into l from public.leads where id=lid for update;
   if l.id is null then raise exception 'Lead not found'; end if;
   select * into h from public.homeowner_intakes where lead_id=lid order by updated_at desc nulls last,created_at desc limit 1 for update;
  else
   phone_key:=regexp_replace(i->>'phone','[^0-9]','','g');
   if length(phone_key)=11 and left(phone_key,1)='1' then phone_key:=substr(phone_key,2); end if;
   email_key:=lower(btrim(coalesce(i->>'email','')));
   select * into h from public.homeowner_intakes x where
    concat_ws('|',btrim(regexp_replace(lower(x.address),'[^a-z0-9]+',' ','g')),btrim(regexp_replace(lower(x.city),'[^a-z0-9]+',' ','g')),btrim(regexp_replace(lower(x.zip),'[^a-z0-9]+',' ','g')))=key
    and ((phone_key<>'' and regexp_replace(regexp_replace(x.phone,'[^0-9]','','g'),'^1([0-9]{10})$','\1')=phone_key) or (email_key<>'' and lower(btrim(x.email))=email_key))
    order by x.updated_at desc nulls last,x.created_at desc limit 1 for update;
   if h.id is not null then
    lid:=h.lead_id; perform pg_advisory_xact_lock(hashtextextended('lead:'||lid,0));
    select * into l from public.leads where id=lid for update;
   end if;
  end if;
 end if;
 existed:=h.id is not null;
 lid:=coalesce(l.id,h.lead_id,(case when public_request then 'HOME-' else 'SET-' end)||gen_random_uuid()::text);
 v_notes:=left(coalesce(i->>'notes',''),4000);
 foreach extra in array array[
  case when nullif(i->>'concern','') is not null then 'Concern: '||(i->>'concern') end,
  case when nullif(i->>'what_they_noticed','') is not null then 'Noticed: '||(i->>'what_they_noticed') end,
  case when nullif(i->>'timing','') is not null then 'Timing: '||(i->>'timing') end,
  case when nullif(i->>'other_contractor','') is not null then 'Other contractor: '||(i->>'other_contractor') end] loop
  if extra is not null and position(extra in v_notes)=0 then v_notes:=concat_ws(E'\n',nullif(v_notes,''),extra); end if;
 end loop;
 v_notes:=left(v_notes,4000);
 if l.id is null then
  insert into public.leads(id,source,address,name,city,state,zip,full_address,notes,status,assigned_rep_id,updated_at)
  values(lid,case when public_request then 'Homeowner public form' else 'Appointment Setter Intake' end,i->>'address',concat_ws(' ',i->>'first_name',i->>'last_name'),i->>'city',i->>'state',i->>'zip',concat_ws(', ',i->>'address',i->>'city',i->>'state',i->>'zip'),v_notes,case when nullif(i->>'scheduled_at','') is not null then 'Appointment' else 'Interested' end,actor,stamp);
 else
  update public.leads set name=concat_ws(' ',i->>'first_name',i->>'last_name'),address=i->>'address',city=i->>'city',state=i->>'state',zip=i->>'zip',full_address=concat_ws(', ',i->>'address',i->>'city',i->>'state',i->>'zip'),notes=v_notes,status=case when nullif(i->>'scheduled_at','') is not null then 'Appointment' else status end,assigned_rep_id=coalesce(actor,assigned_rep_id),updated_at=stamp where id=lid;
 end if;
 hid:=coalesce(h.id,gen_random_uuid());
 if h.id is null then h.id:=hid; h.source:=i->>'source'; h.created_by:=actor; h.created_at:=stamp; h.status:='New'; end if;
 h:=jsonb_populate_record(h,i - array['id','lead_id','source','status','created_by','created_at','updated_at','assigned_salesperson_id']);
 h.id:=hid; h.lead_id:=lid; h.notes:=v_notes; h.consent_contact:=true; h.updated_at:=stamp;
 if not public_request then h.status:='Inspection Scheduled'; h.assigned_salesperson_id:=sales; end if;
 insert into public.homeowner_intakes select h.* on conflict(id) do update set
 first_name=excluded.first_name,last_name=excluded.last_name,phone=excluded.phone,email=excluded.email,
 address=excluded.address,city=excluded.city,state=excluded.state,zip=excluded.zip,
 homeowner_confirmed=excluded.homeowner_confirmed,concern=excluded.concern,what_they_noticed=excluded.what_they_noticed,
 other_contractor=excluded.other_contractor,timing=excluded.timing,preferred_date=excluded.preferred_date,
 preferred_time_window=excluded.preferred_time_window,notes=excluded.notes,consent_contact=excluded.consent_contact,
 status=excluded.status,assigned_salesperson_id=excluded.assigned_salesperson_id,updated_at=excluded.updated_at;
 if nullif(i->>'scheduled_at','') is not null then
  if not public_request then select * into a from public.appointments where lead_id=lid and stage not in ('Completed','Cancelled') order by updated_at desc,created_at desc limit 1 for update; end if;
  aid:=coalesce(a.id,gen_random_uuid());
  insert into public.appointments(id,lead_id,canvasser_id,salesperson_id,scheduled_at,stage,notes)
  values(aid,lid,coalesce(a.canvasser_id,actor),sales,(i->>'scheduled_at')::timestamptz,case when public_request then 'Requested' when i->>'stage'='Confirmed' then 'Confirmed' else 'Scheduled' end,v_notes)
  on conflict(id) do update set salesperson_id=excluded.salesperson_id,scheduled_at=excluded.scheduled_at,stage=excluded.stage,notes=excluded.notes,updated_at=stamp;
 end if;
 insert into public.lead_activity(lead_id,actor_id,action,metadata)
 values(lid,actor,case when public_request then 'homeowner_request_submitted' else 'setter_appointment_booked' end,jsonb_build_object('source',i->>'source','updated',existed,'to_status',case when nullif(i->>'scheduled_at','') is not null then 'Appointment' else 'Interested' end,'preferred_date',coalesce(i->>'preferred_date',''),'preferred_time_window',coalesce(i->>'preferred_time_window',''),'salesperson_id',sales,'scheduled_at',nullif(i->>'scheduled_at','')));
 return jsonb_build_object('ok',true,'updated',existed,'reference',lid,'lead_id',lid,'intake_id',hid,'appointment_id',aid,'message',case when existed then 'Homeowner profile updated.' else 'Homeowner profile created.' end);
end $$;
revoke all on function public.atomic_save_homeowner_profile(jsonb) from public,anon,authenticated;
grant execute on function public.atomic_save_homeowner_profile(jsonb) to service_role;
commit;

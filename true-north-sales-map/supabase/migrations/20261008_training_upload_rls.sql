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

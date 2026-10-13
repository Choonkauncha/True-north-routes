# Accounts update — deployment steps

## Existing Supabase project
1. Open Supabase → SQL Editor → New query.
2. Paste and run `supabase/migrations/20261012_account_archive.sql` in full. Run only this migration for an existing configured database.
3. Deploy this updated `true-north-sales-map` folder to Vercel. No new environment variables or extra serverless function are needed. Keep SUPABASE_URL, the publishable/anon key, and the server-only secret/service-role key configured.
4. Reload the app, open Management → Accounts, and use Delete profile on a subuser. The ⋮ account settings menu opens Deleted profiles archive.

For a brand-new database, `supabase/setup_all.sql` now includes the archive migration. Do not rerun full setup solely for this account update.

## Behavior
- Admins may delete managers, sales reps, appointment setters, and legacy canvassers. Managers cannot delete profiles.
- Admin profiles cannot be deleted, including the signed-in admin. Existing API and database guards protect other admins from password resets, access changes, impersonation, and profile edits.
- Deletion archives the profile, removes the Supabase Auth user and live reps row, and removes impersonation grants/sessions in one database transaction. If any step fails, nothing is deleted or archived. Retrying a completed deletion is safe.
- Deleted profiles disappear from Accounts and cached Team views. The archive is read-only and admin-only. It contains name, email, role and deletion date; the database retains the profile snapshot and account-owned history that existing cascade constraints would otherwise remove.
- Existing leads, photos, submitted forms and other records with SET NULL foreign keys stay in the company database. Account-owned cascading rows such as shifts/training are captured in the archive snapshot before removal. The profile archive is intentional retention, not erasure of every historical mention.
- Supabase Storage ownership or custom foreign-key restrictions can block Auth deletion. Such failure leaves the account intact; reconcile the blocker and retry. This update does not delete business files from Storage.
- Creation has name/email/password limits, password visibility, first-login password-change guidance, a submitting state, and error recovery that keeps nonsecret form fields. Passwords are cleared after errors.

## Logic locations
- `tn-files/accounts-admin.js`: creation form, profile controls, settings archive.
- `api/accounts.js`: authenticated create/reset/access/impersonation/delete/archive API.
- `lib/account-rules.js`: shared role permissions.
- `supabase/accounts.sql`: Auth bootstrap and original profile/audit provisioning.
- `supabase/migrations/20261008_must_change_password.sql`: admin profile guards and first-login password requirements.
- `supabase/migrations/20261012_account_archive.sql`: transactional archive/deletion and database permissions.

## Validation
Account permission and transaction rollback tests pass. The archive migration now works without session_ready() or impersonation tables. Chromium account tests cover protected admins, deletion, archive display, password visibility and creation-error recovery. See REVIEW-AND-DEPLOYMENT.md for the broader route and application review and live deployment limitations.

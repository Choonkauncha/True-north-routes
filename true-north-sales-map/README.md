# True North Roofing — Sales Command Center v2

## Brand + UX refresh (v2.1)

The command center uses the official full badge on deep navy `#0c1424` and electric blue `#1e6bff`, with Slate `#3E4E59` and Field Gray `#F3F5F6`. The training line stays “Inspect Honestly. Document Clearly. Earn the Job.” The brand guide describes the voice as local, straightforward, informed, low-pressure, and accountable.

UX upgrades include a map-first shell, the official True North logo, focus-map mode, keyboard shortcuts (`/`, `N`, `R`, `L`), live cloud refresh via Supabase Realtime, quick field-result actions, a persistent route tray, mobile field controls, richer priority/distance/territory metadata, toast feedback, and improved map controls.

The header, sign-in screens, and favicon use the official full badge in `brand/true-north-full-logo.png`. Pages load `brand/logo-full.webp`. Phone headers use the compass-and-roof crop in `brand/logo-emblem.webp`.

Map-first canvassing operations for Vercel. The supplied dataset contains **17,232 leads**. The manifest records a Knox walk-list total of **16,136**, with coordinates on 17,177 houses.

## What changed

- Exact house-level pins once coordinates are geocoded.
- Smart next-house scoring using status, high-priority source, owner occupancy, property age, verified roof age, territory ownership, and distance from the rep.
- Route optimizer (nearest-neighbor + 2-opt) with a selectable driving/walking mode and Google Maps handoff in navigation blocks.
- Shared Supabase live state for lead status, assignments, notes, appointments, activities, reps, and territory ownership.
- Territory ownership by city/market.
- Heat layers for lead density, opportunity score, and roof-age proxy / verified roof age.
- Active storm alerts from the National Weather Service. This is a **current warning layer**, not a historical hail-damage archive.
- A small weather widget on the map for the current spot: temperature, conditions, wind, rain chance, the next few hours, and today's high and low. It uses Open-Meteo and needs no API key. Active storm, hail, and wind alerts from the National Weather Service show as a banner.
- Appointment handoff queue for salesperson transfer.
- 7-day field leaderboard based on recorded field activity.
- Admin/manager tools to seed the source rows, initialize territories, run batch geocoding, load storm alerts, and export lead state.
- Local device fallback is retained for testing, but it is not shared between reps.

## One-time setup (fresh project)

The live project is `https://ztdnpbrhiudklfqzgcbd.supabase.co`. Paste one file, create the first admin in the Auth dashboard, then set the Vercel env vars. Do not put a password in git.

1. Supabase → SQL Editor → New query. Paste the whole file `supabase/setup_all.sql` and run it once. It is idempotent and already ordered: `schema.sql`, then Cam’s `supabase/migrations/20261008_access_clockin.sql`, then `supabase/forms_photos.sql`, then `supabase/accounts.sql` (audit log, role guard, and the first-admin trigger), then `supabase/migrations/20261008_role_form_library.sql`, then `supabase/migrations/20261008_document_review.sql`. Regenerate it with `node scripts/build-setup-sql.mjs` if one of those files changes. If the live project already ran the older setup, run `supabase/migrations/20261008_role_form_library.sql` and then `supabase/migrations/20261008_document_review.sql`. Do not apply either file from the app.
2. Supabase → Authentication → Add user. Create a user with email `travisbishopmackie@gmail.com` or `truenorthrestorationss@gmail.com` and a password you choose. The `reps_bootstrap_admin` trigger inserts an active `public.reps` row with role `admin`. If that Auth user already existed before the SQL ran, the same script’s backfill insert attaches the admin row. Either order works.
3. Authentication → URL Configuration. Set Site URL to the Vercel app origin, and add that origin, `http://localhost:4173`, and `<origin>/reset-password` to Redirect URLs. “Open as this user” sends a one-time magic link back to `/`. Forgot password sends the reset link to `/reset-password`.
4. Vercel project Root Directory is `true-north-sales-map`. Environment variables:
   - `SUPABASE_URL` — `https://ztdnpbrhiudklfqzgcbd.supabase.co`
   - `SUPABASE_PUBLISHABLE_KEY` — browser-safe publishable key. `SUPABASE_ANON_KEY` is accepted if the publishable name is unset.
   - `SUPABASE_SECRET_KEY` — server-only secret. Used by `/api/accounts` and `/api/homeowner-signup`. Never send it to the browser. `SUPABASE_SERVICE_ROLE_KEY` is the fallback name the account API reads when `SUPABASE_SECRET_KEY` is unset.
   - `ADMIN_EMAILS` — optional. Defaults to `truenorthrestorationss@gmail.com,travisbishopmackie@gmail.com`. This is the sign-in allow-list returned by `/api/config`. The SQL trigger uses those same two addresses and does not read this variable.
5. Redeploy. Environment-variable changes apply to new deployments.
6. Open `/admin`, sign in as that admin, and use **Accounts** to create appointment setter, sales rep, and manager logins. The same Accounts action is on the Management dashboard in My account and in the map’s command center. Each person opens **My account** (map → More on a phone, or the header link) and changes the initial password.

## Cloud setup

1. Prefer `supabase/setup_all.sql` (see above). The same pieces can be run separately: `supabase/schema.sql`, then the clock-in migration, then `supabase/forms_photos.sql`, then `supabase/accounts.sql`.
2. Enable Email/Password authentication in Supabase Auth. The first admin is created in Authentication → Add user; the trigger writes the `reps` row. Later people are created from the admin **Accounts** tab, which creates the Auth user and the active `reps` row together.
3. Roles on `public.reps` are `admin`, `manager`, `appointment_setter`, and `salesperson`. Older `canvasser` rows stay valid and are treated as appointment setters. The Accounts screen does not create that role.
4. In Vercel Project Settings → Environment Variables, add `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY` as listed above.
5. Redeploy. Vercel environment-variable changes apply to new deployments.
6. Sign in as an admin/manager and open **Admin** → **Initialize cloud data**.
7. Run **Initialize territories**.
8. Run **Geocode missing house pins**. The app processes the addresses in small authenticated batches and stores the returned coordinates in Supabase. The Census geocoder's current batch API accepts up to 10,000 records per file; this app uses 500-record chunks to keep each serverless request bounded.

## Data truth notes

The source PDF supplies construction year for the Knox owner-occupied set, not the date the roof was last replaced. The map therefore labels construction-year visualization as a **roof-age proxy** unless a verified `roof_age_years` value is entered by the team.

The map has three storm layers setters and reps can turn on or off: live RainViewer radar for the last 30 to 60 minutes, active National Weather Service warning polygons for Ohio (severe thunderstorm, tornado, hail, and wind, colored by type), and recent NOAA Storm Prediction Center hail, wind, and tornado reports around Knox County. Tap a warning for the headline, hail size, wind, and expiry. **Houses in storm area** filters and queues houses inside a warning polygon or within 3 miles of a hail report so a route can be built from that tap. These feeds need no API key. `/api/storm-maps` caches them for about 10 minutes and returns empty layers if a source is down. The layers show current warnings and reports. They do not assert that a particular property suffered storm damage.

The map also shows a live widget from `/api/weather`. Open-Meteo supplies the forecast for the phone's location, or the map center if location is denied. The National Weather Service point alerts feed supplies the banner. Responses are cached for about 10 minutes. If either service is down, that part stays hidden.

## Vercel architecture

This remains a static-first site, with Vercel Functions only for `/api/config`, `/api/geocode`, `/api/storms`, `/api/storm-maps`, and `/api/weather`. Supabase is the shared database/auth layer. The server-only Supabase secret is used only to validate authenticated requests to the geocoding endpoint.

## Clock in, location, and office messages

Appointment setters and sales reps get a large green **Clock In** button on the field map and on the inspection form. On a phone it stays fixed at the bottom of the screen so it can be reached with a thumb. After clock-in it turns red, says **Clock Out**, and shows a running timer. The first clock-in shows a short location notice with one **Got it** button. A point is stored at clock-in, clock-out, and each door-status change during that shift. The browser is not asked to track in the background.

**Messages** opens one chat with the office. Newest messages sit at the bottom, with a large text box and Send button. An unread count sits on the Messages button. Admins open Messages, tap a person, and get that same chat.

**Shifts** (`/shifts`) lists who is clocked in right now at the top. Tap a person to see their points on a map and the miles for that day.

Each of those people has one message thread with the office, separate from GroupMe. Admins and managers see every thread, with an unread count. Field users see only their own thread.

Admins and managers open **Shifts** at `/shifts` (also linked from Management). Who is clocked in right now is listed first. Tap a person to see that day's points on a map and the miles between them. The day boundary is Eastern time.

Access is enforced twice:

- Supabase row level security, plus insert triggers that stamp `rep_id` / `sender_rep_id` from the signed-in user.
- `GET` and `POST /api/field`, which checks the bearer token and role before it reads or writes. The API calls Postgres with the user token and the publishable key, so RLS still applies. It does not use the service-role secret for these tables.

### Apply the migration

Run this after `supabase/schema.sql` on a new project, or on its own if the rest of the schema is already applied.

1. Open the Supabase project → SQL Editor.
2. Paste `supabase/migrations/20261008_access_clockin.sql` and run it.
3. Confirm the editor finishes without an error. The script is additive: it creates the new tables, policies, and triggers, and it does not rewrite leads, reps, or appointments.
4. Redeploy so `/api/field` and `/shifts` are live. Existing environment variables are enough (`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`). No new secrets.

Re-running the file replaces functions and policies. It does not drop shifts or messages that were already recorded.

### How to test

Use two Supabase users: one `appointment_setter` or `salesperson`, and one `admin` or `manager`, each with an active `public.reps` row.

1. **Clock in.** Sign in on `/` or `/setter` as the field user. Tap the green Clock In button. The first time, the location sheet appears. Tap Got it. Allow the browser location prompt. The button turns red, says Clock Out, and the timer starts. In Supabase, `location_consents` has one row for that rep, and `shifts` has an open row whose `rep_id` matches them.
2. **Door point.** While clocked in, mark a door status on the map (Knocked, No answer, and the other field buttons). `location_points` gains a `door_status` row. Clock out. A `clock_out` point is stored and `clock_out_at` is set. Mark another door after clock-out and confirm no new point is written.
3. **Own rows only.** With the field user's session, `select * from shifts` in the API or from the browser client returns only that user's shifts. Repeat for `location_points` and `messages`. An admin session sees every row.
4. **Messages.** From the field user, open Messages. It is one chat. Send a note. Sign in as admin. The Messages button shows an unread count. Open it, tap that person, and reply. The field user's chat shows the reply, and the unread count clears after the chat is opened. Nothing is posted to GroupMe.
5. **Shifts page.** As admin, open `/shifts`. People who are clocked in right now are at the top. Tap a person. The page shows miles for the day and draws that person's points on the map. An appointment setter who opens `/shifts` sees an office-only notice.

`npm test` checks the Eastern day boundary, mile total, unread counts, and that the migration contains the consent notice.

### Lead files

`data/leads.json` and `source/` stay publicly readable in this change. The live map in cloud mode loads leads from Supabase, but local mode and **Initialize cloud data** still fetch `/data/leads.json` with a plain request. `data/leads.json` is about 3.7MB, close to the serverless response limit, so putting that file through a function can break the import. A follow-up can require a signed-in rep without changing the map pins:

- Stop serving `data/leads.json` and `source/*` as static files.
- Serve them from an authenticated function (or authorize in routing middleware and then continue to the file) using the same bearer-token check as `/api/field`.
- Send the session token on the local-mode fetch and on the admin import fetch.
- Leave `data/city-centers.json` and `data/manifest.json` public. They are map chrome, not the lead list.

## Test locally

```bash
npm start
```

Open http://localhost:4173

Cloud mode requires the Vercel environment variables. Without them, the app loads the supplied source data in local-device mode.


## v2.2 management / homeowner workflows

### New surfaces
- `/` — field map and route builder.
- `/setter.html` or `/setter` — authenticated Appointment Setter intake and clean inspection handoff.
- `/homeowner.html` or `/homeowner` — public homeowner inspection request form.
- `/admin.html` or `/admin` — gated management dashboard for approved admin/manager users.

### Admin access
Admin access is enforced by Supabase Auth plus an allow-list returned by `/api/config`, and then checked against an active `public.reps` profile with role `admin` or `manager`. The two approved email addresses are the default `ADMIN_EMAILS` and the bootstrap trigger. If either address is signed in and the `reps` row is missing, the app still treats that login as admin, the same way `reps_bootstrap_admin` does. Removing an address from `ADMIN_EMAILS` still blocks the Management screens. **Do not put the password in source control.** Add the first Auth user in the Supabase dashboard; the trigger writes the admin `reps` row.

Signed-in admins and managers see **Management** on the map header (desktop), at the top of the phone More menu, on My account as a **Management dashboard** card, and on the screen right after they sign in. Setters and sales reps do not. The card links open `/admin` already signed in: Accounts (`/admin#accounts`), Team & roles, Documents, Messages from the field, and Form library. The in-map command center also links to Accounts.

### Homeowner form
The public form submits through `POST /api/homeowner-signup`. The Vercel function writes a lead + homeowner intake + activity record using the server-only `SUPABASE_SECRET_KEY`, so the public browser never receives the secret key and does not need direct write access to the shared CRM tables.

### Setter workflow
Appointment setters sign in, record the homeowner and property information, capture what the homeowner actually said, schedule a specific inspection, select the salesperson, and save the handoff. The fields are based on the existing True North appointment-setter training: homeowner/contact details, property, reason/concern, other-contractor status, timing, exact homeowner context, appointment date/time, and useful handoff notes.

### Suggested Supabase Auth setup
1. Run `supabase/setup_all.sql` in the SQL Editor (or `schema.sql` first if you are applying files one at a time).
2. In Supabase Authentication → Add user, create `travisbishopmackie@gmail.com` or `truenorthrestorationss@gmail.com` with a password that stays out of git. The trigger creates the admin `reps` row. You do not paste a manual insert.
3. Create everyone else from `/admin` → **Accounts**.

## Photos and forms

Sales reps and admin/managers can attach photos to a house and add a note on each photo. Appointment setters do not get the photo bank. Reps and setters fill only the forms assigned to their role or to them by name. Two starter agreements ship as drafts for sales reps: **Closing / Deal Agreement** and **Contingency Agreement**. They are placeholders. Replace the wording with True North’s own agreements before a homeowner signs anything. An admin can also upload a PDF or image under **Documents** and assign it to all setters, all sales reps, or specific people. **Documents** on `/admin` groups intakes, forms, and roof photos by property. Search covers the homeowner, address, person, and form name. Filters cover document type, person, and new or reviewed. Each property opens one timeline, split into Today, This week, and Older.

### Setup

1. On a fresh project, paste `supabase/setup_all.sql` once. It already includes this step.
2. If the base schema and Cam’s clock-in migration are already applied, run `supabase/forms_photos.sql` after that migration. It creates `lead_photos`, `form_templates`, and `form_submissions`, turns on row-level security, and creates two private Storage buckets: `lead-photos` and `form-assets`. Then run `supabase/migrations/20261008_role_form_library.sql` so uploaded forms, per-person assignments, and photo-note edits are enforced in the database. Then run `supabase/migrations/20261008_document_review.sql` so management can mark a document reviewed. Do not apply either file from the app.
3. The browser uses the publishable key. Signed URLs stay private. Creating logins needs the server secret (see One-time setup).
4. Sign in on the field map, open a house, and use **Add Photo** or **Fill Form**. Add Photo opens the phone camera. Sales reps can also open `/rep`. Admins open **Documents** on `/admin` (also at `/files`). Paperwork is grouped by property with no manual filing.

### Who can see photos

- `salesperson`: photos on leads assigned to them, created by them (`leads.created_by`), or where they are the salesperson on the appointment or homeowner intake.
- `admin` and `manager`: every photo and every form submission.
- `appointment_setter` (and any older `canvasser` row): no photo bank. They can fill forms assigned to all setters, to both portals, or to them by name.

### Using it

- From a house sheet: **Add Photo** (camera), **View photos**, **Fill Form**.
- Forms walk one section per screen, prefill the homeowner name and address, and end on a saved screen with a printable copy.
- Form builder (admin): add a field, pick the type, move it with Up/Down, then **Preview as the rep sees it**. Field types: text, long text, number, date, checkbox, select, signature, photo.

## Accounts

Admins and managers create logins from `/admin` → **Accounts**: name, email, role, and an initial password. That calls `POST /api/accounts`, which uses the server secret to create the Supabase Auth user and the matching active `reps` row. The secret is never returned to the browser. The function checks the caller’s access token against an active `reps` row.

- An **admin** or **manager** can create, reset, turn off, and turn on appointment setters and sales reps. An older canvasser login can still be reset or turned off. New canvasser logins are not offered.
- Only an **admin** can create or change other admins and managers, and only an **admin** can use **Open as this user**.
- Turning a login off sets `reps.active` to false and bans the Auth user. Turning it on clears the ban. You cannot turn off your own login.
- **Open as this user** asks the server for a one-time magic link and shows **Copy link** and **Open in new tab**. Open that link in a private window so the admin’s own session stays put. Every open-as and every admin password reset is written to `public.account_audit` with the admin’s rep id and the time. Browsers cannot insert that table.
- **Activity, files, forms** on the same card lists that person’s recent `lead_activity`, photos, and form submissions.
- Every signed-in person changes their own password at `/account` (**My account**). That uses their own session (`auth.updateUser`) and does not use the secret key. The new password is 8 to 72 characters.
- **Forgot password?** on the map and admin sign-in screens calls `resetPasswordForEmail` and always shows the same confirmation. The email link opens `/reset-password`, which reads the recovery tokens from the URL hash and saves the new password with the same 8 to 72 character rule.

A database trigger also blocks a manager from promoting themselves to admin through the client. Service-role and SQL-editor writes are allowed, which is how the API and the first-admin bootstrap work.


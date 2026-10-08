# True North Roofing — Sales Command Center v2

## Brand + UX refresh (v2.1)

The command center now uses the internal True North training brand system: True North Navy `#132B3A`, Safety Orange `#E5722A`, Slate `#3E4E59`, and Field Gray `#F3F5F6`, with the training line “Inspect Honestly. Document Clearly. Earn the Job.” The brand guide describes the voice as local, straightforward, informed, low-pressure, and accountable.

UX upgrades include a map-first shell, branded compass mark, focus-map mode, keyboard shortcuts (`/`, `N`, `R`, `L`), live cloud refresh via Supabase Realtime, quick field-result actions, a persistent route tray, mobile field controls, richer priority/distance/territory metadata, toast feedback, and improved map controls.

The new `brand/compass-mark.svg` is an internal app mark created for the command center and is not presented as the company’s registered/external logo.

Map-first canvassing operations for Vercel. The supplied dataset contains **12,410 leads** (1,100 CSV + 11,310 Knox owner-occupied records).

## What changed

- Exact house-level pins once coordinates are geocoded.
- Smart next-house scoring using status, high-priority source, owner occupancy, property age, verified roof age, territory ownership, and distance from the rep.
- Route optimizer (nearest-neighbor + 2-opt) with a selectable driving/walking mode and Google Maps handoff in navigation blocks.
- Shared Supabase live state for lead status, assignments, notes, appointments, activities, reps, and territory ownership.
- Territory ownership by city/market.
- Heat layers for lead density, opportunity score, and roof-age proxy / verified roof age.
- Active storm alerts from the National Weather Service. This is a **current warning layer**, not a historical hail-damage archive.
- Appointment handoff queue for salesperson transfer.
- 7-day canvasser leaderboard based on recorded field activity.
- Admin/manager tools to seed the 12,410 source rows, initialize territories, run batch geocoding, load storm alerts, and export lead state.
- Local device fallback is retained for testing, but it is not shared between reps.

## Cloud setup

1. Create a Supabase project and run `supabase/schema.sql` in the SQL Editor.
2. Enable Email/Password authentication in Supabase Auth and create each team member's user account.
3. Add matching rows to `public.reps` with each Auth user's UUID and a role (`admin`, `manager`, `canvasser`, `salesperson`).
4. In Vercel Project Settings → Environment Variables, add:
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY` (the browser-safe publishable key)
   - `SUPABASE_SECRET_KEY` (server-only; never put this in client code)
5. Redeploy. Vercel environment-variable changes apply to new deployments.
6. Sign in as an admin/manager and open **Admin** → **Initialize cloud data**.
7. Run **Initialize territories**.
8. Run **Geocode missing house pins**. The app processes the addresses in small authenticated batches and stores the returned coordinates in Supabase. The Census geocoder's current batch API accepts up to 10,000 records per file; this app uses 500-record chunks to keep each serverless request bounded.

## Data truth notes

The source PDF supplies construction year for the Knox owner-occupied set, not the date the roof was last replaced. The map therefore labels construction-year visualization as a **roof-age proxy** unless a verified `roof_age_years` value is entered by the team.

The NWS layer shows currently active Ohio weather alerts filtered to storm/wind/hail/tornado-related products. It does not assert that a particular property suffered storm damage.

## Vercel architecture

This remains a static-first site, with Vercel Functions only for `/api/config`, `/api/geocode`, and `/api/storms`. Supabase is the shared database/auth layer. The server-only Supabase secret is used only to validate authenticated requests to the geocoding endpoint.

## Clock in, location, and office messages

Setters, canvassers, and sales reps get a large green **Clock In** button on the field map and on setter intake. On a phone it stays fixed at the bottom of the screen so it can be reached with a thumb. After clock-in it turns red, says **Clock Out**, and shows a running timer. The first clock-in shows a short location notice with one **Got it** button. A point is stored at clock-in, clock-out, and each door-status change during that shift. The browser is not asked to track in the background.

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

Use two Supabase users: one `canvasser` (or `appointment_setter` / `salesperson`) and one `admin` or `manager`, each with an active `public.reps` row.

1. **Clock in.** Sign in on `/` or `/setter` as the field user. Tap the green Clock In button. The first time, the location sheet appears. Tap Got it. Allow the browser location prompt. The button turns red, says Clock Out, and the timer starts. In Supabase, `location_consents` has one row for that rep, and `shifts` has an open row whose `rep_id` matches them.
2. **Door point.** While clocked in, mark a door status on the map (Knocked, No answer, and the other field buttons). `location_points` gains a `door_status` row. Clock out. A `clock_out` point is stored and `clock_out_at` is set. Mark another door after clock-out and confirm no new point is written.
3. **Own rows only.** With the field user's session, `select * from shifts` in the API or from the browser client returns only that user's shifts. Repeat for `location_points` and `messages`. An admin session sees every row.
4. **Messages.** From the field user, open Messages. It is one chat. Send a note. Sign in as admin. The Messages button shows an unread count. Open it, tap that person, and reply. The field user's chat shows the reply, and the unread count clears after the chat is opened. Nothing is posted to GroupMe.
5. **Shifts page.** As admin, open `/shifts`. People who are clocked in right now are at the top. Tap a person. The page shows miles for the day and draws that person's points on the map. A setter or canvasser who opens `/shifts` sees an office-only notice.

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
- `/` — field map / canvasser command center.
- `/setter.html` or `/setter` — authenticated Appointment Setter intake and clean inspection handoff.
- `/homeowner.html` or `/homeowner` — public homeowner inspection request form.
- `/admin.html` or `/admin` — gated management dashboard for approved admin/manager users.

### Admin access
Admin access is enforced by Supabase Auth plus an allow-list returned by `/api/config`, and then checked against an active `public.reps` profile with role `admin` or `manager`. The two approved email addresses requested for the project are included as the default allow-list values in `ADMIN_EMAILS`. **Do not put the password in source control.** Create the two Supabase Auth users with the password provided by management, then attach their user IDs to `public.reps` with role `admin`.

### Homeowner form
The public form submits through `POST /api/homeowner-signup`. The Vercel function writes a lead + homeowner intake + activity record using the server-only `SUPABASE_SECRET_KEY`, so the public browser never receives the secret key and does not need direct write access to the shared CRM tables.

### Setter workflow
Appointment setters sign in, record the homeowner and property information, capture what the homeowner actually said, schedule a specific inspection, select the salesperson, and save the handoff. The fields are based on the existing True North appointment-setter training: homeowner/contact details, property, reason/concern, other-contractor status, timing, exact homeowner context, appointment date/time, and useful handoff notes.

### Suggested Supabase Auth setup
1. In Supabase Authentication, create the two approved management users using the exact admin emails in `ADMIN_EMAILS` and the management password.
2. Copy each Auth user's UUID.
3. In SQL Editor, run: `insert into public.reps(user_id,name,email,role,active) values ('UUID','Name','email','admin',true);`
4. Run the expanded `supabase/schema.sql`.

## Photos and forms

Sales reps and admin/managers can attach photos to a house. Appointment setters and canvassers do not get the photo bank. Reps and setters fill forms that an admin assigns to their portal. Two starter agreements ship as drafts: **Closing / Deal Agreement** and **Contingency Agreement**. They are placeholders. Replace the wording with True North’s own agreements before a homeowner signs anything.

### Setup

1. In the Supabase SQL Editor, run `supabase/schema.sql` if you have not already.
2. Run Cam’s clock-in migration, `supabase/migrations/20261008_access_clockin.sql`, if it is not already applied.
3. After that migration, run `supabase/forms_photos.sql`. That file creates `lead_photos`, `form_templates`, and `form_submissions`, turns on row-level security, and creates two private Storage buckets: `lead-photos` and `form-assets`.
4. No new Vercel environment variables are required. The browser uses the existing publishable key. Signed URLs stay private.
5. Sign in on the field map, open a house, and use **Add Photo** or **Fill Form**. Add Photo opens the phone camera. Sales reps can also open `/rep`. Admins manage everything under **Files & Forms** on `/admin` (also at `/files`).

### Who can see photos

- `salesperson`: photos on leads assigned to them, created by them (`leads.created_by`), or where they are the salesperson on the appointment or homeowner intake.
- `admin` and `manager`: every photo and every form submission.
- `canvasser` and `appointment_setter`: no photo bank. They can fill forms assigned to setters or to both portals.

### Using it

- From a house sheet: **Add Photo** (camera), **View photos**, **Fill Form**.
- Forms walk one section per screen, prefill the homeowner name and address, and end on a saved screen with a printable copy.
- Form builder (admin): add a field, pick the type, move it with Up/Down, then **Preview as the rep sees it**. Field types: text, long text, number, date, checkbox, select, signature, photo.


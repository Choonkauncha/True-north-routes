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

## Test locally

```bash
npm start
```

Open http://localhost:4173

Cloud mode requires the Vercel environment variables. Without them, the app loads the supplied source data in local-device mode.

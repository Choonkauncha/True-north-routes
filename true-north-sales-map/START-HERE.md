# True North — updated release

## Install in this order

1. Back up the existing Supabase database and retain the previous app release for rollback.
2. For an existing installation that has the previous complete setup: run `supabase/upgrade_integrity.sql` in the Supabase SQL Editor. For a new project: run `supabase/setup_all.sql`. Apply the database changes before publishing this app. The new transactional saves depend on these RPCs and intentionally do not fall back to partial multi-step writes.
3. Publish the `true-north-sales-map` directory as the Vercel project root, retaining the existing Supabase and Gemini environment variables. This package does not contain credentials.
4. Verify sign-in, required password change, management assignments, staff inspection booking, public homeowner request, and training save on your installation.

This release was tested locally with synthetic browser fixtures and PostgreSQL-compatible database execution. Live production Supabase, routing providers, geocoding, email delivery, weather and Gemini voice were not exercised with your credentials. No production deployment or database migration has been performed.

## Map workflow

- Search an address or ZIP; the Addresses tab shows addresses first, with homeowner information secondary.
- Select individual addresses or open Route → Add stops to choose visible homes, draw an area, or choose homes in a storm area.
- Choose Drive or Walk and the maximum stop count; click Build route.
- Review the built stops and distance, then Start navigation or open Google Maps. Changing selections, mode, or maximum stops clears the previous route; build again before navigating.
- Map options groups filters, layers, weather and map controls. Work groups account, shifts, messages, training and management actions by role. Clock In remains available in Work.
- Phone layouts use a map with an expandable address/route sheet. Addresses returns to a half-height sheet so the map stays visible.

## Domain fixes

| Area | Changes |
| --- | --- |
| Identity | Password readiness enforced server-side and in operational database access; reliable password recovery, fail-closed feature access, safer account provisioning/reset/deactivation and audit warnings. |
| Maps | Verified sessions before private cache access, account/project cache isolation and logout cleanup, valid geocode results, honest coordinate provenance, correct walking provider, stale-route invalidation. |
| Field | Public requests append without trusting supplied lead IDs; Eastern-time scheduling; atomic intake/appointment/activity and form-assignment saves; photo upload compensation; configured cloud failures surfaced. |
| Coach and training | Paused audio suppression, close/timeout cleanup, atomic metadata/assignment saves, archived lessons preserve history, independent poster failures and unavailable progress states. |
| Database | Repeatable setup includes omitted repairs; active/password-ready operational access; transactional saves and service-only public-intake RPC. Existing address/source files are unchanged. |
| Interface | Map-first desktop and phone layout, grouped sibling controls, address-first lists, visible route readiness/navigation actions and viewport-safe menus. |

## Provider configuration

Driving defaults to `https://router.project-osrm.org`; walking uses `https://routing.openstreetmap.de/routed-foot`. Optional server environment variables `OSRM_DRIVING_BASE_URL` and `OSRM_WALKING_BASE_URL` point to compatible providers. Choose providers appropriate to production volume; the public foot server documents a maximum of one request per second at https://routing.openstreetmap.de/about.html. If routing fails, the UI labels its approximation as straight-line and does not claim road-network optimization.

## Checks

Run `npm ci`, then `npm test`. Browser checks require Playwright Chromium: `npx playwright install chromium`, then `npm run test:ui`. The UI fixtures use synthetic addresses and mocked services. `npm run build:vendor` rebuilds the included same-origin Supabase browser SDK from the lockfile. `node scripts/database-integrity.test.mjs` verifies the database setup and transactions. Preserve `.vercelignore`: original private lead/source files are included for local validation and must not be served by the public deployment.

See `docs/ui-ux-audit.md` for the earlier interface inventory; this release's map behavior and installation instructions take precedence over older workflow descriptions.

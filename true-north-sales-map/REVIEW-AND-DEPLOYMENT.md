# Route retap and application review — October 13, 2026

## Changes

- Tapping a house adds it; retapping removes it. The count, checkbox, pin color, numbered badges and saved route update together. Address details remain available from the address list. Read-only route taps open details.
- Removing the final house clears its numbered marker. A routing response for an older selection cannot restore removed stops or outdated route geometry. Distance/time are marked stale until re-optimization.
- Popup, list, area, visible-house and clear-route actions respect view-only mode. Choose Edit explicitly before changing another person's route. Undo also checks edit permissions.
- Storm-area selections now persist through the same saved-route path.
- Null, blank and out-of-range coordinates cannot become stops during route edits.
- Account actions retrieve the current session before sending their request, avoiding an expired cached token after an idle dashboard.
- The archive migration no longer requires session_ready() and handles older installations without impersonation tables.
- The assigned-route migration uses route-specific permission helpers instead of replacing shared password/session guards. Fresh setup now includes assigned routes.

## Existing Supabase database

No database change is required for tap-to-remove itself. For the database fixes, apply these updated files in order in Supabase SQL Editor:

1. `supabase/migrations/20261010_integrity_access.sql` — restores global session guards if an older assigned-route migration replaced them; requires the application's existing base schema.
2. `supabase/migrations/20261011_assigned_routes.sql` — route-local access checks, preserving global guards.
3. `supabase/migrations/20261012_account_archive.sql` — compatible archive setup.

These scripts configure functionality; they do not invoke profile deletion. Use `supabase/setup_all.sql` for a fresh installation. Deploy the `true-north-sales-map` folder after applying applicable SQL. No additional serverless function or environment variable is introduced.

## Verification

- Full npm test suite, including API permissions, account deletion/rollback, SQL setup reruns, routing, training, data integrity and Gemini Live transport.
- Real Chromium touch and mouse tests: add, retap remove, clear numbered badges, saved route updates, add Undo, view-only pin/popup protection and admin assignment.
- Built-route browser checks: removal retains other stops and updates employee route drafts.
- Delayed-response regression: removal during optimization cannot be undone by a late network response.
- Account browser checks: other-admin protection, deletion, three-dot archive, password visibility and creation-error recovery.
- Responsive map smoke at 320, 390, 768, 844 and 1440 widths, navigation, forced-password recovery, plus desktop/mobile voice Coach flows.

Browser fixtures use synthetic accounts/data and mocked backend responses; SQL tests run in embedded PostgreSQL. No production users, Supabase records or Vercel deployment were modified. This review does not verify live provider credentials or production database state.

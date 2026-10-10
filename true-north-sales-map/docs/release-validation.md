# Release verification — 10 October 2026

- `npm test`: all 56 test scripts passed, including the full database setup/rerun, session authorization/recovery, atomic intake rollback, inactive assignee rejection, account safety, cache privacy, route building and Coach lifecycle.
- Map-first browser checks passed at 320×568, 390×844, 768×900, 844×390 and 1440×900. Synthetic fixture tests exercised grouped controls, viewport-safe Work menu, stop selection, route build, navigation, stale-route cleanup and required password recovery back to verified map.
- Focused Coach browser checks passed, including voice start/pause/resume/stop, lesson save retry, responsive layout and selected-tab retention during permission checks.
- Original uploaded setup upgraded successfully using `supabase/upgrade_integrity.sql`; running the upgrade a second time also succeeded. Public/staff intake and forced late appointment rollback passed against the upgraded original schema.
- All five original data/source files remain byte-for-byte identical to the uploaded ZIP. No address records were transformed for this redesign.
- Application JavaScript syntax checks passed. Browser Supabase SDK is included at a fixed lockfile version and served from the application origin.

## Limits

Browser tests use synthetic addresses, mocked authentication, routing, weather and voice services. PostgreSQL-compatible PGlite tests exercise SQL behavior with an Auth/Storage scaffold. They do not replace a live Supabase deployment check. Map tiles and external providers were not verified end-to-end in production. No production deploy, database migration, email, credential rotation or live Gemini call was performed.

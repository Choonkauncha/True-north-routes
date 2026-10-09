# Feature access rollout

Apply `supabase/migrations/20261009_feature_permissions.sql` after the existing Supabase setup, then open Management → Feature access as an admin. There is one persistent switch per field feature for appointment setters and sales reps. Managers retain access but only admins change switches. Existing ownership and audience rules remain in effect.

Before the migration, the app retains its existing access rules and the management panel shows a setup notice instead of pretending to save switches.

Protected database and storage access is enforced by restrictive policies. Coach text and Gemini Live token issuance also check feature access. Page navigation and field tools refresh permissions on sign-in, returning to the app, and Realtime updates. Already downloaded files, public weather/road routing services, public static lead data, and an already-issued Gemini Live session cannot be revoked by these switches. Routes and weather are UI availability controls. Account access can be switched off; the unavailable page always offers sign-out.

The current Coach already contains the WebGL orb and real microphone/output audio-level wiring; this update preserves it.

# Voice Coach configuration

Coach is voice-to-voice only. Configure GEMINI_API_KEY in Vercel (Production and any Preview environment you use) and redeploy. The current model default is gemini-3.8-live and the voice default is Kore.

Apply supabase/migrations/20261009_coach_settings.sql after setup_all.sql. The migration creates one shared team prompt, with active-user read access and admin-only writes. Rerunning it preserves the saved prompt. No migration is needed for the built-in assistive prompt or automatic spoken introduction.

Admins open Management → Coach settings to edit the system prompt for appointment setters and sales reps. Use default prompt loads the preconfigured guidance; Save applies it to new sessions. End and restart an existing session to reload settings. Core privacy and truthful-coaching instructions remain active alongside company guidance. The server also supplies the signed-in user's permitted personal context; field users cannot choose another user's identity or a custom prompt.

After Gemini confirms setup and microphone permission is granted, the browser sends one internal welcome instruction with turnComplete enabled. It is not displayed as a user message. The Coach introduces itself aloud, uses the user's first name and role context, and asks one focused question. Automatic speech detection allows the user to interrupt the Coach; queued playback is stopped when Gemini reports an interruption.

If Google rejects token creation, Coach distinguishes invalid keys, access restrictions, exhausted quotas, and rejected model/session configuration without exposing credentials. A generic browser 502 line alone is insufficient to identify the cause; inspect the error shown in Coach or the response to /api/live-token.

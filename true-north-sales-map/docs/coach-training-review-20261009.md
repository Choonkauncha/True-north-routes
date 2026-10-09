# True North Coach and reliability review

Prepared October 9, 2026 against `main` at `ae53761bec6d33172f0522780ecc7bfded8c5a02`. The owner approved committing and pushing this cumulative review on October 9. It builds on the earlier UI review; do not apply older proposal patches a second time.

## Priority fixes

| Finding | Prepared change | Validation |
| --- | --- | --- |
| Training could report completion before a failed save was confirmed; simultaneous saves could overwrite progress. | Serialize immutable writes per user/lesson, confirm success before displaying completion, keep failed drafts within the current tab/account, and atomically preserve the highest progress/completion across stale tabs through the included Supabase migration. | Training-save/progress tests, two-independent-saver coverage, and browser completion-save failure/retry. |
| Late media downloads or player events could affect another lesson. | Guard lesson/view identity, stop playback and listeners on exit, release stale PDF/deck resources, and wait for PDF page navigation. | Focused lifecycle simulations, regression tests, and image-lesson browser flow. |
| Property photos could disappear beneath a global photo limit, and excessive URL signing slowed galleries. | Filter by property before pagination; load 24 photos per property page and management indexes as metadata; sign only the opened property/visible photos with four concurrent calls. Add loading/error/retry/older-photo states, lazy images, and keyboard-friendly lightbox. | A fixture with 620 unrelated newer photos and 53 older property photos; metadata-first, subset-signing, legacy/local/read-error/concurrency tests. |
| A slower Shifts response could replace a more recent day or rep selection. | Latest-request ownership and auth invalidation; preserve date controls during loading/errors; provide Retry; tear down stale map timers. | Out-of-order success/error, session replacement, signout, retry tests. |

## Coach and navigation

Training now has two keyboard-accessible tabs: My Coach and My lessons. The Coach automatically reads the authenticated active user's permitted records, using the user's token and database row-level security. It adapts its greeting, role guidance and next step to recent field activity, assigned/current leads, upcoming inspections, training progress, photos, forms, shifts and authored-message counts. Unavailable reads remain unknown; capped counts are marked as lower bounds. A refresh control and automatic refresh after returning from a lesson keep the context useful.

The Coach has a positive, practical True North communication and sales persona. It offers a next-step plan, an opener, an objection response, and a confidence reset. A short practice round walks through an introduction, respectful objection handling, and a clear next step. It gives qualitative feedback on the user's actual draft, supplies examples, and lets the user retry. Practice does not complete training or write app records.

The compact interface uses the existing graphite/mint design, a local compass mark, plainly named controls, readable conversation text and collapsed profile details. Lesson cards now have media icons or real posters, saved progress and clear Start/Continue/Review actions. Mobile route controls retain travel mode and the four frequent actions; secondary area/navigation tools live under More route tools without losing their existing handlers.

The Coach now also includes an optional Gemini Live voice panel. Start live voice from the Coach card, speak naturally, pause/resume the microphone, and end the session without changing records. The server authenticates the signed-in user, rate-limits token minting, builds the same permitted personal context, and provisions a one-use ephemeral Gemini token. The browser uses Google’s constrained Live WebSocket endpoint, waits for `setupComplete`, and connects with that short-lived token; the long-lived Gemini key never enters browser code. Startup can be cancelled safely, leaving Coach/refresh/signout tears down the microphone, interruptions stop queued playback, and provider errors remain visible. Audio is captured as mono 16-bit PCM at 16 kHz and Gemini audio is scheduled as 24 kHz PCM, with input and output transcript text shown in the panel. The UI discloses Google processing before Start. The text Coach remains available when the Gemini key, browser microphone, quota or network is unavailable.

## Data and model boundaries

The server derives identity from the bearer token; it does not accept a client-selected user, profile, model or system instruction. Password-gate checks fail closed. Even management snapshots exclude teammates' records. Contact details, message contents, exact location trails and private activity metadata are excluded from the model profile. Responses are private/no-store. User/model text renders as text, not executable HTML. Conversation and failed drafts are account-scoped in memory and clear on account change/signout.

The installed AI SDK is 7.0.136 and requires Node.js 22 or later. Set the server-only AI_GATEWAY_MODEL to a current supported model and provide AI_GATEWAY_API_KEY or a supported Vercel OIDC runtime connection to enable open-ended AI replies. Existing SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY) provide authenticated app access; no service-role key is used by this feature. Do not put model credentials in browser configuration. No credentials or Vercel settings were changed. Without model configuration, personalized guided replies and the practice round work through the authenticated server.

For Live voice, set the server-only GEMINI_API_KEY. Optional GEMINI_LIVE_MODEL defaults to `gemini-3.8-live`; optional GEMINI_LIVE_VOICE defaults to `Kore`. The Live API is a preview service and its model availability and quotas can change. A generous free quota is useful for development, but it is not treated as a guaranteed production limit; configure the Google project quota and spend controls before broad use.

Requests accept at most 14 KB and six bounded history turns. The instance-local limiter permits six ordinary messages and twenty practice actions per minute, with one in-flight reply per user. Practice skips activity reads and paid model calls. The limiter is not a global production quota across instances. Configure provider budgets/shared limits before enabling broad usage if needed.

## Evidence and limits

All 38 non-browser regression scripts pass, including 18 Coach API/personalization cases, Gemini token constraints, constrained-endpoint/setup ordering, cancellation, PCM framing, monotonic training saves, metadata-first photo loading, and Shifts race handling. The browser suite and its successful Shifts fixture pass syntax validation, but could not be rerun after the last refinements because the isolated Chromium executable became corrupted and segfaulted even for `--version`. The prior full synthetic browser run passed 275 control visibility, viewport, hit-target and touch-size checks; production verification should still include a fresh browser/device pass. These tests use synthetic accounts/data; no production records were written.

Fresh GitHub verification on October 9 shows main still at ae53761bec6d33172f0522780ecc7bfded8c5a02. Its Vercel commit status is success; there are no GitHub check runs or main Actions runs returned. See https://github.com/Choonkauncha/True-north-routes/commit/ae53761bec6d33172f0522780ecc7bfded8c5a02 and https://vercel.com/relaxxx/true-north-sales-map-vercel/3rvRW9NhEd2zZJMQdnzbYSCdojbG.

The Vercel project lookup returned 403 for the relaxxx team. GitHub’s Vercel commit status is therefore used for release monitoring, while direct project settings, build/runtime logs, and environment values remain unavailable. Live Supabase account/RLS behavior, migration application, a real Gemini Live microphone session, provider playback and production quotas remain unverified. API/profile behavior was exercised with real handler code and mocked services. Unsaved training and Coach drafts survive navigation within this tab, but not a full reload or tab closure. Photo pagination uses ordered offsets with ID deduplication; concurrent insertions can shift offsets.

## Review and application

The cumulative change is based on the verified main SHA and includes the earlier Atlas/navigation, cache-sync and route-API work as well as these refinements. The included `20261009_training_progress_monotonic.sql` migration must be applied to the connected Supabase project for cross-tab monotonic progress protection to take effect in production.

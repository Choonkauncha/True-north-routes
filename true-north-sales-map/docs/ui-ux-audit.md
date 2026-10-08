# True North UI/UX review and implementation

Reviewed against main through `f388ea7`, including the unified inspection flow, assigned handoffs, receipt uploads, and locally vendored training media modules.

## Design direction

A shared field and office workspace with navy navigation, blue primary actions, a quiet canvas, readable white cards, consistent controls, and visible focus. Keep the field map task-oriented; make management prioritize unresolved work; give each role a useful starting point. The app remains static vanilla JavaScript with its existing Vercel APIs and Supabase authorization.

## Surface inventory

| Surface | Features reviewed | Implemented treatment |
|---|---|---|
| Field map `/` | Address search, filters, priority list, next house, property drawer, status buttons, territories, layers, weather, storm reports, area selection | Clearer search/control hierarchy, wider readable property list, new next-stop styling, restrained overlays, consistent controls, skip link |
| Routes | Selected homes, driving/walking, optimizer, route tray, navigation provider chooser, navigation progress, list sheet | Clear primary build/start actions, compact persistent tray, readable stop cards, responsive layout, keyboard containment and return for dialogs |
| Inspection `/setter` | Auth, homeowner/property fields, concern/context, scheduling, salesperson, consent, prefilled lead, API save | Section navigation, larger fields, readable role names, escaped rep options, Eastern-day metrics, persistent success, duplicate guard, explicit New inspection reset |
| Legacy `/homeowner` | Old entry link | Retains the latest main redirect to the unified authenticated inspection form |
| Management overview `/admin` | Team metrics, appointments, activity | Readable metric cards, Eastern day boundaries, refresh timestamp, future open inspections, actionable new/unassigned/past-due queues |
| Management team | Role/search filters, weekly activity, login creation entry | Clear 7-day period, readable responsive tables, 100-row incremental rendering |
| Management appointments/homeowners/activity | Search, stage/status/person/action filters, handoff context | Debounced filters, counted pagination, preserved person selection, focus notice with reset for attention queues |
| Management territories | Owner/role, lead and mapped counts | Indexed lookups instead of repeated lead scans, consistent table styling |
| Management accounts | Create login, role/status, reset, activate/deactivate, must-change flag, impersonation, activity | Collapsible creation form, avatar/profile cards, search/role/status filters, counts, draft preservation while filtering, clearer action hierarchy |
| My account `/account` | Role/profile, shortcuts, training progress, password confirmation, sign out | Role-specific hero and action grid, separate field/management/security sections, consistent cards |
| Sales photos `/rep`, `/photo` | Property search, gallery, photo upload/caption/notes, signed image URLs | Clear property-search entry, improved empty state/cards, stale search response guard, encoded navigation parameters, consistent upload controls |
| Forms `/forms` | Role/person assignments, property linkage, drafts, submitted forms, signatures | Shared navigation, readable form fields, clearer segmented state, consistent sticky save area |
| Documents `/files` and management tabs | Property timelines, review state, type/person filters, folders, estimates/receipts, form upload/builder | Shared hierarchy, spacing, filters, tables/cards, consistent controls and mobile navigation |
| Training `/training` and embedded sections | Role filters, content cards, progress, video/PDF, management uploads | Readable content cards, clearer selected filter, consistent media/assignment controls; retains latest CDN import fix |
| Shifts `/shifts` | Active shifts, person/day selection, point map, miles | Shared office layout, legible controls/cards, responsive map layout |
| Clock and messages | Consent sheet, clock in/out, timer, unread count, office thread/list | Visible controls on white headers, consistent button sizing, dialog focus containment, Escape where a close control exists |
| Password reset `/reset-password` | Recovery session, password validation, required-change gate | Consistent readable authentication styling; existing reset and gate logic retained |
| Print `/form-print` | Completed form print output | Shared visual defaults with explicit print rules that remove workspace chrome |

## Role behavior

| Profile | Starting point | Existing permissions retained |
|---|---|---|
| Appointment setter / legacy canvasser | Find property, book inspection, leave context, training and forms | No photo bank or Management dashboard |
| Sales rep | Property photos, assigned handoffs, inspection, forms, training | Assigned handoff edit/upload restrictions remain enforced by existing helpers and policies |
| Manager | Field tools, photos, training, account security | Existing manager capabilities remain; Management dashboard itself is still admin-only |
| Admin | Overview attention queues, team/accounts, documents, messages, training | Existing allow-list and restrictions on managing other admins remain |

## Performance and interaction changes

- Fetch management datasets concurrently; select only lead columns used by management.
- Build lead/rep/city indexes once per refresh.
- Render the active management view; add 100 rows at a time to large lists.
- Debounce typing; coalesce realtime events; serialize overlapping refreshes and reuse cached leads unless leads changed.
- Keep account creation input while filtering people.
- Keep the successful inspection visible until New inspection; disable repeated saves and disable reset while saving. A metrics refresh cannot turn an already saved inspection into a save error.
- Use visible focus, associated labels, live save feedback, mobile menu keyboard support, and reduced-motion/print overrides.

## Verification

`npm test` passes all 29 regression scripts, including dashboard index, queue, missing-date, Eastern DST, and tutorial coverage checks. The inspection, handoff, receipt, permission, and training import tests from the newer main commits remain included.

`npm run test:ui` passes with an isolated fixture server and the real Supabase browser client using synthetic sessions and data. It verifies management pagination/attention queues, profile filters and all four roles, creation draft preservation, the inspection request and success/reset/duplicate guard, mobile menu keys, dialog keys, and page layout widths of 320, 390, 768, 1024, and 1440. It completes desktop and mobile tutorials, including selected property photo capture/preview, a training lesson, a saved print record, fullscreen navigation, and sign-in after logout. It checks guide bounds, closing/focus return, retained drafts, and restored collapsed sections. Screenshots go to `.ui-artifacts/`.

Run it with:

```sh
npm ci
npx playwright install chromium
npm run test:ui
```

For an existing Chromium installation, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. `PLAYWRIGHT_CHROMIUM_ARGS` accepts a JSON array for container-specific launch arguments. The preview never creates production users or writes production records.

## Verification limits and existing follow-ups

- No production credentials were provided. Live Supabase RLS, storage uploads, realtime delivery, geolocation, weather/storm availability, training media transcoding, email/password recovery delivery, and real external navigation still need a connected staging check.
- The reps SQL grant test reports source checks only when local Postgres is absent.
- Current management queries retain the pre-existing 5,000-activity and 3,000-intake windows. Counts describe the loaded window; server aggregates and cursor pagination would be a separate scaling change.
- Static lead/source files remain public as documented in the existing README. This redesign does not change the data-access model.
- Old README passages describe a public homeowner form and managers opening Management. Current code redirects that legacy form to inspection intake and restricts Management to allowed admins; this review follows current code.
- The shared stylesheet intentionally loads last to avoid disrupting the existing business modules. Longer-term CSS consolidation can remove old overridden styles separately.


## Latest 20 live updates preserved

The combined release retains these updates from main. The verification column distinguishes source/regression checks from browser preview checks; production deployment and live service behavior were not asserted.

| Update (ET) | Combined release | Verification |
|---|---|---|
| 3:55 — fullscreen, following, heading-up navigation | Retained navigation/bearing/GPS logic; workspace chrome yields to fullscreen | Navigation regression tests and fullscreen layout/tutorial preview |
| 3:53 — training upload permission fix | Retained `20261008_training_upload_rls.sql` | Migration source retained; live policy application not re-run |
| 3:48 — branded loader, opaque logout sign-in, collapsible panels | Retained loader/auth modules and collapse helper; reconciled profile templates | Loader/collapse tests and browser preview |
| 3:41 — training upload module resolution | Retained locally vendored media modules | Training CDN import regression |
| 3:33 — unified inspection, handoff permissions, sales receipts | Retained authenticated inspection API and existing handoff/receipt rules | Inspection/handoff/receipt tests; inspection request preview |
| 2:50 — own password, locked admin owner, admin-only Management | Retained access, password gate, and account action rules | Account/role/password gate tests |
| 1:58 — collapsible map controls and drawn route areas | Retained map popovers, list/route controls, area-drawing logic | Map layer, area-route, route tests |
| 1:53 — role training and practice | Retained assigned training and progress modules | Training progress tests and tutorial preview |
| 1:50 — road-ahead navigation zoom | Retained navigation camera behavior | Navigation motion tests |
| 1:37 — pins before sync completes | Retained static-first lead loading and incremental sync | Lead cache/sync and map tests |
| 1:32 — still logo with tracing outline | Retained branded mark and reduced-motion behavior | Loader screen tests |
| 1:26 — phone navigation and transitions | Retained motion and transition modules | Navigation tests and phone preview |
| 1:18 — inspection folder/live DB rule | Retained existing record helpers and folder rules | Records tests |
| 1:16 — management Document Library and message alerts | Retained role checks and field message modules | Role/records/field rules tests; live notifications not sent |
| 12:56 — folders, receipts, estimates in My forms | Retained existing form/record modules | Records tests and page preview |
| 12:40 — 17,000-house map performance | Retained canvas pins, chunks, cached leads, incremental overlays | Dataset validation: 17,232 records; cache/sync tests |
| 12:40 — weather and storm areas | Retained feeds, layer controls, and storm area selection | Weather/storm/layer tests; live feeds not asserted |
| 12:40 — field roles, property documents, admin profiles | Retained access helpers; redesigned role presentation | Role tests and four profile previews |
| 11:45 — collapsible phone route panel and loading cover | Retained route state and branded map cover | Route tray/loader tests and responsive preview |
| 11:35 — removed Qualify honestly section | Retained current unified setter form; no such section reintroduced | Current setter markup reviewed |

## Per-page annotated tutorials

The ? button opens a guide specific to the current page, signed-in tools, and open management section. Each step has a numbered highlight on the real control and a readable card with instructions, Back, Next/Done, and Close. Escape closes; keyboard focus stays within the guide and returns to Help on exit. No blur is used. Background controls are temporarily inert so the guide cannot accidentally submit a form or click a destructive action.

A guide can temporarily reveal a collapsed section, then restores that section on exit without changing its saved preference or form values. Phone tutorial controls stay at the bottom while the highlighted section expands or scrolls. Clicking an inspection section shortcut expands it, and form validation reveals a collapsed required field before focusing it. The legacy homeowner URL redirects to the inspection page, whose tutorial covers that flow. Tutorials and help buttons are hidden in printed output.

# True North Routes UI/UX revamp — review proposal

Prepared October 9, 2026 against `main` at `ae53761bec6d33172f0522780ecc7bfded8c5a02`.

This cumulative change makes the field map and office pages easier to navigate while retaining their permission rules, forms, map tools, and data flows. The owner approved committing and pushing it on October 9, 2026; no Vercel settings are changed by the code.

## Navigation and presentation

The existing interface spread navigation between the workspace rail, page header, mobile action bar, management rail, and More menu. The proposal builds on the earlier Atlas design with a consistent graphite and mint theme, local SVG icons, clearer page introductions, and role-specific account cards. A searchable page dialog provides Ctrl/Cmd+K access to permitted pages. Management users can search directly for appointments, accounts, homeowner requests, activity, territories, and documents. The dialog reads existing permission-aware navigation; it does not grant additional access.

The mobile workspace menu now exists on Management, and permitted shift navigation is included. Menu links close the drawer. Keyboard dismissal returns focus to the originating control. Dynamic management tabs receive accessible panel associations. The prior Atlas files were selectively integrated into current main; older map/cache implementation files were not copied over newer fixes.

## Findings and edits

| Finding | Prepared change | Evidence |
| --- | --- | --- |
| Filters relied on an icon; Legend and Fit leads disappeared at some widths. | Name Filters and Legend explicitly and keep Filters, Legend, Fit leads, and Layers reachable on narrow screens and tablets. | Browser visibility, viewport bounds, center hit, and touch-height checks across seven map sizes. |
| More could overflow the left edge at 320 px and sit behind the mobile action bar. | Bound the menu to the viewport, give it scrollable height and the correct stacking context. Include map focus and sign out via existing handlers. | More action checks and Escape/focus checks on phones and tablets; dedicated More regression test. |
| An expanded Layers menu could sit behind the route tray. | Lift only the open popover's stacking context; close competing popovers; synchronize Layers `aria-expanded`; support Escape and focus return. | Layers toggle, checkbox, Filters reset, mutual exclusion, and hit tests. |
| Dialogs and route controls could exceed short viewports, and small buttons were difficult to tap. | Scroll bounded dialogs, route trays, and popovers; wrap actions; use at least 44 px button height; retain print overrides. | Visible content buttons checked on ten pages at 390/1440 px; map landscape checked at 844×390. |
| Tile refresh could show a full cover over already usable map controls. | Preserve initial loading presentation; later refresh uses a compact pointer-transparent indicator. | Map interactions continue during resize/refresh without a covering element intercepting hits. |
| Empty routes could expose unusable actions; final-stop removal left stale state. | Disable unavailable optimization, navigation, and Google actions; clear the route when its final stop is removed; name stop-removal buttons by address. | Browser selection, optimization, individual stop removal, final-stop removal, empty-state, and Clear route flows. |
| A delayed route response could restore a cleared or superseded route. | Ignore stale route responses with a request sequence; clearing invalidates pending requests. | Browser fixture delays routing responses and checks the cleared route remains empty. |
| The pending API validation allowed 80 coordinates while the UI supports 80 houses plus origin. | Allow 81 coordinates; reject blank/whitespace and non-number coordinate values. | Route API tests cover the maximum, invalid input, timeout, and upstream errors. |

All twelve rendered HTML entry pages load field styles before the final theme and interaction overrides. This avoids runtime CSS insertion overriding the intended control layout. Account also loads its training-card stylesheet. Existing login and password protection behavior, role permissions, collapsed-panel inert behavior, tutorial flows, forms, uploads, and field tools remain in place.

## Pending work incorporated

This is a cumulative review proposal. It includes the already prepared cache-sync and route-API fixes from `True-North-Routes-Polish-20261009-Cache-Sync.zip` and `True-North-Routes-Polish-20261009-Route-API.zip`. Do not apply those patches again on top of this proposal. Earlier packages remain intact.

The cache fix prevents failed or invalid lead counts from being treated as successful freshness checks, falls back to a cold read when count metadata is unavailable, and avoids saving a stale remote timestamp. The route API fix validates requests, bounds upstream calls to ten seconds, returns explicit client/upstream errors, and prevents cached route responses. Current main's rejection of coordinate-less caches and preservation of pins during delta merges are retained.

## Validation and boundaries

See the package's `VALIDATION.json` and `evidence/` for final executed results. `npm test` runs 32 regression scripts, including the More-menu browser test. `npm run test:ui` exercises the local app through its normal UI against an isolated fixture server. It covers four staff roles, all nine Management tabs, page-search navigation, desktop/mobile tours, dialog focus/Escape, inspection saves and duplicate behavior, account filtering, photo preview, training lessons, route controls, empty states, and responsive layouts. The expanded audit records viewport bounds, center hit targets, button heights, and a page-by-page button inventory. Hidden role/state controls and inert collapsed content are intentionally excluded from reachability assertions.

The browser suite uses synthetic identities, a local Supabase fixture, mocked weather/storm responses, and a mocked road-route response. It does not write production data. It validates UI wiring and local behavior, not every production integration. A real-device pass is still needed for iOS/Safari, GPS, camera/document upload, external navigation apps, actual tile/service delivery, assistive technology, and real authenticated backend permissions. This is not a WCAG conformance certification. Local Postgres was unavailable; the column-grant test ran its documented source-scan fallback. No standalone build script exists for this static app.

## Fresh source and deployment review

GitHub reverified `Choonkauncha/True-north-routes`, default branch `main`, on October 9, 2026. The current head remains [ae53761](https://github.com/Choonkauncha/True-north-routes/commit/ae53761bec6d33172f0522780ecc7bfded8c5a02), the October 8 merge preserving cached pins. Its GitHub Vercel status is `success`, linking to [this deployment](https://vercel.com/relaxxx/true-north-sales-map-vercel/3rvRW9NhEd2zZJMQdnzbYSCdojbG). The Actions wrapper returned no pull-request-triggered workflow runs on its first page for this commit; this does not establish that the repository has no other CI.

Direct Vercel inspection of `prj_FTg8Jh9J1vAujGUkNZ4ZFFVzrJjr` under `team_7uN3Y15dRqgLuMS3vfCU18Ex` returned HTTP 403, not authorized for scope `relaxxx`. An authenticated CLI fallback was unavailable. Therefore the project-to-repository link, direct deployment health, build/runtime logs, and production behavior could not be independently verified. Authorized read access to that scope is the remaining blocker for deployment review.

## Review and use

Open `START-HERE.html` in the review package for actual browser screenshots. Screenshots use fixture accounts; map basemap tiles were not reliably available in this environment. The full source is in `true-north-sales-map/`, and `changes.patch` is cumulative from the exact base commit above. Its application is checked against a clean copy of that base. `CHANGE-MANIFEST.json` identifies changed files and hashes.

For local verification, run `npm ci`, then `npm test` and `npm run test:ui` inside `true-north-sales-map`. Install the Playwright Chromium browser if needed. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` and `PLAYWRIGHT_CHROMIUM_ARGS` support an alternate installed browser. Production verification remains required after the approved GitHub push, including confirmation that Vercel built the exact new commit.

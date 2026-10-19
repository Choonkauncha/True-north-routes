# Workflow and navigation review — 19 October 2026

Reviewed repository head: `06c241fd936152c9203816fe37b24cd7fb5c0fac`.

## Main journeys

| User | Primary journey | Supporting pages |
| --- | --- | --- |
| Appointment setter | Sign in → clock in → find homes → select stops → build route → navigate → book inspection | My forms, training, messages, account |
| Sales rep | Sign in → route/property → roof photos → forms/estimate → follow up | Training, messages, account |
| Admin | Management overview → appointments/homeowner requests → team/account actions | Field map, assigned routes, documents, shifts, feature controls |

The map already combines address selection and route review in one side sheet. Keep this structure: one search, an address list, a route tab, and optional map tools. The route state distinguishes queued homes, a building route, a ready route, and changed stops. A new global navigation redesign should preserve these states and the active-route removal handlers.

## Findings and implemented changes

| Friction | Change |
| --- | --- |
| “More,” “Work,” and “Menu” name navigation differently | Map and tool pages use “Menu.” |
| The map hides the page-search button | “Find a page…” is available inside its existing menu. |
| Search checks hidden links but misses `data-feature-disabled` | Search excludes disabled destinations and refreshes when permission attributes change. Idempotent rendering prevents DOM/permission observer feedback. |
| Mobile drawer has no visible close action | Added “Close menu ×” and focus return. |
| Keyboard users can tab from the map menu into underlying controls | Focus wraps among visible, enabled menu controls; Escape still closes it. |
| Subpages bury the map link inside navigation on phones | Added a direct “Back to map” link and current-page label. The return link follows the existing map feature gate. |
| Booking is called “Inspection form” in one menu and “Book inspection” in another | Both navigation menus use “Book inspection.” |
| `/index.html` loses the map's active-page treatment | Normalized that alias to the map path. |

These are navigation changes. Existing authentication, data access, form saving, route calculation, and field actions remain owned by their existing modules.

## Remaining workflow improvements

1. **Keep booking and document filling visibly distinct.** The booking page offers “Fill Form” alongside “New inspection,” while its purpose is scheduling and handoff. A future page-level revision should use explicit labels such as “Open inspection documents,” with a clear completion action and saved confirmation.
2. **Reduce duplicated header destinations.** Desktop headers repeat links from the main navigation. Consolidate them after checking all role layouts; preserve clock, messages, and sign-out access.
3. **Make the primary next action depend on work state.** Before a shift, emphasize clock-in. With no stops, emphasize selecting homes. With a ready route, emphasize starting navigation. During a property visit, emphasize logging the outcome. The current controls already support these actions but distribute them across panels.
4. **Treat management as a separate job context.** Keep office sections in its existing rail and page search rather than exposing every admin action on the field map.

## Verification

Run `npm run test:navigation` for the new synthetic browser coverage. It exercises setter, sales, and admin navigation; menu closure/focus; responsive widths; live permission refresh; and map-menu page search. Test fixtures do not use production accounts or write production data.

### Results

- `npm run test:navigation` passed, including map-menu search and Escape/focus return. Setter, salesperson, and admin return links, menu closure/focus, and responsive widths 320, 390, 768, 1024, and 1440 passed; role permission changes update search while open.
- Existing role-access, feature defaults, feature-permissions/RLS, and page-tour checks passed.
- Main suite run individually: 58 of 64 passed initially. Three browser checks initially required a browser binary; menu positioning, voice Coach, and adding stops after build subsequently passed with an available Chromium binary (61 of 64 main-suite checks passed in aggregate).
- Three code/assertion failures reproduce unchanged on the original commit: `loader-screen.test.mjs`, `auth-events.test.mjs` (missing test harness stub for `registerMapAssistant`), and `password-gate-signin.test.mjs`.
- Map smoke passes its responsive menu/map controls at 1440×900, 390×844, 320×568, 768×900, and 844×390. It then times out waiting for all route stops to disappear after removing one stop. The same timeout reproduces on the original commit; investigate that route behavior/test expectation separately.

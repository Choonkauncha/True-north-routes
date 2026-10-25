# Management UI review

Reviewed 2026-10-25. Scope: all twelve Management sections, Documents and Training subviews, and the connected GPS, Shifts, Messages, and My account screens. Production inspection was read-only; no customer records, messages, credentials, role permissions, or business settings were changed. Feature removal requires the owner's approval and is excluded from this change.

## Page coverage and refinements

| Screen | Inspected | Refinement or outcome |
| --- | --- | --- |
| Overview | Metrics, attention cards, upcoming inspections, recent activity | Compact heading and consistent content spacing; all shortcuts retained. |
| Appointments | Filters, table, assignment/status controls, delete action | Visible filter labels; complete labeled record cards on phones; sticky table headings on larger screens. Confirmation and admin-only deletion retained. |
| Homeowner requests | Search/status filters, contact/property/source details | Visible labels and mobile records that retain every column. |
| Activity feed | Search, person/action filters, feed entries | Visible labels, consistent field sizes and focus outlines. Raw action identifiers remain a future copy improvement. |
| Team activity | Roster, roles, work totals, status, add-person shortcut | Labeled filters, readable mobile records; account-management actions retained. |
| Territories | Coverage/ownership table | Complete phone records; bounded scroll region with sticky headings on desktop. |
| Accounts | Profile cards, account settings/archive control | Improved settings-menu contrast, wrapping and focus treatment. All account and archive tools retained. |
| Documents | Property queue and filters | Consistent controls, spacing, titles and metadata. |
| Documents: Form builder | Upload, New form, existing templates | Existing editing/upload tools retained; shared control and spacing improvements. No forms submitted. |
| Documents: Library | Receipts, estimates, completed inspections, custom folders | Padded, bordered sections; responsive filter grid; consistent labels and muted text. No uploads, folder changes or deletions. |
| Training: Library | Lessons, Watch status, Edit, Archive | Readable titles/metadata; accessible selected-tab colors; wrapping controls with touch targets. |
| Training: Watch status | Person filter, required-only filter, reminder controls | Shared contrast/control improvements; progress and reminder behavior retained. |
| Training: Add editor | Title, description, category/order, audience, required flag, link/file inputs | Dark readable fields/labels and clear primary action. Editor opened and cancelled without submission. |
| Feature access | Full role/feature switch matrix | Clear row separators, readable column labels, larger switch targets; no permission values changed. |
| Voice coach | System prompt, loading/recovery and save controls | Readable textarea, padding and focus state. No prompt saved. |
| GroupMe scheduling | Link configuration and save controls | Consistent readable input and touch size. No settings saved. |
| Users GPS | Roster, person detail, date/refresh, timeline and map | Shared navy theme, readable headings/metadata, touch controls and responsive header. Tracking and recorded totals unchanged. |
| Shifts | Day picker, current/day lists, selected-person trail | Padded cards/day controls and readable selected-person heading. All clocking and history actions retained. |
| Messages | People list and conversation panel | Reviewed without sending messages; existing panel and tools preserved. |
| My account | Management links, field tools, training summary, password form | Supporting navigation reviewed. No account settings or security changes. |

The mobile Management header now fits the complete logo and company name beside Sections and Help, including at 320px. Whole-page collapse controls remain available, positioned beside their headings to reduce empty vertical space.

## Proposed removals — awaiting owner approval

Nothing in this table has been removed.

| Proposal | Exact change if approved | What remains |
| --- | --- | --- |
| Duplicate Shifts shortcut on Users GPS | Remove one of the two header links that point to `/shifts.html` (the page already supplies one and Field Ops injects another). | One visible Shifts destination and all shift functions. |
| Duplicate appointment shortcut on Overview | Remove the hero's **View appointments** button. | **View all** on Upcoming inspections and **Appointments** in Sections. |
| Whole-page collapse arrows | Remove only the controls that hide the entire Appointments, Homeowner requests, Activity, Team activity, and Territories page contents. | Sections navigation plus useful card/list-level collapse controls. |

Team activity and Accounts, Training and My training, and Users GPS and Shifts serve distinct purposes and are not proposed for consolidation.

## Verification

- Management browser checks cover all twelve sections at 1440, 1024, 768, 390 and 320px, checking page overflow, navigation/search, mobile drawer, deep links/history, recovery and denied-role redirects.
- Added checks for visible filter labels, complete mobile record labels, full phone header text, keyboard focus, and WCAG 4.5:1 text contrast in Training and settings.
- Documents Library and Form builder additionally checked at 1440, 390 and 320px.
- Shifts checked at 1440, 768, 390 and 320px, including person selection and readable trail heading. Corrected the synthetic shift fixture to use the API's `lat`/`lng` coordinate fields.
- GPS browser checks cover roster/detail, escaped addresses, merged timeline, truthful recorded totals, map, clock-out, authorization and responsive/contrast checks at 1400, 768, 390 and 320px.
- Management navigation/workflows, collapse panels, training progress and the GPS/API/SQL/location test suites pass.
- Synthetic fixtures exercise appointment-delete cancellation/confirmation. No production appointment was deleted.
- Screenshots reviewed for phone and desktop records, Training, feature access, Documents and GPS. Browser execution uses isolated fixtures; production inspection verifies the real screen content without exercising write actions.

## Limits

No production write workflows were executed. Upload/save/send operations retain existing behavior and permissions. This is a presentation and accessibility pass; it does not change database schemas, tracking rules, account access or business logic. Remaining duplicate controls above require separate approval before removal.

## Phone-header follow-up

The initial review did not visually cover every connected page. The owner reported that Book inspection still showed the older phone header with Clock In/Messages and a cropped emblem. That page shared its header with account, forms, photos and shifts, rather than the Management header.

The follow-up checks the header across all twelve Management tabs and the connected booking, account, roof-photo bank, photo capture, forms, standalone Documents, Training, Shifts, form-copy, GPS and map screens. Phone screenshots are visually reviewed, including Documents Library/builder/editor and Training status/editor. Reset/sign-in branding is checked separately because the authenticated header is intentionally hidden there.

A shared phone header now displays the complete logo and company name, links home to the field map, and provides one labeled Sections button. Original Clock In, Messages, page search and account controls move into Sections on phone/tablet widths; their handlers, role gates and desktop placement are preserved. Training does not gain clock/message tools it previously lacked. No proposed feature removals have been made. GPS and form-copy use the same presentation while retaining their independent page logic. Page-search focus returns to Sections when its original trigger is inside the closed menu.

Verification uses isolated synthetic data at 320, 390, 430 and 768px, plus desktop restoration, opening Messages without sending, keyboard dismissal, role/permission refresh, map and GPS menus, and full-logo bounding checks. `npm run test:phone-headers` runs the expanded suite and captures internal review screenshots.

The broader map smoke suite passes the header/viewport checks but times out later during route-stop cleanup. The same timeout reproduces on the unchanged pre-follow-up commit. This header change does not change route selection or cleanup behavior.

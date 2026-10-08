/** Page-specific explanations. Targets are resolved from the current, permission-aware UI. */
const step = (target, title, text) => ({ target, title, text });
export const PAGE_TOURS = {
  map: [
    step(
      "#search",
      "Find a property",
      "Search by address, homeowner, or ZIP. Search narrows the house list and the map pins together.",
    ),
    step(
      "#filterBtn",
      "Narrow the field list",
      "Open Filters to choose the area, status, or priority you want to work. Clear filters to see the full list again.",
    ),
    step(
      "#layerBtn",
      "Choose map layers",
      "Turn map layers on or off. Weather and storm reports provide context; they do not prove damage at a particular house.",
    ),
    step(
      "#nextCardBtn, #listSheetGrab",
      "Choose your next house",
      "The field list ranks opportunities. On a phone, open the house-list handle to see homes. Open a home for its address, notes, and door status.",
    ),
    step(
      "#routeTrayToggle",
      "Plan your route",
      "Expand the route panel. Select homes from the list, or use Draw area to circle a neighborhood. Choose Drive or Walk, then Build route.",
    ),
    step(
      "#routeBtn, #mobileRoute",
      "Navigate the route",
      "Build a route before starting it. In-app navigation follows your location with the road ahead pointing up. End returns to the normal field map.",
    ),
    step(
      "#tnClockBtn",
      "Start and finish your shift",
      "Clock In before field work and Clock Out when you finish. The first clock-in explains when location points are recorded.",
    ),
    step(
      "#tnMsgBtn, #tnMore",
      "Reach the office",
      "Messages opens your office conversation. On a phone, More also contains your account, inspection form, and other tools allowed for your role.",
    ),
  ],
  setter: [
    step(
      "#s_first_name",
      "Record the homeowner",
      "Enter the homeowner’s name and a phone number you can use for the inspection. Fill the required fields marked with an asterisk.",
    ),
    step(
      "#address",
      "Confirm the property",
      "Check the street address, city, state, and ZIP. A form opened from a house on the map can already have these details filled in.",
    ),
    step(
      "#concern",
      "Capture what they noticed",
      "Choose the concern and record the homeowner’s own description. This helps the sales rep prepare without promising a diagnosis or insurance outcome.",
    ),
    step(
      "#s_date",
      "Set a specific time",
      "Choose the inspection date and time. Make sure the homeowner understands when the inspector is expected.",
    ),
    step(
      "#salesperson",
      "Choose the handoff owner",
      "Select the sales rep who will take the inspection. Add useful access information and homeowner expectations in Sales handoff notes.",
    ),
    step(
      "#consent_contact",
      "Confirm contact permission",
      "Check this only after the homeowner has agreed to be contacted about this inspection.",
    ),
    step(
      '#setterForm button[type="submit"]',
      "Save once, then confirm",
      "Save inspection records the homeowner profile and handoff. Wait for the confirmation. The save button stays disabled after success to prevent a repeat save.",
    ),
    step(
      "#clearForm",
      "Start the next inspection",
      "New inspection clears this form and its linked property. Use it after a successful save, or when you intentionally want to start over.",
    ),
  ],
  account: [
    step(
      ".profileHero",
      "Your role and workspace",
      "This is your signed-in profile. The shortcuts below reflect the tools available to your role.",
    ),
    step(
      "#managementDashboard",
      "Office shortcuts",
      "Approved admins can open accounts, team activity, documents, messages, and the form library here. Other roles keep their own field tools.",
    ),
    step(
      ".profileActionGrid",
      "Open a work tool",
      "Choose the card for the task you need: inspections, forms, property photos, or training. Your role determines which cards appear.",
    ),
    step(
      "#tnAccountTraining",
      "Check training progress",
      "Review assigned training and completion status here, then open Training to continue an item.",
    ),
    step(
      "#pw1",
      "Change your password",
      "Enter a new password of at least 8 characters and type it again to confirm. Wait for Password saved before signing out.",
    ),
    step(
      "#accountSignOut",
      "Finish securely",
      "Sign out when you are finished, especially on a shared phone or computer.",
    ),
  ],
  rep: [
    step(
      "#q",
      "Find the right property",
      "Enter at least two characters of an address or homeowner name. Open the matching property before taking a photo or filling a form.",
    ),
    step(
      "#groups",
      "Browse photos by address",
      "Saved roof photos are grouped under the property they belong to. Open a group to review the record or add documentation.",
    ),
    step(
      ".roleToolsGrid",
      "Continue your field work",
      "These shortcuts open inspections, assigned forms, training, and the other tools allowed for your role.",
    ),
  ],
  photo: [
    step(
      "label:has(#take), label:has(#retake)",
      "Take or choose a photo",
      "Capture a clear photo or choose one from your device. Check the property name and address before attaching documentation.",
    ),
    step(
      "#caption",
      "Add useful context",
      "Describe what the photo shows and where it was taken. A clear note makes the photo useful to the rest of the team.",
    ),
    step(
      "#savePhoto",
      "Save to the property",
      "Save photo attaches it to this property. Wait for the saved confirmation before moving on.",
    ),
    step(
      "#gallery",
      "Review saved photos",
      "Open a saved photo to inspect it. Use Edit note to improve its description when needed.",
    ),
  ],
  forms: [
    step(
      '.tnSeg, .tnTabs, [data-tn-panel="my-forms"]',
      "Choose the paperwork you need",
      "This page contains assigned forms and your saved paperwork. Use the available tabs or folders to choose the type of record.",
    ),
    step(
      'input[placeholder*="Search"], input[placeholder*="Address"], .tnInput',
      "Find the record or property",
      "Search the property or document before opening a form. Keeping the correct address attached makes the handoff easier to review.",
    ),
    step(
      ".tnFolder, .tnFolderHead, .tnStack",
      "Open a folder or assigned form",
      "Inspection folders group paperwork by inspection. Receipts and estimates use their own sections. Only forms assigned to you or your role are available.",
    ),
    step(
      '.tnSticky, form button[type="submit"]',
      "Review before saving",
      "Check required fields, property details, and any signature request. Save using the form’s action, then wait for its confirmation.",
    ),
  ],
  files: [
    step(
      ".tnSeg, .tnTabs, .toolbar",
      "Choose a document view",
      "Management documents bring property records together. Use the available tabs to switch between property records, folders, and the form library.",
    ),
    step(
      'input[type="search"], input[placeholder*="Search"], .tnInput',
      "Search and filter",
      "Search the homeowner, address, person, or form name. Combine available filters to narrow the paperwork you need.",
    ),
    step(
      ".tnDocGroup, .tnFolder, .tnCard, .tnStack",
      "Open the property record",
      "Open a property or folder to review the related inspection, forms, photos, receipts, and estimates. Review controls are shown only when your role allows them.",
    ),
  ],
  training: [
    step(
      ".tnTrainFilters",
      "Choose a training category",
      "Filter the training list by category. Assigned and required items help you see what to work on first.",
    ),
    step(
      ".tnTrainList",
      "Open a training item",
      "Select a card to watch a video, read a document, or practice. Your assigned content and completion status are shown here.",
    ),
    step(
      "#tnTrainStage",
      "Work through the lesson",
      "Use the video controls or page controls to work through the material. Your viewing progress is recorded while the lesson is open.",
    ),
    step(
      "#tnTrainControls",
      "Finish or continue",
      "Use the available next-page and completion controls. Back to training returns to the list without erasing saved progress.",
    ),
  ],
  shifts: [
    step(
      "#shiftDate",
      "Choose the day",
      "Select the day you want to review. Shift totals and location points use an Eastern-time day boundary.",
    ),
    step(
      '[data-tn-panel="shift-now"]',
      "See who is clocked in",
      "Active shifts appear here. Select a person to review their shift and recorded points.",
    ),
    step(
      '[data-tn-panel="shift-day"]',
      "Review the day’s shifts",
      "Compare the people who worked that day. Choose a person to see their recorded route.",
    ),
    step(
      "#shiftMap",
      "Inspect recorded points",
      "The map shows recorded shift points and the miles between them. This is a record of saved points, not continuous background tracking.",
    ),
  ],
  "reset-password": [
    step(
      "#pw1, #tnForgotEmail",
      "Set a password or request a fresh link",
      "A valid recovery link lets you choose a new password. If the link is missing or expired, enter your account email to request another.",
    ),
    step(
      "#pw2",
      "Confirm the new password",
      "Type the same password again. Use at least 8 characters.",
    ),
    step(
      '#resetForm button[type="submit"], [data-forgot-form] button[type="submit"]',
      "Finish the recovery step",
      "Save the password when both entries match, or send a reset link and open the newest email. Then sign in with your new password.",
    ),
  ],
  "form-print": [
    step(
      ".tnPrintSheet, #app",
      "Review the completed record",
      "Check the homeowner, property, form answers, and any recorded signature before printing or saving a copy.",
    ),
    step(
      'button[onclick*="print"], #printBtn, .tnAccountBtns',
      "Print or save a PDF",
      "Use the print action or your browser’s Print menu. Choose Save as PDF to keep a copy. Workspace navigation and this tutorial are excluded from printed pages.",
    ),
  ],
};

export const ADMIN_TOURS = {
  overview: [
    step(
      "#metrics",
      "Read today’s operation",
      "These cards summarize today’s field activity and inspections, active teammates, and open homeowner records. Today uses Eastern time.",
    ),
    step(
      "#dashboardAttention",
      "Act on open work",
      "Open New requests, Needs a sales rep, or Past due inspections to see the matching queue. The queue shows a reset action so you can return to all records.",
    ),
    step(
      "#upcoming",
      "Check the next inspections",
      "Upcoming inspections shows future open handoffs. Completed, cancelled, and no-show inspections are excluded from this list.",
    ),
    step(
      "#recentActivity",
      "See what just happened",
      "The recent feed shows team changes and handoffs. Open the full activity view to filter by person or action.",
    ),
    step(
      ".rail",
      "Move between office tools",
      "Choose Accounts, Team, Appointments, Documents, Training, Messages, or Shifts. On a narrow phone, expand Management to reveal the section buttons.",
    ),
  ],
  accounts: [
    step(
      ".accountCreate summary",
      "Add a teammate",
      "Expand Add a teammate to create a login and assign the correct role. Keep the initial password private; the teammate can update it in My account.",
    ),
    step(
      ".accountFilters",
      "Find the right account",
      "Search by name or email, then filter by role or active status. Filtering keeps an unfinished new-login form intact.",
    ),
    step(
      "#tnPeopleList",
      "Review access and actions",
      "Each card shows the person’s role and status. Reset, activation, and Open as controls appear only when your account is allowed to use them. Other admins remain locked to their owner.",
    ),
  ],
  team: [
    step(
      "#teamSearch",
      "Find a teammate",
      "Search by name and use the role filter to focus the team list.",
    ),
    step(
      "#teamTable",
      "Review weekly work",
      "Worked, appointments, interest, and latest activity describe the last 7 days of loaded team activity.",
    ),
    step(
      "#addSetterRep",
      "Manage team access",
      "Add setter or rep opens Accounts, where you can create logins and manage allowed account actions.",
    ),
  ],
  appointments: [
    step(
      "#apptSearch",
      "Find an inspection",
      "Search homeowner or address. Use the stage filter to narrow the handoff queue.",
    ),
    step(
      "#apptFocusNotice",
      "Understand a focused queue",
      "An attention card can focus this view on unassigned or past-due inspections. Show all appointments removes that focus.",
    ),
    step(
      "#apptTable",
      "Read the handoff",
      "Check the inspection time, setter, assigned sales rep, stage, and notes. Assignment and editing permissions remain tied to the existing handoff rules.",
    ),
    step(
      "#tab-appointments .dashboardPagination",
      "Load more results",
      "The list starts with 100 matching records. Show more adds the next group without changing your filters.",
    ),
  ],
  homeowners: [
    step(
      "#homeSearch",
      "Find a homeowner record",
      "Search by homeowner, phone, or property. Use the status filter to find records that need follow-up.",
    ),
    step(
      "#homeTable",
      "Review the context",
      "Contact details, property, concern, source, and status keep the homeowner’s inspection record together.",
    ),
  ],
  activity: [
    step(
      "#activitySearch",
      "Search team activity",
      "Search by homeowner, address, or action.",
    ),
    step(
      "#activityPerson",
      "Focus on a person or action",
      "Combine the person and activity-type filters to review a specific teammate’s work.",
    ),
    step(
      "#activityFeed",
      "Read the audit trail",
      "Each entry identifies the actor, time, property, and action. Use Show more for additional matching entries.",
    ),
  ],
  territories: [
    step(
      "#territoryTable",
      "Review territory coverage",
      "Compare lead and mapped-house counts, then check the assigned owner and their role for each territory.",
    ),
  ],
  files: PAGE_TOURS.files,
  training: [
    step(
      "#tnTrainAdd",
      "Add training",
      "Create a training item with a title, audience, and video, document, image, or supported link.",
    ),
    step(
      ".tnTrainFilters",
      "Review content or completion",
      "Use Library to manage items and Watch status to review the team’s progress.",
    ),
    step(
      "#tnTrainAdminBody",
      "Assign the right material",
      "Review each item’s audience and required status. Uploading still uses the project’s storage permission policies.",
    ),
  ],
};

export function tourPage(pathname = "/") {
  const name =
    pathname
      .replace(/\/+$/, "")
      .split("/")
      .pop()
      ?.replace(/\.html$/, "") || "map";
  return name === "index" ? "map" : name === "homeowner" ? "setter" : name;
}

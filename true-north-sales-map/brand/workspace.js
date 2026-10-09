import { bootFeatureAccess } from './feature-access.js';
import "./page-help.js";
import { mountAtlas } from "./atlas.js";

/** Shared workspace chrome. Authorization stays in the existing page modules. */
const body = document.body;
const page = location.pathname.replace(/\.html$/, "").replace(/\/$/, "") || "/";
const isMap = Boolean(document.getElementById("appShell"));
const isAdmin = Boolean(document.querySelector(".dashboardShell"));
const isPublic = body.classList.contains("tn-public");
const isPrint = page === "/form-print";
body.classList.add("tn-workspace");
if (isMap) body.classList.add("tn-map-workspace");
if (isAdmin) body.classList.add("tn-admin-workspace");

const paths = {
  map: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 3v18M15 3v18M3 9h6M15 15h6"/>',
  intake:
    '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v4H9zM9 12h6M9 16h4"/>',
  forms: '<path d="M14 3H5v18h14V8zM14 3v5h5M9 12h6M9 16h6"/>',
  photos:
    '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8" cy="9" r="1.5"/><path d="m3 17 6-5 4 3 3-3 5 5"/>',
  training: '<path d="m3 8 9-5 9 5-9 5zM6 10v7c4 3 8 3 12 0v-7M21 8v8"/>',
  account:
    '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  management:
    '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  shifts: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
function icon(key) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[key] || paths.arrow}</svg>`;
}

if (!isPublic && !isPrint && page !== "/reset-password") mountNavigation();
enhanceContent();
bootFeatureAccess();

function mountNavigation() {
  const header = document.querySelector(".topbar, .tnHeader");
  if (!header) return;
  const nav = document.createElement("nav");
  nav.id = "workspaceNav";
  nav.className = "workspaceNav";
  nav.setAttribute("aria-label", "Field tools");
  const items = [
    ["map", "/", "Field map"],
    ["intake", "/setter", "Book inspection"],
    ["forms", "/forms", "My forms"],
    ["photos", "/rep", "Roof photos"],
    ["training", "/training", "Training"],
    ["shifts", "/shifts", "Shifts"],
    ["account", "/account", "My account"],
    ["management", "/admin", "Management"],
  ];
  const brandHref = page === "/setter" ? "/account.html" : "/";
  const brandLabel = page === "/setter" ? "MY ACCOUNT" : "FIELD TOOLS";
  const brandAria = page === "/setter" ? "Open my account" : "True North home";
  const navLabel = page === "/setter" ? "YOUR ACCOUNT" : "FIELD TOOLS";
  nav.innerHTML = `<a class="workspaceBrand" href="${brandHref}" aria-label="${brandAria}"><img src="/brand/logo-full.webp" alt="True North Restorations" width="168" height="128"><span>${brandLabel}</span></a><div class="workspaceNavLabel">${navLabel}</div><div class="workspaceNavItems">${items.map(([key, href, label]) => `<a href="${href === "/" ? "/" : href + ".html"}" data-workspace-link="${key}" ${["management", "photos", "shifts"].includes(key) ? "hidden" : ""} ${page === href || (key === "photos" && page === "/photo") || (key === "management" && page === "/files") ? 'aria-current="page"' : ""}>${icon(key)}<span>${label}</span></a>`).join("")}</div><div class="workspaceNavFoot"><a href="/homeowner.html">Inspection form ${icon("arrow")}</a><p>Inspect honestly.<br>Document clearly.<br>Earn the job.</p></div>`;
  body.prepend(nav);
  body.classList.add("has-workspace-nav");

  // Every office/field page gets the same workspace menu; the map retains More.
  if (!isMap) {
    const button = document.createElement("button");
    button.className = "workspaceMenuBtn";
    button.type = "button";
    button.innerHTML = `${icon("menu")}<span>Menu</span>`;
    button.setAttribute("aria-controls", nav.id);
    button.setAttribute("aria-expanded", "false");
    header.append(button);
    const scrim = document.createElement("button");
    scrim.className = "workspaceNavScrim";
    scrim.type = "button";
    scrim.hidden = true;
    scrim.setAttribute("aria-label", "Close navigation");
    body.append(scrim);
    const close = () => {
      nav.classList.remove("isOpen");
      button.setAttribute("aria-expanded", "false");
      scrim.hidden = true;
    };
    button.onclick = () => {
      const open = button.getAttribute("aria-expanded") !== "true";
      nav.classList.toggle("isOpen", open);
      button.setAttribute("aria-expanded", String(open));
      scrim.hidden = !open;
      if (open)
        nav
          .querySelector("a[aria-current], .workspaceNavItems a:not([hidden])")
          ?.focus();
    };
    scrim.onclick = () => {
      close();
      button.focus();
    };
    nav.addEventListener('click', (event) => {
      if (event.target.closest('a') && nav.classList.contains('isOpen')) close();
    });
    nav.addEventListener("keydown", (event) => {
      if (!nav.classList.contains("isOpen")) return;
      if (event.key === "Escape") {
        close();
        button.focus();
      }
      if (event.key === "Tab") {
        const links = [...nav.querySelectorAll("a")].filter(visible);
        const first = links[0],
          last = links.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });
    matchMedia("(min-width: 1101px)").addEventListener("change", close);
  }

  // Reflect existing permission-aware links instead of guessing roles from storage.
  const sync = () => {
    const management = nav.querySelector('[data-workspace-link="management"]');
    const photo = nav.querySelector('[data-workspace-link="photos"]');
    const shifts = nav.querySelector('[data-workspace-link="shifts"]');
    const shiftSource = document.querySelector('.tnFieldOps .tnShiftsLink');
    shifts.hidden = !(shiftSource && !shiftSource.hidden && !shiftSource.classList.contains('hidden'));
    const managementSource = document.querySelector(
      "#adminBtn, .tnHeader .tnManageLink, #managementDashboard",
    );
    const photoSource = document.querySelector(
      '#roofPhotosLink, .headerLinks a[href="/rep.html"], #tnMoreMenu a[href="/rep.html"], main .profileAction[href="/rep.html"]',
    );
    management.hidden =
      !isAdmin &&
      !(
        managementSource &&
        !managementSource.hidden &&
        !managementSource.classList.contains("hidden")
      );
    photo.hidden =
      !["/rep", "/photo"].includes(page) &&
      !(
        photoSource &&
        !photoSource.hidden &&
        !photoSource.classList.contains("hidden")
      );
  };
  sync();
  const observer = new MutationObserver(sync);
  observer.observe(header, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "hidden"],
  });
  const app = document.querySelector("main");
  if (app) observer.observe(app, { childList: true, subtree: true });
  mountAtlas(nav, header);
}

function enhanceContent() {
  // Labels in older management screens were placeholders only.
  const labels = {
    teamSearch: "Search team members",
    teamRole: "Filter team by role",
    apptSearch: "Search appointments",
    apptStage: "Filter appointment stage",
    homeSearch: "Search homeowner requests",
    homeStatus: "Filter request status",
    activitySearch: "Search activity",
    activityPerson: "Filter activity by person",
    activityType: "Filter activity by type",
  };
  Object.entries(labels).forEach(([id, label]) =>
    document.getElementById(id)?.setAttribute("aria-label", label),
  );
  document.querySelectorAll(".field").forEach((field) => {
    const label = field.querySelector("label");
    const input = field.querySelector("input[id], select[id], textarea[id]");
    if (label && input && !label.htmlFor) label.htmlFor = input.id;
  });
  document.querySelectorAll(".rail [data-tab]").forEach((button) => {
    button.setAttribute("aria-controls", `tab-${button.dataset.tab}`);
  });
  if (isMap) {
    const main = document.querySelector(".mapShell");
    main.id = "fieldWorkspace";
    main.setAttribute("aria-label", "Field map and prioritized houses");
    const skip = document.createElement("a");
    skip.className = "workspaceSkip";
    skip.href = "#search";
    skip.textContent = "Skip to field tools";
    body.prepend(skip);
  }
  mountSectionNavigator();
}

function mountSectionNavigator() {
  const form =
    document.getElementById("setterForm") ||
    document.getElementById("homeForm");
  if (!form) return;
  const sections = [...form.querySelectorAll(".formSection")].filter(
    (section) => section.querySelector("h3"),
  );
  if (sections.length < 2) return;
  const nav = document.createElement("nav");
  nav.className = "formSectionNav";
  nav.setAttribute("aria-label", "Form sections");
  sections.forEach((section, index) => {
    section.id ||= `intake-section-${index + 1}`;
    const link = document.createElement("a");
    link.href = `#${section.id}`;
    link.textContent =
      section.querySelector("h3")?.textContent.replace(/^\d+\.\s*/, "") ||
      `Section ${index + 1}`;
    const number = document.createElement("span");
    number.textContent = String(index + 1).padStart(2, "0");
    link.prepend(number);
    link.addEventListener("click", () => {
      for (
        let panel = section.closest(".tnFold.isCollapsed");
        panel;
        panel = panel.parentElement?.closest(".tnFold.isCollapsed")
      )
        panel.querySelector(".tnFoldHead")?.click();
    });
    nav.append(link);
  });
  form.prepend(nav);
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        const section = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]?.target;
        if (!section) return;
        nav.querySelectorAll("a").forEach((link) => {
          if (link.hash === `#${section.id}`)
            link.setAttribute("aria-current", "step");
          else link.removeAttribute("aria-current");
        });
      },
      { rootMargin: "-80px 0px -40% 0px", threshold: [0, 0.25, 0.5] },
    );
    sections.forEach((section) => observer.observe(section));
  }
}

function visible(element) {
  return Boolean(element.getClientRects().length);
}

// Focus containment and return for existing dialogs, without replacing their save/close handlers.
let activeDialog = null;
let previousFocus = null;
const dialogs = ".modalOverlay, .drawer, .doorSheet, .tnMsgOverlay, .tnConsent";
function syncDialog() {
  const next =
    [...document.querySelectorAll(dialogs)].filter(visible).at(-1) || null;
  if (next === activeDialog) return;
  if (next) {
    if (!activeDialog) previousFocus = document.activeElement;
    activeDialog = next;
    const card =
      next.querySelector(
        '[role="dialog"], .modalCard, .drawerCard, .doorSheetCard',
      ) || next;
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    if (
      !card.hasAttribute("aria-label") &&
      !card.hasAttribute("aria-labelledby")
    )
      card.setAttribute(
        "aria-label",
        card.querySelector("h2")?.textContent || "Field tools",
      );
    card.tabIndex = -1;
    (
      card.querySelector('input:not([type="hidden"]), button, a[href]') || card
    ).focus({ preventScroll: true });
  } else {
    activeDialog = null;
    if (previousFocus?.isConnected)
      previousFocus.focus({ preventScroll: true });
    previousFocus = null;
  }
}
let dialogFrame = 0;
new MutationObserver(() => {
  if (dialogFrame) return;
  dialogFrame = requestAnimationFrame(() => {
    dialogFrame = 0;
    syncDialog();
  });
}).observe(body, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ["class", "hidden", "aria-hidden"],
});
document.addEventListener("keydown", (event) => {
  if (!activeDialog) return;
  if (event.key === "Escape") {
    const close = activeDialog.querySelector(
      ".closeBtn, .doorSheetClose, #tnMsgClose, [data-close]",
    );
    if (close) {
      event.preventDefault();
      close.click();
    }
  }
  if (event.key !== "Tab") return;
  const focusable = [
    ...activeDialog.querySelectorAll(
      'button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
    ),
  ].filter(visible);
  const first = focusable[0],
    last = focusable.at(-1);
  if (!first) {
    event.preventDefault();
    return;
  }
  if (
    event.shiftKey &&
    (document.activeElement === first ||
      !activeDialog.contains(document.activeElement))
  ) {
    event.preventDefault();
    last.focus();
  } else if (
    !event.shiftKey &&
    (document.activeElement === last ||
      !activeDialog.contains(document.activeElement))
  ) {
    event.preventDefault();
    first.focus();
  }
});
syncDialog();

// Reveal required fields inside a collapsed section before browser validation focuses them.
let invalidFocusQueued = false;
document.addEventListener(
  "invalid",
  (event) => {
    const target = event.target;
    if (!target.closest(".tnFold.isCollapsed")) return;
    event.preventDefault();
    for (
      let panel = target.closest(".tnFold.isCollapsed");
      panel;
      panel = panel.parentElement?.closest(".tnFold.isCollapsed")
    )
      panel.querySelector(".tnFoldHead")?.click();
    if (!invalidFocusQueued) {
      invalidFocusQueued = true;
      requestAnimationFrame(() => {
        target.focus();
        invalidFocusQueued = false;
      });
    }
  },
  true,
);

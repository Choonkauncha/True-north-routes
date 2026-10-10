import { PAGE_TOURS, ADMIN_TOURS, tourPage } from "../lib/page-tours.js";

const page = tourPage(location.pathname);
const button = document.createElement("button");
button.id = "tnPageHelp";
button.type = "button";
button.className = "pageHelpButton";
button.textContent = "?";
button.title = "Show this page’s tutorial";
button.setAttribute("aria-label", "Help: tutorial for this page");
button.setAttribute("aria-haspopup", "dialog");
button.setAttribute("aria-expanded", "false");

let root,
  card,
  spot,
  steps = [],
  position = 0,
  previousFocus,
  inertNodes = [],
  openedPanels = [],
  openedDetails = [];
let frame = 0;

function displayed(node) {
  if (
    !node ||
    node.closest("[hidden], .hidden") ||
    !node.getClientRects().length
  )
    return false;
  for (let parent = node; parent; parent = parent.parentElement) {
    if (
      getComputedStyle(parent).display === "none" ||
      getComputedStyle(parent).visibility === "hidden"
    )
      return false;
  }
  return true;
}
function firstTarget(selector) {
  return [...document.querySelectorAll(selector)].find(node => {
    // Evaluate collapsed tool groups without excluding their tutorial controls.
    const details = [];
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      if (parent.tagName === 'DETAILS' && !parent.open) details.push(parent);
    }
    details.forEach(parent => { parent.open = true; });
    const visible = displayed(node);
    details.forEach(parent => { parent.open = false; });
    return visible;
  });
}
function authContainer() {
  return firstTarget(".tnSignInScreen, #loginModal, #loginCard");
}
function mountButton() {
  if (root) return;
  const auth = authContainer();
  const header = firstTarget(".topbar, .tnHeader");
  const host = auth || header || document.body;
  const floating = !header || Boolean(auth);
  if (button.classList.contains("isFloating") !== floating)
    button.classList.toggle("isFloating", floating);
  if (button.parentElement !== host) host.append(button);
}
function visibleAdminSection() {
  const section = [
    ...document.querySelectorAll(".dashMain > section, #tnAccounts"),
  ].find(displayed);
  return section?.id === "tnAccounts"
    ? "accounts"
    : section?.id.replace("tab-", "") || "overview";
}
function getSteps() {
  if (authContainer() && firstTarget("#loginForm, #tnLogin, #shiftsLogin"))
    return [
      {
        target: "#loginEmail, #email, #tnEmail, #shiftsEmail",
        title: "Use your team login",
        text: "Enter the email address attached to your active True North account. Your role determines the tools you will see after signing in.",
      },
      {
        target: "#loginPassword, #password, #tnPassword, #shiftsPassword",
        title: "Enter your password",
        text: "Enter your own account password. If you need to set a new password, use Forgot password and open the newest reset email.",
      },
      {
        target:
          '#loginForm button[type="submit"], #loginForm button, #tnLogin button, #shiftsLogin button',
        title: "Sign in to your workspace",
        text: "Select Sign in, then wait for the workspace to load. If the page reports a problem, check the message before trying again.",
      },
      {
        target: "[data-forgot]",
        title: "Recover account access",
        text: "Forgot password opens a reset-link request. The tutorial never enters credentials or sends requests for you.",
      },
    ];
  if (page === "admin")
    return ADMIN_TOURS[visibleAdminSection()] || PAGE_TOURS.files;
  if (
    page === "map" &&
    document.documentElement.classList.contains("isNavigating")
  )
    return [
      {
        target: "#navTitle",
        title: "Follow the current stop",
        text: "Navigation follows your recorded GPS position, with the road ahead pointing up. The stop card identifies your next destination.",
      },
      {
        target: "#navRecenter",
        title: "Recenter the map",
        text: "If you move the map away from your position, use Re-center to follow yourself again.",
      },
      {
        target: "#navNextStop",
        title: "Move to the next stop",
        text: "Next stop advances to the next selected house. Confirm the property before recording door activity.",
      },
      {
        target: "#navEnd",
        title: "Return to the field map",
        text: "End closes fullscreen navigation and returns the normal search, house list, and route controls.",
      },
    ];
  return PAGE_TOURS[page] || [];
}
function setInert() {
  for (
    let parent = root.parentElement, child = root;
    parent;
    child = parent, parent = parent.parentElement
  ) {
    for (const sibling of parent.children) {
      if (
        sibling === child ||
        sibling.tagName === "SCRIPT" ||
        sibling.tagName === "STYLE"
      )
        continue;
      inertNodes.push([sibling, sibling.inert]);
      sibling.inert = true;
    }
    if (parent === document.body) break;
  }
}
function revealTarget(target) {
  for (let parent = target.parentElement; parent; parent = parent.parentElement) {
    if (parent.tagName === 'DETAILS' && !parent.open) {
      openedDetails.push(parent);
      parent.open = true;
    }
  }
  const panels = [];
  for (
    let panel = target.closest(".tnFold.isCollapsed");
    panel;
    panel = panel.parentElement?.closest(".tnFold.isCollapsed")
  )
    panels.unshift(panel);
  for (const panel of panels) {
    openedPanels.push(panel);
    panel.classList.remove("isCollapsed");
    panel.querySelector(".tnFoldHead")?.setAttribute("aria-expanded", "true");
    const inner = panel.querySelector(":scope > .tnFoldBody > .tnFoldInner");
    if (inner) inner.inert = false;
  }
}
function start() {
  if (root) return;
  steps = getSteps()
    .map((step) => ({ ...step, node: firstTarget(step.target) }))
    .filter((step) => step.node);
  if (!steps.length)
    steps = [
      {
        node:
          firstTarget("#app, #tnFilesRoot, #main, #shiftsApp") || document.body,
        title: "This page is ready when your tools load",
        text: "Read the message on this page first. Some tools need a signed-in account, a selected property, or an assigned record. Open ? again after that tool is available for a guided walkthrough.",
      },
    ];
  previousFocus = document.activeElement;
  position = 0;
  button.setAttribute("aria-expanded", "true");
  root = document.createElement("div");
  root.className = "pageTour";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "pageTourTitle");
  root.setAttribute("aria-describedby", "pageTourText");
  root.innerHTML =
    '<div class="pageTourShade"></div><div class="pageTourSpot" aria-hidden="true"><span class="pageTourNumber"></span></div><section class="pageTourCard"><div class="pageTourTop"><span class="pageTourProgress" role="status"></span><button type="button" class="pageTourClose" aria-label="Close tutorial">×</button></div><h2 id="pageTourTitle"></h2><p id="pageTourText" aria-live="polite"></p><div class="pageTourFooter"><button type="button" class="pageTourBack">Back</button><span class="pageTourKeys">Esc to close</span><button type="button" class="pageTourNext">Next →</button></div></section>';
  (authContainer() || document.body).append(root);
  card = root.querySelector(".pageTourCard");
  spot = root.querySelector(".pageTourSpot");
  root.querySelector(".pageTourClose").onclick = stop;
  root.querySelector(".pageTourBack").onclick = () => show(position - 1);
  root.querySelector(".pageTourNext").onclick = () =>
    position === steps.length - 1 ? stop() : show(position + 1);
  root.querySelector(".pageTourShade").onclick = stop;
  setInert();
  show(0);
  root.querySelector(".pageTourNext").focus({ preventScroll: true });
  window.addEventListener("resize", schedulePosition);
  document.addEventListener("scroll", schedulePosition, true);
  document.addEventListener("keydown", keyboard, true);
}
function show(next) {
  position = Math.max(0, Math.min(next, steps.length - 1));
  const step = steps[position];
  revealTarget(step.node);
  root.querySelector(".pageTourProgress").textContent =
    `Step ${position + 1} of ${steps.length}`;
  root.querySelector(".pageTourNumber").textContent = position + 1;
  root.querySelector("#pageTourTitle").textContent = step.title;
  root.querySelector("#pageTourText").textContent = step.text;
  root.querySelector(".pageTourBack").disabled = position === 0;
  root.querySelector(".pageTourNext").textContent =
    position === steps.length - 1 ? "Done ✓" : "Next →";
  step.node.scrollIntoView({
    block: "center",
    inline: "nearest",
    behavior: "instant",
  });
  place();
  // Collapsible sections can finish their height transition after the first measurement.
  setTimeout(schedulePosition, 250);
}
function place() {
  if (!root) return;
  const target = steps[position].node;
  if (!target.isConnected) {
    stop();
    return;
  }
  const rect = target.getBoundingClientRect();
  const gap = 14,
    padding = 12,
    width = innerWidth,
    height = innerHeight;
  const left = Math.max(8, rect.left - 6),
    top = Math.max(8, rect.top - 6);
  const right = Math.min(width - 8, rect.right + 6),
    bottom = Math.min(height - 8, rect.bottom + 6);
  spot.style.cssText = `left:${left}px;top:${top}px;width:${Math.max(0, right - left)}px;height:${Math.max(0, bottom - top)}px`;
  const cardRect = card.getBoundingClientRect();
  // Keep phone navigation buttons stationary while a section expands or scrolls.
  if (width <= 600) {
    card.style.left = `${padding}px`;
    card.style.top = "auto";
    card.style.bottom = `${padding}px`;
    return;
  }
  card.style.bottom = "auto";
  let x = Math.max(padding, Math.min(left, width - cardRect.width - padding));
  let y;
  if (bottom + gap + cardRect.height <= height - padding) y = bottom + gap;
  else if (top - gap - cardRect.height >= padding)
    y = top - gap - cardRect.height;
  else if (right + gap + cardRect.width <= width - padding) {
    x = right + gap;
    y = Math.max(padding, Math.min(top, height - cardRect.height - padding));
  } else {
    x = Math.max(padding, width - cardRect.width - padding);
    y = Math.max(padding, height - cardRect.height - padding);
  }
  card.style.left = `${x}px`;
  card.style.top = `${y}px`;
}
function schedulePosition() {
  if (!root || frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    place();
  });
}
function keyboard(event) {
  if (!root) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopImmediatePropagation();
    stop();
    return;
  }
  if (event.key !== "Tab") return;
  event.stopImmediatePropagation();
  const items = [...card.querySelectorAll("button:not(:disabled)")];
  const first = items[0],
    last = items.at(-1);
  if (
    event.shiftKey &&
    (document.activeElement === first || !card.contains(document.activeElement))
  ) {
    event.preventDefault();
    last.focus();
  } else if (
    !event.shiftKey &&
    (document.activeElement === last || !card.contains(document.activeElement))
  ) {
    event.preventDefault();
    first.focus();
  }
}
function stop() {
  if (!root) return;
  root.remove();
  root = null;
  for (const [node, wasInert] of inertNodes)
    if (node.isConnected) node.inert = wasInert;
  inertNodes = [];
  for (const panel of openedPanels)
    if (panel.isConnected) {
      panel.classList.add("isCollapsed");
      panel
        .querySelector(".tnFoldHead")
        ?.setAttribute("aria-expanded", "false");
      const inner = panel.querySelector(":scope > .tnFoldBody > .tnFoldInner");
      if (inner) inner.inert = true;
    }
  openedPanels = [];
  for (const detail of openedDetails) if (detail.isConnected) detail.open = false;
  openedDetails = [];
  button.setAttribute("aria-expanded", "false");
  window.removeEventListener("resize", schedulePosition);
  document.removeEventListener("scroll", schedulePosition, true);
  document.removeEventListener("keydown", keyboard, true);
  mountButton();
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
}
button.onclick = start;
mountButton();
new MutationObserver(mountButton).observe(document.documentElement, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ["class", "hidden"],
});
window.addEventListener("pagehide", stop);

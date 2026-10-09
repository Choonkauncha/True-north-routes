import { atlasIcon } from "./atlas-icons.js";

/** The menu reads the existing permission-aware navigation; it never grants access. */
export function mountAtlas(nav, header) {
  header.after(nav);
  nav.querySelector(".workspaceBrand").innerHTML =
    `${atlasIcon("territories")}<span>WORKSPACE</span>`;
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "atlasJump";
  trigger.setAttribute("aria-label", "Jump to a page");
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.innerHTML = `${atlasIcon("search")}<span>Jump to…</span><kbd>⌘ K</kbd>`;
  header.append(trigger);
  const dialog = document.createElement("dialog");
  dialog.className = "atlasCommand";
  dialog.setAttribute("aria-labelledby", "atlasCommandTitle");
  dialog.innerHTML = `<div class="atlasCommandHead"><div><div class="eyebrow">YOUR WORKSPACE</div><h2 id="atlasCommandTitle">Where do you want to go?</h2></div><button type="button" class="atlasCommandClose" aria-label="Close page search">×</button></div><label class="srOnly" for="atlasCommandQuery">Search pages and tools</label><div class="atlasCommandSearch">${atlasIcon("search")}<input id="atlasCommandQuery" type="search" placeholder="Search pages and tools…" autocomplete="off"></div><div class="atlasCommandResults"></div><div class="atlasCommandFoot"><span>↑ ↓ to explore · Enter to open</span><button type="button" class="atlasWalkthrough">? Page walkthrough</button></div>`;
  document.body.append(dialog);
  const input = dialog.querySelector("input");
  const results = dialog.querySelector(".atlasCommandResults");
  let returnFocus = null;
  const hints = {
    map: "Find homes, plan a route, and navigate",
    intake: "Homeowner details and inspection handoff",
    forms: "Your forms, estimates, and receipts",
    photos: "Find a property and document its roof",
    training: "Lessons, practice, and your progress",
    shifts: "Review team shift time, mileage, and route history",
    account: "Your role, field tools, and password",
    management: "Team, inspections, and office tools",
  };
  function render() {
    const query = input.value.trim().toLowerCase();
    const links = [...nav.querySelectorAll("[data-workspace-link]")].filter(
      (link) => !link.hidden && !link.classList.contains("hidden"),
    );
    const entries = links.map(link => ({ key: link.dataset.workspaceLink, label: link.textContent.trim(), href: link.getAttribute('href'), current: link.hasAttribute('aria-current') }));
    if (links.some(link => link.dataset.workspaceLink === 'management')) {
      for (const [key, label, hint] of [
        ['appointments', 'Appointments', 'Review booked inspections and sales handoffs'],
        ['accounts', 'Team accounts', 'Manage people, roles, and account access'],
        ['homeowners', 'Homeowner requests', 'Follow up on inbound inspection requests'],
        ['activity', 'Team activity', 'Review recorded field activity'],
        ['territories', 'Territories', 'Review territory ownership'],
        ['files', 'Document library', 'Forms, files, and receipts'],
      ]) entries.push({ key, label, hint, href: '/admin.html#'+key });
    }
    results.replaceChildren();
    for (const entry of entries) {
      const {key,label}=entry;
      const hint=entry.hint || hints[key] || '';
      if (query && !`${label} ${hint}`.toLowerCase().includes(query))
        continue;
      const result = document.createElement("a");
      result.href = entry.href;
      result.className = "atlasCommandResult";
      result.innerHTML = `${atlasIcon(key === "intake" ? "inspection" : key === "management" ? "overview" : key)}<span><b></b><small></small></span>${atlasIcon("arrow")}`;
      result.querySelector("b").textContent = label;
      result.querySelector("small").textContent = hint;
      if (entry.current)
        result.setAttribute("aria-current", "page");
      results.append(result);
    }
    if (!results.children.length) {
      const empty = document.createElement("p");
      empty.className = "atlasCommandEmpty";
      empty.textContent =
        "No matching pages. Try “map”, “forms”, or “training”.";
      results.append(empty);
    }
  }
  function open() {
    if (
      dialog.open ||
      document.querySelector(".pageTour") ||
      document.documentElement.classList.contains("tn-signed-out")
    )
      return;
    input.value = "";
    returnFocus = document.activeElement;
    render();
    dialog.showModal();
    input.focus();
  }
  trigger.onclick = open;
  dialog.addEventListener('close', () => {
    if (returnFocus?.isConnected) returnFocus.focus({preventScroll:true});
  });
  new MutationObserver(() => { if(dialog.open) render(); }).observe(nav, {subtree:true,attributes:true,attributeFilter:['hidden','class']});
  dialog.querySelector(".atlasCommandClose").onclick = () => dialog.close();
  dialog.querySelector(".atlasWalkthrough").onclick = () => {
    dialog.close();
    document.querySelector(".pageHelpButton")?.click();
  };
  input.addEventListener("input", render);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("keydown", (event) => {
    const links = [...results.querySelectorAll("a")];
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!links.length) return;
      event.preventDefault();
      const index = links.indexOf(document.activeElement);
      links[
        (index + (event.key === "ArrowDown" ? 1 : -1) + links.length) %
          links.length
      ].focus();
    }
    if (
      event.key === "Enter" &&
      document.activeElement === input &&
      links.length
    ) {
      event.preventDefault();
      links[0].click();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "k" &&
      !event.altKey &&
      header.getClientRects().length
    ) {
      event.preventDefault();
      open();
    }
  });
  // Secondary management navigation gets the same local icon language.
  const decorateRail = () =>
    document
      .querySelectorAll(".rail [data-tab]:not([data-atlas-icon])")
      .forEach((button) => {
        button.dataset.atlasIcon = "true";
        button.setAttribute('aria-controls','tab-'+button.dataset.tab);
        const label = document.createElement("span");
        label.textContent = button.textContent;
        button.innerHTML = atlasIcon(button.dataset.tab);
        button.append(label);
      });
  decorateRail();
  const rail = document.querySelector(".rail");
  if (rail)
    new MutationObserver(decorateRail).observe(rail, {
      childList: true,
      subtree: true,
    });
}

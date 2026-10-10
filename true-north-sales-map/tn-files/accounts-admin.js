import { createClient } from "/vendor/supabase/supabase.js";
import { esc } from "./ui.js";
import {
  canManageAccount,
  managementProfile,
  roleLabel,
} from "../lib/account-rules.js";
import { isOtherAdmin } from "../lib/must-change-password.js";
import { CREATABLE_FIELD_ROLES } from "../lib/role-access.js";

const FIELD = CREATABLE_FIELD_ROLES;
const ADMIN_EXTRA = [
  ["manager", "Manager"],
  ["admin", "Admin"],
];

function mount() {
  const rail = document.querySelector("#app .rail");
  const main = document.querySelector("#app .dashMain");
  if (!rail || !main || document.getElementById("tab-accounts")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.tab = "accounts";
  button.dataset.tnTabBound = "1";
  button.textContent = "Accounts";
  const team = rail.querySelector('[data-tab="team"]');
  if (team) team.insertAdjacentElement("afterend", button);
  else rail.appendChild(button);
  const section = document.createElement("section");
  section.id = "tab-accounts";
  section.className = "hidden";
  section.innerHTML = '<div id="tnAccounts"></div>';
  main.appendChild(section);
  button.addEventListener("click", () => {
    revealAccounts();
    show();
  });
}

function revealAccounts() {
  const changed = document.getElementById("tab-accounts")?.classList.contains("hidden");
  if (changed) window.scrollTo({top: 0, behavior: "instant"});
  history.replaceState(null, "", "#accounts");
  document.dispatchEvent(
    new CustomEvent("tn-admin-view", { detail: "accounts" }),
  );
  document
    .querySelectorAll("#app [data-tab]")
    .forEach((item) =>
      item.classList.toggle("active", item.dataset.tab === "accounts"),
    );
  document
    .querySelectorAll("#app main section[id^=tab-]")
    .forEach((item) =>
      item.classList.toggle("hidden", item.id !== "tab-accounts"),
    );
}

let sb = null;
let me = null;
let session = null;
let people = [];
let detail = null;
let notice = "";
let openLink = null;
let resetId = "";
let accountsCacheReady = false;
const accountFilters = { query: "", role: "", status: "" };

async function show(force) {
  const root = document.getElementById("tnAccounts");
  if (!root) return;
  if (accountsCacheReady && !force) {
    render();
    revealAccounts();
    return;
  }
  root.innerHTML =
    '<div class="tnSkeleton" aria-hidden="true"><span></span><span></span><span></span></div>';
  try {
    if (!sb) {
      const response = await fetch("/api/config");
      const cfg = response.ok ? await response.json() : null;
      if (!cfg?.configured) {
        root.innerHTML =
          '<h1 class="tnTitle">Accounts</h1><p class="tnSub">Connect Supabase before creating logins. Run supabase/setup_all.sql, then add the server secret key.</p>';
        return;
      }
      sb = createClient(cfg.url, cfg.publishableKey);
    }
    const got = await sb.auth.getSession();
    session = got.data.session;
    if (!session) {
      root.innerHTML =
        '<h1 class="tnTitle">Accounts</h1><p class="tnSub">Sign in as an admin or manager.</p>';
      return;
    }
    const row = await sb
      .from("reps")
      .select("id,name,role")
      .eq("user_id", session.user.id)
      .eq("active", true)
      .maybeSingle();
    me = managementProfile({
      email: session.user.email,
      rep: row.data,
      userId: session.user.id,
      name: session.user.user_metadata?.name || "",
    });
    if (!me || !["admin", "manager"].includes(me.role)) {
      root.innerHTML =
        '<h1 class="tnTitle">Accounts</h1><p class="tnSub">Only an admin or manager can manage logins.</p>';
      return;
    }
    people = await loadPeople(sb);
    accountsCacheReady = true;
    render();
    revealAccounts();
  } catch (error) {
    root.innerHTML = `<h1 class="tnTitle">Accounts</h1><p class="tnError">${esc(error.message)}</p>`;
  }
}

function rolesForMe() {
  return me?.role === "admin" ? [...FIELD, ...ADMIN_EXTRA] : FIELD;
}

function personCard(person) {
  const mine = person.id === me.id || person.user_id === session.user.id;
  const actor = { id: me.id, userId: session.user.id, role: me.role };
  if (isOtherAdmin(actor, person)) {
    return `<article class="tnAccountCard tnAccountLocked" data-rep="${esc(person.id)}" data-tn-panel="person-${esc(person.id)}" data-tn-rank="secondary">
        <b>${esc(person.name)}</b>
        <span>${esc(roleLabel(person.role))}</span>
        <p class="tnHelp">Only this admin can open this account.</p>
      </article>`;
  }
  const opts = { samePerson: mine };
  const can = canManageAccount(me.role, person.role, "reset", opts);
  const canOff =
    canManageAccount(
      me.role,
      person.role,
      person.active ? "deactivate" : "reactivate",
      opts,
    ) && !mine;
  const canOpen =
    canManageAccount(me.role, person.role, "open_as", opts) &&
    person.active &&
    !mine;
  return `<article class="tnAccountCard" data-rep="${esc(person.id)}" data-tn-panel="person-${esc(person.id)}" data-tn-rank="secondary">
      <div class="accountPersonHead panelIntro"><span class="accountPersonAvatar" aria-hidden="true">${esc(
        (person.name || "?")
          .split(/\s+/)
          .slice(0, 2)
          .map((word) => word[0])
          .join(""),
      )}</span><div><b>${esc(person.name)}</b><span class="profileRole">${esc(roleLabel(person.role))}</span></div><span class="accountStatus ${person.active ? "active" : "inactive"}">${person.active ? "Active" : "Inactive"}</span></div>
      <span>${esc(person.email || "No email")}</span>
      <div class="tnAccountBtns">
        ${can ? '<button type="button" data-act="reset">Reset password</button>' : ""}
        ${canOff ? `<button type="button" data-act="active">${person.active ? "Turn off" : "Turn on"}</button>` : ""}
        ${canOpen ? '<button type="button" data-act="open">Open as this user</button>' : ""}
        <button type="button" data-act="work">Activity, files, forms</button>
      </div>
      ${resetId === person.id ? '<form class="tnResetForm"><input class="tnInput" type="password" minlength="8" placeholder="New password" required autocomplete="new-password"><button class="tnTap dark" type="submit">Save password</button></form>' : ""}
      ${detail?.id === person.id ? detailHtml() : ""}
      ${openLink?.id === person.id ? linkHtml() : ""}
    </article>`;
}
function filteredPeople() {
  const query = accountFilters.query.trim().toLowerCase();
  return people.filter(
    (person) =>
      (!query ||
        [person.name, person.email].join(" ").toLowerCase().includes(query)) &&
      (!accountFilters.role ||
        (accountFilters.role === "appointment_setter"
          ? ["appointment_setter", "canvasser"].includes(person.role)
          : person.role === accountFilters.role)) &&
      (!accountFilters.status ||
        Boolean(person.active) === (accountFilters.status === "active")),
  );
}
function bindPersonActions(root) {
  root
    .querySelectorAll("[data-act]")
    .forEach(
      (button) =>
        (button.onclick = () =>
          act(button.dataset.act, button.closest("[data-rep]").dataset.rep)),
    );
  root
    .querySelectorAll(".tnResetForm")
    .forEach(
      (form) =>
        (form.onsubmit = (event) =>
          saveReset(
            event,
            form.closest("[data-rep]").dataset.rep,
            form.querySelector("input").value,
          )),
    );
}
function renderPeople() {
  const root = document.getElementById("tnPeopleList");
  if (!root) return;
  root.innerHTML =
    filteredPeople().map(personCard).join("") ||
    '<div class="profileEmpty"><b>No matching teammates.</b><p>Try another name, role, or account status.</p></div>';
  bindPersonActions(root);
  document.getElementById("accountResultCount").textContent =
    `${filteredPeople().length} of ${people.length} people`;
}
function render() {
  const root = document.getElementById("tnAccounts");
  const options = rolesForMe()
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join("");
  const cards = filteredPeople().map(personCard).join("");

  root.innerHTML = `<div class="dashTitle"><div><div class="eyebrow">LOGINS</div><h1 class="tnTitle">Accounts</h1><p class="tnSub">Manage team access, review each person’s work, and keep roles clear.</p></div></div>
    ${notice ? `<p class="tnBanner">${esc(notice)}</p>` : ""}
    <details class="accountCreate"><summary>Add a teammate <span>Create a login and choose their role</span></summary><form id="tnCreateAccount" class="tnCard"><div class="accountCreateGrid">
      <label class="tnLabel" for="acctName">Name</label>
      <input class="tnInput" id="acctName" required autocomplete="name">
      <label class="tnLabel" for="acctEmail">Email</label>
      <input class="tnInput" id="acctEmail" type="email" required autocomplete="off">
      <label class="tnLabel" for="acctRole">Role</label>
      <select class="tnSelect" id="acctRole">${options}</select>
      <label class="tnLabel" for="acctPassword">Initial password</label>
      <input class="tnInput" id="acctPassword" type="password" required minlength="8" autocomplete="new-password">
      </div><button class="tnTap dark" type="submit">Create login</button>
    </form></details>
    <div class="profileSectionHead"><h2>Team profiles</h2><span id="accountResultCount">${filteredPeople().length} of ${people.length} people</span></div>
    <div class="accountFilters"><label>Search people<input class="tnInput" id="accountQuery" placeholder="Name or email" value="${esc(accountFilters.query)}"></label><label>Role<select class="tnSelect" id="accountRoleFilter"><option value="">All roles</option>${[...FIELD, ...ADMIN_EXTRA].map(([role, label]) => `<option value="${role}" ${accountFilters.role === role ? "selected" : ""}>${label}</option>`).join("")}</select></label><label>Status<select class="tnSelect" id="accountStatusFilter"><option value="">All accounts</option><option value="active" ${accountFilters.status === "active" ? "selected" : ""}>Active</option><option value="inactive" ${accountFilters.status === "inactive" ? "selected" : ""}>Inactive</option></select></label></div>
    <div id="tnPeopleList" class="tnAccountList">${cards || '<div class="profileEmpty">No teammates yet. Add the first login above.</div>'}</div>`;
  document.getElementById("tnCreateAccount").onsubmit = createAccount;
  bindPersonActions(root);
  for (const [id, key] of [
    ["accountQuery", "query"],
    ["accountRoleFilter", "role"],
    ["accountStatusFilter", "status"],
  ]) {
    document
      .getElementById(id)
      .addEventListener(key === "query" ? "input" : "change", (event) => {
        accountFilters[key] = event.target.value;
        renderPeople();
      });
  }
  revealAccounts();
}

function linkHtml() {
  return `<div class="tnBanner">
    <p>One-time link for ${esc(openLink.name)}. Open it in a private window so you stay signed in here.</p>
    <div class="tnAccountBtns">
      <button type="button" id="tnCopyLink">Copy link</button>
      <a class="tnTap tnOutline" href="${esc(openLink.url)}" target="_blank" rel="noopener">Open in new tab</a>
    </div>
  </div>`;
}

function detailHtml() {
  const block = (title, rows) =>
    `<h2>${title}</h2>${rows.length ? rows.join("") : '<p class="tnHelp">None yet.</p>'}`;
  return `<div class="tnAccountDetail">
    ${block(
      "Activity",
      detail.activity.map(
        (row) =>
          `<p><b>${esc(row.action)}</b> · ${esc(row.lead_id || "")}<span>${esc(when(row.created_at))}</span></p>`,
      ),
    )}
    ${block(
      "Photos",
      detail.photos.map(
        (row) =>
          `<p><a href="/photo.html?lead=${encodeURIComponent(row.lead_id)}">${esc(row.lead_id)}</a><span>${esc(when(row.created_at))}</span></p>`,
      ),
    )}
    ${block(
      "Forms",
      detail.forms.map(
        (row) =>
          `<p><a href="/form-print.html?id=${encodeURIComponent(row.id)}">${esc(row.template_name)}</a> ${esc(row.homeowner_name || "")}<span>${esc(when(row.created_at))}</span></p>`,
      ),
    )}
  </div>`;
}

function when(iso) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

async function post(body) {
  const response = await fetch("/api/accounts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.error || "Could not update that account.");
  return data;
}

async function createAccount(event) {
  event.preventDefault();
  notice = "";
  try {
    const result = await post({
      action: "create",
      name: document.getElementById("acctName").value,
      email: document.getElementById("acctEmail").value,
      role: document.getElementById("acctRole").value,
      password: document.getElementById("acctPassword").value,
    });
    notice = "Login created. They choose their own password when they sign in." + (result.warning ? " " + result.warning : "");
    resetId = "";
    detail = null;
    openLink = null;
    accountsCacheReady = false;
    await show(true);
  } catch (error) {
    notice = error.message;
    render();
  }
}

async function act(action, repId) {
  const person = people.find((item) => item.id === repId);
  notice = "";
  openLink = null;
  try {
    if (action === "reset") {
      resetId = repId;
      render();
      return;
    } else if (action === "active") {
      const result = await post({ action: "set-active", repId, active: !person.active });
      notice = (person.active ? "Login turned off." : "Login turned on.") + (result.warning ? " " + result.warning : "");
    } else if (action === "open") {
      const result = await post({ action: "open-as", repId });
      openLink = {
        id: repId,
        url: result.url,
        name: result.name || person?.name || "",
      };
      notice = "Sign-in link ready." + (result.warning ? " " + result.warning : "");
    } else if (action === "work") {
      detail = { id: repId, activity: [], photos: [], forms: [] };
      const [activity, photos, forms] = await Promise.all([
        sb
          .from("lead_activity")
          .select("action,lead_id,created_at")
          .eq("actor_id", repId)
          .order("created_at", { ascending: false })
          .limit(12),
        sb
          .from("lead_photos")
          .select("id,lead_id,created_at")
          .eq("uploaded_by", repId)
          .order("created_at", { ascending: false })
          .limit(12),
        sb
          .from("form_submissions")
          .select("id,template_name,homeowner_name,created_at")
          .eq("submitted_by", repId)
          .order("created_at", { ascending: false })
          .limit(12),
      ]);
      detail.activity = activity.data || [];
      detail.photos = photos.data || [];
      detail.forms = forms.data || [];
    }
    if (action !== "work") detail = null;
    await refreshPeople();
    render();
    if (openLink) document.getElementById("tnCopyLink").onclick = copyLink;
  } catch (error) {
    notice = error.message;
    render();
  }
}

async function saveReset(event, repId, password) {
  event.preventDefault();
  notice = "";
  try {
    const result = await post({ action: "reset", repId, password });
    resetId = "";
    notice = "Password reset." + (result.warning ? " " + result.warning : "");
    render();
  } catch (error) {
    notice = error.message;
    render();
  }
}

async function loadPeople(client) {
  const listed = await client.rpc("account_directory");
  const rows =
    !listed.error && Array.isArray(listed.data)
      ? listed.data
      : (
          await client
            .from("reps")
            .select("id,user_id,name,role,active")
            .order("name")
        ).data || [];
  return rows
    .slice()
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

async function refreshPeople() {
  people = await loadPeople(sb);
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(openLink.url);
    notice = "Link copied.";
  } catch {
    notice = openLink.url;
  }
  render();
  document.getElementById("tnCopyLink").onclick = copyLink;
}

mount();

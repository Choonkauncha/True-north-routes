import { mountCoachAdmin } from './tn-files/coach-admin.js';
import { mountFeatureAdmin } from './tn-files/feature-admin.js';
import { createClient } from "/vendor/supabase/supabase.js";
import { atlasIcon } from "./brand/atlas-icons.js";
import "/tn-files/password-reset.js";
import { bindAdminTabs, adminHashTarget } from "/lib/admin-tabs.js";
import { managementProfile, canOpenManagement } from "/lib/account-rules.js";
const $ = (id) => document.getElementById(id);
let cfg,
  sb,
  session,
  me,
  reps = [],
  leads = [],
  appointments = [],
  activities = [],
  homes = [],
  territories = [],
  adminChannel = null;
import {
  dashboardIndex,
  dashboardSummary,
  upcomingAppointments,
} from "./lib/dashboard.js";
let index = dashboardIndex();
let refreshFlight = null,
  refreshAgain = false,
  refreshTimer;
let refreshLeadsNext = false;
const changedTables = new Set();
const viewLimits = {};
const state = { tab: "overview", appointmentFocus: "" };
document.addEventListener("tn-admin-view", (event) => {
  state.tab = event.detail;
});
function esc(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        m
      ],
  );
}
function fmt(n) {
  return Number(n || 0).toLocaleString();
}
function date(v) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "America/New_York",
    }).format(new Date(v));
  } catch {
    return String(v || "");
  }
}
function pill(v) {
  const c = /complete|confirmed|scheduled|interested/i.test(v)
    ? "green"
    : /cancel|no-show|dnc/i.test(v)
      ? "red"
      : /new|request/i.test(v)
        ? "orange"
        : "";
  return `<span class="pill ${c}">${esc(v || "—")}</span>`;
}
async function fetchAll(build, maxRows = Infinity) {
  const out = [];
  for (let from = 0; ;) {
    const { data, error } = await build().range(
      from,
      Math.min(from + 999, maxRows - 1),
    );
    if (error) throw error;
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000 || out.length >= maxRows) break;
    from += 1000;
  }
  return out;
}
function leaveAdmin() {
  document.documentElement.dataset.tnAdmin = "redirect";
  location.replace("/");
}
function rememberAdminRole(user, role) {
  try {
    if (user && user.id && role)
      localStorage.setItem("tn-role:" + user.id, role);
  } catch (e) {}
}
async function boot() {
  try {
    cfg = await fetch("/api/config").then((r) => r.json());
  } catch (e) {
    cfg = null;
  }
  if (!cfg || !cfg.configured) {
    leaveAdmin();
    return;
  }
  sb = createClient(cfg.url, cfg.publishableKey);
  const g = await sb.auth.getSession();
  if (!g.data.session) {
    leaveAdmin();
    return;
  }
  await enter(g.data.session);
  sb.auth.onAuthStateChange((event, s) => {
    if (event === "SIGNED_OUT") leaveAdmin();
    else if (s && event === "SIGNED_IN") enter(s);
  });
  $("loginForm").addEventListener("submit", login);
  bindAdminTabs(document, showTab);
  window.addEventListener("hashchange", () => {
    if (me) applyAdminHash();
  });
  document
    .getElementById("addSetterRep")
    ?.addEventListener("click", () =>
      document.querySelector('#app [data-tab="accounts"]')?.click(),
    );
  $("signOut").onclick = () => {
    document.documentElement.dataset.tnAdmin = "check";
    try {
      if (session && session.user)
        localStorage.removeItem("tn-role:" + session.user.id);
    } catch (e) {}
    (sb ? sb.auth.signOut() : Promise.resolve()).then(() =>
      location.replace("/"),
    );
  };
  $("openMap").onclick = () => (location.href = "/");
  $("exportCsv").onclick = exportCsv;
  [
    "teamSearch",
    "teamRole",
    "apptSearch",
    "apptStage",
    "homeSearch",
    "homeStatus",
    "activitySearch",
    "activityPerson",
    "activityType",
  ].forEach((id) => $(id)?.addEventListener("input", filterChanged));
  [
    "activityPerson",
    "activityType",
    "teamRole",
    "apptStage",
    "homeStatus",
  ].forEach((id) => $(id)?.addEventListener("change", filterChanged));
}
async function login(e) {
  e.preventDefault();
  $("loginError").textContent = "Signing in…";
  const r = await sb.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value,
  });
  if (r.error) $("loginError").textContent = r.error.message;
}
async function enter(s) {
  session = s;
  const email = (s.user.email || "").toLowerCase();
  const r = await sb
    .from("reps")
    .select("id,user_id,name,role,active")
    .eq("user_id", s.user.id)
    .eq("active", true)
    .maybeSingle();
  const profile = managementProfile({
    email,
    rep: r.data,
    userId: s.user.id,
    name: s.user.user_metadata?.name || "",
  });
  if (
    !canOpenManagement({ email, rep: profile, adminEmails: cfg.adminEmails })
  ) {
    leaveAdmin();
    return;
  }
  if (
    me &&
    me.id === profile.id &&
    document.documentElement.dataset.tnAdmin === "ready"
  )
    return;
  me = profile;
  mountFeatureAdmin(sb,me);
  mountCoachAdmin(sb,me);
  rememberAdminRole(s.user, profile.role);
  await loadData();
  document.documentElement.dataset.tnAdmin = "ready";
  $("tnAdminHold")?.remove();
  $("auth").hidden = true;
  $("app").hidden = false;
  $("app").classList.remove("hidden");
  $("welcome").textContent = `Signed in as ${me.name} · ${me.role} · ${email}`;
  if (!state.entered) {
    state.entered = true;
    if (adminHashTarget(location.hash).tab) applyAdminHash();
    else showTab("overview");
  }
  startRealtime();
}
async function loadData({ refreshLeads = true } = {}) {
  refreshLeadsNext ||= refreshLeads || !leads.length;
  if (refreshFlight) {
    refreshAgain = true;
    return refreshFlight;
  }
  refreshFlight = (async () => {
    do {
      refreshAgain = false;
      const loadLeads = refreshLeadsNext;
      refreshLeadsNext = false;
      const data = await Promise.all([
        fetchAll(() =>
          sb
            .from("reps")
            .select("id,user_id,name,role,active,created_at")
            .order("name"),
        ),
        loadLeads
          ? fetchAll(() =>
              sb
                .from("leads")
                .select("id,name,address,city,state,zip,lat,lng,status")
                .order("city"),
            )
          : Promise.resolve(leads),
        fetchAll(() =>
          sb
            .from("appointments")
            .select(
              "*,canvasser:reps!appointments_canvasser_id_fkey(name,role),salesperson:reps!appointments_salesperson_id_fkey(name,role)",
            )
            .order("scheduled_at", { ascending: true }),
        ),
        fetchAll(
          () =>
            sb
              .from("lead_activity")
              .select("*,actor:reps!lead_activity_actor_id_fkey(name,role)")
              .order("created_at", { ascending: false })
              .limit(5000),
          5000,
        ),
        fetchAll(
          () =>
            sb
              .from("homeowner_intakes")
              .select(
                "*,lead:leads!homeowner_intakes_lead_id_fkey(name,address,city,state,zip),creator:reps!homeowner_intakes_created_by_fkey(name,role)",
              )
              .order("created_at", { ascending: false })
              .limit(3000),
          3000,
        ),
        fetchAll(() =>
          sb
            .from("territories")
            .select("*,owner:reps!territories_assigned_rep_id_fkey(name,role)")
            .order("name"),
        ),
      ]);
      [reps, leads, appointments, activities, homes, territories] = data;
      index = dashboardIndex(leads, reps);
      fillPersonFilter();
      renderAll();
      const refreshed = document.getElementById("dashboardRefreshed");
      if (refreshed)
        refreshed.textContent = `Updated ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date())} ET`;
    } while (refreshAgain);
  })();
  try {
    await refreshFlight;
  } finally {
    refreshFlight = null;
  }
}
function metrics() {
  return dashboardSummary({ reps, appointments, activities, homes });
}
let filterTimer;
function filterChanged() {
  clearTimeout(filterTimer);
  viewLimits[state.tab] = 100;
  filterTimer = setTimeout(renderAll, 150);
}
function pageRows(rows, tab) {
  const limit = viewLimits[tab] || 100;
  const section = document.getElementById(`tab-${tab}`);
  let footer = section.querySelector(".dashboardPagination");
  if (!footer) {
    footer = document.createElement("div");
    footer.className = "dashboardPagination";
    section.append(footer);
  }
  footer.innerHTML = `<span>${fmt(Math.min(limit, rows.length))} of ${fmt(rows.length)} records</span>${rows.length > limit ? '<button type="button" class="btn">Show 100 more</button>' : ""}`;
  footer.querySelector("button")?.addEventListener("click", () => {
    viewLimits[tab] = limit + 100;
    renderAll();
  });
  return rows.slice(0, limit);
}
function renderAttention() {
  const m = metrics();
  const root = document.getElementById("dashboardAttention");
  if (!root) return;
  root.innerHTML = [
    [
      m.newRequests,
      "New requests",
      "homeowners",
      "Contact the homeowner and schedule an inspection.",
    ],
    [
      m.unassigned,
      "Need a sales rep",
      "appointments",
      "Give every open inspection an owner.",
      "unassigned",
    ],
    [
      m.overdue,
      "Past due inspections",
      "appointments",
      "Confirm the outcome and update the stage.",
      "overdue",
    ],
  ]
    .map(
      ([count, title, tab, hint, focus = ""]) =>
        `<button type="button" class="attentionCard" data-attention="${tab}" data-focus="${focus}"><span class="attentionCount${count ? " hasWork" : ""}">${fmt(count)}</span><span><b>${title}</b><small>${hint}</small></span><span aria-hidden="true">→</span></button>`,
    )
    .join("");
  root.querySelectorAll("[data-attention]").forEach(
    (button) =>
      (button.onclick = () => {
        if (button.dataset.attention === "homeowners")
          document.getElementById("homeStatus").value = "New";
        if (button.dataset.attention === "appointments") {
          state.appointmentFocus = button.dataset.focus;
          $("apptSearch").value = "";
          $("apptStage").value = "";
        }
        showTab(button.dataset.attention);
      }),
  );
}
function renderMetrics() {
  const m = metrics();
  $("metrics").innerHTML = [
    [m.worked, "Field touches", "activity", "Today, ET"],
    [m.apptToday, "Inspections today", "appointments", "Today, ET"],
    [m.setters, "Appointment setters", "team", "Active team"],
    [m.sales, "Sales reps", "accounts", "Active team"],
    [m.openHomes, "Homeowner requests", "homeowners", "Open queue"],
  ]
    .map(
      (x) =>
        `<div class="card metric"><div class="atlasMetricHead">${atlasIcon(x[2])}<small>${x[3]}</small></div><b>${fmt(x[0])}</b><span>${x[1]}</span></div>`,
    )
    .join("");
}
function renderUpcoming() {
  const rows = upcomingAppointments(appointments);
  $("upcoming").innerHTML = rows.length
    ? rows
        .map((a) => {
          const l = index.leads.get(a.lead_id) || {};
          return `<div class="activityItem"><div class="activityTime">${esc(date(a.scheduled_at))}</div><div><strong>${esc(l.name || "Homeowner")}</strong><p>${esc(l.address || "")} · Setter: ${esc(a.canvasser?.name || "—")} · Sales: ${esc(a.salesperson?.name || "—")}</p></div><div>${pill(a.stage)}</div></div>`;
        })
        .join("")
    : '<div class="empty">No upcoming appointments.</div>';
}
function renderRecent() {
  const rows = activities.slice(0, 8);
  $("recentActivity").innerHTML = rows.length
    ? rows.map(activityHtml).join("")
    : '<div class="empty">No activity yet.</div>';
}
function teamRows() {
  const cutoff = Date.now() - 7 * 86400000;
  const by = {};
  reps
    .filter((r) => r.active)
    .forEach(
      (r) => (by[r.id] = { r, worked: 0, appts: 0, interested: 0, last: null }),
    );
  activities
    .filter((a) => new Date(a.created_at).getTime() >= cutoff)
    .forEach((a) => {
      const x = by[a.actor_id];
      if (!x) return;
      const to = a.metadata?.to_status;
      if (
        [
          "Knocked",
          "No Answer",
          "Interested",
          "Not Interested",
          "Do Not Knock",
        ].includes(to)
      )
        x.worked++;
      if (to === "Interested") x.interested++;
      if (
        ["appointment_booked", "setter_appointment_booked"].includes(a.action)
      )
        x.appts++;
      if (!x.last || new Date(a.created_at) > new Date(x.last))
        x.last = a.created_at;
    });
  return Object.values(by)
    .filter((x) => {
      const q = ($("teamSearch").value || "").toLowerCase();
      const role = $("teamRole").value;
      return (
        (!q || x.r.name.toLowerCase().includes(q)) &&
        (!role ||
          x.r.role === role ||
          (role === "appointment_setter" && x.r.role === "canvasser"))
      );
    })
    .sort(
      (a, b) =>
        b.appts * 10 +
        b.interested * 2 +
        b.worked -
        (a.appts * 10 + a.interested * 2 + a.worked),
    );
}
function renderTeam() {
  const rows = pageRows(teamRows(), "team");
  $("teamTable").innerHTML = rows.length
    ? rows
        .map(
          (x) =>
            `<tr><td><b>${esc(x.r.name)}</b></td><td>${pill({ appointment_setter: "Appointment setter", canvasser: "Appointment setter", salesperson: "Sales rep", manager: "Manager", admin: "Admin" }[x.r.role] || x.r.role)}</td><td>${x.worked}</td><td>${x.appts}</td><td>${x.interested}</td><td>${x.last ? esc(date(x.last)) : "—"}</td><td>${x.r.active ? pill("Active") : pill("Inactive")}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="7"><div class="empty">No matching team members.</div></td></tr>';
}
function renderAppointments() {
  const q = ($("apptSearch").value || "").toLowerCase();
  const st = $("apptStage").value;
  const rows = appointments
    .filter((a) => {
      const l = index.leads.get(a.lead_id) || {};
      const blob = [l.name, l.address, l.city].join(" ").toLowerCase();
      const open = ["Requested", "Scheduled", "Confirmed"].includes(a.stage);
      const focused =
        !state.appointmentFocus ||
        (open &&
          (state.appointmentFocus === "unassigned"
            ? !a.salesperson_id
            : a.scheduled_at && new Date(a.scheduled_at) < new Date()));
      return (!q || blob.includes(q)) && (!st || a.stage === st) && focused;
    })
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  const notice = $("apptFocusNotice");
  if (notice) {
    notice.hidden = !state.appointmentFocus;
    notice.innerHTML = state.appointmentFocus
      ? `<span>${state.appointmentFocus === "unassigned" ? "Inspections needing a sales rep" : "Past due inspections"}</span><button type="button" class="btn" id="clearAppointmentFocus">Show all appointments</button>`
      : "";
    notice.querySelector("button")?.addEventListener("click", () => {
      state.appointmentFocus = "";
      viewLimits.appointments = 100;
      renderAppointments();
    });
  }
  $("apptTable").innerHTML =
    pageRows(rows, "appointments")
      .map((a) => {
        const l = index.leads.get(a.lead_id) || {};
        return `<tr><td><b>${esc(l.name || "")}</b><div class="small">${esc(l.address || "")}</div></td><td>${esc(date(a.scheduled_at))}</td><td>${esc(a.canvasser?.name || "—")}</td><td>${esc(a.salesperson?.name || "—")}</td><td>${pill(a.stage)}</td><td>${esc(a.notes || "")}</td></tr>`;
      })
      .join("") ||
    '<tr><td colspan="6"><div class="empty">No appointments match.</div></td></tr>';
}
function renderHomeowners() {
  const q = ($("homeSearch").value || "").toLowerCase();
  const st = $("homeStatus").value;
  const rows = homes.filter((h) => {
    const l = h.lead || {};
    const blob = [
      h.first_name,
      h.last_name,
      h.phone,
      h.email,
      h.address,
      l.name,
      l.address,
      l.city,
    ]
      .join(" ")
      .toLowerCase();
    return (!q || blob.includes(q)) && (!st || h.status === st);
  });
  $("homeTable").innerHTML =
    pageRows(rows, "homeowners")
      .map((h) => {
        const l = h.lead || {};
        return `<tr><td><b>${esc(`${h.first_name || ""} ${h.last_name || ""}`)}</b></td><td>${esc(h.phone || "")}<div class="small">${esc(h.email || "")}</div></td><td>${esc(h.address || l.address || "")}<div class="small">${esc(h.city || l.city || "")}, ${esc(h.state || l.state || "")} ${esc(h.zip || l.zip || "")}</div></td><td>${esc(h.concern || "—")}<div class="small">${esc(h.what_they_noticed || h.notes || "")}</div></td><td>${pill(h.source === "public_homeowner_form" ? "Inspection request" : "Inspection form")}</td><td>${pill(h.status)}</td><td>${esc(date(h.created_at))}</td></tr>`;
      })
      .join("") ||
    '<tr><td colspan="7"><div class="empty">No requests match.</div></td></tr>';
}
function fillPersonFilter() {
  const selected = $("activityPerson").value;
  $("activityPerson").innerHTML =
    '<option value="">All people</option>' +
    reps
      .filter((r) => r.active)
      .map((r) => `<option value="${r.id}">${esc(r.name)}</option>`)
      .join("");
  $("activityPerson").value = selected;
}
function activityHtml(a) {
  const l = index.leads.get(a.lead_id) || {};
  const actor = a.actor?.name || index.reps.get(a.actor_id)?.name || "System";
  const action =
    a.action === "status_changed"
      ? `status → ${a.metadata?.to_status || ""}`
      : a.action === "homeowner_request_submitted"
        ? "inspection request submitted"
        : a.action === "setter_appointment_booked"
          ? "inspection booked"
          : a.action === "appointment_booked"
            ? "appointment booked"
            : {
                inspection_completed: "inspection completed",
                inspection_reopened: "inspection reopened",
                handoff_assigned: "sales rep assigned",
                handoff_note: "handoff note added",
              }[a.action] || a.action;
  return `<div class="activityItem"><div class="activityTime">${esc(date(a.created_at))}</div><div><strong>${esc(actor)}</strong><p>${esc(action)} · ${esc(l.name || l.address || a.lead_id)}</p></div><div>${pill(a.metadata?.to_status || a.action)}</div></div>`;
}
function renderActivity() {
  const q = ($("activitySearch").value || "").toLowerCase();
  const person = $("activityPerson").value;
  const type = $("activityType").value;
  const rows = activities.filter((a) => {
    const l = index.leads.get(a.lead_id) || {};
    const blob = [a.action, a.metadata?.to_status, l.name, l.address]
      .join(" ")
      .toLowerCase();
    return (
      (!q || blob.includes(q)) &&
      (!person || a.actor_id === person) &&
      (!type || a.action === type)
    );
  });
  $("activityFeed").innerHTML =
    pageRows(rows, "activity").map(activityHtml).join("") ||
    '<div class="empty">No activity matches.</div>';
}
function renderTerritories() {
  const rows = territories.map((t) => {
    const city = index.cities.get(t.city) || { total: 0, mapped: 0 };
    const name =
      t.name !== t.city
        ? index.cities.get(t.name) || { total: 0, mapped: 0 }
        : { total: 0, mapped: 0 };
    const owner = t.owner?.name || "Unassigned";
    return `<tr><td><b>${esc(t.name)}</b></td><td>${fmt(city.total + name.total)}</td><td>${fmt(city.mapped + name.mapped)}</td><td>${esc(owner)}</td><td>${esc(t.owner?.role || "—")}</td></tr>`;
  });
  $("territoryTable").innerHTML =
    rows.join("") ||
    '<tr><td colspan="5"><div class="empty">No territories initialized.</div></td></tr>';
}
function renderAll() {
  if (state.tab === "overview") {
    renderMetrics();
    renderUpcoming();
    renderRecent();
    renderAttention();
  } else
    ({
      team: renderTeam,
      appointments: renderAppointments,
      homeowners: renderHomeowners,
      activity: renderActivity,
      territories: renderTerritories,
    })[state.tab]?.();
}
function toastMsg(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(window._tt);
  window._tt = setTimeout(() => el.classList.add("hidden"), 2400);
}
function showTab(tab) {
  const changed = state.tab !== tab;
  state.tab = tab;
  if (changed) window.scrollTo({ top: 0, behavior: "instant" });
  document.querySelectorAll("[data-tab]").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
    if (b.dataset.tab === tab) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  document
    .querySelectorAll("main section[id^=tab-]")
    .forEach((s) => s.classList.toggle("hidden", s.id !== `tab-${tab}`));
  renderAll();
  if (tab !== "files") history.replaceState(null, "", `#${tab}`);
}
function applyAdminHash() {
  const target = adminHashTarget(location.hash);
  if (!target.tab) return;
  if (["accounts","features"].includes(target.tab))
    document.querySelector(`#app [data-tab="${target.tab}"]`)?.click();
  else showTab(target.tab);
  if (target.messages) document.getElementById("openMessages")?.click();
}
function startRealtime() {
  if (adminChannel) return;
  adminChannel = sb.channel("tn-admin-live");
  for (const table of [
    "appointments",
    "homeowner_intakes",
    "lead_activity",
    "leads",
    "reps",
    "territories",
  ]) {
    adminChannel.on(
      "postgres_changes",
      { event: "*", schema: "public", table },
      () => {
        changedTables.add(table);
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          const refreshLeads = changedTables.has("leads");
          changedTables.clear();
          loadData({ refreshLeads }).catch((error) =>
            toastMsg(`Could not refresh: ${error.message}`),
          );
        }, 650);
      },
    );
  }
  adminChannel.subscribe();
}
function exportCsv() {
  const rows = activities.map((a) => ({
    created_at: a.created_at,
    actor: a.actor?.name || "",
    action: a.action,
    lead_id: a.lead_id,
    status: a.metadata?.to_status || "",
    metadata: JSON.stringify(a.metadata || {}),
  }));
  const head = Object.keys(rows[0] || {});
  const csv = [
    head.join(","),
    ...rows.map((r) =>
      head
        .map((k) => `"${String(r[k] ?? "").replaceAll('"', '""')}"`)
        .join(","),
    ),
  ].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "true-north-management-activity.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
boot().catch((error) => {
  const hold = document.getElementById("tnAdminHold");
  if (hold) {
    hold.innerHTML = `<div class="dashboardLoadError"><h1>Dashboard could not load</h1><p>${esc(error.message || "Please try again.")}</p><button type="button" class="btn" id="retryDashboard">Try again</button><a class="btn" href="/">Field map</a></div>`;
    document.getElementById("retryDashboard").onclick = () => location.reload();
  } else toastMsg(error.message || "Dashboard could not refresh.");
});

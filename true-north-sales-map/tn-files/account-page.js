import { bootFiles, signIn, signOut } from "./store.js";
import { bindSignOut, esc, mountSignIn, revealApp } from "./ui.js";
import { passwordChangeError } from "../lib/password-reset.js";
import { passwordUpdateError } from "../lib/must-change-password.js";
import { forgetRole, rememberRole } from "../lib/management-gate.js";
import { roleLabel, fieldHomeLinks } from "../lib/role-access.js";
import { MANAGEMENT_LINKS, canOpenManagement } from "../lib/account-rules.js";
import { mountAccountTraining } from "./training-account.js";
import { atlasIcon } from "../brand/atlas-icons.js";

const app = document.getElementById("app");

async function start() {
  const ctx = await bootFiles();
  bindSignOut(ctx, document.getElementById("signOut"));
  if (ctx.mode === "local") {
    revealApp();
    app.innerHTML =
      '<h1 class="tnTitle">My account</h1><p class="tnSub">Password changes need the live Supabase project. This preview is not connected.</p><a class="tnTap" href="/">Back to map</a>';
    return;
  }
  if (!ctx.session) return renderSignIn(ctx);
  revealApp();
  renderForm(ctx);
}

function renderSignIn(ctx) {
  mountSignIn(app);
  document.getElementById("tnLogin").onsubmit = async (event) => {
    event.preventDefault();
    try {
      await signIn(
        ctx,
        document.getElementById("tnEmail").value,
        document.getElementById("tnPassword").value,
      );
      revealApp();
      renderForm(ctx);
    } catch (error) {
      document.getElementById("tnLoginError").textContent = error.message;
    }
  };
}

function managementCard(ctx) {
  const email = ctx.session?.user?.email || ctx.rep?.email || "";
  if (
    !canOpenManagement({
      email,
      rep: ctx.rep,
      adminEmails: ctx.cfg?.adminEmails,
    })
  )
    return "";
  const links = MANAGEMENT_LINKS.map(
    (link) =>
      `<a class="profileAction" href="${esc(link.href)}">${atlasIcon(link.href.includes("shifts") ? "activity" : link.href.includes("files") ? "files" : "overview")}<b>${esc(link.label)}</b><span>${esc(link.hint)}</span><i aria-hidden="true">↗</i></a>`,
  ).join("");
  return `<section class="profileSection" id="managementDashboard" data-tn-panel="account-management" data-tn-rank="secondary"><div class="profileSectionHead formHeader"><h2>Management tools</h2><span>Your office workspace</span></div><div class="profileActionGrid">${links}</div></section>`;
}

function renderForm(ctx) {
  const who = ctx.rep?.name || ctx.session.user.email || "Signed in";
  const initials = who
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
  const guidance = ["appointment_setter", "canvasser"].includes(ctx.rep?.role)
    ? "Find the homeowner. Book the inspection. Leave a clear handoff."
    : ctx.rep?.role === "salesperson"
      ? "Inspect the property. Document what you find. Keep the homeowner informed."
      : "Keep the team, inspections, and paperwork moving.";
  const hints = {
    map: "Explore your territory and build your next route.",
    inspection: "Book an inspection with a complete homeowner handoff.",
    forms: "Keep your submitted forms and paperwork together.",
    photos: "Find a property and capture clear roof documentation.",
    training: "Build your skills with lessons and guided practice.",
  };
  const actions = fieldHomeLinks(ctx.rep?.role)
    .filter((link) => !["account", "message"].includes(link.id))
    .map(
      (link) =>
        `<a class="profileAction" href="${esc(link.href)}">${atlasIcon(link.id)}<b>${esc(link.label)}</b><span>${esc(hints[link.id] || "")}</span><i aria-hidden="true">↗</i></a>`,
    )
    .join("");
  const role = ctx.rep?.role;
  const setter = ["appointment_setter", "canvasser"].includes(role);
  const primary = setter
    ? { href: "/setter.html", label: "Book an inspection" }
    : role === "salesperson"
      ? { href: "/rep.html", label: "Open roof photos" }
      : { href: "/", label: "Open the field map" };
  app.innerHTML = `<section class="profileHero" data-role="${esc(role || "member")}"><div class="profileAvatar" aria-hidden="true">${esc(initials)}</div><div><div class="eyebrow">${setter ? "SETTER WORKSPACE" : role === "salesperson" ? "SALES WORKSPACE" : "YOUR WORKSPACE"}</div><h1 class="tnTitle">${esc(who)}</h1><span class="profileRole">${esc(roleLabel(role) || "Team member")}</span><p>${guidance}</p><a class="tnTap primary atlasProfileStart" href="${primary.href}">${primary.label} ${atlasIcon("arrow")}</a></div></section>
    ${managementCard(ctx)}
    <section class="profileSection"><div class="profileSectionHead"><h2>Your field tools</h2><span>Pick up where you need to work</span></div><div class="profileActionGrid">${actions}</div></section>
    <div id="tnAccountTraining"></div>
    <form id="pwForm" class="tnCard" data-tn-panel="account-password" data-tn-rank="primary">
      <div class="eyebrow">ACCOUNT SECURITY</div><h2>Update your password</h2>
      <label class="tnLabel" for="pw1">New password</label>
      <input class="tnInput" id="pw1" type="password" autocomplete="new-password" minlength="8" required>
      <label class="tnLabel" for="pw2">Confirm new password</label>
      <input class="tnInput" id="pw2" type="password" autocomplete="new-password" minlength="8" required>
      <p class="tnHelp">At least 8 characters. Use this the next time you sign in.</p>
      <button class="tnTap dark" type="submit">Change password</button>
      <p id="pwMsg" class="tnHelp"></p>
    </form>
    <p class="tnAccountBtns" style="margin-top:16px"><a class="tnTap tnOutline" href="/">Back to map</a><button id="accountSignOut" class="tnTap" type="button">Sign out</button></p>`;
  document.getElementById("pwForm").onsubmit = (event) => save(event, ctx);
  mountAccountTraining(document.getElementById("tnAccountTraining"), ctx).catch(
    () => {},
  );
  if (ctx.rep?.role && ctx.session?.user?.id)
    rememberRole(localStorage, ctx.session.user.id, ctx.rep.role);
  document.getElementById("accountSignOut").onclick = async () => {
    const { coverForSignOut } = await import("../brand/loader.js");
    coverForSignOut(document);
    forgetRole(localStorage, ctx.session?.user?.id);
    await signOut(ctx);
    location.href = "/";
  };
}

async function save(event, ctx) {
  event.preventDefault();
  const msg = document.getElementById("pwMsg");
  const first = document.getElementById("pw1").value;
  const second = document.getElementById("pw2").value;
  msg.className = "tnError";
  const problem = passwordChangeError(first, second);
  if (problem) {
    msg.textContent = problem;
    return;
  }
  msg.className = "tnHelp";
  msg.textContent = "Saving…";
  const { error } = await ctx.sb.auth.updateUser({ password: first });
  if (error) {
    msg.className = "tnError";
    msg.textContent = passwordUpdateError(error, first);
    return;
  }
  const cleared = await ctx.sb.rpc("clear_must_change_password");
  if (cleared.error) {
    msg.className = "tnError";
    msg.textContent = passwordUpdateError(cleared.error, first);
    return;
  }
  document.getElementById("pw1").value = "";
  document.getElementById("pw2").value = "";
  msg.className = "tnHelp";
  msg.textContent = "Password saved.";
}

start();

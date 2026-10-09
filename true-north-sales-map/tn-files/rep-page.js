import {
  bootFiles,
  signIn,
  searchLeads,
  listPhotoPage,
  groupPhotosByAddress,
} from "./store.js";
import { esc, bindSignOut, mountSignIn, revealApp, actionRow } from "./ui.js";
import { canUsePhotoBank } from "./logic.js";
import { fieldHomeLinks, roleLabel } from "../lib/role-access.js";

const app = document.getElementById("app");
let ctx;

async function start() {
  ctx = await bootFiles();
  bindSignOut(ctx, document.getElementById("signOut"));
  if (ctx.mode === "cloud" && !ctx.session) return renderSignIn();
  revealApp();
  render();
}

function renderSignIn() {
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
      render();
    } catch (error) {
      document.getElementById("tnLoginError").textContent = error.message;
    }
  };
}

function homeLinks(role) {
  return fieldHomeLinks(role)
    .map((item) => {
      if (item.id === "photos") return "";
      if (item.action === "message")
        return `<a class="tnTap" href="/?open=messages">${esc(item.label)}</a>`;
      return `<a class="tnTap${item.id === "inspection" ? " dark" : ""}" href="${esc(item.href)}">${esc(item.label)}</a>`;
    })
    .join("");
}

function render() {
  const role = ctx.rep?.role;
  const photos = canUsePhotoBank(role, ctx.mode);
  const who = ctx.rep ? `${ctx.rep.name} · ${roleLabel(role)}` : "This phone";
  if (!photos) {
    app.innerHTML = `<p class="tnProgress">${esc(who)}</p><h1 class="tnTitle">Appointment setter</h1><p class="tnSub">Photos are for sales reps. You can still send inspections, fill forms assigned to you, and message management.</p><div class="tnStack">${homeLinks(role)}</div>`;
    return;
  }
  app.innerHTML = `${ctx.mode === "local" ? '<div class="tnBanner">Saved on this phone until Supabase storage is connected.</div>' : ""}<section class="profileHero" data-role="salesperson"><div><div class="eyebrow">PROPERTY DOCUMENTATION</div><h1 class="tnTitle">Every inspection, documented.</h1><p>${esc(who)} · Search a property to add photos or complete a form.</p></div></section><section class="tnCard propertySearchCard" data-tn-panel="rep-search" data-tn-rank="primary"><h2>Find a property</h2><label class="tnLabel" for="q">Find a property</label><input class="tnInput" id="q" placeholder="Search address or homeowner" autocomplete="off"><p class="tnHelp">Enter at least two characters. Your photos and forms stay attached to the property.</p><div id="hits" class="tnStack" aria-live="polite"></div></section><section data-tn-panel="rep-photos" data-tn-rank="secondary"><div class="profileSectionHead"><h2>Property photo bank</h2><span>Organized by address</span></div><div id="groups" class="tnStack"></div></section><section class="profileSection"><div class="profileSectionHead"><h2>Field tools</h2></div><div class="roleToolsGrid">${homeLinks(role)}${ctx.rep && (ctx.rep.role === "admin" || ctx.rep.role === "manager") ? '<a class="tnTap" href="/files.html">Files & Forms</a>' : ""}</div></section>`;
  const input = document.getElementById("q");
  let timer;
  input.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => runSearch(input.value), 200);
  };
  loadGroups(true);
}

let searchGeneration = 0;
async function runSearch(query) {
  const generation = ++searchGeneration;
  const hits = document.getElementById("hits");
  if (!hits) return;
  if (query.trim().length < 2) {
    hits.innerHTML = "";
    hits.removeAttribute("aria-busy");
    return;
  }
  let rows = [];
  hits.setAttribute("aria-busy", "true");
  try {
    rows = await searchLeads(ctx, query);
  } catch (error) {
    if (generation === searchGeneration) {
      hits.innerHTML = `<p class="tnError">${esc(error.message)}</p>`;
      hits.removeAttribute("aria-busy");
    }
    return;
  }
  if (generation !== searchGeneration) return;
  hits.removeAttribute("aria-busy");
  hits.innerHTML = "";
  if (!rows.length) {
    hits.innerHTML = '<p class="tnSub">No matching house.</p>';
    return;
  }
  rows.forEach((lead) => {
    const card = document.createElement("div");
    card.className = "tnCard";
    card.innerHTML = `<b>${esc(lead.address || "House")}</b><span>${esc(lead.name || "")} · ${esc([lead.city, lead.state].filter(Boolean).join(", "))}</span>`;
    card.append(actionRow(lead, { photos: true }));
    hits.append(card);
  });
}

let bankGeneration = 0;
let bankPhotos = [];
let bankOffset = 0;

function paintGroups(groups) {
  const grouped = groupPhotosByAddress(bankPhotos);
  groups.classList.add("propertyPhotoGrid");
  groups.innerHTML = grouped.length
    ? grouped.map((group) => `<a class="tnCard" href="/photo.html?lead=${encodeURIComponent(group.lead_id || '')}&address=${encodeURIComponent(group.address)}"><b>${esc(group.address)}</b><span>${group.photos.length} photo${group.photos.length === 1 ? '' : 's'} loaded · Open full property history →</span></a>`).join('')
    : '<div class="profileEmpty"><b>Your photo bank starts with a property.</b><p>Search an address above, then choose Add Photo. Each inspection will have its own photo history.</p></div>';
  if (bankOffset !== null) groups.insertAdjacentHTML('beforeend', '<button type="button" class="tnTap" data-bank-more>Load older property records</button>');
  const more = groups.querySelector('[data-bank-more]');
  if (more) more.onclick = () => loadGroups(false);
}

async function loadGroups(reset = false) {
  const groups = document.getElementById("groups");
  if (!groups) return;
  const generation = ++bankGeneration;
  if (reset) { bankPhotos = []; bankOffset = 0; groups.innerHTML = '<p class="tnSub" role="status">Loading property records…</p>'; }
  groups.querySelector('[data-bank-error]')?.remove();
  groups.querySelector('[data-bank-retry]')?.remove();
  groups.setAttribute('aria-busy', 'true');
  const more = groups.querySelector('[data-bank-more]');
  if (more) { more.disabled = true; more.textContent = 'Loading…'; }
  try {
    const page = await listPhotoPage(ctx, { offset: bankOffset || 0, pageSize: 100, signUrls: false });
    if (generation !== bankGeneration || !groups.isConnected) return;
    const ids = new Set(bankPhotos.map((photo) => photo.id));
    bankPhotos.push(...page.photos.filter((photo) => !ids.has(photo.id)));
    bankOffset = page.nextOffset;
    paintGroups(groups);
  } catch (error) {
    if (generation !== bankGeneration || !groups.isConnected) return;
    groups.querySelector('[data-bank-error]')?.remove();
    groups.insertAdjacentHTML('beforeend', `<p class="tnError" data-bank-error>${esc(error.message)}</p><button type="button" class="tnTap" data-bank-retry>Retry property records</button>`);
    groups.querySelector('[data-bank-retry]').onclick = () => loadGroups(reset);
    if (more) { more.disabled = false; more.textContent = 'Load older property records'; }
  } finally {
    if (generation === bankGeneration && groups.isConnected) groups.removeAttribute('aria-busy');
  }
}

start();

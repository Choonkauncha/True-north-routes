import { bootFiles, signIn, searchLeads, listPhotos, groupPhotosByAddress } from './store.js';
import { esc, bindSignOut, signInCard, actionRow } from './ui.js';
import { canUsePhotoBank } from './logic.js';
import { fieldHomeLinks, roleLabel } from '../lib/role-access.js';

const app = document.getElementById('app');
let ctx;

async function start() {
  ctx = await bootFiles();
  bindSignOut(ctx, document.getElementById('signOut'));
  if (ctx.mode === 'cloud' && !ctx.session) return renderSignIn();
  render();
}

function renderSignIn() {
  app.innerHTML = signInCard();
  document.getElementById('tnLogin').onsubmit = async (event) => {
    event.preventDefault();
    try { await signIn(ctx, document.getElementById('tnEmail').value, document.getElementById('tnPassword').value); render(); }
    catch (error) { document.getElementById('tnLoginError').textContent = error.message; }
  };
}

function homeLinks(role) {
  return fieldHomeLinks(role).map((item) => {
    if (item.id === 'photos') return '';
    if (item.action === 'message') return `<a class="tnTap" href="/?open=messages">${esc(item.label)}</a>`;
    return `<a class="tnTap${item.id === 'inspection' ? ' dark' : ''}" href="${esc(item.href)}">${esc(item.label)}</a>`;
  }).join('');
}

function render() {
  const role = ctx.rep?.role;
  const photos = canUsePhotoBank(role, ctx.mode);
  const who = ctx.rep ? `${ctx.rep.name} · ${roleLabel(role)}` : 'This phone';
  if (!photos) {
    app.innerHTML = `<p class="tnProgress">${esc(who)}</p><h1 class="tnTitle">Appointment setter</h1><p class="tnSub">Photos are for sales reps. You can still send inspections, fill forms assigned to you, and message management.</p><div class="tnStack">${homeLinks(role)}</div>`;
    return;
  }
  app.innerHTML = `${ctx.mode === 'local' ? '<div class="tnBanner">Saved on this phone until Supabase storage is connected.</div>' : ''}<p class="tnProgress">${esc(who)}</p><h1 class="tnTitle">Sales</h1><p class="tnSub">Search the house, then add a roof photo or fill a form.</p><label class="tnLabel" for="q">House</label><input class="tnInput" id="q" placeholder="Address or homeowner"><div id="hits" class="tnStack" style="margin-top:10px"></div><h2 style="margin:22px 0 8px">Photos by house</h2><div id="groups" class="tnStack"></div><div class="tnStack" style="margin-top:16px">${homeLinks(role)}${ctx.rep && (ctx.rep.role === 'admin' || ctx.rep.role === 'manager') ? '<a class="tnTap" href="/files.html">Files & Forms</a>' : ''}</div>`;
  const input = document.getElementById('q');
  let timer;
  input.oninput = () => { clearTimeout(timer); timer = setTimeout(() => runSearch(input.value), 200); };
  input.focus();
  loadGroups();
}

async function runSearch(query) {
  const hits = document.getElementById('hits');
  if (!hits) return;
  if (query.trim().length < 2) { hits.innerHTML = ''; return; }
  let rows = [];
  try { rows = await searchLeads(ctx, query); }
  catch (error) { hits.innerHTML = `<p class="tnError">${esc(error.message)}</p>`; return; }
  hits.innerHTML = '';
  if (!rows.length) { hits.innerHTML = '<p class="tnSub">No matching house.</p>'; return; }
  rows.forEach((lead) => {
    const card = document.createElement('div');
    card.className = 'tnCard';
    card.innerHTML = `<b>${esc(lead.address || 'House')}</b><span>${esc(lead.name || '')} · ${esc([lead.city, lead.state].filter(Boolean).join(', '))}</span>`;
    card.append(actionRow(lead, { photos: true }));
    hits.append(card);
  });
}

async function loadGroups() {
  const groups = document.getElementById('groups');
  if (!groups) return;
  try {
    const grouped = groupPhotosByAddress(await listPhotos(ctx));
    groups.innerHTML = grouped.length ? grouped.map((group) => `<a class="tnCard" href="/photo.html?lead=${esc(group.lead_id)}&address=${esc(group.address)}"><b>${esc(group.address)}</b><span>${group.photos.length} photo${group.photos.length === 1 ? '' : 's'}</span></a>`).join('') : '<p class="tnSub">No photos yet. Search a house and tap Add Photo.</p>';
  } catch (error) {
    groups.innerHTML = `<p class="tnError">${esc(error.message)}</p>`;
  }
}

start();

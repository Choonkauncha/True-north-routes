import { bootFiles, signIn, getSubmission } from './store.js';
import { esc, bindSignOut, mountSignIn, revealApp } from './ui.js';
import { isManagement } from './logic.js';

const app = document.getElementById('app');
const id = new URLSearchParams(location.search).get('id');

async function start() {
  const ctx = await bootFiles();
  bindSignOut(ctx, document.getElementById('signOut'));
  if (!id) { revealApp(); app.innerHTML = '<p class="tnSub">Missing form.</p><a class="tnTap" href="/files.html">Files & Forms</a>'; return; }
  if (ctx.mode === 'cloud' && !ctx.session) return renderSignIn(ctx);
  await show(ctx);
}

function renderSignIn(ctx) {
  mountSignIn(app);
  document.getElementById('tnLogin').onsubmit = async (event) => {
    event.preventDefault();
    try { await signIn(ctx, document.getElementById('tnEmail').value, document.getElementById('tnPassword').value); await show(ctx); }
    catch (error) { document.getElementById('tnLoginError').textContent = error.message; }
  };
}

async function show(ctx) {
  revealApp();
  const row = await getSubmission(ctx, id).catch((error) => ({ error }));
  if (!row || row.error || !row.id) {
    app.innerHTML = `<p class="tnError">${esc(row?.error?.message || 'That form is not available.')}</p><a class="tnTap" href="/files.html">Files & Forms</a>`;
    return;
  }
  const when = (() => { try { return new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeStyle: 'short' }).format(new Date(row.created_at)); } catch { return row.created_at || ''; } })();
  const fields = row.fields || [];
  const body = fields.map((field) => {
    const value = row.answers?.[field.id];
    let inner = esc(value || '—');
    if (field.type === 'checkbox') inner = value ? 'Yes' : 'No';
    if (value && typeof value === 'object' && value.url) inner = `<img class="${field.type === 'signature' ? 'tnSignImg' : 'tnPreview'}" alt="${esc(field.label)}" src="${esc(value.url)}">`;
    return `<div class="tnPrintRow"><b>${esc(field.label)}</b>${inner}</div>`;
  }).join('');
  app.innerHTML = `<div class="tnNoPrint tnStack" style="margin-bottom:12px"><button class="tnTap primary" type="button" id="printBtn">Print</button><a class="tnTap" href="${ctx.mode === 'cloud' && !isManagement(ctx.rep?.role) ? '/rep.html' : '/files.html'}">Back</a></div>
    <article class="tnPrintSheet">${row.is_draft ? `<div class="tnBanner">${esc(row.draft_notice || 'Draft. Replace with True North’s own wording.')}</div>` : ''}<div class="eyebrow">TRUE NORTH RESTORATIONS</div><h1>${esc(row.template_name)}</h1><p class="tnSub">${esc(row.homeowner_name || '')}<br>${esc(row.address_snapshot || '')}<br>${esc(row.rep_name || '')} · ${esc(when)}</p>${body}</article>`;
  document.getElementById('printBtn').onclick = () => window.print();
}

start();

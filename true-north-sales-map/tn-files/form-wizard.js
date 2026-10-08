import { bootFiles, signIn, getLead, listTemplates, listAssignments, searchLeads, uploadFormAsset, saveSubmission, plainError } from './store.js';
import { esc, bindSignOut, signInCard, mountSignature, compressImage, houseBackHref } from './ui.js';
import { screensFromFields, initialAnswers, validateScreen, snapshotHomeowner, formatAddress, PREVIEW_LEAD, audienceLabel } from './logic.js';
import { canSeeForm, canUsePhotoBank } from '../lib/role-access.js';

const app = document.getElementById('app');
const params = new URLSearchParams(location.search);
const preview = params.get('preview') === '1';
let ctx, templates = [], template = null, lead = null, screens = [], sectionIndex = 0, answers = {}, media = new Map(), pads = [], phase = 'house', saved = null;

function queryLead() {
  if (!params.get('lead') && !params.get('address')) return null;
  return { id: params.get('lead') || '', name: params.get('name') || '', address: params.get('address') || '', city: params.get('city') || '', state: params.get('state') || '', zip: params.get('zip') || '' };
}

async function start() {
  ctx = await bootFiles();
  bindSignOut(ctx, document.getElementById('signOut'));
  if (!preview && ctx.mode === 'cloud' && !ctx.session) return renderSignIn();
  if (preview) {
    const raw = sessionStorage.getItem('tn-form-preview');
    template = raw ? JSON.parse(raw) : null;
    lead = PREVIEW_LEAD;
    if (!template) { app.innerHTML = '<p class="tnSub">Nothing to preview.</p><a class="tnTap" href="/files.html">Back to forms</a>'; return; }
    beginTemplate();
    phase = template.kind === 'file' ? 'file' : 'section';
    return render();
  }
  const repNav = document.getElementById('repNav');
  if (repNav) repNav.classList.toggle('hidden', !canUsePhotoBank(ctx.rep?.role, ctx.mode));
  lead = queryLead();
  if (params.get('lead')) {
    const found = await getLead(ctx, params.get('lead')).catch(() => null);
    if (found) lead = { ...lead, ...found };
  }
  const assignments = await listAssignments(ctx).catch(() => []);
  templates = (await listTemplates(ctx)).filter((item) => item.active !== false && canSeeForm(ctx.rep?.role, item, { repId: ctx.rep?.id, assignments, mode: ctx.mode }));
  if (params.get('template')) template = templates.find((item) => item.id === params.get('template')) || null;
  if (!lead) phase = 'house';
  else if (!template && templates.length === 1) { template = templates[0]; openTemplate(); }
  else if (!template) phase = 'pick';
  else openTemplate();
  render();
}

function openTemplate() {
  beginTemplate();
  phase = template?.kind === 'file' ? 'file' : (screens.length ? 'section' : 'review');
}

function beginTemplate() {
  screens = screensFromFields(template.fields || []);
  answers = initialAnswers(template.fields || [], lead);
  media = new Map();
  sectionIndex = 0;
}

function renderSignIn() {
  app.innerHTML = signInCard();
  document.getElementById('tnLogin').onsubmit = async (event) => {
    event.preventDefault();
    try { await signIn(ctx, document.getElementById('tnEmail').value, document.getElementById('tnPassword').value); start(); }
    catch (error) { document.getElementById('tnLoginError').textContent = error.message; }
  };
}

function banner() {
  const bits = [];
  if (ctx?.mode === 'local' && !preview) bits.push('<div class="tnBanner">Saved on this phone until Supabase is connected.</div>');
  if (preview) bits.push('<div class="tnBanner">Preview. Nothing will be saved.</div>');
  else if (template?.is_draft && phase !== 'house' && phase !== 'pick') bits.push(`<div class="tnBanner">${esc(template.draft_notice || 'Draft. Use True North’s own wording before a homeowner signs.')}</div>`);
  return bits.join('');
}

function render() {
  pads.forEach((pad) => pad.destroy?.());
  pads = [];
  if (phase === 'house') return renderHouse();
  if (phase === 'pick') return renderPick();
  if (phase === 'file') return renderFile();
  if (phase === 'section') return renderSection();
  if (phase === 'review') return renderReview();
  if (phase === 'success') return renderSuccess();
}

function renderHouse() {
  app.innerHTML = `${banner()}<p class="tnProgress">Choose the house</p><h1 class="tnTitle">Which house?</h1><label class="tnLabel" for="houseQ">Search address or name</label><input class="tnInput" id="houseQ" placeholder="Start typing an address"><div id="houseHits" class="tnStack" style="margin-top:10px"></div><div class="tnSticky"><a class="tnTap" href="/">Back to map</a></div>`;
  const input = document.getElementById('houseQ');
  let timer;
  input.oninput = () => { clearTimeout(timer); timer = setTimeout(() => runSearch(input.value), 200); };
  input.focus();
}

async function runSearch(query) {
  const hits = document.getElementById('houseHits');
  if (!hits) return;
  if (query.trim().length < 2) { hits.innerHTML = ''; return; }
  const rows = await searchLeads(ctx, query).catch((error) => { hits.innerHTML = `<p class="tnError">${esc(error.message)}</p>`; return []; });
  hits.innerHTML = rows.length ? rows.map((row) => `<button type="button" class="tnTap tnChoice" data-id="${esc(row.id)}"><span><b>${esc(row.address || 'House')}</b><span class="tnMeta">${esc(row.name || '')} ${esc(row.city || '')}</span></span></button>`).join('') : '<p class="tnSub">No matching house.</p>';
  hits.querySelectorAll('button').forEach((button) => button.onclick = () => chooseHouse(rows.find((row) => row.id === button.dataset.id)));
}

function chooseHouse(row) {
  lead = row;
  if (templates.length === 1) { template = templates[0]; openTemplate(); }
  else phase = 'pick';
  render();
}

function renderFile() {
  const fileLabel = template.file_name || template.name;
  app.innerHTML = `${banner()}<a class="tnTap" href="${esc(houseBackHref(lead))}">Back to this house</a><h1 class="tnTitle" style="margin-top:12px">${esc(template.name)}</h1><p class="tnSub">${esc(fileLabel)}. View it, then send a completed copy if you have one.</p><div class="tnStack"><a class="tnTap primary" id="openFile" href="#" target="_blank" rel="noopener">View or download</a><label class="tnTap">Attach completed copy<input id="returnFile" type="file" accept="application/pdf,image/*"></label><p id="returnName" class="tnSub"></p><button class="tnTap dark" id="sendFile" type="button">Send to management</button><p id="fileError" class="tnError"></p></div>`;
  let attachment = null;
  document.getElementById('returnFile').onchange = () => {
    attachment = document.getElementById('returnFile').files?.[0] || null;
    document.getElementById('returnName').textContent = attachment ? attachment.name : '';
  };
  document.getElementById('sendFile').onclick = () => sendFileCopy(attachment);
  openLibraryFile();
}

async function openLibraryFile() {
  const link = document.getElementById('openFile');
  if (!link || !template?.storage_path) return;
  if (String(template.storage_path).startsWith('local:')) {
    const { pendingObjectUrl } = await import('./store.js');
    const url = await pendingObjectUrl(String(template.storage_path).slice(6));
    if (url) {
      link.href = url;
      link.setAttribute('download', template.file_name || 'form');
    }
    return;
  }
  if (ctx.mode === 'local') {
    link.removeAttribute('href');
    return;
  }
  const signed = await ctx.sb.storage.from('form-assets').createSignedUrl(template.storage_path, 60 * 60);
  if (signed.data?.signedUrl) {
    link.href = signed.data.signedUrl;
    link.setAttribute('download', template.file_name || 'form');
  }
}

async function sendFileCopy(attachment) {
  const error = document.getElementById('fileError');
  const button = document.getElementById('sendFile');
  button.disabled = true;
  error.textContent = 'Sending…';
  try {
    let attachment_path = '';
    let attachment_name = '';
    if (attachment) {
      const uploaded = await uploadFormAsset(ctx, { leadId: lead?.id, blob: attachment, contentType: attachment.type || 'application/octet-stream' });
      attachment_path = uploaded.path;
      attachment_name = attachment.name;
    }
    saved = await saveSubmission(ctx, {
      template_id: template.id,
      template_name: template.name,
      lead_id: lead?.id || null,
      address_snapshot: formatAddress(lead),
      homeowner_name: lead?.name || '',
      fields: [],
      answers: {},
      is_draft: false,
      draft_notice: '',
      attachment_path,
      attachment_name
    });
    phase = 'success';
    render();
  } catch (err) {
    button.disabled = false;
    error.textContent = plainError(err);
  }
}

function renderPick() {
  app.innerHTML = `${banner()}<a class="tnTap" href="${esc(houseBackHref(lead))}">Back to this house</a><h1 class="tnTitle" style="margin-top:12px">Which form?</h1><p class="tnSub">${esc(formatAddress(lead) || lead?.name || '')}</p><div class="tnStack">${templates.length ? templates.map((item) => `<button type="button" class="tnCard" data-id="${esc(item.id)}"><b>${esc(item.name)}</b><span>${esc(audienceLabel(item.audience))}${item.is_draft ? ' · Draft' : ''}</span></button>`).join('') : '<p class="tnSub">No forms are assigned to you yet.</p><a class="tnTap" href="' + esc(houseBackHref(lead)) + '">Back to this house</a>'}</div>`;
  app.querySelectorAll('[data-id]').forEach((button) => button.onclick = () => {
    template = templates.find((item) => item.id === button.dataset.id);
    openTemplate();
    render();
  });
}

function renderSection() {
  const screen = screens[sectionIndex];
  if (!screen) { phase = 'review'; return renderReview(); }
  const total = screens.length + 1;
  const fields = screen.fields.map((field) => fieldHtml(field)).join('');
  app.innerHTML = `${banner()}<p class="tnProgress">${sectionIndex + 1} of ${total}</p><h1 class="tnTitle">${esc(screen.title)}</h1><p class="tnSub">${esc(template.name)}</p>${fields}<p id="stepError" class="tnError"></p><div class="tnSticky"><button class="tnTap primary" id="nextBtn" type="button">${sectionIndex === screens.length - 1 ? 'Review' : 'Next'}</button><button class="tnTap" id="backBtn" type="button">Back</button></div>`;
  bindFields(screen);
  document.getElementById('nextBtn').onclick = () => goNext(screen);
  document.getElementById('backBtn').onclick = goBack;
}

function fieldHtml(field) {
  const value = answers[field.id];
  const help = field.help ? `<p class="tnHelp">${esc(field.help)}</p>` : '';
  if (field.type === 'textarea') return `<label class="tnLabel" for="f-${esc(field.id)}">${esc(field.label)}</label>${help}<textarea class="tnArea" id="f-${esc(field.id)}">${esc(value || '')}</textarea><p class="tnError" id="e-${esc(field.id)}"></p>`;
  if (field.type === 'checkbox') return `<button type="button" class="tnCheck${value ? ' on' : ''}" id="f-${esc(field.id)}">${esc(field.label)}</button><p class="tnError" id="e-${esc(field.id)}"></p>`;
  if (field.type === 'select') {
    const options = (field.options || []).map((option) => `<button type="button" class="tnTap tnChoice${value === option ? ' on' : ''}" data-option="${esc(option)}">${esc(option)}</button>`).join('');
    return `<p class="tnLabel">${esc(field.label)}</p>${help}<div class="tnStack" id="f-${esc(field.id)}">${options}</div><p class="tnError" id="e-${esc(field.id)}"></p>`;
  }
  if (field.type === 'signature' || field.type === 'photo') {
    const existing = media.get(field.id);
    const preview = existing ? `<img class="tnPreview" alt="" src="${esc(existing.url)}" style="margin-top:8px">` : '';
    if (field.type === 'photo') return `<p class="tnLabel">${esc(field.label)}</p>${help}${preview}<label class="tnTap primary" style="margin-top:8px">${existing ? 'Retake' : 'Take photo'}<input id="f-${esc(field.id)}" type="file" accept="image/*" capture="environment"></label><p class="tnError" id="e-${esc(field.id)}"></p>`;
    return `<p class="tnLabel">${esc(field.label)}</p>${help}${preview}<canvas class="tnSign" id="f-${esc(field.id)}"></canvas><button class="tnTap" type="button" id="clear-${esc(field.id)}" style="margin-top:8px">Clear signature</button><p class="tnError" id="e-${esc(field.id)}"></p>`;
  }
  const type = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text';
  return `<label class="tnLabel" for="f-${esc(field.id)}">${esc(field.label)}</label>${help}<input class="tnInput" id="f-${esc(field.id)}" type="${type}" value="${esc(value || '')}"><p class="tnError" id="e-${esc(field.id)}"></p>`;
}

function bindFields(screen) {
  for (const field of screen.fields) {
    const node = document.getElementById(`f-${field.id}`);
    if (field.type === 'checkbox' && node) node.onclick = () => { answers[field.id] = !answers[field.id]; node.classList.toggle('on', answers[field.id]); };
    if (field.type === 'select' && node) node.querySelectorAll('[data-option]').forEach((button) => button.onclick = () => {
      answers[field.id] = button.dataset.option;
      node.querySelectorAll('[data-option]').forEach((item) => item.classList.toggle('on', item === button));
    });
    if (field.type === 'signature' && node) {
      const pad = mountSignature(node);
      pads.push(pad);
      document.getElementById(`clear-${field.id}`).onclick = () => { pad.clear(); media.delete(field.id); answers[field.id] = null; };
    }
    if (field.type === 'photo' && node) node.onchange = async () => {
      const file = node.files?.[0];
      if (!file) return;
      try {
        screen.fields.forEach((item) => {
          const input = document.getElementById(`f-${item.id}`);
          if (input && ['text', 'textarea', 'number', 'date'].includes(item.type)) answers[item.id] = input.value;
        });
        const blob = await compressImage(file);
        media.set(field.id, { blob, url: URL.createObjectURL(blob), kind: 'photo', contentType: 'image/jpeg' });
        answers[field.id] = true;
        render();
      } catch (error) { document.getElementById(`e-${field.id}`).textContent = error.message; }
    };
  }
}

async function collect(screen) {
  for (const field of screen.fields) {
    const node = document.getElementById(`f-${field.id}`);
    if (['text', 'textarea', 'number', 'date'].includes(field.type) && node) answers[field.id] = node.value;
    if (field.type === 'signature') {
      const padIndex = screen.fields.filter((item) => item.type === 'signature').indexOf(field);
      const live = pads[padIndex];
      if (live && !live.isBlank()) {
        const blob = await live.toBlob();
        media.set(field.id, { blob, url: URL.createObjectURL(blob), kind: 'signature', contentType: 'image/png' });
        answers[field.id] = true;
      } else if (media.has(field.id)) answers[field.id] = true;
      else answers[field.id] = null;
    }
    if (field.type === 'photo') answers[field.id] = media.has(field.id) ? true : null;
  }
}

async function goNext(screen) {
  await collect(screen);
  const errors = validateScreen(screen.fields, answers);
  if (Object.keys(errors).length) {
    for (const [id, message] of Object.entries(errors)) {
      const slot = document.getElementById(`e-${id}`);
      if (slot) slot.textContent = message;
    }
    return;
  }
  if (sectionIndex < screens.length - 1) { sectionIndex += 1; phase = 'section'; }
  else phase = 'review';
  render();
}

function goBack() {
  if (sectionIndex > 0) { sectionIndex -= 1; phase = 'section'; return render(); }
  if (preview) { history.length > 1 ? history.back() : location.href = '/files.html'; return; }
  if (templates.length !== 1) { phase = 'pick'; template = null; return render(); }
  if (!params.get('lead')) { phase = 'house'; lead = null; template = null; return render(); }
  location.href = houseBackHref(lead);
}

function renderReview() {
  const rows = (template.fields || []).map((field) => {
    const value = answers[field.id];
    let body = esc(value || '—');
    if (field.type === 'checkbox') body = value ? 'Yes' : 'No';
    const shot = media.get(field.id);
    if (shot) body = `<img class="${field.type === 'signature' ? 'tnSignImg' : 'tnPreview'}" alt="${esc(field.label)}" src="${esc(shot.url)}">`;
    return `<div class="tnPrintRow"><b>${esc(field.label)}</b>${body}</div>`;
  }).join('');
  app.innerHTML = `${banner()}<p class="tnProgress">Last step</p><h1 class="tnTitle">Look it over</h1><p class="tnSub">${esc(template.name)} · ${esc(formatAddress(lead) || 'No house')}</p><div class="tnCard">${rows}</div><p id="stepError" class="tnError"></p><div class="tnSticky"><button class="tnTap primary" id="submitBtn" type="button">${preview ? 'Finish preview' : 'Submit'}</button><button class="tnTap" id="backBtn" type="button">Back</button></div>`;
  document.getElementById('backBtn').onclick = () => { phase = 'section'; sectionIndex = Math.max(0, screens.length - 1); render(); };
  document.getElementById('submitBtn').onclick = submit;
}

async function submit() {
  if (preview) { phase = 'success'; saved = { preview: true }; return render(); }
  const button = document.getElementById('submitBtn');
  const error = document.getElementById('stepError');
  button.disabled = true;
  error.textContent = 'Saving…';
  try {
    const stored = {};
    for (const field of template.fields || []) {
      const shot = media.get(field.id);
      if (shot?.blob) {
        const uploaded = await uploadFormAsset(ctx, { leadId: lead?.id || 'unassigned', blob: shot.blob, contentType: shot.contentType });
        stored[field.id] = { kind: shot.kind, path: uploaded.path };
      } else stored[field.id] = answers[field.id];
    }
    saved = await saveSubmission(ctx, {
      template_id: template.id,
      template_name: template.name,
      lead_id: lead?.id || null,
      address_snapshot: formatAddress(lead),
      homeowner_name: snapshotHomeowner(template.fields, answers),
      fields: template.fields,
      answers: stored,
      is_draft: Boolean(template.is_draft),
      draft_notice: template.draft_notice || ''
    });
    phase = 'success';
    render();
  } catch (err) {
    button.disabled = false;
    error.textContent = plainError(err);
  }
}

function renderSuccess() {
  if (saved?.preview) {
    app.innerHTML = `<div class="tnSuccess"><img class="brandLogo" src="/brand/logo-emblem.webp" alt="True North Restorations" width="64" height="64"><h1 class="tnTitle">Preview finished</h1><p class="tnSub">Nothing was saved.</p></div><div class="tnStack"><a class="tnTap primary" href="/files.html#builder">Back to form builder</a></div>`;
    return;
  }
  const again = new URLSearchParams();
  if (lead?.id) again.set('lead', lead.id);
  if (lead?.name) again.set('name', lead.name);
  if (lead?.address) again.set('address', lead.address);
  const where = ctx?.mode === 'local' ? 'Saved on this phone until Supabase is connected.' : `${template.name} is stored with ${formatAddress(lead) || 'this form'}.`;
  app.innerHTML = `${template?.is_draft ? `<div class="tnBanner">${esc(template.draft_notice || 'Draft wording.')}</div>` : ''}<div class="tnSuccess"><img class="brandLogo" src="/brand/logo-emblem.webp" alt="True North Restorations" width="64" height="64"><h1 class="tnTitle">Saved</h1><p class="tnSub">${esc(where)}</p></div><div class="tnStack"><a class="tnTap primary" href="${esc(houseBackHref(lead))}">Back to this house</a><a class="tnTap dark" href="/forms.html?${esc(again.toString())}">Fill another form</a><a class="tnTap" href="/form-print.html?id=${esc(saved.id)}">See a copy</a></div>`;
}

start();

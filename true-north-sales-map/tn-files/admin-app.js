import { bootFiles, attachSession, signIn, listTemplates, saveTemplate, listPhotos, listSubmissions, listReps, listAssignments, replaceAssignments, uploadLibraryFile, groupPhotosByAddress, plainError } from './store.js';
import { esc, bindSignOut, signInCard } from './ui.js';
import { FIELD_TYPES, PREFILLS, blankField, isManagement, DRAFT_NOTICE, audienceLabel } from './logic.js';
import { roleLabel } from '../lib/role-access.js';

const root = document.getElementById('tnFilesRoot');
if (root) boot();

let ctx, templates = [], photos = [], submissions = [], reps = [], assignments = [];
let view = 'photos';
let editor = null;
let pendingFile = null;
const filters = { rep: '', from: '', to: '', form: '' };

async function boot() {
  ctx = await bootFiles();
  bindSignOut(ctx, document.getElementById('signOut'));
  const embedded = Boolean(document.getElementById('tab-files'));
  if (ctx.mode === 'cloud' && !ctx.session) {
    if (!embedded) renderSignIn();
    ctx.sb.auth.onAuthStateChange(async (_event, session) => {
      if (!session) return;
      await attachSession(ctx, session);
      if (isManagement(ctx.rep?.role)) await loadAndRender();
      else if (!embedded) renderDenied();
    });
    return;
  }
  if (ctx.mode === 'cloud' && !isManagement(ctx.rep?.role)) return renderDenied();
  await loadAndRender();
}

function renderSignIn() {
  root.innerHTML = signInCard();
  document.getElementById('tnLogin').onsubmit = async (event) => {
    event.preventDefault();
    try {
      await signIn(ctx, document.getElementById('tnEmail').value, document.getElementById('tnPassword').value);
      if (!isManagement(ctx.rep?.role)) return renderDenied();
      await loadAndRender();
    } catch (error) { document.getElementById('tnLoginError').textContent = error.message; }
  };
}

function renderDenied() {
  root.innerHTML = '<h1 class="tnTitle">Files & Forms</h1><p class="tnSub">This section is for admin and managers.</p><a class="tnTap" href="/rep.html">Sales tools</a>';
}

async function loadAndRender() {
  root.innerHTML = '<p class="tnSub">Loading…</p>';
  try {
    [templates, photos, submissions, reps, assignments] = await Promise.all([
      listTemplates(ctx), listPhotos(ctx), listSubmissions(ctx), listReps(ctx), listAssignments(ctx)
    ]);
  } catch (error) {
    root.innerHTML = `<p class="tnError">${esc(error.message)}</p>`;
    return;
  }
  const saved = sessionStorage.getItem('tn-form-editor');
  if (location.hash === '#builder' && saved) {
    editor = JSON.parse(saved);
    view = 'builder';
  }
  render();
}

function inRange(iso) {
  const day = String(iso || '').slice(0, 10);
  if (filters.from && day < filters.from) return false;
  if (filters.to && day > filters.to) return false;
  return true;
}

function when(iso) {
  try { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)); }
  catch { return ''; }
}

function render() {
  const local = ctx.mode === 'local' ? '<div class="tnBanner">This browser only, until Supabase is connected. Run supabase/forms_photos.sql on the live project.</div>' : '';
  root.innerHTML = `${local}<div class="dashTitle"><div><div class="eyebrow">FILES & FORMS</div><h1 class="tnTitle">Photos and forms</h1></div></div>
    <div class="tnSeg"><button type="button" data-view="photos" class="${view === 'photos' ? 'on' : ''}">Photos</button><button type="button" data-view="forms" class="${view === 'forms' ? 'on' : ''}">Submitted</button><button type="button" data-view="builder" class="${view === 'builder' ? 'on' : ''}">Form builder</button></div>
    ${view === 'builder' ? builderHtml() : listHtml()}
  `;
  root.querySelectorAll('[data-view]').forEach((button) => button.onclick = () => { view = button.dataset.view; if (view !== 'builder') editor = null; render(); });
  if (view === 'builder') bindBuilder();
  else bindList();
}

function listHtml() {
  const formOptions = templates.map((item) => `<option value="${esc(item.id)}" ${filters.form === item.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('');
  const repOptions = reps.map((rep) => `<option value="${esc(rep.id)}" ${filters.rep === rep.id ? 'selected' : ''}>${esc(rep.name)}</option>`).join('');
  const body = view === 'photos' ? photoCards() : submissionCards();
  return `<div class="tnFilters">
      <select class="tnSelect" id="filterRep"><option value="">All reps</option>${repOptions}</select>
      <input class="tnInput" id="filterFrom" type="date" value="${esc(filters.from)}" aria-label="From date">
      <input class="tnInput" id="filterTo" type="date" value="${esc(filters.to)}" aria-label="To date">
      <select class="tnSelect" id="filterForm" ${view === 'photos' ? 'disabled' : ''}><option value="">All forms</option>${formOptions}</select>
    </div><div class="tnStack">${body}</div>`;
}

function photoCards() {
  const rows = photos.filter((photo) => inRange(photo.created_at) && (!filters.rep || photo.uploaded_by === filters.rep));
  if (!rows.length) return '<div class="tnCard"><b>No photos yet</b><span>They show up when a sales rep taps Add Photo on a house.</span></div>';
  return groupPhotosByAddress(rows).map((group) => `<div class="tnCard"><b>${esc(group.address)}</b><span>${group.photos.length} photo${group.photos.length === 1 ? '' : 's'}</span><div class="tnGallery" style="margin-top:8px">${group.photos.map((photo) => `<figure class="tnPhotoCard"><a href="${esc(photo.url)}" target="_blank" rel="noopener"><img alt="${esc(photo.caption || group.address)}" src="${esc(photo.url)}"></a><figcaption class="tnPhotoNote">${esc(photo.caption || 'No note yet')}</figcaption><span>${esc(photo.uploader_name || 'Rep')} · ${esc(when(photo.created_at))}</span></figure>`).join('')}</div></div>`).join('');
}

function submissionCards() {
  const rows = submissions.filter((row) => inRange(row.created_at) && (!filters.rep || row.submitted_by === filters.rep) && (!filters.form || row.template_id === filters.form));
  if (!rows.length) return '<div class="tnCard"><b>No completed forms yet</b><span>Reps and setters submit them from a house.</span></div>';
  return rows.map((row) => `<a class="tnCard" href="/form-print.html?id=${esc(row.id)}"><b>${esc(row.template_name)}</b><span>${esc(row.homeowner_name || 'Homeowner')} · ${esc(row.address_snapshot || 'No address')}</span><span>${esc(row.rep_name || 'Rep')} · ${esc(when(row.created_at))}${row.is_draft ? ' · Draft' : ''}</span></a>`).join('');
}

function bindList() {
  const read = () => {
    filters.rep = document.getElementById('filterRep').value;
    filters.from = document.getElementById('filterFrom').value;
    filters.to = document.getElementById('filterTo').value;
    filters.form = document.getElementById('filterForm').value;
    render();
  };
  ['filterRep', 'filterFrom', 'filterTo', 'filterForm'].forEach((id) => document.getElementById(id).onchange = read);
}

function fieldPeople() {
  return reps.filter((rep) => ['appointment_setter', 'canvasser', 'salesperson'].includes(rep.role));
}

function assigneeIds(templateId) {
  return assignments.filter((row) => row.template_id === templateId).map((row) => row.rep_id);
}

function builderHtml() {
  if (!editor) {
    return `<div class="tnStack"><label class="tnTap primary">Upload a PDF or image<input id="uploadForm" type="file" accept="application/pdf,image/*"></label><button class="tnTap" id="newForm" type="button">New form</button></div><p class="tnSub">Uploaded files and forms you build here can go to all setters, all sales reps, or specific people.</p><div class="tnStack" style="margin-top:10px">${templates.map((item) => `<button type="button" class="tnCard" data-edit="${esc(item.id)}"><b>${esc(item.name)}</b><span>${esc(audienceLabel(item.audience))}${item.kind === 'file' ? ' · File' : ''}${item.active === false ? ' · Hidden' : ''}${item.is_draft ? ' · Draft' : ''}</span></button>`).join('') || '<p class="tnSub">No forms yet.</p>'}</div>`;
  }
  const people = fieldPeople();
  const chosen = new Set(editor.assignee_ids || []);
  const peopleHtml = people.length
    ? people.map((rep) => `<button type="button" class="tnCheck ${chosen.has(rep.id) ? 'on' : ''}" data-assignee="${esc(rep.id)}">${esc(rep.name)} · ${esc(roleLabel(rep.role))}</button>`).join('')
    : '<p class="tnSub">Named people show up here after setters and sales reps have logins. All setters and all sales reps still work from the buttons above.</p>';
  const fileBlock = editor.kind === 'file'
    ? `<p class="tnSub">${esc(pendingFile?.name || editor.file_name || 'No file chosen yet')}</p><label class="tnTap">Replace file<input id="replaceFile" type="file" accept="application/pdf,image/*"></label>`
    : '';
  const fields = (editor.fields || []).map((field, index) => `<div class="tnFieldCard" data-index="${index}">
      <header><b>Field ${index + 1}</b><div class="tnIconBtns"><button type="button" data-up="${index}" aria-label="Move up">Up</button><button type="button" data-down="${index}" aria-label="Move down">Down</button><button type="button" data-remove="${index}" aria-label="Remove field">Remove</button></div></header>
      <label class="tnLabel">Label<input class="tnInput" data-label="${index}" value="${esc(field.label)}"></label>
      <label class="tnLabel">Type<select class="tnSelect" data-type="${index}">${FIELD_TYPES.map(([value, label]) => `<option value="${value}" ${field.type === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <label class="tnLabel">Section<input class="tnInput" data-section="${index}" value="${esc(field.section || '')}" placeholder="Same name shares one screen"></label>
      <label class="tnLabel">Fill from the house<select class="tnSelect" data-prefill="${index}">${PREFILLS.map(([value, label]) => `<option value="${value}" ${field.prefill === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <button type="button" class="tnCheck ${field.required ? 'on' : ''}" data-required="${index}">${field.required ? 'Required' : 'Optional'}</button>
      ${field.type === 'select' ? `<label class="tnLabel">Choices, one per line<textarea class="tnArea" data-options="${index}">${esc((field.options || []).join('\n'))}</textarea></label>` : ''}
    </div>`).join('');
  return `<button class="tnTap" id="closeEditor" type="button">All forms</button>
    <label class="tnLabel">Form name<input class="tnInput" id="formName" value="${esc(editor.name)}"></label>
    ${fileBlock}
    <p class="tnLabel">Who gets this form</p>
    <div class="tnSeg" id="audienceSeg"><button type="button" data-audience="setter" class="${editor.audience === 'setter' ? 'on' : ''}">All setters</button><button type="button" data-audience="rep" class="${editor.audience === 'rep' ? 'on' : ''}">All sales reps</button><button type="button" data-audience="both" class="${editor.audience === 'both' ? 'on' : ''}">Setters and sales reps</button><button type="button" data-audience="people" class="${editor.audience === 'people' ? 'on' : ''}">Specific people</button></div>
    <p class="tnLabel">${editor.audience === 'people' ? 'People who get this form' : 'Also give it to specific people'}</p>
    <div class="tnStack" id="assigneeList">${peopleHtml}</div>
    <button type="button" class="tnCheck ${editor.is_draft ? 'on' : ''}" id="draftToggle">${editor.is_draft ? 'Marked as draft' : 'Not marked as draft'}</button>
    <label class="tnLabel">Draft note<input class="tnInput" id="draftNote" value="${esc(editor.draft_notice || '')}"></label>
    <button type="button" class="tnCheck ${editor.active !== false ? 'on' : ''}" id="activeToggle" style="margin-top:8px">${editor.active !== false ? 'People can fill this form' : 'Hidden from the team'}</button>
    ${editor.kind === 'file' ? '' : `<div style="height:12px"></div>${fields}<button class="tnTap" id="addField" type="button">Add field</button>`}
    <p id="builderError" class="tnError"></p>
    <div class="tnSticky"><button class="tnTap primary" id="saveForm" type="button">Save form</button>${editor.kind === 'file' ? '' : '<button class="tnTap dark" id="previewForm" type="button">Preview as the rep sees it</button>'}</div>`;
}

function readEditor() {
  if (!editor) return;
  const name = document.getElementById('formName');
  if (!name) return;
  editor.name = name.value;
  editor.draft_notice = document.getElementById('draftNote').value;
  editor.assignee_ids = [...root.querySelectorAll('[data-assignee].on')].map((button) => button.dataset.assignee);
  (editor.fields || []).forEach((field, index) => {
    const label = root.querySelector(`[data-label="${index}"]`);
    const section = root.querySelector(`[data-section="${index}"]`);
    const type = root.querySelector(`[data-type="${index}"]`);
    const prefill = root.querySelector(`[data-prefill="${index}"]`);
    const options = root.querySelector(`[data-options="${index}"]`);
    if (label) field.label = label.value;
    if (section) field.section = section.value;
    if (type) field.type = type.value;
    if (prefill) field.prefill = prefill.value;
    if (options) field.options = options.value.split('\n').map((line) => line.trim()).filter(Boolean);
  });
  sessionStorage.setItem('tn-form-editor', JSON.stringify(editor));
}

function bindBuilder() {
  root.querySelectorAll('[data-edit]').forEach((button) => button.onclick = () => {
    const found = templates.find((item) => item.id === button.dataset.edit);
    pendingFile = null;
    editor = JSON.parse(JSON.stringify(found));
    editor.kind = editor.kind || 'builder';
    editor.fields = editor.fields || [];
    editor.assignee_ids = assigneeIds(found.id);
    sessionStorage.setItem('tn-form-editor', JSON.stringify(editor));
    render();
  });
  document.getElementById('uploadForm')?.addEventListener('change', () => {
    const file = document.getElementById('uploadForm').files?.[0];
    if (!file) return;
    pendingFile = file;
    editor = {
      name: file.name.replace(/\.[^.]+$/, ''),
      audience: 'rep',
      is_draft: false,
      draft_notice: '',
      active: true,
      kind: 'file',
      fields: [],
      assignee_ids: []
    };
    render();
  });
  document.getElementById('newForm')?.addEventListener('click', () => {
    pendingFile = null;
    editor = { name: '', audience: 'both', is_draft: true, draft_notice: DRAFT_NOTICE, active: true, kind: 'builder', fields: [blankField()], assignee_ids: [] };
    render();
  });
  if (!editor) return;
  const refresh = () => { readEditor(); render(); };
  document.getElementById('closeEditor').onclick = () => { editor = null; pendingFile = null; sessionStorage.removeItem('tn-form-editor'); render(); };
  document.getElementById('replaceFile')?.addEventListener('change', () => {
    const file = document.getElementById('replaceFile').files?.[0];
    if (!file) return;
    pendingFile = file;
    readEditor();
    render();
  });
  document.getElementById('addField')?.addEventListener('click', () => { readEditor(); editor.fields.push(blankField()); render(); });
  document.getElementById('draftToggle').onclick = () => { readEditor(); editor.is_draft = !editor.is_draft; render(); };
  document.getElementById('activeToggle').onclick = () => { readEditor(); editor.active = editor.active === false; render(); };
  root.querySelectorAll('[data-audience]').forEach((button) => button.onclick = () => { readEditor(); editor.audience = button.dataset.audience; render(); });
  root.querySelectorAll('[data-assignee]').forEach((button) => button.onclick = () => { button.classList.toggle('on'); });
  root.querySelectorAll('[data-required]').forEach((button) => button.onclick = () => { readEditor(); editor.fields[button.dataset.required].required = !editor.fields[button.dataset.required].required; render(); });
  root.querySelectorAll('[data-type]').forEach((select) => select.onchange = refresh);
  root.querySelectorAll('[data-up]').forEach((button) => button.onclick = () => shift(Number(button.dataset.up), -1));
  root.querySelectorAll('[data-down]').forEach((button) => button.onclick = () => shift(Number(button.dataset.down), 1));
  root.querySelectorAll('[data-remove]').forEach((button) => button.onclick = () => { readEditor(); editor.fields.splice(Number(button.dataset.remove), 1); render(); });
  document.getElementById('saveForm').onclick = onSave;
  const preview = document.getElementById('previewForm');
  if (preview) preview.onclick = () => {
    readEditor();
    sessionStorage.setItem('tn-form-preview', JSON.stringify(editor));
    sessionStorage.setItem('tn-form-editor', JSON.stringify(editor));
    location.href = '/forms.html?preview=1';
  };
}

function shift(index, dir) {
  readEditor();
  const next = index + dir;
  if (next < 0 || next >= editor.fields.length) return;
  const [item] = editor.fields.splice(index, 1);
  editor.fields.splice(next, 0, item);
  render();
}

async function onSave() {
  readEditor();
  const error = document.getElementById('builderError');
  error.textContent = 'Saving…';
  try {
    if (editor.audience === 'people' && !(editor.assignee_ids || []).length) throw new Error('Pick at least one person.');
    if (editor.kind === 'file') {
      if (pendingFile) {
        const uploaded = await uploadLibraryFile(ctx, pendingFile);
        editor.storage_path = uploaded.path;
        editor.mime_type = uploaded.mime_type;
        editor.file_name = uploaded.file_name;
        pendingFile = null;
      }
      if (!editor.storage_path) throw new Error('Choose a PDF or an image.');
    }
    const saved = await saveTemplate(ctx, editor);
    await replaceAssignments(ctx, saved.id, editor.assignee_ids || []);
    editor = { ...saved, assignee_ids: editor.assignee_ids || [] };
    sessionStorage.setItem('tn-form-editor', JSON.stringify(editor));
    templates = await listTemplates(ctx);
    assignments = await listAssignments(ctx);
    error.textContent = 'Saved';
  } catch (err) { error.textContent = plainError(err); }
}

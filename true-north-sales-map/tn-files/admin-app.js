import { bootFiles, attachSession, hydratePhotoUrls, listTemplates, saveTemplate, listPhotos, listSubmissions, listReps, listAssignments, listIntakes, replaceAssignments, uploadLibraryFile, setDocumentReviewed, plainError } from './store.js';
import { createDeferredAuthHandler } from '../lib/auth-events.js';
import { esc, bindSignOut, mountSignIn, revealApp } from './ui.js';
import { FIELD_TYPES, PREFILLS, blankField, isManagement, DRAFT_NOTICE, audienceLabel } from './logic.js';
import { roleLabel } from '../lib/role-access.js';
import { DOC_TYPES, collectDocuments, formatWhen, propertyGroups, sectionDocuments, sectionGroups, typeLabel, visibleDocuments } from '../lib/documents.js';
import { LIBRARY_ACCEPT } from '../lib/records.js';
import { mountMyForms } from './my-forms.js';

const root = document.getElementById('tnFilesRoot');
if (root) boot();

let ctx, templates = [], photos = [], submissions = [], reps = [], assignments = [], intakes = [];
let view = 'documents';
let editor = null;
let pendingFile = null;
let propertyKeyOpen = '';
let accountEpoch = 0;
const docFilters = { query: '', type: 'all', personId: '', status: 'all' };

async function boot() {
  ctx = await bootFiles();
  bindSignOut(ctx, document.getElementById('signOut'));
  const embedded = Boolean(document.getElementById('tab-files'));
  ctx.sb?.auth.onAuthStateChange(createDeferredAuthHandler({
    initialSession: ctx.session,
    onInvalidate() {
      accountEpoch++;
      ctx.session = null; ctx.rep = null;
      templates = []; photos = []; submissions = []; reps = []; assignments = []; intakes = [];
      editor = null; pendingFile = null; propertyKeyOpen = '';
      root.innerHTML = '';
      if (!embedded) renderSignIn();
    },
    async onSession(session, current) {
      const next = { ...ctx };
      await attachSession(next, session);
      if (!current()) return;
      ctx.session = next.session; ctx.rep = next.rep;
      if (isManagement(ctx.rep?.role)) await loadAndRender();
      else if (!embedded) renderDenied();
    },
    onError(error) { root.innerHTML = `<p class="tnError">${esc(plainError(error))}</p>`; }
  }));
  if (ctx.mode === 'cloud' && !ctx.session) {
    if (!embedded) renderSignIn();
    return;
  }
  if (ctx.mode === 'cloud' && !isManagement(ctx.rep?.role)) return renderDenied();
  await loadAndRender();
}

function renderSignIn() {
  mountSignIn(root);
  document.getElementById('tnLogin').onsubmit = async (event) => {
    event.preventDefault();
    try {
      const { error } = await ctx.sb.auth.signInWithPassword({ email: document.getElementById('tnEmail').value.trim(), password: document.getElementById('tnPassword').value });
      if (error) throw error;
    } catch (error) { const note = document.getElementById('tnLoginError'); if (note) note.textContent = error.message; }
  };
}

function renderDenied() {
  revealApp();
  root.innerHTML = '<h1 class="tnTitle">Files & Forms</h1><p class="tnSub">This section is for admin and managers.</p><a class="tnTap" href="/rep.html">Sales tools</a>';
}

async function loadAndRender() {
  const epoch = accountEpoch;
  root.innerHTML = '<div class="tnSkeleton" aria-hidden="true"><span></span><span></span><span></span></div>';
  try {
    const loaded = await Promise.all([
      listTemplates(ctx), listPhotos(ctx, { signUrls: false }), listSubmissions(ctx), listReps(ctx), listAssignments(ctx), listIntakes(ctx)
    ]);
    if (epoch !== accountEpoch) return;
    [templates, photos, submissions, reps, assignments, intakes] = loaded;
  } catch (error) {
    if (epoch !== accountEpoch) return;
    revealApp();
    root.innerHTML = `<p class="tnError">${esc(error.message)}</p>`;
    return;
  }
  const saved = sessionStorage.getItem('tn-form-editor');
  if (location.hash === '#builder') {
    view = 'builder';
    if (saved) {
      try { editor = JSON.parse(saved); } catch { editor = null; }
    }
  } else if (location.hash === '#library' || location.hash === '#receipts' || location.hash === '#estimates') {
    view = 'library';
  }
  const propertyHash = decodeURIComponent(location.hash.replace(/^#property=/, ''));
  if (location.hash.startsWith('#property=') && propertyHash) {
    propertyKeyOpen = propertyHash;
    view = 'property';
  }
  render();
}

function allDocuments() {
  return collectDocuments({ submissions, photos, intakes, reps, templates });
}

function render() {
  revealApp();
  const local = ctx.mode === 'local' ? '<div class="tnBanner">This browser only, until Supabase is connected.</div>' : '';
  const body = view === 'builder' ? builderHtml() : view === 'library' ? '<div id="tnMyForms"></div>' : view === 'property' ? propertyHtml() : documentsHtml();
  const title = view === 'library' ? 'Document library' : 'Paperwork by property';
  root.innerHTML = `${local}<div class="dashTitle"><div><div class="eyebrow">DOCUMENTS</div><h1 class="tnTitle">${title}</h1></div></div>
    <div class="tnSeg"><button type="button" data-view="documents" class="${view === 'documents' || view === 'property' ? 'on' : ''}">Documents</button><button type="button" data-view="builder" class="${view === 'builder' ? 'on' : ''}">Form builder</button><button type="button" data-view="library" class="${view === 'library' ? 'on' : ''}">Library</button></div>
    ${body}
  `;
  root.querySelectorAll('[data-view]').forEach((button) => button.onclick = () => {
    view = button.dataset.view;
    if (view !== 'builder') editor = null;
    if (view === 'documents') propertyKeyOpen = '';
    const hash = view === 'builder' ? '#builder' : view === 'library' ? '#library' : '#files';
    history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
    render();
  });
  if (view === 'builder') bindBuilder();
  else if (view === 'library') mountMyForms(document.getElementById('tnMyForms'), ctx, { embedded: true });
  else if (view === 'property') bindProperty();
  else bindDocuments();
}

function documentsHtml() {
  const docs = visibleDocuments(allDocuments(), docFilters);
  const sections = sectionGroups(propertyGroups(docs));
  const people = reps.filter((rep) => ['appointment_setter', 'canvasser', 'salesperson'].includes(rep.role));
  const chips = DOC_TYPES.map(([value, label]) => `<button type="button" class="tnChip ${docFilters.type === value ? 'on' : ''}" data-type="${value}">${esc(label)}</button>`).join('');
  const personOptions = people.map((rep) => `<option value="${esc(rep.id)}" ${docFilters.personId === rep.id ? 'selected' : ''}>${esc(rep.name)} · ${esc(roleLabel(rep.role))}</option>`).join('');
  const sectionsHtml = sections.length ? sections.map((section, index) => `<section class="tnDocSection" data-tn-panel="docs-${index}-${String(section.label || 'section').toLowerCase().replace(/[^a-z0-9]+/g, '-')}" data-tn-rank="${index === 0 ? 'primary' : 'secondary'}"><h2>${esc(section.label)}</h2><div class="tnPropertyGrid">${section.groups.map(propertyCard).join('')}</div></section>`).join('') : '<div class="tnCard" data-tn-panel="docs-empty" data-tn-rank="primary"><h2>Documents</h2><b>Nothing matches</b><span>Intakes, forms, and roof photos show up here as soon as someone sends them in.</span></div>';
  return `<label class="tnLabel" for="docSearch">Search</label><input class="tnInput" id="docSearch" value="${esc(docFilters.query)}" placeholder="Homeowner, address, person, or form" autocomplete="off">
    <div class="tnChips" id="docTypes">${chips}</div>
    <div class="tnDocFilters">
      <label class="tnLabel">Person<select class="tnSelect" id="docPerson"><option value="">Everyone</option>${personOptions}</select></label>
      <div class="tnSeg tnSegStatus" id="docStatus"><button type="button" data-status="all" class="${docFilters.status === 'all' ? 'on' : ''}">All</button><button type="button" data-status="new" class="${docFilters.status === 'new' ? 'on' : ''}">New</button><button type="button" data-status="reviewed" class="${docFilters.status === 'reviewed' ? 'on' : ''}">Reviewed</button></div>
    </div>
    <div class="tnDocSections">${sectionsHtml}</div>`;
}

function propertyCard(group) {
  const kinds = [...new Set(group.docs.map((doc) => typeLabel(doc.type)))].join(' · ');
  const fresh = group.newCount ? `${group.newCount} new` : 'Reviewed';
  return `<button type="button" class="tnCard tnProperty" data-property="${esc(group.key)}"><b>${esc(group.address)}</b><span>${esc(group.homeowner || 'Homeowner not named yet')}</span><span>${group.docs.length} document${group.docs.length === 1 ? '' : 's'} · ${esc(fresh)}</span><span>${esc(kinds)}</span></button>`;
}

function propertyHtml() {
  const group = propertyGroups(allDocuments()).find((item) => item.key === propertyKeyOpen);
  if (!group) return '<p class="tnSub">That property is not in the current paperwork.</p><button type="button" class="tnTap" id="docBack">All properties</button>';
  const sections = sectionDocuments(group.docs);
  return `<button type="button" class="tnTap" id="docBack">All properties</button><h2 class="tnTitle" style="margin-top:12px">${esc(group.address)}</h2><p class="tnSub">${esc(group.homeowner || 'Homeowner not named yet')} · ${group.docs.length} document${group.docs.length === 1 ? '' : 's'}</p>
    ${sections.map((section, index) => `<section class="tnDocSection" data-tn-panel="property-docs-${index}" data-tn-rank="${index === 0 ? 'primary' : 'secondary'}"><h2>${esc(section.label)}</h2><div class="tnTimeline">${section.docs.map(timelineItem).join('')}</div></section>`).join('')}`;
}

function timelineItem(doc) {
  const image = doc.image ? `<a href="${esc(doc.href || doc.image)}" target="_blank" rel="noopener"><img alt="${esc(doc.note || doc.title)}" src="${esc(doc.image)}"></a>` : '';
  const note = doc.note ? `<p class="tnPhotoNote">${esc(doc.note)}</p>` : '';
  const open = doc.href && doc.source !== 'photo' ? `<a class="tnTap" href="${esc(doc.href)}">Open</a>` : '';
  const review = `<button type="button" class="tnTap" data-review="${esc(doc.id)}">${doc.reviewed ? 'Mark new' : 'Mark reviewed'}</button>`;
  return `<article class="tnCard tnDocItem" data-tn-panel="doc-${esc(doc.id)}" data-tn-rank="secondary"><b>${esc(doc.title)}</b><span>${esc(typeLabel(doc.type))} · ${doc.reviewed ? 'Reviewed' : 'New'}</span><span>${esc(doc.personName || 'Unassigned')}${doc.personRole ? ` · ${esc(roleLabel(doc.personRole))}` : ''} · ${esc(formatWhen(doc.at))}</span>${note}${image}<div class="tnDocActions">${open}${review}</div><p class="tnError" data-review-error="${esc(doc.id)}"></p></article>`;
}

function bindDocuments() {
  const input = document.getElementById('docSearch');
  input.oninput = () => {
    const pos = input.selectionStart;
    docFilters.query = input.value;
    render();
    const next = document.getElementById('docSearch');
    next.focus();
    next.setSelectionRange(pos, pos);
  };
  root.querySelectorAll('[data-type]').forEach((button) => button.onclick = () => { docFilters.type = button.dataset.type; render(); });
  document.getElementById('docPerson').onchange = () => { docFilters.personId = document.getElementById('docPerson').value; render(); };
  root.querySelectorAll('[data-status]').forEach((button) => button.onclick = () => { docFilters.status = button.dataset.status; render(); });
  root.querySelectorAll('[data-property]').forEach((button) => button.onclick = async () => {
    propertyKeyOpen = button.dataset.property;
    view = 'property';
    history.replaceState(null, '', `${location.pathname}${location.search}#property=${encodeURIComponent(propertyKeyOpen)}`);
    render();
    const group = propertyGroups(allDocuments()).find((item) => item.key === propertyKeyOpen);
    const ids = new Set((group?.docs || []).filter((doc) => doc.source === 'photo').map((doc) => doc.sourceId));
    const pending = photos.filter((photo) => ids.has(photo.id) && !photo.url);
    if (pending.length) {
      const hydrated = await hydratePhotoUrls(ctx, pending);
      const byId = new Map(hydrated.map((photo) => [photo.id, photo]));
      photos = photos.map((photo) => byId.get(photo.id) || photo);
      if (view === 'property' && propertyKeyOpen === button.dataset.property) render();
    }
  });
}

function bindProperty() {
  document.getElementById('docBack').onclick = () => {
    view = 'documents';
    propertyKeyOpen = '';
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    render();
  };
  root.querySelectorAll('[data-review]').forEach((button) => button.onclick = () => markReviewed(button));
}

async function markReviewed(button) {
  const doc = allDocuments().find((item) => item.id === button.dataset.review);
  const error = root.querySelector(`[data-review-error="${button.dataset.review}"]`);
  if (!doc) return;
  button.disabled = true;
  try {
    const reviewed_at = await setDocumentReviewed(ctx, doc, !doc.reviewed);
    const lists = { form: submissions, photo: photos, intake: intakes };
    const row = lists[doc.source]?.find((item) => item.id === doc.sourceId);
    if (row) row.reviewed_at = reviewed_at;
    render();
  } catch (err) {
    button.disabled = false;
    if (error) error.textContent = plainError(err);
  }
}

function fieldPeople() {
  return reps.filter((rep) => ['appointment_setter', 'canvasser', 'salesperson'].includes(rep.role));
}

function assigneeIds(templateId) {
  return assignments.filter((row) => row.template_id === templateId).map((row) => row.rep_id);
}

function builderHtml() {
  if (!editor) {
    return `<div class="tnStack"><label class="tnTap primary">Upload a PDF, image, or office file<input id="uploadForm" type="file" accept="${LIBRARY_ACCEPT}"></label><button class="tnTap" id="newForm" type="button">New form</button></div><p class="tnSub">Uploaded files and forms you build here can go to all setters, all sales reps, or specific people. Folder them from the Library tab.</p><div class="tnStack" style="margin-top:10px">${templates.map((item) => `<button type="button" class="tnCard" data-edit="${esc(item.id)}"><b>${esc(item.name)}</b><span>${esc(audienceLabel(item.audience))}${item.kind === 'file' ? ' · File' : ''}${item.active === false ? ' · Hidden' : ''}${item.is_draft ? ' · Draft' : ''}</span></button>`).join('') || '<p class="tnSub">No forms yet.</p>'}</div>`;
  }
  const people = fieldPeople();
  const chosen = new Set(editor.assignee_ids || []);
  const peopleHtml = people.length
    ? people.map((rep) => `<button type="button" class="tnCheck ${chosen.has(rep.id) ? 'on' : ''}" data-assignee="${esc(rep.id)}">${esc(rep.name)} · ${esc(roleLabel(rep.role))}</button>`).join('')
    : '<p class="tnSub">Named people show up here after setters and sales reps have logins. All setters and all sales reps still work from the buttons above.</p>';
  const fileBlock = editor.kind === 'file'
    ? `<p class="tnSub">${esc(pendingFile?.name || editor.file_name || 'No file chosen yet')}</p><label class="tnTap">Replace file<input id="replaceFile" type="file" accept="${LIBRARY_ACCEPT}"></label>`
    : '';
  const fields = (editor.fields || []).map((field, index) => `<div class="tnFieldCard" data-index="${index}" data-tn-panel="builder-field-${index}" data-tn-rank="secondary">
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
      if (!editor.storage_path) throw new Error('Choose a PDF, an image, or an office document.');
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

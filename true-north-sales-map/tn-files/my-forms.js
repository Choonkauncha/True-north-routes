import { esc } from './ui.js';
import { audienceLabel, isManagement } from './logic.js';
import { canSeeForm } from '../lib/role-access.js';
import {
  ESTIMATE_STATUSES,
  LIBRARY_ACCEPT,
  RECORD_ACCEPT,
  addCategory,
  canDeleteRecord,
  filterRecords,
  formatMoney,
  groupLibrary,
  removeCategory,
  renameCategory,
  reorderCategory,
  statusLabel
} from '../lib/records.js';
import {
  deleteCategory,
  deleteEstimate,
  deleteLibraryDocument,
  deleteReceipt,
  discardStoredFile,
  listAssignments,
  listCategories,
  listEstimates,
  listReceipts,
  listTemplates,
  openStoredFile,
  plainError,
  saveCategory,
  saveEstimate,
  saveReceipt,
  saveTemplate,
  searchLeads,
  uploadLibraryFile
} from './store.js';

let mountToken = 0;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function tabFromHash(embedded) {
  if (embedded) return 'library';
  const hash = location.hash.replace('#', '');
  if (hash === 'receipts' || hash === 'estimates') return hash;
  return 'library';
}

export async function mountMyForms(container, ctx, options = {}) {
  const mine = ++mountToken;
  const manage = ctx.mode === 'local' || isManagement(ctx.rep?.role);
  const role = ctx.rep?.role || (ctx.mode === 'local' ? 'admin' : '');
  container.innerHTML = '<div class="tnSkeleton" aria-hidden="true"><span></span><span></span><span></span></div>';
  let categories = [];
  let templates = [];
  let receipts = [];
  let estimates = [];
  let assignments = [];
  try {
    [categories, templates, receipts, estimates, assignments] = await Promise.all([
      listCategories(ctx),
      listTemplates(ctx),
      listReceipts(ctx),
      listEstimates(ctx),
      listAssignments(ctx).catch(() => [])
    ]);
  } catch (error) {
    if (mine !== mountToken) return;
    container.innerHTML = `<p class="tnError">${esc(plainError(error))}</p>`;
    return;
  }
  if (mine !== mountToken) return;

  const ui = {
    tab: tabFromHash(options.embedded),
    categories,
    templates,
    receipts,
    estimates,
    assignments,
    notice: '',
    error: '',
    renaming: '',
    editing: '',
    draft: blankDraft(),
    leadHits: [],
    filters: { query: '', from: '', to: '', status: '' }
  };

  const render = () => {
    if (mine !== mountToken) return;
    container.innerHTML = shell();
    bind();
  };

  function libraryDocs() {
    return ui.templates.filter((item) => item.kind === 'file' && canSeeForm(role, item, {
      repId: ctx.rep?.id,
      assignments: ui.assignments,
      mode: ctx.mode
    }));
  }

  function blankDraft() {
    return {
      amount: '',
      vendor: '',
      homeowner_name: '',
      address_snapshot: '',
      record_date: today(),
      note: '',
      status: 'draft',
      lead_id: '',
      leadLabel: ''
    };
  }

  function readDraft() {
    const read = (id) => container.querySelector(`#${id}`)?.value ?? ui.draft[id.replace(/^rec/, '').toLowerCase()];
    ui.draft.amount = container.querySelector('#recAmount')?.value ?? ui.draft.amount;
    ui.draft.vendor = container.querySelector('#recVendor')?.value ?? ui.draft.vendor;
    ui.draft.homeowner_name = container.querySelector('#recHomeowner')?.value ?? ui.draft.homeowner_name;
    ui.draft.address_snapshot = container.querySelector('#recAddress')?.value ?? ui.draft.address_snapshot;
    ui.draft.record_date = container.querySelector('#recDate')?.value ?? ui.draft.record_date;
    ui.draft.note = container.querySelector('#recNote')?.value ?? ui.draft.note;
    ui.draft.status = container.querySelector('#recStatus')?.value ?? ui.draft.status;
    ui.filters.query = container.querySelector('#recQuery')?.value ?? ui.filters.query;
    ui.filters.from = container.querySelector('#recFrom')?.value ?? ui.filters.from;
    ui.filters.to = container.querySelector('#recTo')?.value ?? ui.filters.to;
    ui.filters.status = container.querySelector('#recStatusFilter')?.value ?? ui.filters.status;
    return read;
  }

  function shell() {
    const local = ctx.mode === 'local' && !options.embedded ? '<div class="tnBanner">Saved on this phone until Supabase is connected.</div>' : '';
    const fill = options.onFillHouse ? '<button type="button" class="tnTap" id="fillHouse">Fill a form for a house</button>' : '';
    const tabs = ['library', 'receipts', 'estimates'].map((tab) => {
      const label = tab === 'library' ? 'Library' : tab === 'receipts' ? 'Receipts' : 'Estimates';
      return `<button type="button" data-mytab="${tab}" class="${ui.tab === tab ? 'on' : ''}">${label}</button>`;
    }).join('');
    const heading = options.embedded ? '' : '<h1 class="tnTitle">My forms</h1><p class="tnSub">Premade agreements, receipts, and estimates.</p>';
    return `${local}<div class="tnMyForms">${heading}
      <div class="tnSeg tnMyTabs" id="myFormsTabs">${tabs}</div>
      ${ui.notice ? `<p class="tnBanner">${esc(ui.notice)}</p>` : ''}
      ${ui.tab === 'library' ? libraryHtml() : ui.tab === 'receipts' ? recordsHtml('receipt') : recordsHtml('estimate')}
      ${fill}</div>`;
  }

  function libraryHtml() {
    const groups = groupLibrary(ui.categories, libraryDocs());
    const intro = manage
      ? '<p class="tnSub">Add folders for contingency agreements and anything else the team should keep. Removing a folder moves its files to Uncategorized.</p>'
      : '<p class="tnSub">Documents management shared with you. Open or download them here.</p>';
    const adder = manage
      ? `<form id="newCategory" class="tnRecordForm"><label class="tnLabel" for="categoryName">New category</label><input class="tnInput" id="categoryName" maxlength="60" placeholder="Warranties"><button class="tnTap primary" type="submit">Add category</button><p id="categoryError" class="tnError">${esc(ui.error)}</p></form>`
      : (ui.error ? `<p class="tnError">${esc(ui.error)}</p>` : '');
    const folders = groups.map((group) => folderHtml(group)).join('');
    return `<div id="libraryPanel">${intro}${adder}<div class="tnStack">${folders}</div></div>`;
  }

  function folderHtml(group) {
    const locked = group.system || group.slug === 'uncategorized';
    const controls = manage ? `<div class="tnIconBtns">
      <button type="button" data-cat-up="${esc(group.id)}" aria-label="Move ${esc(group.name)} up">Up</button>
      <button type="button" data-cat-down="${esc(group.id)}" aria-label="Move ${esc(group.name)} down">Down</button>
      <button type="button" data-cat-rename="${esc(group.id)}">Rename</button>
      ${locked ? '' : `<button type="button" data-cat-remove="${esc(group.id)}">Remove</button>`}
    </div>` : '';
    const rename = manage && ui.renaming === group.id
      ? `<form data-rename-form="${esc(group.id)}" class="tnRecordForm"><label class="tnLabel" for="rename-${esc(group.id)}">Folder name</label><input class="tnInput" id="rename-${esc(group.id)}" value="${esc(group.name)}" maxlength="60"><button class="tnTap primary" type="submit">Save name</button></form>`
      : '';
    const docs = group.documents.length
      ? group.documents.map((doc) => docHtml(doc)).join('')
      : '<p class="tnSub">No documents in this folder yet.</p>';
    const upload = manage
      ? `<label class="tnTap">Add a document<input type="file" data-upload="${esc(group.id)}" accept="${LIBRARY_ACCEPT}"></label>`
      : '';
    return `<section class="tnFolder" data-folder="${esc(group.slug)}"><div class="tnFolderHead"><b>${esc(group.name)}</b>${controls}</div>${rename}<div class="tnStack">${docs}</div>${upload}</section>`;
  }

  function docHtml(doc) {
    const editing = manage && ui.editing === doc.id;
    const meta = `${esc(doc.file_name || 'File')} · ${esc(audienceLabel(doc.audience))}${doc.active === false ? ' · Hidden' : ''}`;
    const open = `<button type="button" class="tnTap" data-open="${esc(doc.id)}">Open</button>`;
    const editBtn = manage ? `<button type="button" class="tnTap" data-edit-doc="${esc(doc.id)}">${editing ? 'Close' : 'Edit'}</button>` : '';
    const panel = editing ? editPanel(doc) : '';
    return `<article class="tnCard tnRecordCard"><b class="tnDocName">${esc(doc.name)}</b><span>${meta}</span><div class="tnRecordActions">${open}${editBtn}</div>${panel}</article>`;
  }

  function editPanel(doc) {
    const options = ui.categories.map((row) => `<option value="${esc(row.id)}" ${doc.category_id === row.id ? 'selected' : ''}>${esc(row.name)}</option>`).join('');
    const audiences = [
      ['both', 'Setters and sales reps'],
      ['setter', 'All setters'],
      ['rep', 'All sales reps'],
      ['people', 'Specific people']
    ].map(([value, label]) => `<option value="${value}" ${doc.audience === value ? 'selected' : ''}>${label}</option>`).join('');
    return `<form data-doc-form="${esc(doc.id)}" class="tnRecordForm">
      <label class="tnLabel" for="docName-${esc(doc.id)}">Name</label><input class="tnInput" id="docName-${esc(doc.id)}" value="${esc(doc.name)}">
      <label class="tnLabel" for="docCat-${esc(doc.id)}">Folder</label><select class="tnSelect" id="docCat-${esc(doc.id)}">${options}</select>
      <label class="tnLabel" for="docAudience-${esc(doc.id)}">Who can open it</label><select class="tnSelect" id="docAudience-${esc(doc.id)}">${audiences}</select>
      <label class="tnTap">Replace file<input type="file" id="docReplace-${esc(doc.id)}" accept="${LIBRARY_ACCEPT}"></label>
      <button class="tnTap primary" type="submit">Save document</button>
      <button class="tnTap" type="button" data-doc-delete="${esc(doc.id)}">Delete document</button>
      <p class="tnError" data-doc-error="${esc(doc.id)}"></p>
    </form>`;
  }

  function recordsHtml(kind) {
    const estimate = kind === 'estimate';
    const rows = filterRecords(estimate ? ui.estimates : ui.receipts, ui.filters);
    const title = estimate ? 'Estimate records' : 'Receipt records';
    const blurb = estimate
      ? 'Upload an estimate PDF or photo. Link it to a house when you have one.'
      : 'Upload a receipt or take a photo of one. Management can delete any. You can delete your own.';
    const extra = estimate
      ? `<label class="tnLabel" for="recHomeowner">Homeowner</label><input class="tnInput" id="recHomeowner" value="${esc(ui.draft.homeowner_name)}" autocomplete="name">
         <label class="tnLabel" for="recStatus">Status</label><select class="tnSelect" id="recStatus">${ESTIMATE_STATUSES.map(([value, label]) => `<option value="${value}" ${ui.draft.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select>`
      : `<label class="tnLabel" for="recVendor">Vendor</label><input class="tnInput" id="recVendor" value="${esc(ui.draft.vendor)}">`;
    const statusFilter = estimate
      ? `<label class="tnLabel" for="recStatusFilter">Status</label><select class="tnSelect" id="recStatusFilter"><option value="">Any status</option>${ESTIMATE_STATUSES.map(([value, label]) => `<option value="${value}" ${ui.filters.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select>`
      : '';
    const list = rows.length ? rows.map((row) => recordCard(row, estimate)).join('') : `<p class="tnSub">No ${estimate ? 'estimates' : 'receipts'} match.</p>`;
    const chosen = ui.draft.leadLabel ? `<p class="tnSub">Linked house: ${esc(ui.draft.leadLabel)}</p><button type="button" class="tnTap" id="clearLead">Clear house</button>` : '';
    const hits = ui.leadHits.map((row) => `<button type="button" class="tnTap tnChoice" data-lead="${esc(row.id)}"><b>${esc(row.address || 'House')}</b><span class="tnMeta">${esc(row.name || '')} ${esc(row.city || '')}</span></button>`).join('');
    const capture = estimate ? '' : ' capture="environment"';
    return `<div id="${estimate ? 'estimatesPanel' : 'receiptsPanel'}"><h2>${title}</h2><p class="tnSub">${blurb}</p>
      <form id="recordForm" class="tnRecordForm">
        <label class="tnTap primary">${estimate ? 'Upload estimate' : 'Upload receipt or take a photo'}<input id="recFile" type="file" accept="${RECORD_ACCEPT}"${capture}></label>
        <p class="tnSub" id="recFileName">${esc(ui.draft.fileName || 'No file chosen yet')}</p>
        ${extra}
        <label class="tnLabel" for="recAmount">Amount</label><input class="tnInput" id="recAmount" inputmode="decimal" value="${esc(ui.draft.amount)}" placeholder="1250.00">
        <label class="tnLabel" for="recDate">Date</label><input class="tnInput" id="recDate" type="date" value="${esc(ui.draft.record_date)}">
        <label class="tnLabel" for="recAddress">Address</label><input class="tnInput" id="recAddress" value="${esc(ui.draft.address_snapshot)}">
        <label class="tnLabel" for="leadQ">Find the house</label><input class="tnInput" id="leadQ" placeholder="Start typing an address" value="">
        <div id="leadHits" class="tnStack">${hits}</div>
        ${chosen}
        <label class="tnLabel" for="recNote">Note</label><textarea class="tnArea" id="recNote">${esc(ui.draft.note)}</textarea>
        <button class="tnTap primary" type="submit">Save ${estimate ? 'estimate' : 'receipt'}</button>
        <p id="recordError" class="tnError">${esc(ui.error)}</p>
      </form>
      <div class="tnRecordFilters">
        <label class="tnLabel" for="recQuery">Search</label><input class="tnInput" id="recQuery" value="${esc(ui.filters.query)}" placeholder="${estimate ? 'Homeowner, address, or note' : 'Vendor, address, or note'}">
        <label class="tnLabel" for="recFrom">From</label><input class="tnInput" id="recFrom" type="date" value="${esc(ui.filters.from)}">
        <label class="tnLabel" for="recTo">To</label><input class="tnInput" id="recTo" type="date" value="${esc(ui.filters.to)}">
        ${statusFilter}
      </div>
      <div class="tnStack" id="recordList">${list}</div></div>`;
  }

  function recordCard(row, estimate) {
    const money = formatMoney(row.amount);
    const bits = [
      estimate ? row.homeowner_name : row.vendor,
      row.address_snapshot,
      money,
      row.record_date || '',
      estimate ? statusLabel(row.status) : ''
    ].filter(Boolean).join(' · ');
    const note = row.note ? `<p class="tnPhotoNote">${esc(row.note)}</p>` : '';
    const remove = canDeleteRecord(role, row, ctx.mode === 'local' ? row.uploaded_by : ctx.rep?.id)
      ? `<button type="button" class="tnTap" data-rec-delete="${esc(row.id)}">Delete</button>`
      : '';
    const open = row.url ? `<a class="tnTap" href="${esc(row.url)}" target="_blank" rel="noopener">View</a>` : '';
    return `<article class="tnCard tnRecordCard"><b class="tnDocName">${esc(row.file_name || (estimate ? 'Estimate' : 'Receipt'))}</b><span>${esc(bits || 'No details yet')}</span>${note}<div class="tnRecordActions">${open}${remove}</div></article>`;
  }

  function bind() {
    container.querySelectorAll('[data-mytab]').forEach((button) => button.onclick = () => {
      readDraft();
      ui.tab = button.dataset.mytab;
      ui.error = '';
      ui.notice = '';
      ui.leadHits = [];
      if (!options.embedded) history.replaceState(null, '', `#${ui.tab}`);
      render();
    });
    document.getElementById('fillHouse')?.addEventListener('click', () => options.onFillHouse?.());
    if (ui.tab === 'library') bindLibrary();
    else bindRecords();
  }

  function bindLibrary() {
    const form = container.querySelector('#newCategory');
    if (form) form.onsubmit = async (event) => {
      event.preventDefault();
      const result = addCategory(ui.categories, container.querySelector('#categoryName').value);
      const error = container.querySelector('#categoryError');
      if (result.error) { error.textContent = result.error; return; }
      try {
        const saved = await saveCategory(ctx, result.category);
        ui.categories = [...ui.categories, saved];
        ui.notice = `Added ${saved.name}.`;
        ui.error = '';
        render();
      } catch (err) { error.textContent = plainError(err); }
    };
    container.querySelectorAll('[data-cat-rename]').forEach((button) => button.onclick = () => {
      ui.renaming = ui.renaming === button.dataset.catRename ? '' : button.dataset.catRename;
      ui.error = '';
      render();
    });
    container.querySelectorAll('[data-rename-form]').forEach((form) => form.onsubmit = async (event) => {
      event.preventDefault();
      const id = form.dataset.renameForm;
      const result = renameCategory(ui.categories, id, form.querySelector('input').value);
      if (result.error) { ui.error = result.error; render(); return; }
      const next = result.categories.find((row) => row.id === id);
      try {
        await saveCategory(ctx, next);
        ui.categories = result.categories;
        ui.renaming = '';
        ui.notice = 'Folder renamed.';
        ui.error = '';
        render();
      } catch (err) { ui.error = plainError(err); render(); }
    });
    container.querySelectorAll('[data-cat-up], [data-cat-down]').forEach((button) => button.onclick = async () => {
      const id = button.dataset.catUp || button.dataset.catDown;
      const direction = button.dataset.catUp ? -1 : 1;
      const next = reorderCategory(ui.categories, id, direction);
      try {
        await Promise.all(next.map((row) => saveCategory(ctx, row)));
        ui.categories = next;
        render();
      } catch (err) { ui.error = plainError(err); render(); }
    });
    container.querySelectorAll('[data-cat-remove]').forEach((button) => button.onclick = async () => {
      const id = button.dataset.catRemove;
      const plan = removeCategory(ui.categories, libraryDocs(), id);
      if (plan.error) { ui.error = plan.error; render(); return; }
      try {
        for (const doc of libraryDocs()) {
          if (doc.category_id === id) await saveTemplate(ctx, { ...doc, category_id: plan.fallbackId });
        }
        await deleteCategory(ctx, id);
        ui.categories = plan.categories;
        ui.templates = ui.templates.map((item) => (item.category_id === id ? { ...item, category_id: plan.fallbackId } : item));
        ui.notice = plan.message;
        ui.error = '';
        render();
      } catch (err) { ui.error = plainError(err); render(); }
    });
    container.querySelectorAll('[data-upload]').forEach((input) => input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const uploaded = await uploadLibraryFile(ctx, file);
        const saved = await saveTemplate(ctx, {
          name: file.name.replace(/\.[^.]+$/, '') || file.name,
          audience: 'both',
          kind: 'file',
          fields: [],
          is_draft: false,
          draft_notice: '',
          active: true,
          category_id: input.dataset.upload,
          storage_path: uploaded.path,
          mime_type: uploaded.mime_type,
          file_name: uploaded.file_name
        });
        ui.templates = [saved, ...ui.templates.filter((item) => item.id !== saved.id)];
        ui.notice = `Added ${saved.name}.`;
        ui.error = '';
        render();
      } catch (err) { ui.error = plainError(err); render(); }
    });
    container.querySelectorAll('[data-open]').forEach((button) => button.onclick = () => openDoc(button.dataset.open));
    container.querySelectorAll('[data-edit-doc]').forEach((button) => button.onclick = () => {
      ui.editing = ui.editing === button.dataset.editDoc ? '' : button.dataset.editDoc;
      render();
    });
    container.querySelectorAll('[data-doc-form]').forEach((form) => form.onsubmit = (event) => saveDoc(event, form));
    container.querySelectorAll('[data-doc-delete]').forEach((button) => button.onclick = () => removeDoc(button.dataset.docDelete));
  }

  async function openDoc(id) {
    const doc = ui.templates.find((item) => item.id === id);
    if (!doc) return;
    try {
      const url = await openStoredFile(ctx, doc.storage_path);
      if (!url) throw new Error('That file is not available yet.');
      window.open(url, '_blank', 'noopener');
    } catch (err) { ui.error = plainError(err); render(); }
  }

  async function saveDoc(event, form) {
    event.preventDefault();
    const id = form.dataset.docForm;
    const doc = ui.templates.find((item) => item.id === id);
    const error = form.querySelector('[data-doc-error]');
    if (!doc) return;
    const name = form.querySelector(`#docName-${id}`).value.trim();
    const category_id = form.querySelector(`#docCat-${id}`).value;
    const audience = form.querySelector(`#docAudience-${id}`).value;
    const file = form.querySelector(`#docReplace-${id}`).files?.[0];
    if (!name) { error.textContent = 'Name the document.'; return; }
    if (audience === 'people' && !ui.assignments.some((row) => row.template_id === id)) {
      error.textContent = 'Pick specific people in the form builder, or choose a group above.';
      return;
    }
    error.textContent = 'Saving…';
    try {
      let next = { ...doc, name, category_id, audience };
      if (file) {
        const uploaded = await uploadLibraryFile(ctx, file);
        const previous = doc.storage_path;
        next = { ...next, storage_path: uploaded.path, mime_type: uploaded.mime_type, file_name: uploaded.file_name };
        const saved = await saveTemplate(ctx, next);
        if (previous && previous !== uploaded.path) await discardStoredFile(ctx, previous);
        ui.templates = ui.templates.map((item) => (item.id === saved.id ? saved : item));
      } else {
        const saved = await saveTemplate(ctx, next);
        ui.templates = ui.templates.map((item) => (item.id === saved.id ? saved : item));
      }
      ui.editing = '';
      ui.notice = 'Document saved.';
      ui.error = '';
      render();
    } catch (err) { error.textContent = plainError(err); }
  }

  async function removeDoc(id) {
    const doc = ui.templates.find((item) => item.id === id);
    if (!doc) return;
    try {
      await deleteLibraryDocument(ctx, doc);
      ui.templates = ui.templates.filter((item) => item.id !== id);
      ui.editing = '';
      ui.notice = 'Document deleted.';
      render();
    } catch (err) { ui.error = plainError(err); render(); }
  }

  function bindRecords() {
    const file = container.querySelector('#recFile');
    if (file) file.onchange = () => {
      ui.draft.file = file.files?.[0] || null;
      ui.draft.fileName = ui.draft.file?.name || '';
      readDraft();
      const label = container.querySelector('#recFileName');
      if (label) label.textContent = ui.draft.fileName || 'No file chosen yet';
    };
    const query = container.querySelector('#leadQ');
    let timer;
    if (query) query.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(() => runLeadSearch(query.value), 200);
    };
    container.querySelectorAll('[data-lead]').forEach((button) => button.onclick = () => {
      const row = ui.leadHits.find((item) => item.id === button.dataset.lead);
      if (!row) return;
      readDraft();
      ui.draft.lead_id = row.id;
      ui.draft.leadLabel = [row.address, row.city].filter(Boolean).join(', ');
      ui.draft.address_snapshot = ui.draft.leadLabel || row.address || '';
      if (!ui.draft.homeowner_name) ui.draft.homeowner_name = row.name || '';
      ui.leadHits = [];
      render();
    });
    container.querySelector('#clearLead')?.addEventListener('click', () => {
      readDraft();
      ui.draft.lead_id = '';
      ui.draft.leadLabel = '';
      render();
    });
    container.querySelector('#recordForm').onsubmit = saveRecord;
    const applyFilter = () => { readDraft(); ui.error = ''; render(); };
    container.querySelector('#recQuery').oninput = () => {
      const pos = container.querySelector('#recQuery').selectionStart;
      applyFilter();
      const next = container.querySelector('#recQuery');
      next.focus();
      next.setSelectionRange(pos, pos);
    };
    ['recFrom', 'recTo', 'recStatusFilter'].forEach((id) => {
      container.querySelector(`#${id}`)?.addEventListener('change', applyFilter);
    });
    container.querySelectorAll('[data-rec-delete]').forEach((button) => button.onclick = () => removeRecord(button.dataset.recDelete));
  }

  async function runLeadSearch(query) {
    const hits = container.querySelector('#leadHits');
    if (!hits) return;
    if (query.trim().length < 2) { hits.innerHTML = ''; ui.leadHits = []; return; }
    const rows = await searchLeads(ctx, query).catch((error) => {
      hits.innerHTML = `<p class="tnError">${esc(error.message)}</p>`;
      return [];
    });
    ui.leadHits = rows;
    hits.innerHTML = rows.length
      ? rows.map((row) => `<button type="button" class="tnTap tnChoice" data-lead="${esc(row.id)}"><b>${esc(row.address || 'House')}</b><span class="tnMeta">${esc(row.name || '')} ${esc(row.city || '')}</span></button>`).join('')
      : '<p class="tnSub">No matching house.</p>';
    hits.querySelectorAll('[data-lead]').forEach((button) => button.onclick = () => {
      const row = rows.find((item) => item.id === button.dataset.lead);
      if (!row) return;
      readDraft();
      ui.draft.lead_id = row.id;
      ui.draft.leadLabel = [row.address, row.city].filter(Boolean).join(', ');
      ui.draft.address_snapshot = ui.draft.leadLabel || row.address || '';
      if (!ui.draft.homeowner_name) ui.draft.homeowner_name = row.name || '';
      ui.leadHits = [];
      render();
    });
  }

  async function saveRecord(event) {
    event.preventDefault();
    readDraft();
    const error = container.querySelector('#recordError');
    const file = ui.draft.file || container.querySelector('#recFile').files?.[0];
    if (!file) { error.textContent = ui.tab === 'estimates' ? 'Choose an estimate file.' : 'Choose a receipt file or photo.'; return; }
    error.textContent = 'Saving…';
    try {
      const payload = { ...ui.draft, file };
      if (ui.tab === 'estimates') {
        const saved = await saveEstimate(ctx, payload);
        ui.estimates = [saved, ...ui.estimates.filter((row) => row.id !== saved.id)];
        ui.notice = 'Estimate saved.';
      } else {
        const saved = await saveReceipt(ctx, payload);
        ui.receipts = [saved, ...ui.receipts.filter((row) => row.id !== saved.id)];
        ui.notice = 'Receipt saved.';
      }
      ui.draft = blankDraft();
      ui.error = '';
      ui.leadHits = [];
      render();
    } catch (err) { error.textContent = plainError(err); }
  }

  async function removeRecord(id) {
    const estimate = ui.tab === 'estimates';
    const rows = estimate ? ui.estimates : ui.receipts;
    const row = rows.find((item) => item.id === id);
    if (!row) return;
    try {
      if (estimate) await deleteEstimate(ctx, row);
      else await deleteReceipt(ctx, row);
      if (estimate) ui.estimates = ui.estimates.filter((item) => item.id !== id);
      else ui.receipts = ui.receipts.filter((item) => item.id !== id);
      ui.notice = estimate ? 'Estimate deleted.' : 'Receipt deleted.';
      render();
    } catch (err) { ui.error = plainError(err); render(); }
  }

  render();
}

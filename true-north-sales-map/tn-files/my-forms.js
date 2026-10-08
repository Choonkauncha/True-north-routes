import { esc } from './ui.js';
import { audienceLabel, isManagement } from './logic.js';
import { canSeeForm } from '../lib/role-access.js';
import {
  ESTIMATE_STATUSES,
  LIBRARY_ACCEPT,
  RECORD_ACCEPT,
  addCategory,
  canDeleteRecord,
  customCategories,
  filterRecords,
  formatMoney,
  groupLibrary,
  inspectionFolders,
  isInspectionFolder,
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
  listIntakes,
  listPhotos,
  listReceipts,
  listSubmissions,
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
const formDataCache = new Map();

function formCacheKey(ctx) {
  return `${ctx?.mode || 'local'}:${ctx?.rep?.id || 'none'}`;
}

const DEMO_LEAD = 'demo-inspection-lead';
const DEMO_FOLDER = {
  id: 'c2000000-0000-4000-8000-0000000000a1',
  name: 'Alex Morgan · 18 Public Square · Oct 8, 2026',
  slug: 'inspection-demo',
  sort_order: 1759946400,
  system: true,
  kind: 'inspection',
  appointment_id: 'a2000000-0000-4000-8000-0000000000a1',
  lead_id: DEMO_LEAD,
  scheduled_at: '2026-10-08T18:00:00Z'
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function blankDraft(estimate) {
  return {
    amount: '',
    vendor: '',
    homeowner_name: '',
    address_snapshot: '',
    record_date: today(),
    note: '',
    status: 'draft',
    lead_id: '',
    leadLabel: '',
    file: null,
    fileName: '',
    open: false,
    filters: { query: '', from: '', to: '', status: '' },
    hits: [],
    estimate
  };
}

function withLocalSamples(categories, receipts, estimates, photos, submissions, intakes) {
  const nextCategories = categories.some(isInspectionFolder) ? categories : [...categories, DEMO_FOLDER];
  const nextReceipts = receipts.length ? receipts : [{
    id: 'demo-receipt',
    demo: true,
    file_name: 'supply-receipt.png',
    vendor: 'ABC Supply',
    amount: 40,
    record_date: '2026-10-08',
    address_snapshot: '18 Public Square',
    note: 'Coil nails for the repair.',
    lead_id: DEMO_LEAD,
    uploaded_by: 'local'
  }];
  const nextEstimates = estimates.length ? estimates : [{
    id: 'demo-estimate',
    demo: true,
    file_name: 'roof-estimate.pdf',
    homeowner_name: 'Alex Morgan',
    amount: 9000,
    record_date: '2026-10-08',
    status: 'sent',
    address_snapshot: '18 Public Square',
    note: 'Full slope replacement.',
    lead_id: DEMO_LEAD,
    uploaded_by: 'local'
  }];
  const nextPhotos = photos.some((row) => row.lead_id === DEMO_LEAD) ? photos : [{
    id: 'demo-photo',
    demo: true,
    lead_id: DEMO_LEAD,
    caption: 'Hail hits on the south slope.',
    address_snapshot: '18 Public Square',
    created_at: '2026-10-08T18:30:00Z'
  }, ...photos];
  const nextSubmissions = submissions.some((row) => row.lead_id === DEMO_LEAD) ? submissions : [{
    id: 'demo-submission',
    demo: true,
    lead_id: DEMO_LEAD,
    template_name: 'Roof inspection',
    created_at: '2026-10-08T18:40:00Z'
  }, ...submissions];
  const nextIntakes = intakes.some((row) => row.lead_id === DEMO_LEAD) ? intakes : [{
    id: 'demo-intake',
    demo: true,
    lead_id: DEMO_LEAD,
    first_name: 'Alex',
    last_name: 'Morgan',
    address: '18 Public Square',
    concern: 'Missing shingles after the storm.',
    created_at: '2026-10-08T15:00:00Z'
  }, ...intakes];
  return {
    categories: nextCategories,
    receipts: nextReceipts,
    estimates: nextEstimates,
    photos: nextPhotos,
    submissions: nextSubmissions,
    intakes: nextIntakes
  };
}

export async function mountMyForms(container, ctx, options = {}) {
  const mine = ++mountToken;
  const manage = ctx.mode === 'local' || isManagement(ctx.rep?.role);
  if (!manage) {
    container.innerHTML = '<p class="tnSub">The document library is for admin and managers.</p>';
    return;
  }
  const role = ctx.rep?.role || (ctx.mode === 'local' ? 'admin' : '');
  let data = formDataCache.get(formCacheKey(ctx));
  if (!data) {
    container.innerHTML = '<div class="tnSkeleton" aria-hidden="true"><span></span><span></span><span></span></div>';
    let categories = [];
    let templates = [];
    let receipts = [];
    let estimates = [];
    let assignments = [];
    let photos = [];
    let submissions = [];
    let intakes = [];
    try {
      [categories, templates, receipts, estimates, assignments, photos, submissions, intakes] = await Promise.all([
        listCategories(ctx),
        listTemplates(ctx),
        listReceipts(ctx),
        listEstimates(ctx),
        listAssignments(ctx).catch(() => []),
        listPhotos(ctx).catch(() => []),
        listSubmissions(ctx).catch(() => []),
        listIntakes(ctx).catch(() => [])
      ]);
    } catch (error) {
      if (mine !== mountToken) return;
      container.innerHTML = `<p class="tnError">${esc(plainError(error))}</p>`;
      return;
    }
    if (mine !== mountToken) return;
    if (ctx.mode === 'local') {
      ({ categories, receipts, estimates, photos, submissions, intakes } = withLocalSamples(
        categories, receipts, estimates, photos, submissions, intakes
      ));
    }
    data = { categories, templates, receipts, estimates, assignments, photos, submissions, intakes };
    formDataCache.set(formCacheKey(ctx), data);
  }

  const ui = Object.assign(data, {
    notice: '',
    error: '',
    renaming: '',
    editing: '',
    openId: '',
    receipt: blankDraft(false),
    estimate: blankDraft(true)
  });

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

  function readKind(kind) {
    const box = kind === 'estimate' ? ui.estimate : ui.receipt;
    const prefix = kind === 'estimate' ? 'est' : 'rec';
    const read = (suffix, key) => {
      const node = container.querySelector(`#${prefix}${suffix}`);
      if (node) box[key] = node.value;
    };
    read('Amount', 'amount');
    read('Vendor', 'vendor');
    read('Homeowner', 'homeowner_name');
    read('Address', 'address_snapshot');
    read('Date', 'record_date');
    read('Note', 'note');
    read('Status', 'status');
    read('Query', 'query');
    const filters = box.filters;
    const query = container.querySelector(`#${prefix}Query`);
    const from = container.querySelector(`#${prefix}From`);
    const to = container.querySelector(`#${prefix}To`);
    const status = container.querySelector(`#${prefix}StatusFilter`);
    if (query) filters.query = query.value;
    if (from) filters.from = from.value;
    if (to) filters.to = to.value;
    if (status) filters.status = status.value;
  }

  function shell() {
    const local = ctx.mode === 'local' && !options.embedded
      ? '<div class="tnBanner">Saved on this phone until Supabase is connected.</div>'
      : '';
    const heading = options.embedded
      ? ''
      : '<h1 class="tnTitle">Document library</h1><p class="tnSub">Receipts, estimates, completed inspections, and the folders you keep.</p>';
    const body = ui.openId ? folderHtml() : overviewHtml();
    return `${local}<div class="tnMyForms">${heading}
      ${ui.notice ? `<p class="tnBanner">${esc(ui.notice)}</p>` : ''}
      ${ui.error ? `<p class="tnError">${esc(ui.error)}</p>` : ''}
      ${body}</div>`;
  }

  function overviewHtml() {
    return `${recordSection('receipt')}${recordSection('estimate')}${inspectionSection()}${customSection()}`;
  }

  function recordSection(kind) {
    const estimate = kind === 'estimate';
    const box = estimate ? ui.estimate : ui.receipt;
    const prefix = estimate ? 'est' : 'rec';
    const rows = filterRecords(estimate ? ui.estimates : ui.receipts, box.filters);
    const title = estimate ? 'Estimates' : 'Receipts';
    const blurb = estimate
      ? 'Upload an estimate PDF or photo and link it to a house when you have one.'
      : 'Upload a receipt file or take a photo of one with the phone.';
    const capture = estimate ? '' : ' capture="environment"';
    const extra = estimate
      ? `<label class="tnLabel" for="estHomeowner">Homeowner</label><input class="tnInput" id="estHomeowner" value="${esc(box.homeowner_name)}" autocomplete="name">
         <label class="tnLabel" for="estStatus">Status</label><select class="tnSelect" id="estStatus">${ESTIMATE_STATUSES.map(([value, label]) => `<option value="${value}" ${box.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select>`
      : `<label class="tnLabel" for="recVendor">Vendor</label><input class="tnInput" id="recVendor" value="${esc(box.vendor)}">`;
    const statusFilter = estimate
      ? `<label class="tnLabel" for="estStatusFilter">Status</label><select class="tnSelect" id="estStatusFilter"><option value="">Any status</option>${ESTIMATE_STATUSES.map(([value, label]) => `<option value="${value}" ${box.filters.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select>`
      : '';
    const list = rows.length
      ? rows.map((row) => recordCard(row, estimate)).join('')
      : `<p class="tnSub">No ${estimate ? 'estimates' : 'receipts'} yet.</p>`;
    const form = box.open ? `<form id="${prefix}Form" class="tnRecordForm">
        <p class="tnSub" id="${prefix}FileName">${esc(box.fileName || 'No file chosen yet')}</p>
        ${extra}
        <label class="tnLabel" for="${prefix}Amount">Amount</label><input class="tnInput" id="${prefix}Amount" inputmode="decimal" value="${esc(box.amount)}" placeholder="1250.00">
        <label class="tnLabel" for="${prefix}Date">Date</label><input class="tnInput" id="${prefix}Date" type="date" value="${esc(box.record_date)}">
        <label class="tnLabel" for="${prefix}Address">Address</label><input class="tnInput" id="${prefix}Address" value="${esc(box.address_snapshot)}">
        <label class="tnLabel" for="${prefix}LeadQ">Find the house</label><input class="tnInput" id="${prefix}LeadQ" placeholder="Start typing an address">
        <div id="${prefix}Hits" class="tnStack">${leadHits(box)}</div>
        ${box.leadLabel ? `<p class="tnSub">Linked house: ${esc(box.leadLabel)}</p><button type="button" class="tnTap" data-clear-lead="${kind}">Clear house</button>` : ''}
        <label class="tnLabel" for="${prefix}Note">Note</label><textarea class="tnArea" id="${prefix}Note">${esc(box.note)}</textarea>
        <button class="tnTap primary" type="submit">Save ${estimate ? 'estimate' : 'receipt'}</button>
        <p id="${prefix}Error" class="tnError"></p>
      </form>` : '';
    return `<section class="tnLibrarySection" id="${estimate ? 'estimatesSection' : 'receiptsSection'}" data-tn-panel="${estimate ? 'library-estimates' : 'library-receipts'}" data-tn-rank="${estimate ? 'secondary' : 'primary'}">
      <h2>${title}</h2>
      <p class="tnSub">${blurb}</p>
      <label class="tnTap primary">${estimate ? 'Add an estimate' : 'Add a receipt'}<input id="${prefix}File" type="file" accept="${RECORD_ACCEPT}"${capture}></label>
      ${form}
      <div class="tnStack">${list}</div>
      <div class="tnRecordFilters">
        <label class="tnLabel" for="${prefix}Query">Search</label><input class="tnInput" id="${prefix}Query" value="${esc(box.filters.query)}" placeholder="${estimate ? 'Homeowner, address, or note' : 'Vendor, address, or note'}">
        <label class="tnLabel" for="${prefix}From">From</label><input class="tnInput" id="${prefix}From" type="date" value="${esc(box.filters.from)}">
        <label class="tnLabel" for="${prefix}To">To</label><input class="tnInput" id="${prefix}To" type="date" value="${esc(box.filters.to)}">
        ${statusFilter}
      </div>
    </section>`;
  }

  function leadHits(box) {
    return box.hits.map((row) => `<button type="button" class="tnTap tnChoice" data-lead="${esc(row.id)}" data-kind="${box.estimate ? 'estimate' : 'receipt'}"><b>${esc(row.address || 'House')}</b><span class="tnMeta">${esc(row.name || '')} ${esc(row.city || '')}</span></button>`).join('');
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
    const remove = canDeleteRecord(role)
      ? `<button type="button" class="tnTap" data-rec-delete="${esc(row.id)}" data-kind="${estimate ? 'estimate' : 'receipt'}">Delete</button>`
      : '';
    const open = row.url ? `<a class="tnTap" href="${esc(row.url)}" target="_blank" rel="noopener">View</a>` : '';
    return `<article class="tnCard tnRecordCard" data-tn-panel="record-${esc(row.id || row.file_name || 'row')}" data-tn-rank="secondary"><b class="tnDocName">${esc(row.file_name || (estimate ? 'Estimate' : 'Receipt'))}</b><span>${esc(bits || 'No details yet')}</span>${note}<div class="tnRecordActions">${open}${remove}</div></article>`;
  }

  function inspectionSection() {
    const folders = inspectionFolders(ui.categories);
    const list = folders.length
      ? folders.map((folder) => `<button type="button" class="tnTap tnChoice" data-open-folder="${esc(folder.id)}"><span><b>${esc(folder.name)}</b><span class="tnMeta">Completed inspection</span></span></button>`).join('')
      : '<p class="tnSub">Completed inspections show up here on their own.</p>';
    return `<section class="tnLibrarySection" id="inspectionFolders" data-tn-panel="library-inspections" data-tn-rank="secondary"><h2>Completed inspections</h2><p class="tnSub">A permanent folder for every inspection marked Completed. Named by homeowner, address, and date.</p><div class="tnFolderList">${list}</div></section>`;
  }

  function customSection() {
    const groups = groupLibrary(customCategories(ui.categories), libraryDocs().filter((doc) => !isInspectionFolder(ui.categories.find((row) => row.id === doc.category_id))));
    const adder = `<form id="newCategory" class="tnRecordForm"><label class="tnLabel" for="categoryName">New category</label><input class="tnInput" id="categoryName" maxlength="60" placeholder="Warranties"><button class="tnTap primary" type="submit">Add category</button><p id="categoryError" class="tnError"></p></form>`;
    return `<section class="tnLibrarySection" id="customFolders" data-tn-panel="library-folders" data-tn-rank="secondary"><h2>Folders</h2><p class="tnSub">Add folders for contingency agreements and anything else the office should keep. Removing a folder moves its files to Uncategorized.</p>${adder}<div class="tnStack">${groups.map((group) => folderCard(group)).join('')}</div></section>`;
  }

  function folderCard(group) {
    const locked = group.system || group.slug === 'uncategorized' || isInspectionFolder(group);
    const controls = `<div class="tnIconBtns">
      <button type="button" data-cat-up="${esc(group.id)}" aria-label="Move ${esc(group.name)} up">Up</button>
      <button type="button" data-cat-down="${esc(group.id)}" aria-label="Move ${esc(group.name)} down">Down</button>
      <button type="button" data-cat-rename="${esc(group.id)}">Rename</button>
      ${locked ? '' : `<button type="button" data-cat-remove="${esc(group.id)}">Remove</button>`}
    </div>`;
    const rename = ui.renaming === group.id
      ? `<form data-rename-form="${esc(group.id)}" class="tnRecordForm"><label class="tnLabel" for="rename-${esc(group.id)}">Folder name</label><input class="tnInput" id="rename-${esc(group.id)}" value="${esc(group.name)}" maxlength="60"><button class="tnTap primary" type="submit">Save name</button></form>`
      : '';
    const docs = group.documents.length
      ? group.documents.map((doc) => docHtml(doc)).join('')
      : '<p class="tnSub">No documents in this folder yet.</p>';
    return `<section class="tnFolder" data-folder="${esc(group.slug)}" data-tn-panel="folder-${esc(group.slug)}" data-tn-rank="secondary"><div class="tnFolderHead"><b>${esc(group.name)}</b>${controls}</div>${rename}<div class="tnStack">${docs}</div><label class="tnTap">Add a document<input type="file" data-upload="${esc(group.id)}" accept="${LIBRARY_ACCEPT}"></label></section>`;
  }

  function docHtml(doc) {
    const editing = ui.editing === doc.id;
    const meta = `${esc(doc.file_name || 'File')} · ${esc(audienceLabel(doc.audience))}${doc.active === false ? ' · Hidden' : ''}`;
    const open = `<button type="button" class="tnTap" data-open="${esc(doc.id)}">Open</button>`;
    const editBtn = `<button type="button" class="tnTap" data-edit-doc="${esc(doc.id)}">${editing ? 'Close' : 'Edit'}</button>`;
    return `<article class="tnCard tnRecordCard" data-tn-panel="library-doc-${esc(doc.id)}" data-tn-rank="secondary"><b class="tnDocName">${esc(doc.name)}</b><span>${meta}</span><div class="tnRecordActions">${open}${editBtn}</div>${editing ? editPanel(doc) : ''}</article>`;
  }

  function categoryOptions(selected) {
    const rows = [...customCategories(ui.categories), ...inspectionFolders(ui.categories)];
    return rows.map((row) => `<option value="${esc(row.id)}" ${selected === row.id ? 'selected' : ''}>${esc(row.name)}</option>`).join('');
  }

  function editPanel(doc) {
    const audiences = [
      ['both', 'Setters and sales reps'],
      ['setter', 'All setters'],
      ['rep', 'All sales reps'],
      ['people', 'Specific people']
    ].map(([value, label]) => `<option value="${value}" ${doc.audience === value ? 'selected' : ''}>${label}</option>`).join('');
    return `<form data-doc-form="${esc(doc.id)}" class="tnRecordForm">
      <label class="tnLabel" for="docName-${esc(doc.id)}">Name</label><input class="tnInput" id="docName-${esc(doc.id)}" value="${esc(doc.name)}">
      <label class="tnLabel" for="docCat-${esc(doc.id)}">Folder</label><select class="tnSelect" id="docCat-${esc(doc.id)}">${categoryOptions(doc.category_id)}</select>
      <label class="tnLabel" for="docAudience-${esc(doc.id)}">Who can open it</label><select class="tnSelect" id="docAudience-${esc(doc.id)}">${audiences}</select>
      <label class="tnTap">Replace file<input type="file" id="docReplace-${esc(doc.id)}" accept="${LIBRARY_ACCEPT}"></label>
      <button class="tnTap primary" type="submit">Save document</button>
      <button class="tnTap" type="button" data-doc-delete="${esc(doc.id)}">Delete document</button>
      <p class="tnError" data-doc-error="${esc(doc.id)}"></p>
    </form>`;
  }

  function folderHtml() {
    const folder = ui.categories.find((row) => row.id === ui.openId);
    if (!folder) return '<p class="tnSub">That folder is no longer here.</p><button type="button" class="tnTap" id="closeFolder">Back to the library</button>';
    const leadId = folder.lead_id || '';
    const photos = ui.photos.filter((row) => leadId && row.lead_id === leadId);
    const submissions = ui.submissions.filter((row) => leadId && row.lead_id === leadId);
    const intakes = ui.intakes.filter((row) => leadId && row.lead_id === leadId);
    const receipts = ui.receipts.filter((row) => leadId && row.lead_id === leadId);
    const estimates = ui.estimates.filter((row) => leadId && row.lead_id === leadId);
    const files = libraryDocs().filter((doc) => doc.category_id === folder.id);
    const photoHtml = photos.length
      ? photos.map((photo) => `<article class="tnCard tnRecordCard"><b>Roof photo</b>${photo.caption ? `<p class="tnPhotoNote">${esc(photo.caption)}</p>` : '<p class="tnSub">No note on this photo.</p>'}${photo.url ? `<img alt="${esc(photo.caption || 'Roof photo')}" src="${esc(photo.url)}">` : ''}</article>`).join('')
      : '<p class="tnSub">No roof photos for this house yet.</p>';
    const formHtml = submissions.length
      ? submissions.map((row) => `<article class="tnCard tnRecordCard"><b class="tnDocName">${esc(row.template_name || 'Inspection form')}</b><span>${esc(String(row.created_at || '').slice(0, 10))}</span></article>`).join('')
      : '<p class="tnSub">No inspection form yet.</p>';
    const intakeHtml = intakes.length
      ? intakes.map((row) => `<article class="tnCard tnRecordCard"><b class="tnDocName">${esc(`${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Homeowner intake')}</b><span>${esc(row.address || '')}</span>${row.concern ? `<p class="tnPhotoNote">${esc(row.concern)}</p>` : ''}</article>`).join('')
      : '<p class="tnSub">No homeowner intake yet.</p>';
    const linked = [...receipts.map((row) => recordCard(row, false)), ...estimates.map((row) => recordCard(row, true))].join('')
      || '<p class="tnSub">No receipts or estimates linked to this house yet. Add them from the library and pick this house.</p>';
    const extra = files.length ? files.map((doc) => docHtml(doc)).join('') : '<p class="tnSub">No extra files in this folder yet.</p>';
    return `<section class="tnLibrarySection" id="openInspection">
      <button type="button" class="tnTap" id="closeFolder">Back to the library</button>
      <h2>${esc(folder.name)}</h2>
      <p class="tnPerm">Permanent folder for this completed inspection. It cannot be renamed or deleted.</p>
      <section data-tn-panel="lib-photos" data-tn-rank="primary"><h3>Roof photos</h3><div class="tnStack">${photoHtml}</div></section>
      <section data-tn-panel="lib-forms" data-tn-rank="secondary"><h3>Inspection forms</h3><div class="tnStack">${formHtml}</div></section>
      <section data-tn-panel="lib-intake" data-tn-rank="secondary"><h3>Homeowner intake</h3><div class="tnStack">${intakeHtml}</div></section>
      <section data-tn-panel="lib-money" data-tn-rank="secondary"><h3>Receipts and estimates</h3><div class="tnStack">${linked}</div></section>
      <section data-tn-panel="lib-files" data-tn-rank="secondary"><h3>More files</h3><div class="tnStack">${extra}</div></section>
      <label class="tnTap primary">Add a file to this inspection<input type="file" data-upload="${esc(folder.id)}" accept="${LIBRARY_ACCEPT}"></label>
    </section>`;
  }

  function bind() {
    container.querySelector('#closeFolder')?.addEventListener('click', () => {
      ui.openId = '';
      ui.error = '';
      render();
    });
    container.querySelectorAll('[data-open-folder]').forEach((button) => button.onclick = () => {
      ui.openId = button.dataset.openFolder;
      ui.error = '';
      ui.notice = '';
      render();
    });
    bindRecords('receipt');
    bindRecords('estimate');
    bindLibrary();
  }

  function bindRecords(kind) {
    const estimate = kind === 'estimate';
    const box = estimate ? ui.estimate : ui.receipt;
    const prefix = estimate ? 'est' : 'rec';
    const file = container.querySelector(`#${prefix}File`);
    if (file) file.onchange = () => {
      readKind('receipt');
      readKind('estimate');
      box.file = file.files?.[0] || null;
      box.fileName = box.file?.name || '';
      box.open = Boolean(box.file);
      render();
    };
    const query = container.querySelector(`#${prefix}LeadQ`);
    if (query) {
      let timer;
      query.oninput = () => {
        clearTimeout(timer);
        timer = setTimeout(() => runLeadSearch(kind, query.value), 200);
      };
    }
    container.querySelectorAll(`[data-lead][data-kind="${kind}"]`).forEach((button) => button.onclick = () => chooseLead(kind, button.dataset.lead));
    container.querySelector(`[data-clear-lead="${kind}"]`)?.addEventListener('click', () => {
      readKind(kind);
      box.lead_id = '';
      box.leadLabel = '';
      render();
    });
    container.querySelector(`#${prefix}Form`)?.addEventListener('submit', (event) => saveRecord(event, kind));
    const applyFilter = () => {
      readKind('receipt');
      readKind('estimate');
      render();
      const next = container.querySelector(`#${prefix}Query`);
      if (next && document.activeElement !== next) next.focus();
    };
    container.querySelector(`#${prefix}Query`)?.addEventListener('input', () => {
      const node = container.querySelector(`#${prefix}Query`);
      const pos = node.selectionStart;
      readKind('receipt');
      readKind('estimate');
      render();
      const next = container.querySelector(`#${prefix}Query`);
      if (!next) return;
      next.focus();
      next.setSelectionRange(pos, pos);
    });
    [`${prefix}From`, `${prefix}To`, `${prefix}StatusFilter`].forEach((id) => {
      container.querySelector(`#${id}`)?.addEventListener('change', applyFilter);
    });
    container.querySelectorAll(`[data-rec-delete][data-kind="${kind}"]`).forEach((button) => button.onclick = () => removeRecord(kind, button.dataset.recDelete));
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
    container.querySelectorAll('[data-rename-form]').forEach((formNode) => formNode.onsubmit = async (event) => {
      event.preventDefault();
      const id = formNode.dataset.renameForm;
      const result = renameCategory(ui.categories, id, formNode.querySelector('input').value);
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
      const custom = reorderCategory(customCategories(ui.categories), id, direction);
      try {
        await Promise.all(custom.map((row) => saveCategory(ctx, row)));
        ui.categories = [...inspectionFolders(ui.categories), ...custom];
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
    container.querySelectorAll('[data-doc-form]').forEach((formNode) => formNode.onsubmit = (event) => saveDoc(event, formNode));
    container.querySelectorAll('[data-doc-delete]').forEach((button) => button.onclick = () => removeDoc(button.dataset.docDelete));
  }

  async function chooseLead(kind, id) {
    const box = kind === 'estimate' ? ui.estimate : ui.receipt;
    const row = box.hits.find((item) => item.id === id);
    if (!row) return;
    readKind(kind);
    box.lead_id = row.id;
    box.leadLabel = [row.address, row.city].filter(Boolean).join(', ');
    box.address_snapshot = box.leadLabel || row.address || '';
    if (!box.homeowner_name) box.homeowner_name = row.name || '';
    box.hits = [];
    render();
  }

  async function runLeadSearch(kind, query) {
    const box = kind === 'estimate' ? ui.estimate : ui.receipt;
    const prefix = kind === 'estimate' ? 'est' : 'rec';
    const hits = container.querySelector(`#${prefix}Hits`);
    if (!hits) return;
    if (query.trim().length < 2) { hits.innerHTML = ''; box.hits = []; return; }
    const rows = await searchLeads(ctx, query).catch((error) => {
      hits.innerHTML = `<p class="tnError">${esc(error.message)}</p>`;
      return [];
    });
    box.hits = rows;
    hits.innerHTML = rows.length ? leadHits(box) : '<p class="tnSub">No matching house.</p>';
    hits.querySelectorAll('[data-lead]').forEach((button) => button.onclick = () => chooseLead(kind, button.dataset.lead));
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

  async function saveDoc(event, formNode) {
    event.preventDefault();
    const id = formNode.dataset.docForm;
    const doc = ui.templates.find((item) => item.id === id);
    const error = formNode.querySelector('[data-doc-error]');
    if (!doc) return;
    const name = formNode.querySelector(`#docName-${id}`).value.trim();
    const category_id = formNode.querySelector(`#docCat-${id}`).value;
    const audience = formNode.querySelector(`#docAudience-${id}`).value;
    const file = formNode.querySelector(`#docReplace-${id}`).files?.[0];
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

  async function saveRecord(event, kind) {
    event.preventDefault();
    const estimate = kind === 'estimate';
    const box = estimate ? ui.estimate : ui.receipt;
    const prefix = estimate ? 'est' : 'rec';
    readKind(kind);
    const error = container.querySelector(`#${prefix}Error`);
    const file = box.file || container.querySelector(`#${prefix}File`)?.files?.[0];
    if (!file) {
      error.textContent = estimate ? 'Choose an estimate file.' : 'Choose a receipt file or photo.';
      return;
    }
    error.textContent = 'Saving…';
    try {
      const payload = { ...box, file };
      if (estimate) {
        const saved = await saveEstimate(ctx, payload);
        ui.estimates = [saved, ...ui.estimates.filter((row) => row.id !== saved.id)];
        ui.notice = 'Estimate saved.';
        ui.estimate = blankDraft(true);
      } else {
        const saved = await saveReceipt(ctx, payload);
        ui.receipts = [saved, ...ui.receipts.filter((row) => row.id !== saved.id)];
        ui.notice = 'Receipt saved.';
        ui.receipt = blankDraft(false);
      }
      ui.error = '';
      render();
    } catch (err) { error.textContent = plainError(err); }
  }

  async function removeRecord(kind, id) {
    const estimate = kind === 'estimate';
    const rows = estimate ? ui.estimates : ui.receipts;
    const row = rows.find((item) => item.id === id);
    if (!row) return;
    try {
      if (!row.demo) {
        if (estimate) await deleteEstimate(ctx, row);
        else await deleteReceipt(ctx, row);
      }
      if (estimate) ui.estimates = ui.estimates.filter((item) => item.id !== id);
      else ui.receipts = ui.receipts.filter((item) => item.id !== id);
      ui.notice = estimate ? 'Estimate deleted.' : 'Receipt deleted.';
      render();
    } catch (err) { ui.error = plainError(err); render(); }
  }

  render();
}

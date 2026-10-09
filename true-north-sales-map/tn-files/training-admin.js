import { bootFiles, attachSession } from './store.js';
import { createDeferredAuthHandler } from '../lib/auth-events.js';
import { roleLabel } from '../lib/role-access.js';
import {
  TRAINING_BUCKET,
  classifyFile,
  cleanTrainingDraft,
  contentTypeFor,
  extensionOf,
  uploadSizeError
} from '../lib/training-progress.js';
import {
  adminFormHtml,
  adminShellHtml,
  libraryHtml,
  matrixHtml,
  profileHtml
} from './training-ui.js';
import {
  capturePoster,
  pdfPageCount,
  probeVideoFile,
  readPptx,
  transcodeToMp4,
  uploadPoster,
  uploadTrainingFile
} from './training-media.js';

const root = document.getElementById('tnTrainingRoot');
const preview = new URLSearchParams(location.search).get('preview');
if (root && preview === 'training' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  const { renderAdminPreview } = await import('./training-preview.js');
  revealAdmin();
  renderAdminPreview(root);
} else if (root) {
  boot();
}

let ctx;
let items = [];
let people = [];
let progress = [];
let reminders = [];
let assignments = [];
let view = 'library';
let draft = null;
let statusItemId = '';
let personId = '';
let requiredOnly = false;
let accountEpoch = 0;

function revealAdmin() {
  document.getElementById('auth')?.classList.add('hidden');
  document.getElementById('app')?.classList.remove('hidden');
  document.querySelectorAll('main section[id^=tab-]').forEach((section) => {
    section.classList.toggle('hidden', section.id !== 'tab-training');
  });
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === 'training');
  });
}

async function boot() {
  const section = document.getElementById('tab-training');
  ctx = await bootFiles();
  const load = () => {
    const epoch = accountEpoch;
    if (ctx?.sb && ctx.session) refresh().catch(error => { if (epoch === accountEpoch) showError(error); });
  };
  if (section) {
    new MutationObserver(() => {
      if (!section.classList.contains('hidden')) load();
    }).observe(section, { attributes: true, attributeFilter: ['class'] });
    if (!section.classList.contains('hidden')) load();
  }
  ctx.sb?.auth.onAuthStateChange(createDeferredAuthHandler({
    initialSession: ctx.session,
    onInvalidate() {
      accountEpoch++;
      ctx.session = null; ctx.rep = null;
      items = []; people = []; progress = []; reminders = []; assignments = [];
      draft = null; statusItemId = ''; personId = '';
      root.innerHTML = '';
    },
    async onSession(session, current) {
      const next = { ...ctx };
      await attachSession(next, session);
      if (!current()) return;
      ctx.session = next.session; ctx.rep = next.rep;
      if (!section || !section.classList.contains('hidden')) load();
    },
    onError: showError
  }));
}

async function refresh() {
  const epoch = accountEpoch;
  const [itemRes, peopleRes, progressRes, reminderRes, assignmentRes] = await Promise.all([
    ctx.sb.from('training_items').select('*').order('sort_order'),
    ctx.sb.from('reps').select('id,name,role,active').eq('active', true).order('name'),
    ctx.sb.from('training_progress').select('*'),
    ctx.sb.from('training_reminders').select('*'),
    ctx.sb.from('training_assignments').select('*')
  ]);
  if (epoch !== accountEpoch) return;
  const error = itemRes.error || peopleRes.error || progressRes.error || reminderRes.error || assignmentRes.error;
  if (error) throw error;
  items = itemRes.data || [];
  people = (peopleRes.data || []).filter((person) => ['appointment_setter', 'canvasser', 'salesperson'].includes(person.role));
  progress = progressRes.data || [];
  reminders = reminderRes.data || [];
  assignments = assignmentRes.data || [];
  render();
}

function showError(error) {
  root.innerHTML = `<p class="tnTrainError">${error.message}. Apply supabase/migrations/20261008_training_practice.sql, then reload.</p>`;
}

function render() {
  root.innerHTML = adminShellHtml();
  root.querySelector('[data-admin-view="library"]').setAttribute('aria-pressed', view === 'library' ? 'true' : 'false');
  root.querySelector('[data-admin-view="status"]').setAttribute('aria-pressed', view === 'status' ? 'true' : 'false');
  root.querySelector('#tnTrainAdd').onclick = () => { draft = { audience: 'both', sortOrder: items.length + 1, assigneeIds: [] }; view = 'library'; render(); };
  root.querySelectorAll('[data-admin-view]').forEach((button) => {
    button.onclick = () => { view = button.dataset.adminView; draft = null; render(); };
  });
  const body = root.querySelector('#tnTrainAdminBody');
  if (draft) {
    const categories = [...new Set(items.map((item) => item.category).filter(Boolean))];
    body.innerHTML = adminFormHtml({ draft, people: people.map((person) => ({ ...person, name: person.name })), categories });
    const audience = body.querySelector('#tnAudience');
    audience.onchange = () => { body.querySelector('#tnPeople').hidden = audience.value !== 'specific'; };
    body.querySelector('#tnFile').onchange = () => {
      const chosen = body.querySelector('#tnFile').files?.[0];
      body.querySelector('#tnKeepWrap').hidden = !chosen || extensionOf(chosen.name) !== 'mov';
    };
    body.querySelector('#tnTrainCancel').onclick = () => { draft = null; render(); };
    body.querySelector('#tnTrainForm').onsubmit = (event) => submit(event);
    return;
  }
  if (view === 'status') {
    body.innerHTML = statusHtml();
    bindStatus(body);
    return;
  }
  const cards = items.map((item) => ({ ...item, progressRows: progress.filter((row) => row.item_id === item.id) }));
  body.innerHTML = libraryHtml(cards);
  body.querySelectorAll('[data-edit]').forEach((button) => { button.onclick = () => edit(button.dataset.edit); });
  body.querySelectorAll('[data-delete]').forEach((button) => { button.onclick = () => remove(button.dataset.delete); });
  body.querySelectorAll('[data-status]').forEach((button) => {
    button.onclick = () => { statusItemId = button.dataset.status; personId = ''; view = 'status'; render(); };
  });
}

function edit(id) {
  const item = items.find((row) => row.id === id);
  if (!item) return;
  draft = {
    id: item.id,
    title: item.title,
    description: item.description,
    category: item.category,
    sortOrder: item.sort_order,
    audience: item.audience,
    required: item.required,
    externalUrl: item.external_url || '',
    assigneeIds: assignments.filter((row) => row.item_id === item.id).map((row) => row.rep_id)
  };
  view = 'library';
  render();
}

function statusHtml() {
  if (personId && !statusItemId) {
    const person = people.find((row) => row.id === personId);
    const rows = items.filter((item) => !requiredOnly || item.required || reminders.some((row) => row.item_id === item.id && row.rep_id === personId)).map((item) => ({
      ...item,
      progress: progress.find((row) => row.item_id === item.id && row.rep_id === personId) || null,
      reminded: reminders.some((row) => row.item_id === item.id && row.rep_id === personId)
    }));
    return profileHtml({ person: { ...person, name: person?.name || 'Teammate' }, items: rows }) + personFilter();
  }
  const item = items.find((row) => row.id === statusItemId) || items[0];
  if (!item) return '<div class="tnTrainEmpty">Upload training before checking who has watched it.</div>';
  statusItemId = item.id;
  const progressByRep = new Map(progress.filter((row) => row.item_id === item.id).map((row) => [row.rep_id, row]));
  return matrixHtml({
    item,
    people: people.map((person) => ({ ...person, roleLabel: roleLabel(person.role) })),
    progressByRep,
    reminders: reminders.filter((row) => row.item_id === item.id),
    personId,
    requiredOnly
  });
}

function personFilter() {
  const options = ['<option value="">Everyone</option>'].concat(people.map((person) => `<option value="${person.id}" ${person.id === personId ? 'selected' : ''}>${person.name}</option>`)).join('');
  return `<label for="tnPersonFilter">Person</label><select id="tnPersonFilter">${options}</select><label class="tnTrainCheck"><input id="tnRequiredOnly" type="checkbox" ${requiredOnly ? 'checked' : ''}>Required only</label><button type="button" id="tnBackMatrix" class="tnTrainBtn">Back to the item</button>`;
}

function bindStatus(body) {
  const select = body.querySelector('#tnPersonFilter');
  if (select) select.onchange = () => { personId = select.value; render(); };
  const required = body.querySelector('#tnRequiredOnly');
  if (required) required.onchange = () => { requiredOnly = required.checked; render(); };
  body.querySelector('#tnBackMatrix')?.addEventListener('click', () => { personId = ''; render(); });
  body.querySelectorAll('[data-remind]').forEach((button) => {
    button.onclick = async () => {
      const { error } = await ctx.sb.from('training_reminders').upsert({
        item_id: statusItemId,
        rep_id: button.dataset.remind,
        created_by: ctx.rep?.id || null
      }, { onConflict: 'item_id,rep_id' });
      if (error) { alert(error.message); return; }
      await refresh();
    };
  });
}

async function submit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const file = form.file.files?.[0] || null;
  const cleaned = cleanTrainingDraft({
    title: form.title.value,
    description: form.description.value,
    category: form.category.value,
    sortOrder: form.sortOrder.value,
    audience: form.audience.value,
    required: form.required.checked,
    externalUrl: file ? '' : form.externalUrl.value,
    assigneeIds: [...form.querySelectorAll('input[name="person"]:checked')].map((input) => input.value),
    file
  }, { editing: Boolean(draft.id) });
  const status = form.querySelector('#tnUploadStatus');
  if (cleaned.error) { status.textContent = cleaned.error; return; }
  status.textContent = 'Saving…';
  try {
    const id = draft.id || crypto.randomUUID();
    const existing = items.find((item) => item.id === id);
    let media = existing ? {
      kind: existing.kind,
      storage_path: existing.storage_path,
      original_path: existing.original_path,
      poster_path: existing.poster_path,
      mime_type: existing.mime_type,
      file_name: existing.file_name,
      byte_size: existing.byte_size,
      duration_seconds: existing.duration_seconds,
      slide_count: existing.slide_count,
      page_count: existing.page_count,
      external_url: existing.external_url,
      external_provider: existing.external_provider
    } : {};
    if (cleaned.external) {
      media = {
        kind: 'external',
        external_url: cleaned.external.embedUrl,
        external_provider: cleaned.external.provider,
        storage_path: null,
        mime_type: null,
        file_name: null,
        byte_size: null,
        duration_seconds: null,
        slide_count: null,
        page_count: null
      };
    }
    if (file) media = await storeFile(id, file, status);
    const row = {
      id,
      title: cleaned.title,
      description: cleaned.description,
      category: cleaned.category,
      sort_order: cleaned.sortOrder,
      audience: cleaned.audience,
      required: cleaned.required,
      active: true,
      created_by: existing?.created_by || ctx.rep?.id || null,
      ...media
    };
    const saved = await ctx.sb.from('training_items').upsert(row).select('*').single();
    if (saved.error) throw saved.error;
    await ctx.sb.from('training_assignments').delete().eq('item_id', id);
    if (cleaned.assigneeIds.length) {
      const assigned = await ctx.sb.from('training_assignments').insert(cleaned.assigneeIds.map((rep_id) => ({ item_id: id, rep_id })));
      if (assigned.error) throw assigned.error;
    }
    draft = null;
    await refresh();
  } catch (error) {
    status.textContent = error.message;
  }
}

async function storeFile(id, file, status) {
  const kind = classifyFile(file.name, file.type);
  const sizeError = uploadSizeError(file.size);
  if (sizeError) throw new Error(sizeError);
  const stamp = Date.now();
  let uploadFile = file;
  let contentType = contentTypeFor(file.name, kind);
  let originalPath = null;
  const setMeter = (value, label) => {
    const meter = document.getElementById('tnUploadMeter');
    if (!meter) return;
    meter.hidden = false;
    meter.setAttribute('aria-valuenow', String(value));
    meter.querySelector('span').style.width = `${value}%`;
    status.textContent = label;
  };
  if (kind === 'video') {
    setMeter(2, 'Checking whether this browser can play the video…');
    const decision = await probeVideoFile(file);
    if (decision.action === 'transcode') {
      const keep = document.getElementById('tnKeepOriginal');
      document.getElementById('tnKeepWrap').hidden = false;
      setMeter(5, 'This file will not play on every phone. Converting to H.264 MP4…');
      if (keep?.checked) {
        originalPath = await send(file, `${id}/original-${stamp}.${extensionOf(file.name) || 'mov'}`, contentTypeFor(file.name, 'video'), (value) => setMeter(Math.round(value * 0.2), 'Uploading the original…'));
      }
      uploadFile = await transcodeToMp4(file, (value) => setMeter(20 + Math.round(value * 0.4), 'Converting to H.264 MP4…'));
      contentType = 'video/mp4';
    } else {
      contentType = decision.contentType;
      if (decision.action === 'play-as-mp4') uploadFile = file.slice(0, file.size, 'video/mp4');
    }
  }
  const ext = kind === 'video' ? (contentType === 'video/webm' ? 'webm' : 'mp4') : (extensionOf(file.name) || 'bin');
  const storagePath = await send(uploadFile, `${id}/media-${stamp}.${ext}`, contentType, (value) => setMeter(kind === 'video' ? 60 + Math.round(value * 0.3) : value, 'Uploading…'));
  let posterPath = null;
  let duration = null;
  let slideCount = null;
  let pageCount = null;
  if (kind === 'video') {
    duration = await mediaDuration(uploadFile);
    const poster = await capturePoster(uploadFile);
    if (poster) posterPath = await uploadPoster(ctx.sb, `${id}/poster-${stamp}.jpg`, poster);
  }
  if (kind === 'deck') {
    setMeter(90, 'Reading slides…');
    const parsed = await readPptx(file);
    slideCount = parsed.slideCount;
  }
  if (kind === 'pdf') {
    setMeter(90, 'Counting pages…');
    pageCount = await pdfPageCount(file);
  }
  if (kind === 'image') pageCount = 1;
  setMeter(100, 'Saved.');
  return {
    kind,
    storage_path: storagePath,
    original_path: originalPath,
    poster_path: posterPath,
    mime_type: contentType,
    file_name: file.name,
    byte_size: uploadFile.size || file.size,
    duration_seconds: duration,
    slide_count: slideCount,
    page_count: pageCount,
    external_url: null,
    external_provider: null
  };
}

async function send(file, objectName, contentType, onProgress) {
  const { data } = await ctx.sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sign in again before uploading.');
  await uploadTrainingFile({
    file,
    objectName,
    contentType,
    supabaseUrl: ctx.cfg.url,
    accessToken: token,
    apikey: ctx.cfg.publishableKey,
    onProgress
  });
  return objectName;
}

function mediaDuration(file) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    const url = URL.createObjectURL(file);
    video.onloadedmetadata = () => { const value = Number.isFinite(video.duration) ? video.duration : null; URL.revokeObjectURL(url); resolve(value); };
    video.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    video.src = url;
  });
}

async function remove(id) {
  const item = items.find((row) => row.id === id);
  if (!item || !confirm(`Delete “${item.title}”? Watch history for it goes away too.`)) return;
  const paths = [item.storage_path, item.poster_path, item.original_path].filter(Boolean);
  if (paths.length) await ctx.sb.storage.from(TRAINING_BUCKET).remove(paths);
  const { error } = await ctx.sb.from('training_items').delete().eq('id', id);
  if (error) { alert(error.message); return; }
  await refresh();
}

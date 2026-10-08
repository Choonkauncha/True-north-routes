import { STARTER_TEMPLATES, formatAddress, normalizeAddressKey } from './logic.js';
import { cleanPhotoNote } from '../lib/role-access.js';
import { managementProfile } from '../lib/account-rules.js';

const DB_NAME = 'tn-files-local';
const PENDING_ID = 'incoming';
let leadCache = null;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      ['photos', 'submissions', 'templates', 'pending'].forEach((name) => {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbAll(storeName) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  }));
}

function idbPut(storeName, value) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
  }));
}

function idbGet(storeName, id) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  }));
}

function idbDelete(storeName, id) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

export async function ensureLocalTemplates() {
  const existing = await idbAll('templates');
  if (existing.length) return existing;
  for (const template of STARTER_TEMPLATES) {
    await idbPut('templates', { ...template, fields: template.fields.map((field) => ({ ...field })) });
  }
  return idbAll('templates');
}

export async function bootFiles() {
  let cfg = { configured: false };
  try {
    const response = await fetch('/api/config');
    if (response.ok) cfg = await response.json();
  } catch { /* local static server */ }
  if (!cfg?.configured) {
    await ensureLocalTemplates();
    return { mode: 'local', cfg, sb: null, rep: null, session: null };
  }
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  const sb = createClient(cfg.url, cfg.publishableKey);
  const ctx = { mode: 'cloud', cfg, sb, rep: null, session: null };
  const { data } = await sb.auth.getSession();
  if (data.session) await attachSession(ctx, data.session);
  return ctx;
}

export async function attachSession(ctx, session) {
  ctx.session = session;
  const result = await ctx.sb.from('reps').select('*').eq('user_id', session.user.id).eq('active', true).maybeSingle();
  ctx.rep = managementProfile({
    email: session.user.email,
    rep: result.data,
    userId: session.user.id,
    name: session.user.user_metadata?.name || ''
  });
  return ctx;
}

export async function signIn(ctx, email, password) {
  const { data, error } = await ctx.sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
  await attachSession(ctx, data.session);
  if (!ctx.rep) throw new Error('This login has no active True North profile.');
  return ctx;
}

export async function signOut(ctx) {
  if (ctx?.sb) await ctx.sb.auth.signOut();
  if (ctx) { ctx.session = null; ctx.rep = null; }
}

export async function listTemplates(ctx) {
  if (ctx.mode === 'local') {
    const rows = await ensureLocalTemplates();
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }
  const { data, error } = await ctx.sb.from('form_templates').select('*').order('name');
  if (error) throw error;
  return data || [];
}

export async function saveTemplate(ctx, template) {
  const fileForm = template.kind === 'file';
  const row = {
    name: String(template.name || '').trim(),
    description: template.description || '',
    audience: template.audience || 'both',
    fields: fileForm ? [] : (template.fields || []),
    is_draft: Boolean(template.is_draft),
    draft_notice: template.draft_notice || '',
    active: template.active !== false
  };
  if (template.kind === 'file') {
    row.kind = 'file';
    row.fields = [];
    if (template.storage_path) row.storage_path = template.storage_path;
    if (template.mime_type) row.mime_type = template.mime_type;
    if (template.file_name) row.file_name = template.file_name;
  }
  if (!row.name) throw new Error('Name the form.');
  if (!fileForm && !row.fields.length) throw new Error('Add at least one field.');
  if (row.fields.some((field) => !String(field.label || '').trim())) throw new Error('Name every field.');
  if (row.fields.some((field) => field.type === 'select' && !(field.options || []).length)) throw new Error('Add choices for each select field.');
  if (ctx.mode === 'local') {
    const saved = { ...row, id: template.id || crypto.randomUUID(), updated_at: new Date().toISOString() };
    await idbPut('templates', saved);
    return saved;
  }
  if (template.id) {
    const { data, error } = await ctx.sb.from('form_templates').update(row).eq('id', template.id).select('*').single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await ctx.sb.from('form_templates').insert({ ...row, created_by: ctx.rep?.id || null }).select('*').single();
  if (error) throw error;
  return data;
}

export async function listAssignments(ctx) {
  if (ctx.mode === 'local') {
    const templates = await idbAll('templates');
    return templates.flatMap((template) => (template.assignee_ids || []).map((rep_id) => ({ template_id: template.id, rep_id })));
  }
  const { data, error } = await ctx.sb.from('form_assignments').select('template_id,rep_id');
  if (error) throw error;
  return data || [];
}

export async function replaceAssignments(ctx, templateId, repIds) {
  const ids = [...new Set((repIds || []).filter(Boolean))];
  if (ctx.mode === 'local') {
    const template = await idbGet('templates', templateId);
    if (template) await idbPut('templates', { ...template, assignee_ids: ids });
    return ids.map((rep_id) => ({ template_id: templateId, rep_id }));
  }
  const removed = await ctx.sb.from('form_assignments').delete().eq('template_id', templateId);
  if (removed.error) throw removed.error;
  if (!ids.length) return [];
  const rows = ids.map((rep_id) => ({ template_id: templateId, rep_id }));
  const inserted = await ctx.sb.from('form_assignments').insert(rows);
  if (inserted.error) throw inserted.error;
  return rows;
}

export async function uploadLibraryFile(ctx, file) {
  const name = String(file?.name || 'form').trim();
  const type = file?.type || '';
  const allowed = type === 'application/pdf' || type.startsWith('image/');
  if (!allowed) throw new Error('Upload a PDF or an image.');
  if (file.size > 12 * 1024 * 1024) throw new Error('That file is over 12 MB.');
  const id = crypto.randomUUID();
  const safe = name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80) || 'form';
  if (ctx.mode === 'local') {
    await idbPut('pending', { id, blob: file, type, name, created_at: new Date().toISOString() });
    return { id, path: `local:${id}`, mime_type: type, file_name: name, url: URL.createObjectURL(file) };
  }
  const path = `library/${id}/${safe}`;
  const upload = await ctx.sb.storage.from('form-assets').upload(path, file, { contentType: type || 'application/octet-stream', upsert: false });
  if (upload.error) throw upload.error;
  const signed = await ctx.sb.storage.from('form-assets').createSignedUrl(path, 60 * 60);
  return { id, path, mime_type: type, file_name: name, url: signed.data?.signedUrl || '' };
}

async function loadLeadCache() {
  if (leadCache) return leadCache;
  const response = await fetch('/data/leads.json');
  if (!response.ok) return [];
  leadCache = await response.json();
  return leadCache;
}

export async function searchLeads(ctx, query) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  if (ctx.mode === 'local') {
    const leads = await loadLeadCache();
    const needle = q.toLowerCase();
    return leads.filter((lead) => `${lead.name || ''} ${lead.address || ''} ${lead.city || ''}`.toLowerCase().includes(needle)).slice(0, 25);
  }
  const safe = q.replace(/[%_,]/g, ' ');
  const { data, error } = await ctx.sb.from('leads').select('id,name,address,city,state,zip,status,assigned_rep_id,created_by').or(`address.ilike.%${safe}%,name.ilike.%${safe}%,city.ilike.%${safe}%`).limit(25);
  if (error) throw error;
  return data || [];
}

export async function getLead(ctx, id) {
  if (!id) return null;
  if (ctx.mode === 'local') {
    const leads = await loadLeadCache();
    return leads.find((lead) => lead.id === id) || null;
  }
  const { data, error } = await ctx.sb.from('leads').select('id,name,address,city,state,zip,full_address,status,assigned_rep_id,created_by').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export function leadQuery(lead) {
  const params = new URLSearchParams();
  if (!lead) return params;
  if (lead.id) params.set('lead', lead.id);
  if (lead.name) params.set('name', lead.name);
  if (lead.address) params.set('address', lead.address);
  if (lead.city) params.set('city', lead.city);
  if (lead.state) params.set('state', lead.state);
  if (lead.zip) params.set('zip', lead.zip);
  return params;
}

export async function putPending(file) {
  await idbPut('pending', { id: PENDING_ID, blob: file, type: file.type, name: file.name || 'photo.jpg', created_at: new Date().toISOString() });
}

export async function takePending() {
  const row = await idbGet('pending', PENDING_ID);
  if (row) await idbDelete('pending', PENDING_ID);
  return row;
}

export async function pendingObjectUrl(id) {
  const row = await idbGet('pending', id);
  return row?.blob ? URL.createObjectURL(row.blob) : '';
}

function photoRecordUrl(row) {
  if (row.url) return row.url;
  if (row.blob) return URL.createObjectURL(row.blob);
  return '';
}

export async function listPhotos(ctx) {
  if (ctx.mode === 'local') {
    const rows = await idbAll('photos');
    return rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map((row) => ({ ...row, url: photoRecordUrl(row), uploader_name: row.uploader_name || 'This phone' }));
  }
  const withReview = 'id,lead_id,uploaded_by,storage_path,address_snapshot,caption,created_at,reviewed_at,uploader:reps!lead_photos_uploaded_by_fkey(id,name,role)';
  const withoutReview = 'id,lead_id,uploaded_by,storage_path,address_snapshot,caption,created_at,uploader:reps!lead_photos_uploaded_by_fkey(id,name,role)';
  let result = await ctx.sb.from('lead_photos').select(withReview).order('created_at', { ascending: false }).limit(500);
  if (result.error && /reviewed_at/i.test(result.error.message)) {
    result = await ctx.sb.from('lead_photos').select(withoutReview).order('created_at', { ascending: false }).limit(500);
  }
  if (result.error) throw result.error;
  const photos = result.data || [];
  await Promise.all(photos.map(async (photo) => {
    try {
      const signed = await ctx.sb.storage.from('lead-photos').createSignedUrl(photo.storage_path, 60 * 60);
      photo.url = signed.data?.signedUrl || '';
    } catch { photo.url = ''; }
    photo.uploader_name = photo.uploader?.name || '';
    if (!('reviewed_at' in photo)) photo.reviewed_at = null;
  }));
  return photos;
}

export async function listIntakes(ctx) {
  if (ctx.mode === 'local') return [];
  const columns = 'id,lead_id,first_name,last_name,address,city,state,zip,source,notes,concern,created_by,created_at,reviewed_at';
  let result = await ctx.sb.from('homeowner_intakes').select(columns).order('created_at', { ascending: false }).limit(500);
  if (result.error && /reviewed_at/i.test(result.error.message)) {
    result = await ctx.sb.from('homeowner_intakes').select(columns.replace(',reviewed_at', '')).order('created_at', { ascending: false }).limit(500);
  }
  if (result.error) throw result.error;
  return (result.data || []).map((row) => ({ ...row, reviewed_at: row.reviewed_at || null }));
}

export async function setDocumentReviewed(ctx, doc, reviewed) {
  const reviewed_at = reviewed ? new Date().toISOString() : null;
  if (ctx.mode === 'local') {
    const storeName = doc.source === 'photo' ? 'photos' : 'submissions';
    if (doc.source === 'intake') return reviewed_at;
    const row = await idbGet(storeName, doc.sourceId);
    if (row) await idbPut(storeName, { ...row, reviewed_at });
    return reviewed_at;
  }
  const table = doc.source === 'photo' ? 'lead_photos' : doc.source === 'intake' ? 'homeowner_intakes' : 'form_submissions';
  const { error } = await ctx.sb.from(table).update({ reviewed_at }).eq('id', doc.sourceId);
  if (error) throw error;
  return reviewed_at;
}

export async function savePhoto(ctx, { lead, blob, caption }) {
  const cleaned = cleanPhotoNote(caption);
  if (cleaned.error) throw new Error(cleaned.error);
  caption = cleaned.text;
  const address = formatAddress(lead);
  if (ctx.mode === 'local') {
    const row = {
      id: crypto.randomUUID(),
      lead_id: lead?.id || '',
      address_snapshot: address,
      caption: caption || '',
      created_at: new Date().toISOString(),
      uploader_name: 'This phone',
      blob
    };
    await idbPut('photos', row);
    return { ...row, url: URL.createObjectURL(blob) };
  }
  if (!ctx.rep) throw new Error('Sign in as a sales rep to add photos.');
  const path = `${lead.id}/${crypto.randomUUID()}.jpg`;
  const upload = await ctx.sb.storage.from('lead-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (upload.error) throw upload.error;
  const { data, error } = await ctx.sb.from('lead_photos').insert({
    lead_id: lead.id,
    uploaded_by: ctx.rep.id,
    storage_path: path,
    address_snapshot: address,
    caption: caption || ''
  }).select('*').single();
  if (error) throw error;
  await ctx.sb.from('lead_activity').insert({ lead_id: lead.id, actor_id: ctx.rep.id, action: 'photo_added', metadata: { caption: caption || '' } });
  const signed = await ctx.sb.storage.from('lead-photos').createSignedUrl(path, 60 * 60);
  return { ...data, url: signed.data?.signedUrl || '', uploader_name: ctx.rep.name };
}

export async function updatePhotoNote(ctx, photo, caption) {
  const cleaned = cleanPhotoNote(caption);
  if (cleaned.error) throw new Error(cleaned.error);
  if (ctx.mode === 'local') {
    const current = await idbGet('photos', photo.id);
    const row = { ...(current || photo), caption: cleaned.text };
    delete row.url;
    await idbPut('photos', row);
    return { ...photo, caption: cleaned.text };
  }
  const { data, error } = await ctx.sb.from('lead_photos').update({ caption: cleaned.text }).eq('id', photo.id).select('id,caption').single();
  if (error) throw error;
  return { ...photo, caption: data.caption || '' };
}

export async function uploadFormAsset(ctx, { leadId, blob, contentType }) {
  if (ctx.mode === 'local') {
    const id = crypto.randomUUID();
    await idbPut('pending', { id, blob, type: contentType });
    return { path: `local:${id}`, url: URL.createObjectURL(blob) };
  }
  const repId = ctx.rep?.id || 'rep';
  const ext = contentType === 'application/pdf' ? 'pdf' : contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  const path = `${leadId || 'unassigned'}/${repId}/${crypto.randomUUID()}.${ext}`;
  const upload = await ctx.sb.storage.from('form-assets').upload(path, blob, { contentType, upsert: false });
  if (upload.error) throw upload.error;
  const signed = await ctx.sb.storage.from('form-assets').createSignedUrl(path, 60 * 60);
  return { path, url: signed.data?.signedUrl || '' };
}

async function resolveAssetUrl(ctx, path) {
  if (!path) return '';
  if (String(path).startsWith('local:')) {
    const row = await idbGet('pending', String(path).slice(6));
    return row?.blob ? URL.createObjectURL(row.blob) : '';
  }
  if (ctx.mode === 'local') return '';
  const signed = await ctx.sb.storage.from('form-assets').createSignedUrl(path, 60 * 60);
  return signed.data?.signedUrl || '';
}

async function hydrateSubmission(ctx, row) {
  const answers = { ...(row.answers || {}) };
  for (const [key, value] of Object.entries(answers)) {
    if (value && typeof value === 'object' && value.path) {
      answers[key] = { ...value, url: await resolveAssetUrl(ctx, value.path) };
    }
  }
  return { ...row, answers, rep_name: row.rep_name || row.submitter?.name || (ctx.mode === 'local' ? 'This phone' : '') };
}

export async function listSubmissions(ctx) {
  if (ctx.mode === 'local') {
    const rows = await idbAll('submissions');
    const hydrated = [];
    for (const row of rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))) hydrated.push(await hydrateSubmission(ctx, row));
    return hydrated;
  }
  const { data, error } = await ctx.sb.from('form_submissions').select('*,submitter:reps!form_submissions_submitted_by_fkey(id,name,role)').order('created_at', { ascending: false }).limit(500);
  if (error) throw error;
  const rows = [];
  for (const row of data || []) rows.push(await hydrateSubmission(ctx, { ...row, rep_name: row.submitter?.name || '' }));
  return rows;
}

export async function getSubmission(ctx, id) {
  if (ctx.mode === 'local') {
    const row = await idbGet('submissions', id);
    return row ? hydrateSubmission(ctx, row) : null;
  }
  const { data, error } = await ctx.sb.from('form_submissions').select('*,submitter:reps!form_submissions_submitted_by_fkey(id,name,role)').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? hydrateSubmission(ctx, { ...data, rep_name: data.submitter?.name || '' }) : null;
}

export async function saveSubmission(ctx, payload) {
  const row = {
    template_id: payload.template_id,
    template_name: payload.template_name,
    lead_id: payload.lead_id || null,
    address_snapshot: payload.address_snapshot || '',
    homeowner_name: payload.homeowner_name || '',
    fields: payload.fields || [],
    answers: payload.answers || {},
    is_draft: Boolean(payload.is_draft),
    draft_notice: payload.draft_notice || ''
  };
  if (payload.attachment_path) {
    row.attachment_path = payload.attachment_path;
    row.attachment_name = payload.attachment_name || '';
  }
  if (ctx.mode === 'local') {
    const saved = { ...row, id: crypto.randomUUID(), submitted_by: null, rep_name: 'This phone', created_at: new Date().toISOString() };
    await idbPut('submissions', saved);
    return hydrateSubmission(ctx, saved);
  }
  const { data, error } = await ctx.sb.from('form_submissions').insert({ ...row, submitted_by: ctx.rep.id }).select('*').single();
  if (error) throw error;
  if (row.lead_id) {
    await ctx.sb.from('lead_activity').insert({ lead_id: row.lead_id, actor_id: ctx.rep.id, action: 'form_submitted', metadata: { template_name: row.template_name, submission_id: data.id } });
  }
  return hydrateSubmission(ctx, { ...data, rep_name: ctx.rep.name });
}

export async function listReps(ctx) {
  if (ctx.mode === 'local') return [];
  const { data, error } = await ctx.sb.from('reps').select('id,name,role,active').eq('active', true).order('name');
  if (error) throw error;
  return data || [];
}

export function photosForLead(photos, lead) {
  const id = lead?.id || '';
  const key = normalizeAddressKey(formatAddress(lead) || lead?.address || '');
  return (photos || []).filter((photo) => (id && photo.lead_id === id) || (key && normalizeAddressKey(photo.address_snapshot).includes(key)));
}

export function groupPhotosByAddress(photos) {
  const groups = new Map();
  for (const photo of photos || []) {
    const key = normalizeAddressKey(photo.address_snapshot) || photo.lead_id || 'House';
    if (!groups.has(key)) groups.set(key, { address: photo.address_snapshot || 'House', lead_id: photo.lead_id, photos: [] });
    groups.get(key).photos.push(photo);
  }
  return [...groups.values()];
}

export function plainError(error) {
  const message = String(error?.message || error || 'Something went wrong.');
  if (/reviewed_at/i.test(message)) {
    return 'Run supabase/migrations/20261008_document_review.sql in the Supabase SQL editor, then try again.';
  }
  if (/form_assignments|storage_path|attachment_path|schema cache|column .* does not exist/i.test(message)) {
    return 'Run supabase/migrations/20261008_role_form_library.sql in the Supabase SQL editor, then try again.';
  }
  if (/row-level security|violates|42501|not authorized|permission/i.test(message)) {
    return 'This house is not assigned to you yet. Assign it on the house sheet, then try again.';
  }
  return message;
}

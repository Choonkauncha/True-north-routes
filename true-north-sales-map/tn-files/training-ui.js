import {
  escapeHtml,
  formatClock,
  formatWhen,
  mediaMeta,
  statusLabel,
  typeBadge,
  watchCounts
} from '../lib/training-progress.js';
import { atlasIcon } from '../brand/atlas-icons.js';

export function statusPill(row) {
  const status = statusLabel(row);
  return `<span class="tnTrainPill is-${status.key}">${escapeHtml(status.label)}</span>`;
}

export function thumbHtml(item) {
  if (item.posterUrl) return `<span class="tnTrainThumb" aria-hidden="true"><img src="${escapeHtml(item.posterUrl)}" alt="" loading="lazy" decoding="async"></span>`;
  const icon = item.kind === 'video' || item.kind === 'external'
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m10 8 6 4-6 4z"/></svg>'
    : atlasIcon({ deck: 'overview', pdf: 'forms', image: 'photos' }[item.kind] || 'files');
  return `<span class="tnTrainThumb" aria-hidden="true">${icon}</span>`;
}

export function cardHtml(item, { progress, reminded, interactive = true } = {}) {
  const required = item.required || reminded;
  const meta = mediaMeta(item);
  const badge = typeBadge(item);
  const status = statusLabel(progress);
  // Keep the meter consistent with confirmed completion and the existing status rules.
  const percent = status.key === 'completed' ? 100 : Math.min(89, Math.max(0, Math.round(Number(progress?.percent) || 0)));
  const detail = meta && meta.toLowerCase() !== badge.toLowerCase() ? `<span class="quiet">${escapeHtml(meta)}</span>` : '';
  const action = { new: 'Start lesson', progress: 'Continue lesson', completed: 'Review lesson' }[status.key];
  const meter = `<span class="tnLessonProgress"><span class="tnLessonProgressTrack" aria-hidden="true"><i style="width:${percent}%"></i></span><span>${percent}%</span></span>`;
  const cardStatus = status.key === 'progress' ? '<span class="tnTrainPill is-progress">In progress</span>' : statusPill(progress);
  const body = `<span class="tnTrainBody"><span class="tnTrainTitle">${escapeHtml(item.title)}</span>${item.description ? `<span class="tnTrainDesc">${escapeHtml(item.description)}</span>` : ''}<span class="tnTrainMeta"><span class="tnTrainBadge">${escapeHtml(badge)}</span>${detail}${cardStatus}${required ? '<span class="tnTrainPill is-required">Required</span>' : ''}</span>${meter}${interactive ? `<span class="tnTrainContinue">${action} &rarr;</span>` : ''}</span>`;
  const thumb = thumbHtml(item);
  if (!interactive) return `<article class="tnTrainCard">${thumb}${body}</article>`;
  return `<button type="button" class="tnTrainCard" data-item="${escapeHtml(item.id)}">${thumb}${body}</button>`;
}

export function listHtml({ who, items, filter = 'all', compact = false }) {
  const filters = ['all', 'required', 'video', 'deck', 'pdf'].map((key) => {
    const label = { all: 'All', required: 'Required', video: 'Videos', deck: 'Slides', pdf: 'PDFs' }[key];
    return `<button type="button" data-filter="${key}" aria-pressed="${filter === key ? 'true' : 'false'}">${label}</button>`;
  }).join('');
  const cards = items.length
    ? items.map((item) => cardHtml(item, { progress: item.progress, reminded: item.reminded })).join('')
    : `<div class="tnTrainEmpty"><strong>${filter === 'required' ? 'No required lessons right now.' : filter === 'all' ? 'Your lessons will appear here.' : 'No lessons match this filter.'}</strong><p>${filter === 'all' ? 'Your team can assign lessons here. In the meantime, practice a real conversation with your coach.' : 'View all lessons to choose your next practice.'}</p>${filter === 'all' ? '' : '<button type="button" class="tnTrainBtn" data-filter="all">View all lessons</button>'}</div>`;
  const heading = compact ? '<h2>Your lessons</h2>' : '<h1>Training &amp; Practice</h1>';
  return `<div class="tnTrain" data-tn-panel="training-list" data-tn-rank="primary"><div class="tnTrainHead"><div>${heading}${who ? `<p class="tnTrainLead">${escapeHtml(who)}</p>` : ''}</div></div><div class="tnTrainFilters" role="group" aria-label="Filter training">${filters}</div><div class="tnTrainList">${cards}</div></div>`;
}

export function playerHtml(item, progress) {
  const required = item.required || item.reminded;
  return `<div class="tnTrain"><button type="button" class="tnTrainBtn tnTrainBack" id="tnTrainBack">Back to training</button><div class="tnTrainHead"><div><p class="tnTrainLead">${escapeHtml(typeBadge(item))}${required ? ' · Required' : ''}</p><h1>${escapeHtml(item.title)}</h1>${item.description ? `<p class="tnTrainLead">${escapeHtml(item.description)}</p>` : ''}</div>${statusPill(progress)}</div><div id="tnTrainStage"></div><p id="tnTrainPageLabel" class="tnTrainLead"></p><div class="tnTrainControls" id="tnTrainControls"></div><div class="tnTrainMeter" id="tnTrainWatch" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Watched"><span></span></div><p id="tnTrainMsg" class="tnTrainError" role="status"></p></div>`;
}

export function videoStageHtml({ src, poster }) {
  const posterAttr = poster ? ` poster="${escapeHtml(poster)}"` : '';
  return `<div class="tnTrainStage"><video id="tnTrainVideo" controls playsinline preload="metadata" src="${escapeHtml(src)}"${posterAttr}><a href="${escapeHtml(src)}">Download the video</a></video></div>`;
}

export function embedStageHtml({ src, title }) {
  return `<div class="tnTrainStage"><iframe id="tnTrainFrame" title="${escapeHtml(title || 'Training video')}" src="${escapeHtml(src)}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>`;
}

export function slideStageHtml(slide, index, total) {
  const texts = slide?.texts || [];
  const title = slide?.title || texts[0] || `Slide ${index + 1}`;
  const lines = slide?.lines || texts.slice(slide?.title ? 0 : 1);
  const images = (slide?.images || []).map((src) => `<img src="${escapeHtml(src)}" alt="">`).join('');
  const list = lines.length ? `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>` : '';
  return `<article class="tnTrainSlide" aria-label="Slide ${index + 1} of ${total}"><div class="slideBar">Slide ${index + 1} of ${total}</div><div class="slideBody">${images}<h2>${escapeHtml(title)}</h2>${list}</div></article>`;
}

export function imageStageHtml(src, alt) {
  return `<div class="tnTrainSlide"><div class="slideBody"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt || 'Training image')}"></div></div>`;
}

export function pdfShellHtml() {
  return '<div class="tnTrainPdf" id="tnTrainPdf"><canvas class="tnTrainCanvas" id="tnTrainCanvas"></canvas></div>';
}

export function officeFallbackHtml(src) {
  return `<div class="tnTrainStage"><iframe title="PowerPoint" src="https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(src)}"></iframe></div><p class="tnTrainLead">If the slides stay blank, use Download. Microsoft has to fetch the file, and that viewer is cramped on a phone.</p>`;
}

export function controlButtons({ showNav, showComplete, download }) {
  const nav = showNav ? '<button type="button" id="tnTrainPrev">Previous</button><button type="button" id="tnTrainNext">Next</button>' : '';
  const complete = showComplete ? '<button type="button" class="primary" id="tnTrainDone">Mark as complete</button>' : '';
  const file = download ? `<a class="tnTrainBtn" href="${escapeHtml(download)}" download>Download</a>` : '';
  return `${nav}${complete}${file}`;
}

export function accountHtml(items) {
  if (!items.length) return '<section class="tnCard"><b>Training</b><span>Nothing assigned yet.</span></section>';
  const done = items.filter((item) => item.progress?.completed_at).length;
  const rows = items.map((item) => cardHtml(item, { progress: item.progress, reminded: item.reminded, interactive: false })).join('');
  return `<section class="tnTrain" id="tnAccountTrainingList" data-tn-panel="account-training" data-tn-rank="secondary"><div class="tnTrainHead"><div><h2>Training status</h2><p class="tnTrainLead">${done} of ${items.length} completed</p></div><a class="tnTrainBtn primary" href="/training.html">Open training</a></div><div class="tnTrainList">${rows}</div></section>`;
}

export function adminShellHtml() {
  return `<div class="tnTrain" data-tn-panel="training-admin" data-tn-rank="primary"><div class="tnTrainHead"><div><p class="tnTrainLead">Management</p><h1>Training</h1><p class="tnTrainLead">Upload a video, deck, PDF, or image, or paste a YouTube, Vimeo, or Loom link. Free plan files must be 50 MB or smaller.</p></div><button type="button" class="tnTrainBtn primary" id="tnTrainAdd">Add training</button></div><div class="tnTrainFilters" role="group" aria-label="Training admin"><button type="button" data-admin-view="library" aria-pressed="true">Library</button><button type="button" data-admin-view="status" aria-pressed="false">Watch status</button></div><div id="tnTrainAdminBody"></div></div>`;
}

export function adminFormHtml({ draft, people, categories }) {
  const audience = draft.audience || 'both';
  const options = ['setters', 'reps', 'both', 'specific'].map((value) => {
    const label = { setters: 'Appointment setters', reps: 'Sales reps', both: 'Setters and reps', specific: 'Specific people' }[value];
    return `<option value="${value}" ${audience === value ? 'selected' : ''}>${label}</option>`;
  }).join('');
  const checks = people.map((person) => `<label class="tnTrainCheck"><input type="checkbox" name="person" value="${escapeHtml(person.id)}" ${(draft.assigneeIds || []).includes(person.id) ? 'checked' : ''}>${escapeHtml(person.name)}</label>`).join('');
  const list = categories.map((category) => `<option value="${escapeHtml(category)}"></option>`).join('');
  return `<form class="tnTrainForm" id="tnTrainForm" data-tn-panel="training-editor" data-tn-rank="primary"><h2>${draft.id ? 'Edit training' : 'New training'}</h2><label for="tnTitle">Title</label><input id="tnTitle" name="title" required maxlength="160" value="${escapeHtml(draft.title || '')}"><label for="tnDesc">Description</label><textarea id="tnDesc" name="description" maxlength="2000">${escapeHtml(draft.description || '')}</textarea><label for="tnCategory">Category</label><input id="tnCategory" name="category" list="tnCategories" maxlength="80" value="${escapeHtml(draft.category || '')}"><datalist id="tnCategories">${list}</datalist><label for="tnOrder">Order</label><input id="tnOrder" name="sortOrder" type="number" min="0" step="1" value="${escapeHtml(draft.sortOrder ?? 0)}"><label for="tnAudience">Who sees it</label><select id="tnAudience" name="audience">${options}</select><div id="tnPeople" class="tnTrainPeople" ${audience === 'specific' ? '' : 'hidden'}>${checks || '<p>No setters or reps yet.</p>'}</div><label class="tnTrainCheck"><input id="tnRequired" name="required" type="checkbox" ${draft.required ? 'checked' : ''}>Required</label><label for="tnLink">YouTube, Vimeo, or Loom link</label><input id="tnLink" name="externalUrl" type="url" inputmode="url" placeholder="https://" value="${escapeHtml(draft.externalUrl || '')}"><label for="tnFile">${draft.id ? 'Replace the file' : 'File'}</label><input id="tnFile" name="file" type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm,.pptx,.pdf,image/*"><label class="tnTrainCheck" id="tnKeepWrap" hidden><input id="tnKeepOriginal" type="checkbox" checked>Keep the original file too</label><div class="tnTrainMeter" id="tnUploadMeter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Upload progress" hidden><span></span></div><p id="tnUploadStatus" role="status"></p><div class="tnTrainControls"><button type="submit" class="primary">${draft.id ? 'Save' : 'Upload'}</button><button type="button" id="tnTrainCancel">Cancel</button></div></form>`;
}

export function libraryHtml(items) {
  if (!items.length) return '<div class="tnTrainEmpty">No training uploaded yet.</div>';
  return `<div class="tnTrainList">${items.map((item) => {
    const counts = watchCounts(item.progressRows || []);
    return `<article class="tnTrainPerson" data-tn-panel="train-item-${escapeHtml(item.id)}" data-tn-rank="secondary"><b>${escapeHtml(item.title)}</b><small>${escapeHtml(typeBadge(item))} · ${escapeHtml(item.audience)} · ${item.required ? 'Required' : 'Optional'}${item.active === false ? ' · Archived' : ''}${item.category ? ` · ${escapeHtml(item.category)}` : ''}</small><small>${counts.watched} watched · ${counts.completed} completed</small><div class="tnTrainControls"><button type="button" data-status="${escapeHtml(item.id)}">Watch status</button><button type="button" data-edit="${escapeHtml(item.id)}">Edit</button><button type="button" data-delete="${escapeHtml(item.id)}" ${item.active === false ? 'disabled' : ''}>Archive</button></div></article>`;
  }).join('')}</div>`;
}

export function matrixHtml({ item, people, progressByRep, reminders, personId, requiredOnly }) {
  const rows = people.filter((person) => !personId || person.id === personId).map((person) => {
    const progress = progressByRep.get(person.id) || null;
    const reminded = (reminders || []).some((row) => row.rep_id === person.id);
    if (requiredOnly && !item.required && !reminded) return '';
    const status = statusLabel(progress);
    const when = progress?.completed_at ? formatWhen(progress.completed_at) : '';
    const watched = formatClock(progress?.max_watched_seconds || 0);
    const remind = item.required
      ? '<button type="button" disabled>Required for everyone</button>'
      : `<button type="button" data-remind="${escapeHtml(person.id)}" ${reminded ? 'disabled' : ''}>${reminded ? 'Highlighted' : 'Remind'}</button>`;
    return `<article class="tnTrainPerson" data-tn-panel="train-person-${escapeHtml(person.id)}" data-tn-rank="secondary"><b>${escapeHtml(person.name)}</b><small>${escapeHtml(person.roleLabel || person.role)}</small><span class="tnTrainMeta">${statusPill(progress)}${item.required || reminded ? '<span class="tnTrainPill is-required">Required</span>' : ''}</span><small>${status.key === 'new' ? 'Not started' : `Time watched ${watched}`}${when ? ` · Completed ${escapeHtml(when)}` : ''}</small><div class="tnTrainControls">${remind}</div></article>`;
  }).join('');
  const personOptions = ['<option value="">Everyone</option>'].concat(people.map((person) => `<option value="${escapeHtml(person.id)}" ${person.id === personId ? 'selected' : ''}>${escapeHtml(person.name)}</option>`)).join('');
  return `<div class="tnTrain" data-tn-panel="training-status" data-tn-rank="primary"><h2>${escapeHtml(item.title)}</h2><p class="tnTrainLead">${watchCounts([...progressByRep.values()]).watched} watched · ${watchCounts([...progressByRep.values()]).completed} completed</p><label for="tnPersonFilter">Person</label><select id="tnPersonFilter">${personOptions}</select><label class="tnTrainCheck"><input id="tnRequiredOnly" type="checkbox" ${requiredOnly ? 'checked' : ''}>Required only</label><div class="tnTrainList" style="margin-top:12px">${rows || '<div class="tnTrainEmpty">No one matches.</div>'}</div></div>`;
}

export function profileHtml({ person, items }) {
  const rows = items.map((item) => {
    const when = item.progress?.completed_at ? formatWhen(item.progress.completed_at) : '';
    return `<article class="tnTrainPerson" data-tn-panel="train-profile-${escapeHtml(item.id || item.title)}" data-tn-rank="secondary"><b>${escapeHtml(item.title)}</b><span class="tnTrainMeta">${statusPill(item.progress)}${item.required || item.reminded ? '<span class="tnTrainPill is-required">Required</span>' : ''}</span><small>${item.progress?.completed_at ? `Completed ${escapeHtml(when)} · ` : ''}Time watched ${formatClock(item.progress?.max_watched_seconds || 0)}</small></article>`;
  }).join('');
  return `<div class="tnTrain" data-tn-panel="training-profile" data-tn-rank="primary"><h2>${escapeHtml(person.name)} — training status</h2><div class="tnTrainList">${rows || '<div class="tnTrainEmpty">Nothing assigned.</div>'}</div></div>`;
}

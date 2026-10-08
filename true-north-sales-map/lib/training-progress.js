/**
 * Training progress, completion, and upload limits.
 * Video completion counts played time only. A seek to the end does not count.
 * Decks and PDFs complete when every page has been opened, or when the
 * viewer marks complete after opening the item.
 */

export const PLAN_NAME = 'Free';
export const PLAN_FILE_LIMIT_BYTES = 50 * 1024 * 1024;
export const TRAINING_BUCKET = 'training';
export const TRAINING_BUCKET_FILE_LIMIT_BYTES = 50 * 1024 * 1024;
export const COMPLETE_RATIO = 0.9;
export const SEEK_GAP_SECONDS = 2;
export const SAVE_EVERY_MS = 10000;

const SETTER_ROLES = ['appointment_setter', 'canvasser'];
const FIELD_ROLES = [...SETTER_ROLES, 'salesperson'];

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

export function formatMegabytes(bytes) {
  const n = Number(bytes) || 0;
  const mb = n / (1024 * 1024);
  if (mb >= 10) return `${Math.round(mb)} MB`;
  return `${mb.toFixed(1)} MB`;
}

export function formatClock(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remain = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(remain).padStart(2, '0')}`;
  return `${minutes}:${String(remain).padStart(2, '0')}`;
}

export function formatWhen(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/** Empty string when the file fits. Otherwise a message that names both caps. */
export function uploadSizeError(bytes, {
  bucketLimit = TRAINING_BUCKET_FILE_LIMIT_BYTES,
  planLimit = PLAN_FILE_LIMIT_BYTES,
  planName = PLAN_NAME
} = {}) {
  const size = Number(bytes) || 0;
  const cap = Math.min(bucketLimit, planLimit);
  if (size > 0 && size <= cap) return '';
  return `This file is ${formatMegabytes(size)}. The training bucket allows ${formatMegabytes(bucketLimit)} per file, and the ${planName} plan’s global limit is ${formatMegabytes(planLimit)}. Shorten the file or raise the plan limit before uploading.`;
}

export function storageLimitMessage(error, bytes) {
  const text = String(error?.message || error || '');
  if (!/maximum allowed size|entity too large|payload too large|413/i.test(text)) return '';
  const size = Number(bytes) > 0 ? ` (${formatMegabytes(bytes)})` : '';
  return `Upload stopped${size}. Supabase rejected the file for size. This project is on the ${PLAN_NAME} plan, whose global limit cannot exceed ${formatMegabytes(PLAN_FILE_LIMIT_BYTES)}, and the training bucket is capped at ${formatMegabytes(TRAINING_BUCKET_FILE_LIMIT_BYTES)}. A lower global limit in Storage settings rejects the file even sooner. Shorten it and try again.`;
}

export function extensionOf(name) {
  const base = String(name || '').split(/[/\\]/).pop() || '';
  const dot = base.lastIndexOf('.');
  if (dot < 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

export function classifyFile(name, type = '') {
  const ext = extensionOf(name);
  const mime = String(type || '').toLowerCase();
  if (['mp4', 'm4v', 'webm', 'mov'].includes(ext) || mime.startsWith('video/')) return 'video';
  if (ext === 'pptx' || mime.includes('presentationml')) return 'deck';
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif'].includes(ext) || mime.startsWith('image/')) return 'image';
  return '';
}

export function contentTypeFor(name, kind = classifyFile(name)) {
  const ext = extensionOf(name);
  if (kind === 'video') {
    if (ext === 'webm') return 'video/webm';
    if (ext === 'mov') return 'video/quicktime';
    return 'video/mp4';
  }
  if (kind === 'deck') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (kind === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

/**
 * playable means the browser decoded a frame (videoWidth) and claims it can
 * play the type. .mov that passes is uploaded as video/mp4. Anything else
 * is converted to H.264 MP4 before upload.
 */
export function playbackDecision({ extension = '', canPlayType = '', videoWidth = 0, played = false } = {}) {
  const ext = String(extension || '').toLowerCase();
  const playable = played === true && Number(videoWidth) > 0 && String(canPlayType || '') !== '';
  if (playable && ext === 'mov') return { action: 'play-as-mp4', contentType: 'video/mp4' };
  if (playable) return { action: 'keep', contentType: contentTypeFor(`file.${ext || 'mp4'}`, 'video') };
  return { action: 'transcode', contentType: 'video/mp4' };
}

export function tusEndpoint(supabaseUrl) {
  const host = new URL(supabaseUrl).hostname;
  const ref = host.split('.')[0];
  if (!ref || ref === 'localhost') throw new Error('Supabase URL is missing a project id.');
  return `https://${ref}.storage.supabase.co/storage/v1/upload/resumable`;
}

export function mergeRanges(ranges) {
  const sorted = (ranges || [])
    .map((pair) => [Number(pair[0]) || 0, Number(pair[1]) || 0])
    .map(([start, end]) => [Math.max(0, Math.min(start, end)), Math.max(start, end)])
    .filter(([start, end]) => end - start > 0.05)
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  sorted.forEach(([start, end]) => {
    const last = merged[merged.length - 1];
    if (!last || start > last[1] + 0.25) merged.push([start, end]);
    else last[1] = Math.max(last[1], end);
  });
  return merged;
}

export function sumRanges(ranges) {
  return mergeRanges(ranges).reduce((total, [start, end]) => total + (end - start), 0);
}

export function compactRanges(ranges) {
  return mergeRanges(ranges).map(([start, end]) => [round(start, 2), round(end, 2)]);
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

/**
 * Add played time only when playback moved forward by a small step.
 * A seek (gap larger than SEEK_GAP_SECONDS, or a jump backward) moves the
 * cursor and leaves the watched ranges unchanged.
 */
export function notePlayback(session, currentTime, { playing = true } = {}) {
  const ranges = session?.ranges || [];
  const time = Math.max(0, Number(currentTime) || 0);
  const last = session?.lastTime;
  if (!playing || !session?.playing || last == null) {
    return { ...session, ranges, lastTime: time, playing: Boolean(playing) };
  }
  const delta = time - last;
  if (delta > 0 && delta <= SEEK_GAP_SECONDS) {
    return { ...session, ranges: mergeRanges([...ranges, [last, time]]), lastTime: time, playing: true };
  }
  return { ...session, ranges, lastTime: time, playing: true };
}

export function onPlay(session, currentTime) {
  return { ...session, ranges: session?.ranges || [], lastTime: Math.max(0, Number(currentTime) || 0), playing: true };
}

export function onTime(session, currentTime) {
  return notePlayback(session, currentTime, { playing: true });
}

export function onPause(session, currentTime) {
  if (!session?.playing) return { ...session, lastTime: Math.max(0, Number(currentTime) || 0), playing: false };
  const next = notePlayback(session, currentTime, { playing: true });
  return { ...next, playing: false };
}

export function onSeek(session, currentTime) {
  return { ...session, ranges: session?.ranges || [], lastTime: Math.max(0, Number(currentTime) || 0) };
}

export function uniquePages(pages, total) {
  const limit = Math.max(0, Number(total) || 0);
  return [...new Set((pages || []).map((page) => Number(page)).filter((page) => page >= 1 && (!limit || page <= limit)))].sort((a, b) => a - b);
}

export function notePage(session, page, total) {
  return { ...session, pages: uniquePages([...(session?.pages || []), page], total) };
}

export function pageTotal(item) {
  if (!item) return 0;
  if (item.kind === 'deck') return Number(item.slide_count) || 0;
  if (item.kind === 'pdf') return Number(item.page_count) || 0;
  if (item.kind === 'image') return 1;
  return 0;
}

export function summarizeProgress({
  ranges = [],
  duration = 0,
  lastPosition = 0,
  pagesViewed = [],
  totalPages = 0,
  markComplete = false,
  opened = false,
  kind = 'video',
  openSeconds = 0
} = {}) {
  if (kind === 'video' || (kind === 'external' && Number(duration) > 0)) {
    const watched = sumRanges(ranges);
    const length = Number(duration) || 0;
    const ratio = length > 0 ? watched / length : 0;
    const percent = length > 0 ? Math.min(100, ratio * 100) : 0;
    return {
      maxWatchedSeconds: round(Math.min(watched, length || watched), 2),
      percent: round(percent, 1),
      completed: length > 0 && ratio >= COMPLETE_RATIO,
      lastPosition: round(Math.max(0, Number(lastPosition) || 0), 2),
      pages: []
    };
  }
  if (kind === 'external') {
    const openedEnough = opened || openSeconds > 0;
    if (markComplete && !openedEnough) {
      return { error: 'Open it before marking it complete.', completed: false, percent: 0, maxWatchedSeconds: round(openSeconds, 2), pages: [] };
    }
    return {
      error: '',
      completed: Boolean(markComplete && openedEnough),
      percent: markComplete && openedEnough ? 100 : 0,
      maxWatchedSeconds: round(openSeconds, 2),
      lastPosition: round(openSeconds, 2),
      pages: []
    };
  }
  const total = Math.max(0, Number(totalPages) || 0);
  const pages = uniquePages(pagesViewed, total);
  const percent = total > 0 ? (pages.length / total) * 100 : 0;
  const sawSomething = opened || pages.length > 0;
  if (markComplete && !sawSomething) {
    return { error: 'Open it before marking it complete.', completed: false, percent: round(percent, 1), pages, maxWatchedSeconds: 0 };
  }
  const completed = (total > 0 && pages.length >= total) || Boolean(markComplete && sawSomething);
  return {
    error: '',
    pages,
    percent: round(completed && markComplete ? Math.max(percent, percent) : percent, 1),
    completed,
    maxWatchedSeconds: 0,
    lastPosition: 0
  };
}

export function statusLabel(row) {
  if (row?.completed_at || row?.completed === true) return { key: 'completed', label: 'Completed' };
  const percent = Number(row?.percent) || 0;
  const started = Boolean(row?.started_at) || Number(row?.view_count) > 0 || percent > 0 || (row?.pages_viewed || []).length > 0;
  if (!started) return { key: 'new', label: 'New' };
  const shown = Math.round(percent);
  const capped = shown >= 90 ? 89 : Math.max(0, shown);
  return { key: 'progress', label: `In progress ${capped}%` };
}

export function beginView(progress, nowIso) {
  const previous = progress || {};
  return {
    ...previous,
    started_at: previous.started_at || nowIso,
    view_count: (Number(previous.view_count) || 0) + 1
  };
}

export function isSetterRole(role) {
  return SETTER_ROLES.includes(role);
}

export function isFieldTrainingRole(role) {
  return FIELD_ROLES.includes(role) || role === 'admin' || role === 'manager';
}

export function canViewItem(item, role, repId) {
  if (!item || item.active === false) return role === 'admin' || role === 'manager';
  if (role === 'admin' || role === 'manager') return true;
  const assigned = (item.assigneeIds || []).includes(repId);
  if (assigned) return true;
  if (item.audience === 'specific') return false;
  if (isSetterRole(role)) return item.audience === 'setters' || item.audience === 'both';
  if (role === 'salesperson') return item.audience === 'reps' || item.audience === 'both';
  return false;
}

export function isHighlighted(item, reminders, repId) {
  if (!item) return false;
  if (item.required) return true;
  return (reminders || []).some((row) => row.item_id === item.id && row.rep_id === repId);
}

export function typeBadge(item) {
  if (item?.kind === 'external') return providerLabel(item.external_provider);
  return { video: 'Video', deck: 'Slides', pdf: 'PDF', image: 'Image' }[item?.kind] || 'File';
}

export function providerLabel(provider) {
  return { youtube: 'YouTube', vimeo: 'Vimeo', loom: 'Loom' }[provider] || 'Video';
}

export function mediaMeta(item) {
  if (!item) return '';
  if (item.kind === 'video' || (item.kind === 'external' && Number(item.duration_seconds) > 0)) return formatClock(item.duration_seconds);
  if (item.kind === 'deck') return Number(item.slide_count) > 0 ? `${item.slide_count} slides` : 'Slides';
  if (item.kind === 'pdf') return Number(item.page_count) > 0 ? `${item.page_count} pages` : 'PDF';
  if (item.kind === 'image') return 'Image';
  if (item.kind === 'external') return providerLabel(item.external_provider);
  return '';
}

export function watchCounts(rows) {
  const list = rows || [];
  const watched = list.filter((row) => Number(row.view_count) > 0 || row.started_at || Number(row.percent) > 0).length;
  const completed = list.filter((row) => row.completed_at).length;
  return { watched, completed };
}

export function parseExternalVideo(value) {
  let url;
  try { url = new URL(String(value || '').trim()); }
  catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0] || '';
    return youtube(id);
  }
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') return youtube(url.searchParams.get('v') || '');
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live') return youtube(parts[1] || '');
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = (url.pathname.split('/').filter(Boolean).pop() || '').replace(/\D/g, '');
    if (/^\d{6,12}$/.test(id)) {
      return { provider: 'vimeo', id, embedUrl: `https://player.vimeo.com/video/${id}` };
    }
  }
  if (host === 'loom.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    const id = parts[0] === 'share' || parts[0] === 'embed' ? parts[1] : '';
    if (/^[a-f0-9]{32}$/i.test(id || '')) {
      return { provider: 'loom', id, embedUrl: `https://www.loom.com/embed/${id}` };
    }
  }
  return null;
}

function youtube(id) {
  if (!/^[\w-]{6,20}$/.test(id || '')) return null;
  return { provider: 'youtube', id, embedUrl: `https://www.youtube-nocookie.com/embed/${id}` };
}

export function textFromSlideXml(xml) {
  const texts = [];
  const pattern = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
  let match = pattern.exec(String(xml || ''));
  while (match) {
    const text = decodeXml(match[1]).replace(/\s+/g, ' ').trim();
    if (text) texts.push(text);
    match = pattern.exec(String(xml || ''));
  }
  return texts;
}

export function slideModel(xml, relsXml = '') {
  const texts = textFromSlideXml(xml);
  const embeds = [...String(xml || '').matchAll(/r:embed="([^"]+)"/g)].map((match) => match[1]);
  const targets = [];
  embeds.forEach((id) => {
    const rel = new RegExp(`Id="${id}"[^>]*Target="([^"]+)"`, 'i').exec(String(relsXml || ''))
      || new RegExp(`Target="([^"]+)"[^>]*Id="${id}"`, 'i').exec(String(relsXml || ''));
    if (!rel) return;
    const target = rel[1];
    if (/\.(png|jpe?g|gif|webp)$/i.test(target)) targets.push(target);
  });
  return { texts, imageTargets: targets };
}

export function slideCountFromNames(names) {
  return (names || []).filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name)).length;
}

export function resolveZipPath(base, target) {
  const parts = String(base || '').split('/').filter(Boolean);
  String(target || '').split('/').forEach((part) => {
    if (!part || part === '.') return;
    if (part === '..') parts.pop();
    else parts.push(part);
  });
  return parts.join('/');
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');
}

export function cleanTrainingDraft(draft, { editing = false } = {}) {
  const title = String(draft.title || '').trim().replace(/\s+/g, ' ');
  if (title.length < 2 || title.length > 160) return { error: 'Add a title (2–160 characters).' };
  const description = String(draft.description || '').trim();
  if (description.length > 2000) return { error: 'Keep the description under 2,000 characters.' };
  const category = String(draft.category || '').trim().replace(/\s+/g, ' ');
  if (category.length > 80) return { error: 'Keep the category under 80 characters.' };
  const sort = Number(draft.sortOrder);
  const sortOrder = Number.isFinite(sort) ? Math.max(0, Math.round(sort)) : 0;
  const audience = ['setters', 'reps', 'both', 'specific'].includes(draft.audience) ? draft.audience : '';
  if (!audience) return { error: 'Choose who should see this.' };
  const assigneeIds = [...new Set((draft.assigneeIds || []).filter(Boolean))];
  if (audience === 'specific' && !assigneeIds.length) return { error: 'Pick at least one person.' };
  const link = String(draft.externalUrl || '').trim();
  const external = link ? parseExternalVideo(link) : null;
  if (link && !external) return { error: 'Paste a YouTube, Vimeo, or Loom link.' };
  if (!editing && !draft.file && !external) return { error: 'Choose a file or paste a video link.' };
  if (draft.file) {
    const kind = classifyFile(draft.file.name, draft.file.type);
    if (!kind) return { error: 'Use an mp4, mov, m4v, webm, pptx, pdf, or image file.' };
    const sizeError = uploadSizeError(draft.file.size);
    if (sizeError) return { error: sizeError };
  }
  return {
    title,
    description,
    category,
    sortOrder,
    audience,
    assigneeIds: audience === 'specific' ? assigneeIds : [],
    required: Boolean(draft.required),
    external
  };
}

export function progressPayload({ repId, item, session, saved, markComplete = false, now = new Date().toISOString() }) {
  const duration = Number(session?.duration) > 0 ? Number(session.duration) : Number(item?.duration_seconds) || 0;
  const summary = summarizeProgress({
    ranges: session?.ranges || saved?.watched_ranges || [],
    duration,
    lastPosition: session?.lastTime ?? saved?.last_position_seconds ?? 0,
    pagesViewed: session?.pages || saved?.pages_viewed || [],
    totalPages: pageTotal(item),
    markComplete,
    opened: true,
    kind: item?.kind === 'image' ? 'pdf' : item?.kind,
    openSeconds: session?.openSeconds || 0
  });
  if (summary.error) return { error: summary.error };
  const already = saved?.completed_at || null;
  return {
    row: {
      rep_id: repId,
      item_id: item.id,
      started_at: saved?.started_at || session?.started_at || now,
      last_position_seconds: summary.lastPosition || 0,
      max_watched_seconds: summary.maxWatchedSeconds || 0,
      percent: summary.percent || 0,
      completed_at: (already || summary.completed) ? (already || now) : null,
      view_count: Number(saved?.view_count) || Number(session?.view_count) || 1,
      pages_viewed: summary.pages || [],
      watched_ranges: compactRanges(session?.ranges || saved?.watched_ranges || []),
      updated_at: now
    }
  };
}

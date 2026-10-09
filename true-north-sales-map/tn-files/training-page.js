import { bootFiles, signIn } from './store.js';
import { bindSignOut, mountSignIn, revealApp } from './ui.js';
import { roleLabel } from '../lib/role-access.js';
import {
  SAVE_EVERY_MS,
  beginView,
  escapeHtml,
  canViewItem,
  isFieldTrainingRole,
  isHighlighted,
  notePage,
  onPause,
  onPlay,
  onSeek,
  onTime,
  pageTotal,
  progressPayload,
  statusLabel
} from '../lib/training-progress.js';
import {
  controlButtons,
  embedStageHtml,
  imageStageHtml,
  listHtml,
  officeFallbackHtml,
  pdfShellHtml,
  playerHtml,
  slideStageHtml,
  videoStageHtml
} from './training-ui.js';
import { openPdf, readPptx, renderPdfPage } from './training-media.js';
import { createTrainingSaver, saveTrainingRow } from '../lib/training-save.js';
import { coachWorkspaceHtml, invalidateCoachProfile, mountCoachWorkspace, stopCoachVoice } from './coach-ui.js';

const app = document.getElementById('app');
const preview = new URLSearchParams(location.search).get('preview');
if (preview && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  const { renderTrainingPreview } = await import('./training-preview.js');
  await renderTrainingPreview(app, preview);
} else {
  start();
}

let ctx;
let catalog = [];
let filter = 'all';
let lessonsActive = false;
let openItem = null;
let session = null;
let saved = null;
let timer = 0;
let poll = 0;
let pdfDoc = null;
let slideIndex = 0;
let slides = [];
let officeMode = false;
let viewVersion = 0;
let mediaCleanup = [];

function isCurrentView(version, item) {
  return version === viewVersion && openItem === item;
}

function mediaError(error, version, item) {
  if (!isCurrentView(version, item)) return;
  const msg = document.getElementById('tnTrainMsg');
  if (msg) {
    delete msg.dataset.trainingValidation;
    msg.textContent = error?.message || 'This lesson could not load. Go back and reopen it to retry.';
  }
}
const trainingSaver = createTrainingSaver({
  write: (request) => saveTrainingRow({ ...request, sb: ctx.sb, cfg: ctx.cfg }),
  onChange: (state) => {
    if (!sameTrainingAccount(state.identity)) return;
    const item = catalog.find((row) => row.id === state.identity.itemId);
    if (state.confirmed && item) item.progress = state.confirmed;
    if (openItem?.id === state.identity.itemId && state.confirmed) {
      saved = { ...saved, ...state.confirmed, view_count: Math.max(saved?.view_count || 0, state.confirmed.view_count || 0) };
      paintWatch();
    }
    paintSaveStatus();
  }
});

function trainingIdentity(itemId = openItem?.id) {
  return { userId: ctx?.session?.user?.id, repId: ctx?.rep?.id, itemId };
}

function sameTrainingAccount(identity) {
  return identity.userId === ctx?.session?.user?.id && identity.repId === ctx?.rep?.id;
}

async function start() {
  ctx = await bootFiles();
  bindSignOut(ctx, document.getElementById('signOut'));
  if (ctx.mode === 'local') {
    revealApp();
    app.innerHTML = '<h1 class="tnTitle">Training &amp; Practice</h1><p class="tnSub">Sign in to the connected True North app to see your personal Coach and assigned lessons.</p><a class="tnTap" href="/">Back to map</a>';
    return;
  }
  if (!ctx.session) return renderSignIn();
  if (!ctx.rep || !isFieldTrainingRole(ctx.rep.role)) {
    revealApp();
    app.innerHTML = '<h1 class="tnTitle">Training</h1><p class="tnSub">This page is for appointment setters and sales reps.</p><a class="tnTap" href="/">Back to map</a>';
    return;
  }
  revealApp();
  await showList();
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(true); });
  window.addEventListener('pagehide', () => { stopCoachVoice(); flush(true); });
}

function renderSignIn() {
  mountSignIn(app);
  document.getElementById('tnLogin').onsubmit = async (event) => {
    event.preventDefault();
    try {
      await signIn(ctx, document.getElementById('tnEmail').value, document.getElementById('tnPassword').value);
      if (!isFieldTrainingRole(ctx.rep?.role)) {
        revealApp();
        app.innerHTML = '<h1 class="tnTitle">Training</h1><p class="tnSub">This page is for appointment setters and sales reps.</p>';
        return;
      }
      revealApp();
      await showList();
    } catch (error) {
      document.getElementById('tnLoginError').textContent = error.message;
    }
  };
}

async function loadCatalog() {
  const [items, progress, reminders, assignments] = await Promise.all([
    ctx.sb.from('training_items').select('*').eq('active', true).order('sort_order'),
    ctx.sb.from('training_progress').select('*').eq('rep_id', ctx.rep.id),
    ctx.sb.from('training_reminders').select('item_id,rep_id').eq('rep_id', ctx.rep.id),
    ctx.sb.from('training_assignments').select('item_id,rep_id').eq('rep_id', ctx.rep.id)
  ]);
  if (items.error) throw items.error;
  if (progress.error) throw progress.error;
  if (reminders.error) throw reminders.error;
  if (assignments.error) throw assignments.error;
  const progressRows = progress.data || [];
  const reminderRows = reminders.data || [];
  const assigned = new Set((assignments.data || []).map((row) => row.item_id));
  catalog = (items.data || [])
    .map((item) => ({
      ...item,
      assigneeIds: assigned.has(item.id) ? [ctx.rep.id] : [],
      progress: progressRows.find((row) => row.item_id === item.id) || null,
      reminded: isHighlighted(item, reminderRows, ctx.rep.id) && !item.required
    }))
    .filter((item) => canViewItem(item, ctx.rep.role, ctx.rep.id))
    .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title));
  await Promise.all(catalog.map(async (item) => {
    if (!item.poster_path) return;
    item.posterUrl = await signed(item.poster_path);
  }));
}

async function signed(path) {
  const { data, error } = await ctx.sb.storage.from('training').createSignedUrl(path, 60 * 60);
  if (error) return '';
  return data.signedUrl;
}

function visibleItems() {
  return catalog.filter((item) => {
    if (filter === 'required') return item.required || item.reminded;
    if (filter === 'video') return item.kind === 'video' || item.kind === 'external';
    if (filter === 'deck') return item.kind === 'deck';
    if (filter === 'pdf') return item.kind === 'pdf';
    return true;
  });
}

async function showList() {
  const version = ++viewVersion;
  stopTimer();
  if (openItem) invalidateCoachProfile();
  openItem = null;
  app.innerHTML = '<p class="tnSub">Loading training…</p>';
  try { await loadCatalog(); }
  catch (error) {
    if (version !== viewVersion) return;
    app.innerHTML = coachWorkspaceHtml('<div class="tnTrain"><h2>Your lessons</h2><p class="tnError" role="status">Your lessons could not load. Your saved progress has not been changed.</p><button type="button" id="tnLessonRetry">Try again</button></div>');
    mountCoachWorkspace(ctx, { showLessons: lessonsActive, onChange: active => lessonsActive = active });
    document.getElementById('tnLessonRetry').onclick = showList;
    paintSaveStatus();
    return;
  }
  if (version !== viewVersion) return;
  paintList();
}

function paintList() {
  const who = ctx.rep ? `${ctx.rep.name} · ${roleLabel(ctx.rep.role)}` : '';
  app.innerHTML = coachWorkspaceHtml(listHtml({ who, items: visibleItems(), filter, compact: true }));
  mountCoachWorkspace(ctx, { showLessons: lessonsActive, onChange: active => lessonsActive = active });
  app.querySelectorAll('[data-filter]').forEach((button) => {
    button.onclick = () => { filter = button.dataset.filter; paintList(); };
  });
  app.querySelectorAll('[data-item]').forEach((button) => {
    button.onclick = () => openTraining(button.dataset.item);
  });
  paintSaveStatus();
}

async function openTraining(id) {
  const item = catalog.find((row) => row.id === id);
  if (!item) return;
  stopCoachVoice();
  const version = ++viewVersion;
  stopTimer();
  lessonsActive = true;
  openItem = item;
  // Keep failed drafts for this account and lesson without claiming completion.
  const draft = trainingSaver.pendingFor(trainingIdentity(id));
  saved = beginView({ ...item.progress, ...draft, completed_at: item.progress?.completed_at || null }, new Date().toISOString());
  session = {
    ranges: saved.watched_ranges || [],
    pages: saved.pages_viewed || [],
    lastTime: null,
    playing: false,
    started_at: saved.started_at,
    view_count: saved.view_count,
    openSeconds: Number(saved.max_watched_seconds) || 0,
    duration: Number(item.duration_seconds) || 0
  };
  if (item.kind === 'image') session = notePage(session, 1, 1);
  app.innerHTML = playerHtml(item, saved);
  paintSaveStatus();
  document.getElementById('tnTrainBack').onclick = () => { flush(false).finally(showList); };
  const stage = document.getElementById('tnTrainStage');
  try {
    if (item.kind === 'video') await mountVideo(stage, item, version);
    else if (item.kind === 'external') await mountExternal(stage, item, version);
    else if (item.kind === 'deck') await mountDeck(stage, item, version);
    else if (item.kind === 'pdf') await mountPdf(stage, item, version);
    else if (item.kind === 'image') await mountImage(stage, item, version);
  } catch (error) {
    if (version !== viewVersion) return;
    mediaError(error, version, item);
  }
  if (version !== viewVersion) return;
  paintWatch();
  await flush(false);
  if (version === viewVersion) startTimer();
}

async function mountVideo(stage, item, version) {
  const src = await signed(item.storage_path);
  const poster = item.poster_path ? await signed(item.poster_path) : '';
  if (!isCurrentView(version, item)) return;
  stage.innerHTML = videoStageHtml({ src, poster });
  const video = stage.querySelector('#tnTrainVideo');
  let seeking = false;
  const listen = (name, callback) => {
    const guarded = (event) => { if (isCurrentView(version, item)) callback(event); };
    video.addEventListener(name, guarded);
    mediaCleanup.push(() => video.removeEventListener(name, guarded));
  };
  mediaCleanup.push(() => { video.pause(); video.removeAttribute('src'); video.load(); });
  listen('loadedmetadata', () => {
    session.duration = video.duration || session.duration;
    const resume = Number(saved.last_position_seconds) || 0;
    if (resume > 1 && resume < video.duration - 1) {
      seeking = true;
      video.currentTime = resume;
    }
  });
  listen('seeking', () => { seeking = true; });
  listen('seeked', () => {
    session = onSeek(session, video.currentTime);
    seeking = false;
  });
  listen('play', () => { session = onPlay(session, video.currentTime); });
  listen('timeupdate', () => {
    if (seeking || video.paused) return;
    session = onTime(session, video.currentTime);
    paintWatch();
  });
  listen('pause', () => {
    session = onPause(session, video.currentTime);
    paintWatch();
    flush(false);
  });
  listen('ended', () => { session = onPause(session, video.currentTime); flush(false); });
}

async function mountExternal(stage, item, version) {
  const id = embedId(item);
  const embed = item.external_provider === 'youtube'
    ? `https://www.youtube-nocookie.com/embed/${id}?enablejsapi=1&origin=${encodeURIComponent(location.origin)}`
    : item.external_provider === 'vimeo'
      ? `https://player.vimeo.com/video/${id}`
      : item.external_url;
  stage.innerHTML = embedStageHtml({ src: embed, title: item.title });
  document.getElementById('tnTrainControls').innerHTML = controlButtons({ showComplete: true });
  document.getElementById('tnTrainDone').onclick = () => markComplete();
  if (item.external_provider === 'youtube') watchYoutube(item, version);
  else if (item.external_provider === 'vimeo') await watchVimeo(item, version);
  else watchOpenClock(item, version);
}

function embedId(item) {
  const url = new URL(item.external_url);
  if (item.external_provider === 'youtube') return url.pathname.split('/').filter(Boolean).pop();
  return url.pathname.split('/').filter(Boolean).pop();
}

function watchYoutube(item, version) {
  const boot = () => {
    if (!isCurrentView(version, item)) return;
    const frame = document.getElementById('tnTrainFrame');
    if (!frame || !window.YT?.Player) return;
    const player = new window.YT.Player(frame, {
      events: {
        onReady: () => { if (isCurrentView(version, item)) session.duration = player.getDuration() || 0; },
        onStateChange: (event) => {
          if (!isCurrentView(version, item)) return;
          if (event.data === window.YT.PlayerState.PLAYING) session = onPlay(session, player.getCurrentTime());
          if (event.data === window.YT.PlayerState.PAUSED || event.data === window.YT.PlayerState.ENDED) {
            session = onPause(session, player.getCurrentTime());
            flush(false);
          }
        }
      }
    });
    mediaCleanup.push(() => player.destroy());
    poll = window.setInterval(() => {
      if (!isCurrentView(version, item) || !session?.playing || !player.getCurrentTime) return;
      session.duration = player.getDuration() || session.duration;
      session = onTime(session, player.getCurrentTime());
      paintWatch();
    }, 500);
  };
  if (window.YT?.Player) boot();
  else {
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    window.onYouTubeIframeAPIReady = boot;
    mediaCleanup.push(() => { if (window.onYouTubeIframeAPIReady === boot) window.onYouTubeIframeAPIReady = undefined; });
    document.head.appendChild(tag);
  }
}

async function watchVimeo(item, version) {
  const frame = document.getElementById('tnTrainFrame');
  const { default: Player } = await import('https://cdn.jsdelivr.net/npm/@vimeo/player@2.24.0/+esm');
  if (!isCurrentView(version, item)) return;
  const player = new Player(frame);
  const handlers = [];
  const listen = (name, callback) => {
    const guarded = (data) => {
      if (isCurrentView(version, item)) Promise.resolve(callback(data)).catch((error) => mediaError(error, version, item));
    };
    handlers.push([name, guarded]);
    player.on(name, guarded);
  };
  mediaCleanup.push(() => {
    for (const [name, handler] of handlers) player.off(name, handler);
    Promise.resolve(player.destroy()).catch(() => {});
  });
  listen('play', async () => {
    const [duration, time] = await Promise.all([player.getDuration(), player.getCurrentTime()]);
    if (!isCurrentView(version, item)) return;
    session.duration = duration || 0;
    session = onPlay(session, time);
  });
  listen('timeupdate', (data) => {
    session.duration = data.duration || session.duration;
    session = onTime(session, data.seconds);
    paintWatch();
  });
  listen('pause', async () => {
    const time = await player.getCurrentTime();
    if (!isCurrentView(version, item)) return;
    session = onPause(session, time); flush(false);
  });
  listen('seeked', async () => {
    const time = await player.getCurrentTime();
    if (isCurrentView(version, item)) session = onSeek(session, time);
  });
}

function watchOpenClock(item, version) {
  poll = window.setInterval(() => {
    if (!isCurrentView(version, item) || document.hidden) return;
    session.openSeconds = (session.openSeconds || 0) + 1;
    paintWatch();
  }, 1000);
}

async function mountDeck(stage, item, version) {
  officeMode = false;
  slides = [];
  try {
    const src = await signed(item.storage_path);
    if (!isCurrentView(version, item)) return;
    const response = await fetch(src);
    if (!response.ok) throw new Error('Could not download the deck.');
    const file = new File([await response.blob()], item.file_name || 'deck.pptx');
    if (!isCurrentView(version, item)) return;
    const parsed = await readPptx(file);
    const release = () => parsed.slides.forEach((slide) => (slide.images || []).forEach((url) => URL.revokeObjectURL(url)));
    if (!isCurrentView(version, item)) { release(); return; }
    mediaCleanup.push(release);
    slides = parsed.slides;
    if (!slides.length) throw new Error('No slides found.');
  } catch {
    if (!isCurrentView(version, item)) return;
    officeMode = true;
  }
  slideIndex = 0;
  if (!officeMode) session = notePage(session, 1, slides.length || pageTotal(item));
  paintDeck(item, version);
}

function paintDeck(item, version) {
  if (!isCurrentView(version, item)) return;
  const stage = document.getElementById('tnTrainStage');
  const total = slides.length || Number(item.slide_count) || 1;
  if (officeMode) {
    signed(item.storage_path).then((src) => {
      if (!isCurrentView(version, item)) return;
      stage.innerHTML = officeFallbackHtml(src);
    }).catch((error) => mediaError(error, version, item));
  } else {
    stage.innerHTML = slideStageHtml(slides[slideIndex], slideIndex, total);
    session = notePage(session, slideIndex + 1, total);
  }
  document.getElementById('tnTrainPageLabel').textContent = officeMode ? 'Slide viewer' : `Slide ${slideIndex + 1} of ${total}`;
  document.getElementById('tnTrainControls').innerHTML = controlButtons({
    showNav: !officeMode && total > 1,
    showComplete: true,
    download: ''
  });
  signed(item.storage_path).then((src) => {
    if (!isCurrentView(version, item)) return;
    const controls = document.getElementById('tnTrainControls');
    if (controls && !controls.querySelector('a')) controls.insertAdjacentHTML('beforeend', controlButtons({ download: src }));
  }).catch((error) => mediaError(error, version, item));
  document.getElementById('tnTrainPrev')?.addEventListener('click', () => { if (!isCurrentView(version, item)) return; slideIndex = Math.max(0, slideIndex - 1); paintDeck(item, version); paintWatch(); flush(false); });
  document.getElementById('tnTrainNext')?.addEventListener('click', () => { if (!isCurrentView(version, item)) return; slideIndex = Math.min(total - 1, slideIndex + 1); paintDeck(item, version); paintWatch(); flush(false); });
  document.getElementById('tnTrainDone')?.addEventListener('click', () => markComplete());
  paintWatch();
}

async function mountPdf(stage, item, version) {
  stage.innerHTML = pdfShellHtml();
  const src = await signed(item.storage_path);
  if (!isCurrentView(version, item)) return;
  const doc = await openPdf(src);
  const release = () => { Promise.resolve(doc.destroy?.()).catch(() => {}); };
  if (!isCurrentView(version, item)) { release(); return; }
  mediaCleanup.push(release);
  pdfDoc = doc;
  slideIndex = 0;
  await paintPdf(item, version);
}

async function paintPdf(item, version) {
  if (!isCurrentView(version, item)) return false;
  const pageIndex = slideIndex;
  const total = pdfDoc.numPages || pageTotal(item) || 1;
  app.querySelectorAll('#tnTrainPrev, #tnTrainNext').forEach((button) => button.disabled = true);
  await renderPdfPage(pdfDoc, pageIndex + 1, document.getElementById('tnTrainCanvas'));
  if (!isCurrentView(version, item)) return false;
  session = notePage(session, pageIndex + 1, total);
  document.getElementById('tnTrainPageLabel').textContent = `Page ${pageIndex + 1} of ${total}`;
  const src = await signed(item.storage_path);
  if (!isCurrentView(version, item)) return false;
  document.getElementById('tnTrainControls').innerHTML = controlButtons({ showNav: total > 1, showComplete: true, download: src });
  const navigate = async (direction) => {
    if (!isCurrentView(version, item)) return;
    slideIndex = Math.max(0, Math.min(total - 1, slideIndex + direction));
    try { if (await paintPdf(item, version)) flush(false); }
    catch (error) { mediaError(error, version, item); }
    finally {
      if (isCurrentView(version, item)) app.querySelectorAll('#tnTrainPrev, #tnTrainNext').forEach((button) => button.disabled = false);
    }
  };
  document.getElementById('tnTrainPrev')?.addEventListener('click', () => navigate(-1));
  document.getElementById('tnTrainNext')?.addEventListener('click', () => navigate(1));
  document.getElementById('tnTrainDone')?.addEventListener('click', () => markComplete());
  paintWatch();
  return true;
}

async function mountImage(stage, item, version) {
  const src = await signed(item.storage_path);
  if (!isCurrentView(version, item)) return;
  stage.innerHTML = imageStageHtml(src, item.title);
  session = notePage(session, 1, 1);
  document.getElementById('tnTrainControls').innerHTML = controlButtons({ showComplete: true, download: src });
  document.getElementById('tnTrainDone')?.addEventListener('click', () => markComplete());
  paintWatch();
}

function paintWatch() {
  if (!openItem) return;
  const payload = progressPayload({ repId: ctx.rep.id, item: openItem, session, saved });
  const row = payload.row;
  if (!row) return;
  // The meter can show the local viewing session; completion is server-confirmed.
  const status = statusLabel({ ...row, completed_at: saved?.completed_at || null, completed: Boolean(saved?.completed_at) });
  const pill = app.querySelector('.tnTrainHead .tnTrainPill');
  if (pill) { pill.className = `tnTrainPill is-${status.key}`; pill.textContent = status.label; }
  const meter = document.getElementById('tnTrainWatch');
  if (meter) {
    const value = Math.round(row.percent || 0);
    meter.setAttribute('aria-valuenow', String(value));
    meter.querySelector('span').style.width = `${value}%`;
  }
}

async function markComplete() {
  const item = openItem;
  const version = viewVersion;
  const result = await flush(false, true);
  if (!isCurrentView(version, item)) return;
  const msg = document.getElementById('tnTrainMsg');
  if (result?.validationError && msg) {
    msg.dataset.trainingValidation = 'true';
    msg.textContent = result.error;
  } else {
    // Network/auth errors belong to the persistent save notice with Retry.
    // Clear only a superseded validation message, leaving media errors intact.
    if (msg?.dataset.trainingValidation) {
      msg.textContent = '';
      delete msg.dataset.trainingValidation;
    }
    paintWatch();
  }
}

function paintSaveStatus() {
  if (!ctx?.rep) return;
  let box = document.getElementById('tnTrainSaveStatus');
  const panel = !openItem ? app.querySelector('.tnTrainingWorkspace') || app.querySelector('.tnTrain') : app.querySelector('.tnTrain');
  if (!panel) return;
  if (!box) {
    box = document.createElement('div');
    box.id = 'tnTrainSaveStatus';
    box.className = 'tnTrainLead';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    panel.prepend(box);
  }
  const states = openItem
    ? [trainingSaver.stateFor(trainingIdentity())].filter(Boolean)
    : trainingSaver.unsavedFor(ctx.session?.user?.id, ctx.rep.id);
  box.hidden = !states.length;
  box.innerHTML = states.map((state) => {
    const title = !openItem ? `${catalog.find((item) => item.id === state.identity.itemId)?.title || 'Lesson'}: ` : '';
    const text = state.status === 'saved' ? 'Progress saved.' : state.status === 'saving' ? 'Saving progress…' : state.error;
    const retry = state.status === 'error' ? ` <button type="button" class="tnTrainBtn" data-training-retry="${escapeHtml(state.identity.itemId)}">Retry save</button>` : '';
    return `<p>${escapeHtml(title + text)}${retry}</p>`;
  }).join('');
  box.querySelectorAll('[data-training-retry]').forEach((button) => {
    button.onclick = () => {
      if (openItem?.id === button.dataset.trainingRetry) flush(false);
      else trainingSaver.retry(trainingIdentity(button.dataset.trainingRetry));
    };
  });
}

function startTimer() {
  if (timer) window.clearInterval(timer);
  timer = window.setInterval(() => flush(false), SAVE_EVERY_MS);
}

function stopTimer() {
  if (timer) window.clearInterval(timer);
  timer = 0;
  if (poll) window.clearInterval(poll);
  poll = 0;
  const cleanups = mediaCleanup;
  mediaCleanup = [];
  for (const cleanup of cleanups) {
    try { cleanup(); } catch { /* A provider may already have detached its frame. */ }
  }
  pdfDoc = null;
}

async function flush(keepalive, markComplete = false) {
  if (!openItem || !session || !ctx?.sb || !ctx.rep?.id || !ctx.session?.user?.id) return null;
  const built = progressPayload({ repId: ctx.rep.id, item: openItem, session, saved, markComplete });
  if (built.error) return { ...built, validationError: true };
  const identity = trainingIdentity();
  const pending = trainingSaver.pendingFor(identity);
  built.row.completed_at ||= pending?.completed_at || null;
  return trainingSaver.enqueue({ identity, row: built.row, keepalive });
}

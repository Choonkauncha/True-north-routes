import { bootFiles, signIn } from './store.js';
import { bindSignOut, signInCard } from './ui.js';
import { roleLabel } from '../lib/role-access.js';
import {
  SAVE_EVERY_MS,
  beginView,
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
let openItem = null;
let session = null;
let saved = null;
let timer = 0;
let poll = 0;
let pdfDoc = null;
let slideIndex = 0;
let slides = [];
let officeMode = false;

async function start() {
  ctx = await bootFiles();
  bindSignOut(ctx, document.getElementById('signOut'));
  if (ctx.mode === 'local') {
    app.innerHTML = '<h1 class="tnTitle">Training &amp; Practice</h1><p class="tnSub">Training needs the live Supabase project. Apply supabase/migrations/20261008_training_practice.sql, then reload.</p><a class="tnTap" href="/">Back to map</a>';
    return;
  }
  if (!ctx.session) return renderSignIn();
  if (!ctx.rep || !isFieldTrainingRole(ctx.rep.role)) {
    app.innerHTML = '<h1 class="tnTitle">Training</h1><p class="tnSub">This page is for appointment setters and sales reps.</p><a class="tnTap" href="/">Back to map</a>';
    return;
  }
  await showList();
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(true); });
  window.addEventListener('pagehide', () => flush(true));
}

function renderSignIn() {
  app.innerHTML = signInCard();
  document.getElementById('tnLogin').onsubmit = async (event) => {
    event.preventDefault();
    try {
      await signIn(ctx, document.getElementById('tnEmail').value, document.getElementById('tnPassword').value);
      if (!isFieldTrainingRole(ctx.rep?.role)) {
        app.innerHTML = '<h1 class="tnTitle">Training</h1><p class="tnSub">This page is for appointment setters and sales reps.</p>';
        return;
      }
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
  stopTimer();
  openItem = null;
  app.innerHTML = '<p class="tnSub">Loading training…</p>';
  try { await loadCatalog(); }
  catch (error) {
    app.innerHTML = `<p class="tnError">${error.message}. Apply supabase/migrations/20261008_training_practice.sql if this project does not have the training tables yet.</p>`;
    return;
  }
  paintList();
}

function paintList() {
  const who = ctx.rep ? `${ctx.rep.name} · ${roleLabel(ctx.rep.role)}` : '';
  app.innerHTML = listHtml({ who, items: visibleItems(), filter });
  app.querySelectorAll('[data-filter]').forEach((button) => {
    button.onclick = () => { filter = button.dataset.filter; paintList(); };
  });
  app.querySelectorAll('[data-item]').forEach((button) => {
    button.onclick = () => openTraining(button.dataset.item);
  });
}

async function openTraining(id) {
  const item = catalog.find((row) => row.id === id);
  if (!item) return;
  openItem = item;
  saved = beginView(item.progress, new Date().toISOString());
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
  document.getElementById('tnTrainBack').onclick = () => { flush(false).finally(showList); };
  const stage = document.getElementById('tnTrainStage');
  try {
    if (item.kind === 'video') await mountVideo(stage, item);
    else if (item.kind === 'external') await mountExternal(stage, item);
    else if (item.kind === 'deck') await mountDeck(stage, item);
    else if (item.kind === 'pdf') await mountPdf(stage, item);
    else if (item.kind === 'image') await mountImage(stage, item);
  } catch (error) {
    document.getElementById('tnTrainMsg').textContent = error.message;
  }
  paintWatch();
  await flush(false);
  startTimer();
}

async function mountVideo(stage, item) {
  const src = await signed(item.storage_path);
  const poster = item.poster_path ? await signed(item.poster_path) : '';
  stage.innerHTML = videoStageHtml({ src, poster });
  const video = document.getElementById('tnTrainVideo');
  let seeking = false;
  video.addEventListener('loadedmetadata', () => {
    session.duration = video.duration || session.duration;
    const resume = Number(saved.last_position_seconds) || 0;
    if (resume > 1 && resume < video.duration - 1) {
      seeking = true;
      video.currentTime = resume;
    }
  });
  video.addEventListener('seeking', () => { seeking = true; });
  video.addEventListener('seeked', () => {
    session = onSeek(session, video.currentTime);
    seeking = false;
  });
  video.addEventListener('play', () => { session = onPlay(session, video.currentTime); });
  video.addEventListener('timeupdate', () => {
    if (seeking || video.paused) return;
    session = onTime(session, video.currentTime);
    paintWatch();
  });
  video.addEventListener('pause', () => {
    session = onPause(session, video.currentTime);
    paintWatch();
    flush(false);
  });
  video.addEventListener('ended', () => { session = onPause(session, video.currentTime); flush(false); });
}

async function mountExternal(stage, item) {
  const id = embedId(item);
  const embed = item.external_provider === 'youtube'
    ? `https://www.youtube-nocookie.com/embed/${id}?enablejsapi=1&origin=${encodeURIComponent(location.origin)}`
    : item.external_provider === 'vimeo'
      ? `https://player.vimeo.com/video/${id}`
      : item.external_url;
  stage.innerHTML = embedStageHtml({ src: embed, title: item.title });
  document.getElementById('tnTrainControls').innerHTML = controlButtons({ showComplete: true });
  document.getElementById('tnTrainDone').onclick = () => markComplete();
  if (item.external_provider === 'youtube') watchYoutube();
  else if (item.external_provider === 'vimeo') watchVimeo();
  else watchOpenClock();
}

function embedId(item) {
  const url = new URL(item.external_url);
  if (item.external_provider === 'youtube') return url.pathname.split('/').filter(Boolean).pop();
  return url.pathname.split('/').filter(Boolean).pop();
}

function watchYoutube() {
  const boot = () => {
    const frame = document.getElementById('tnTrainFrame');
    if (!frame || !window.YT?.Player) return;
    const player = new window.YT.Player(frame, {
      events: {
        onReady: () => { session.duration = player.getDuration() || 0; },
        onStateChange: (event) => {
          if (event.data === window.YT.PlayerState.PLAYING) session = onPlay(session, player.getCurrentTime());
          if (event.data === window.YT.PlayerState.PAUSED || event.data === window.YT.PlayerState.ENDED) {
            session = onPause(session, player.getCurrentTime());
            flush(false);
          }
        }
      }
    });
    poll = window.setInterval(() => {
      if (!openItem || !session?.playing || !player.getCurrentTime) return;
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
    document.head.appendChild(tag);
  }
}

async function watchVimeo() {
  const { default: Player } = await import('https://cdn.jsdelivr.net/npm/@vimeo/player@2.24.0/+esm');
  const player = new Player(document.getElementById('tnTrainFrame'));
  player.on('play', async () => {
    session.duration = (await player.getDuration()) || 0;
    session = onPlay(session, await player.getCurrentTime());
  });
  player.on('timeupdate', (data) => {
    session.duration = data.duration || session.duration;
    session = onTime(session, data.seconds);
    paintWatch();
  });
  player.on('pause', async () => { session = onPause(session, await player.getCurrentTime()); flush(false); });
  player.on('seeked', async () => { session = onSeek(session, await player.getCurrentTime()); });
}

function watchOpenClock() {
  poll = window.setInterval(() => {
    if (!openItem || document.hidden) return;
    session.openSeconds = (session.openSeconds || 0) + 1;
    paintWatch();
  }, 1000);
}

async function mountDeck(stage, item) {
  officeMode = false;
  slides = [];
  try {
    const src = await signed(item.storage_path);
    const response = await fetch(src);
    if (!response.ok) throw new Error('Could not download the deck.');
    const file = new File([await response.blob()], item.file_name || 'deck.pptx');
    const parsed = await readPptx(file);
    slides = parsed.slides;
    if (!slides.length) throw new Error('No slides found.');
  } catch {
    officeMode = true;
  }
  slideIndex = 0;
  if (!officeMode) session = notePage(session, 1, slides.length || pageTotal(item));
  paintDeck(item);
}

function paintDeck(item) {
  const stage = document.getElementById('tnTrainStage');
  const total = slides.length || Number(item.slide_count) || 1;
  if (officeMode) {
    signed(item.storage_path).then((src) => {
      stage.innerHTML = officeFallbackHtml(src);
    });
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
    const controls = document.getElementById('tnTrainControls');
    if (controls && !controls.querySelector('a')) controls.insertAdjacentHTML('beforeend', controlButtons({ download: src }));
  });
  document.getElementById('tnTrainPrev')?.addEventListener('click', () => { slideIndex = Math.max(0, slideIndex - 1); paintDeck(item); paintWatch(); flush(false); });
  document.getElementById('tnTrainNext')?.addEventListener('click', () => { slideIndex = Math.min(total - 1, slideIndex + 1); paintDeck(item); paintWatch(); flush(false); });
  document.getElementById('tnTrainDone')?.addEventListener('click', () => markComplete());
  paintWatch();
}

async function mountPdf(stage, item) {
  stage.innerHTML = pdfShellHtml();
  const src = await signed(item.storage_path);
  pdfDoc = await openPdf(src);
  slideIndex = 0;
  await paintPdf(item);
}

async function paintPdf(item) {
  const total = pdfDoc.numPages || pageTotal(item) || 1;
  session = notePage(session, slideIndex + 1, total);
  await renderPdfPage(pdfDoc, slideIndex + 1, document.getElementById('tnTrainCanvas'));
  document.getElementById('tnTrainPageLabel').textContent = `Page ${slideIndex + 1} of ${total}`;
  const src = await signed(item.storage_path);
  document.getElementById('tnTrainControls').innerHTML = controlButtons({ showNav: total > 1, showComplete: true, download: src });
  document.getElementById('tnTrainPrev')?.addEventListener('click', async () => { slideIndex = Math.max(0, slideIndex - 1); await paintPdf(item); flush(false); });
  document.getElementById('tnTrainNext')?.addEventListener('click', async () => { slideIndex = Math.min(total - 1, slideIndex + 1); await paintPdf(item); flush(false); });
  document.getElementById('tnTrainDone')?.addEventListener('click', () => markComplete());
  paintWatch();
}

async function mountImage(stage, item) {
  const src = await signed(item.storage_path);
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
  const status = statusLabel({ ...row, completed: Boolean(row.completed_at) });
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
  const result = await flush(false, true);
  const msg = document.getElementById('tnTrainMsg');
  if (result?.error && msg) msg.textContent = result.error;
  else paintWatch();
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
}

async function flush(keepalive, markComplete = false) {
  if (!openItem || !session || !ctx?.sb) return null;
  const built = progressPayload({ repId: ctx.rep.id, item: openItem, session, saved, markComplete });
  if (built.error) return built;
  saved = { ...saved, ...built.row };
  openItem.progress = saved;
  const { data } = await ctx.sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  const url = `${ctx.cfg.url}/rest/v1/training_progress?on_conflict=rep_id,item_id`;
  try {
    await fetch(url, {
      method: 'POST',
      keepalive,
      headers: {
        apikey: ctx.cfg.publishableKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(built.row)
    });
  } catch (error) {
    if (!keepalive) document.getElementById('tnTrainMsg').textContent = error.message;
  }
  return built;
}

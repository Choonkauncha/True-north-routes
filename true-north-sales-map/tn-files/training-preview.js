import { listHtml, matrixHtml, playerHtml, slideStageHtml, videoStageHtml, controlButtons } from './training-ui.js';
import { roleLabel } from '../lib/role-access.js';

const poster = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#0c1424"/><rect x="0" y="132" width="320" height="48" fill="#1e6bff"/><text x="16" y="40" fill="#fff" font-family="sans-serif" font-size="18" font-weight="700">True North</text><text x="16" y="68" fill="#d5e2f2" font-family="sans-serif" font-size="14">How to set the inspection</text><polygon points="146,78 146,112 176,95" fill="#fff"/></svg>');

const items = [
  {
    id: 'inspect',
    title: 'How to set the inspection',
    description: 'Find the homeowner, ask what they noticed, and book a real time.',
    kind: 'video',
    duration_seconds: 754,
    required: true,
    posterUrl: poster,
    progress: null,
    reminded: false
  },
  {
    id: 'script',
    title: 'Door approach practice',
    description: 'The first minute on the porch. Trust first, then the inspection.',
    kind: 'video',
    duration_seconds: 312,
    required: false,
    posterUrl: poster,
    progress: { percent: 42, started_at: '2026-10-08T14:00:00Z', view_count: 1 },
    reminded: false
  },
  {
    id: 'deck',
    title: 'Insurance basics',
    description: 'What to say, and what not to promise, before the inspection.',
    kind: 'deck',
    slide_count: 8,
    required: true,
    progress: { completed_at: '2026-10-07T18:12:00Z', percent: 100, max_watched_seconds: 0 },
    reminded: false
  }
];

export async function renderTrainingPreview(app, which) {
  document.getElementById('signOut')?.classList.add('tnHide');
  if (which === 'video') return renderVideo(app);
  if (which === 'deck') return renderDeck(app);
  paintList(app, 'all');
}

function paintList(app, filter) {
  const shown = items.filter((item) => {
    if (filter === 'required') return item.required || item.reminded;
    if (filter === 'video') return item.kind === 'video' || item.kind === 'external';
    if (filter === 'deck') return item.kind === 'deck';
    return true;
  });
  app.innerHTML = listHtml({ who: 'Alex Setter · Appointment setter', items: shown, filter });
  app.querySelectorAll('[data-filter]').forEach((button) => {
    button.onclick = () => paintList(app, button.dataset.filter);
  });
}

function renderVideo(app) {
  const item = items[0];
  app.innerHTML = playerHtml({ ...item, reminded: false }, { percent: 18, started_at: '2026-10-08T14:00:00Z', view_count: 1 });
  const stage = document.getElementById('tnTrainStage');
  stage.innerHTML = videoStageHtml({ src: '/training-preview/sample.mp4', poster });
  const video = document.getElementById('tnTrainVideo');
  video.controls = true;
  video.muted = true;
  video.playsInline = true;
  const play = () => video.play().catch(() => {});
  video.addEventListener('loadeddata', play);
  play();
  const meter = document.getElementById('tnTrainWatch');
  meter.setAttribute('aria-valuenow', '18');
  meter.querySelector('span').style.width = '18%';
}

const deckSlides = [
  { title: 'Find the homeowner', lines: ['Introduce True North.', 'Ask who owns the house.'] },
  { title: 'What the inspection is for', lines: ['Look at the roof. Do not diagnose from the porch.', 'Book a specific day and time.', 'Leave the salesperson a clean note.'] },
  { title: 'What not to promise', lines: ['Do not guarantee an insurance outcome.', 'Do not quote a price from the sidewalk.'] }
];

function renderDeck(app) {
  let index = 1;
  const paint = () => {
    app.innerHTML = playerHtml({
      title: 'Insurance basics',
      description: 'Eight slides. Move through every one.',
      kind: 'deck',
      required: true,
      reminded: false
    }, { percent: Math.round(((index + 1) / 8) * 100), started_at: '2026-10-08T14:00:00Z', view_count: 1 });
    document.getElementById('tnTrainStage').innerHTML = slideStageHtml(deckSlides[index] || deckSlides[deckSlides.length - 1], index, 8);
    document.getElementById('tnTrainPageLabel').textContent = `Slide ${index + 1} of 8`;
    document.getElementById('tnTrainControls').innerHTML = controlButtons({ showNav: true, showComplete: true });
    const meter = document.getElementById('tnTrainWatch');
    meter.setAttribute('aria-valuenow', String(Math.round(((index + 1) / 8) * 100)));
    meter.querySelector('span').style.width = `${Math.round(((index + 1) / 8) * 100)}%`;
    document.getElementById('tnTrainPrev').onclick = () => { index = Math.max(0, index - 1); paint(); };
    document.getElementById('tnTrainNext').onclick = () => { index = Math.min(7, index + 1); paint(); };
    document.getElementById('tnTrainDone').onclick = () => {
      const pill = app.querySelector('.tnTrainHead .tnTrainPill');
      pill.className = 'tnTrainPill is-completed';
      pill.textContent = 'Completed';
    };
  };
  paint();
}

export function renderAdminPreview(root) {
  const people = [
    { id: 'a', name: 'Alex Setter', role: 'appointment_setter', roleLabel: roleLabel('appointment_setter') },
    { id: 'b', name: 'Jordan Setter', role: 'canvasser', roleLabel: roleLabel('canvasser') },
    { id: 'c', name: 'Sam Sales', role: 'salesperson', roleLabel: roleLabel('salesperson') },
    { id: 'd', name: 'Riley Sales', role: 'salesperson', roleLabel: roleLabel('salesperson') }
  ];
  const progressByRep = new Map([
    ['a', { rep_id: 'a', percent: 42, started_at: '2026-10-08T14:00:00Z', view_count: 2, max_watched_seconds: 180 }],
    ['c', { rep_id: 'c', percent: 100, completed_at: '2026-10-07T18:12:00Z', started_at: '2026-10-07T18:00:00Z', view_count: 1, max_watched_seconds: 740 }]
  ]);
  root.innerHTML = `<div class="tnTrain"><div class="tnTrainHead"><div><p class="tnTrainLead">Management</p><h1>Training</h1></div></div>${matrixHtml({
    item: { id: 'inspect', title: 'How to set the inspection', required: true },
    people,
    progressByRep,
    reminders: [{ item_id: 'inspect', rep_id: 'b' }],
    personId: '',
    requiredOnly: false
  })}</div>`;
}

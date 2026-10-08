/*
  One collapse helper for cards, sections, and sheets.
  Weather, filters, the houses summary, and the route tray keep the
  toggles from the map controls work. The auto-prioritized list sheet
  and in-app navigation are left alone.
*/
import { readStoredUser } from '../lib/management-gate.js';

export const NARROW_PANEL_QUERY = '(max-width: 412px)';
const SKIP = '#listSheet, #navBar, #navChoice, #handoffPanel, #teamPanel, #loginModal, #loginCard, #auth, .authCard, .loginCard, .tnSignInScreen, [data-tn-no-fold]';
const BAR_SELECTOR = ':scope > header, :scope > .formHeader, :scope > .dashTitle, :scope > .tnTrainHead, :scope > .tnFolderHead, :scope > .doorSheetHead, :scope > .panelIntro';
const SIMPLE_SELECTOR = ':scope > h1, :scope > h2, :scope > h3, :scope > .sectionTitle, :scope > .sectionLabel, :scope > b';
const INTERACTIVE = 'button, a, input, select, textarea, label, summary';

export function panelPageId(pathname) {
  const path = String(pathname || '/').split('?')[0];
  const base = path.replace(/\/+$/, '').split('/').pop() || '';
  if (!base || base === 'index' || base === 'index.html') return 'map';
  return base.replace(/\.html$/, '');
}

export function panelStorageKey(userId, page, panelId) {
  return `tnrc2:panel:${userId || 'local'}:${page}:${panelId}`;
}

export function collapseDecision({ rank, narrow, saved }) {
  if (saved === '1' || saved === 'true') return true;
  if (saved === '0' || saved === 'false') return false;
  if (rank === 'primary') return false;
  return Boolean(narrow);
}

export function readPanelCollapsed(storage, userId, page, panelId, rank, narrow) {
  const key = panelStorageKey(userId, page, panelId);
  let saved = null;
  try { saved = storage ? storage.getItem(key) : null; }
  catch { saved = null; }
  return collapseDecision({ rank, narrow, saved });
}

function storage() {
  try { return localStorage; }
  catch { return null; }
}

function currentUserId() {
  const user = readStoredUser(storage());
  return user?.id || 'local';
}

function currentPage() {
  return panelPageId(typeof location === 'undefined' ? '/' : location.pathname);
}

function narrowNow() {
  return typeof matchMedia === 'function' && matchMedia(NARROW_PANEL_QUERY).matches;
}

function cssId(id) {
  return String(id || 'panel').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80) || 'panel';
}

function labelFrom(node) {
  if (!node) return 'Section';
  const clone = node.cloneNode(true);
  clone.querySelectorAll(`${INTERACTIVE}, .tnFoldHead, .tnFoldChevron`).forEach((child) => child.remove());
  const text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
  return text.slice(0, 80) || 'Section';
}

function isBar(node) {
  return node.matches('header, .formHeader, .dashTitle, .tnTrainHead, .tnFolderHead, .doorSheetHead, .panelIntro');
}

function applyCollapsed(el, head, collapsed) {
  el.classList.toggle('isCollapsed', collapsed);
  head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  const inner = el.querySelector(':scope > .tnFoldBody > .tnFoldInner');
  if (inner) inner.inert = collapsed;
  if (head.classList.contains('tnFoldChevronBtn')) {
    const name = el.dataset.tnFoldLabel || 'section';
    head.setAttribute('aria-label', `${collapsed ? 'Show' : 'Hide'} ${name}`);
  }
}

function persist(panelId, collapsed) {
  const store = storage();
  if (!store) return;
  try { store.setItem(panelStorageKey(currentUserId(), currentPage(), panelId), collapsed ? '1' : '0'); }
  catch { /* private mode */ }
}

function toggle(el, head, panelId) {
  const collapsed = head.getAttribute('aria-expanded') === 'true';
  applyCollapsed(el, head, collapsed);
  persist(panelId, collapsed);
  el.dispatchEvent(new CustomEvent('tn-panel-toggle', {
    bubbles: true,
    detail: { id: panelId, collapsed }
  }));
}

function enhance(el) {
  if (!el || el.dataset.tnFoldReady === '1' || el.dataset.tnFoldSkip === '1') return;
  if (el.matches('button, a, input, select, textarea, label')) {
    el.dataset.tnFoldSkip = '1';
    return;
  }
  if (el.closest(SKIP)) {
    el.dataset.tnFoldSkip = '1';
    return;
  }
  const panelId = el.getAttribute('data-tn-panel');
  if (!panelId) return;
  const title = el.querySelector(`${BAR_SELECTOR}, ${SIMPLE_SELECTOR}`);
  if (!title) {
    el.dataset.tnFoldSkip = '1';
    return;
  }
  el.dataset.tnFoldReady = '1';
  el.classList.add('tnFold');
  const rank = el.getAttribute('data-tn-rank') === 'primary' ? 'primary' : 'secondary';
  el.dataset.tnFoldLabel = labelFrom(title);
  const keepers = [...el.children].filter((node) => node !== title && node.matches('.closeBtn, [data-tn-fold-tool]'));
  keepers.forEach((node) => node.remove());

  const body = document.createElement('div');
  body.className = 'tnFoldBody';
  if (!body.id) body.id = `tn-fold-${cssId(panelId)}`;
  const inner = document.createElement('div');
  inner.className = 'tnFoldInner';
  body.append(inner);

  let head;
  let bar = null;
  const barMode = isBar(title) || Boolean(title.querySelector(INTERACTIVE));
  if (barMode) {
    title.classList.add('tnFoldBar');
    head = document.createElement('button');
    head.type = 'button';
    head.className = 'tnFoldHead tnFoldChevronBtn';
    const chevron = document.createElement('span');
    chevron.className = 'tnFoldChevron';
    chevron.setAttribute('aria-hidden', 'true');
    head.append(chevron);
    title.append(head);
    [...el.childNodes].forEach((node) => {
      if (node !== title) inner.append(node);
    });
  } else {
    const eyebrow = title.previousElementSibling;
    head = document.createElement('button');
    head.type = 'button';
    head.className = 'tnFoldHead';
    const label = document.createElement('span');
    label.className = 'tnFoldTitle';
    if (eyebrow && eyebrow.classList.contains('eyebrow')) label.append(eyebrow);
    label.append(title);
    const chevron = document.createElement('span');
    chevron.className = 'tnFoldChevron';
    chevron.setAttribute('aria-hidden', 'true');
    head.append(label, chevron);
    bar = document.createElement('div');
    bar.className = 'tnFoldBar';
    bar.append(head);
    [...el.childNodes].forEach((node) => inner.append(node));
  }
  el.append(...(bar ? [bar] : []), ...keepers, body);
  head.setAttribute('aria-controls', body.id);
  const collapsed = readPanelCollapsed(storage(), currentUserId(), currentPage(), panelId, rank, narrowNow());
  applyCollapsed(el, head, collapsed);
  head.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggle(el, head, panelId);
  });
  if (barMode) {
    title.addEventListener('click', (event) => {
      if (event.target.closest(`${INTERACTIVE}, .doorSheetGrab, .closeBtn`)) return;
      toggle(el, head, panelId);
    });
    title.addEventListener('keydown', (event) => {
      if (event.target !== title) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggle(el, head, panelId);
    });
  }
}

export function mountPanels(root) {
  const scope = root && root.querySelectorAll ? root : document;
  const nodes = [];
  if (scope.nodeType === 1 && scope.matches?.('[data-tn-panel]')) nodes.push(scope);
  scope.querySelectorAll('[data-tn-panel]').forEach((node) => nodes.push(node));
  nodes.forEach(enhance);
}

function savedRaw(panelId) {
  const store = storage();
  if (!store) return null;
  try { return store.getItem(panelStorageKey(currentUserId(), currentPage(), panelId)); }
  catch { return null; }
}

function boot() {
  mountPanels(document);
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      mountPanels(document);
    });
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  const media = matchMedia(NARROW_PANEL_QUERY);
  const onNarrow = () => {
    document.querySelectorAll('[data-tn-panel][data-tn-fold-ready]').forEach((el) => {
      if (savedRaw(el.getAttribute('data-tn-panel')) != null) return;
      const head = el.querySelector('.tnFoldHead');
      if (!head) return;
      const rank = el.getAttribute('data-tn-rank') === 'primary' ? 'primary' : 'secondary';
      applyCollapsed(el, head, collapseDecision({ rank, narrow: media.matches, saved: null }));
    });
  };
  if (media.addEventListener) media.addEventListener('change', onNarrow);
  else if (media.addListener) media.addListener(onNarrow);
}

if (typeof document !== 'undefined') {
  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot);
}

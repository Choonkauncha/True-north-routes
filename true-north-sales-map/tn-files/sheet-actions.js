import { bootFiles } from './store.js';
import { actionRow } from './ui.js';
import { canUsePhotoBank } from './logic.js';

let showPhotos = false;

function readDrawerLead(top) {
  const lines = (top.querySelector('.drawerAddr')?.innerText || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const rest = lines[1] || '';
  const match = rest.match(/^(.*),\s*([A-Za-z]{2})\s+(\S+)$/);
  return {
    id: top.dataset.leadId || '',
    name: top.querySelector('h2')?.textContent?.trim() || '',
    address: lines[0] || '',
    city: match?.[1] || '',
    state: match?.[2] || '',
    zip: match?.[3] || ''
  };
}

function placeRow(container, lead, className) {
  let row = container.querySelector(':scope > .tnSheetActions');
  const flag = showPhotos ? '1' : '0';
  if (row?.dataset.lead === (lead.id || '') && row.dataset.photos === flag) return;
  row?.remove();
  row = actionRow(lead, { photos: showPhotos });
  row.dataset.photos = flag;
  if (className) row.classList.add(className);
  container.prepend(row);
}

function syncDrawer() {
  const top = document.querySelector('#drawerContent .drawerTop');
  if (!top) return;
  const content = document.getElementById('drawerContent');
  const lead = readDrawerLead(top);
  let row = content.querySelector(':scope > .tnSheetActions');
  const flag = showPhotos ? '1' : '0';
  if (row?.dataset.lead === (lead.id || '') && row.dataset.photos === flag) return;
  row?.remove();
  row = actionRow(lead, { photos: showPhotos });
  row.dataset.photos = flag;
  top.insertAdjacentElement('afterend', row);
}

function syncDoor() {
  const footer = document.querySelector('#doorSheet .doorSheetFooter');
  const book = document.getElementById('doorSheetBook');
  if (!footer || !book) return;
  let id = '';
  try { id = new URL(book.getAttribute('href') || book.href, location.origin).searchParams.get('lead') || ''; } catch { id = ''; }
  placeRow(footer, {
    id,
    name: document.getElementById('doorSheetName')?.textContent?.trim() || '',
    address: document.getElementById('doorSheetAddress')?.textContent?.trim() || ''
  }, 'tnDoorActions');
}

function openHouseFromQuery() {
  const params = new URLSearchParams(location.search);
  const lead = params.get('lead');
  const q = params.get('q');
  if (!lead && !q) return;
  const search = document.getElementById('search');
  if (q && search && search.value !== q) {
    search.value = q;
    search.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const tryOpen = () => {
    if (!lead) return false;
    if (document.querySelector('#drawerContent .drawerTop')?.dataset.leadId === lead) return true;
    const row = document.querySelector(`.leadRow[data-id="${CSS.escape(lead)}"]`);
    if (!row) return false;
    row.click();
    return true;
  };
  if (tryOpen()) return;
  const list = document.getElementById('workList');
  if (!list) return;
  const watcher = new MutationObserver(() => { if (tryOpen()) watcher.disconnect(); });
  watcher.observe(list, { childList: true });
  setTimeout(() => watcher.disconnect(), 8000);
}

const drawer = document.getElementById('drawerContent');
if (drawer) new MutationObserver(() => syncDrawer()).observe(drawer, { childList: true });
const door = document.getElementById('doorSheet');
if (door) new MutationObserver(() => syncDoor()).observe(door, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'href'] });
syncDrawer();
syncDoor();
openHouseFromQuery();

bootFiles().then((ctx) => {
  showPhotos = canUsePhotoBank(ctx.rep?.role, ctx.mode);
  syncDrawer();
  syncDoor();
}).catch(() => {});

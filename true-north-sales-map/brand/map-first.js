/** Map workspace presentation. Route calculations remain owned by app.js. */
const sheet = document.getElementById('listSheet');
const addresses = document.getElementById('fieldAddressesTab');
const route = document.getElementById('fieldRouteTab');
const setView = view => {
  if (!sheet) return;
  sheet.dataset.fieldView = view;
  addresses?.setAttribute('aria-pressed', String(view === 'addresses'));
  route?.setAttribute('aria-pressed', String(view === 'route'));
};
addresses?.addEventListener('click', () => {
  setView('addresses');
  document.dispatchEvent(new CustomEvent('tn-map-panel-view', { detail: { view: 'addresses' } }));
});
route?.addEventListener('click', () => {
  setView('route');
  document.getElementById('routeBtn')?.click();
});
for (const id of ['routeBtn', 'mobileRoute', 'routeTrayBtn']) {
  document.getElementById(id)?.addEventListener('click', () => setView('route'), true);
}
const builder = document.getElementById('routePanel');
if (builder) new MutationObserver(() => {
  if (!builder.classList.contains('hidden')) setView('route');
}).observe(builder, { attributes: true, attributeFilter: ['class'] });
const options = document.getElementById('fieldMapTools');
options?.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    options.open = false;
    options.querySelector('summary')?.focus();
  }
});
document.addEventListener('pointerdown', event => {
  if (options?.open && !options.contains(event.target)) options.open = false;
});
// The existing role-aware menu supplies account, training, messages and management.
const labelWorkMenu = () => {
  const button = document.getElementById('tnMore');
  if (button && button.textContent !== 'Work') {
    button.textContent = 'Work';
    button.setAttribute('aria-label', 'Open work tools');
  }
};
labelWorkMenu();
new MutationObserver(labelWorkMenu).observe(document.querySelector('.topRight') || document.body, { childList: true, subtree: true });

const search = document.getElementById('search');
const phone = matchMedia('(max-width: 960px)');
const searchCopy = () => { if (search) search.placeholder = phone.matches ? 'Search address or ZIP' : 'Search an address, homeowner, or ZIP'; };
searchCopy();
phone.addEventListener('change', searchCopy);

// Reflect the app's verified route state; the presentation never infers readiness.
const tray = document.getElementById('routeTray');
let wasReady = false;
const syncRoutePresentation = () => {
  if (!tray) return;
  const ready = tray.dataset.routeReady === 'true';
  const building = tray.dataset.routeBuilding === 'true';
  sheet?.toggleAttribute('data-route-ready', ready);
  const count = document.getElementById('routeTrayCount');
  if (ready && count && tray.dataset.routeStopCount) count.textContent = tray.dataset.routeStopCount;
  const label = document.getElementById('routeTrayState');
  if (label) label.textContent = ready ? 'stops ready' : building ? 'stops building…' : 'houses queued';
  const hint = tray.querySelector('.routeReadyHint');
  if (hint) hint.hidden = !ready;
  if (ready && !wasReady) {
    const chooser = tray.querySelector('.fieldAddStops');
    if (chooser) chooser.open = false;
  }
  for (const id of ['routeBtn', 'mobileRoute']) {
    const button = document.getElementById(id);
    if (button?.firstChild?.nodeType === Node.TEXT_NODE) button.firstChild.textContent = ready ? 'Review route ' : 'Build route ';
  }
  const build = document.getElementById('routeTrayBtn');
  if (build) build.textContent = building ? 'Building route…' : ready ? 'Rebuild route' : 'Build route';
  wasReady = ready;
};
if (tray) new MutationObserver(syncRoutePresentation).observe(tray, { attributes: true, attributeFilter: ['data-route-ready', 'data-route-building', 'data-route-stop-count'] });
syncRoutePresentation();

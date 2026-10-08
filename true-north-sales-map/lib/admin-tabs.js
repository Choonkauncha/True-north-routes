const ADMIN_TABS = ['overview', 'team', 'appointments', 'homeowners', 'activity', 'territories', 'files', 'accounts'];

/** Map a /admin hash to a dashboard tab. Messages and the form library are not rail tabs. */
export function adminHashTarget(hash) {
  const raw = decodeURIComponent(String(hash || '').replace(/^#/, '')).split('&')[0];
  if (!raw) return { tab: '', messages: false, builder: false };
  if (raw === 'messages') return { tab: 'overview', messages: true, builder: false };
  if (raw === 'builder' || raw === 'library') return { tab: 'files', messages: false, builder: true };
  if (raw.startsWith('property=')) return { tab: 'files', messages: false, builder: false };
  if (ADMIN_TABS.includes(raw)) return { tab: raw, messages: false, builder: false };
  return { tab: '', messages: false, builder: false };
}

/** Bind dashboard tabs without replacing a handler another module already owns. */
export function bindAdminTabs(root, showTab) {
  root.querySelectorAll('[data-tab]').forEach((button) => {
    if (button.dataset.tnTabBound) return;
    button.dataset.tnTabBound = '1';
    button.addEventListener('click', () => showTab(button.dataset.tab));
  });
  root.querySelectorAll('[data-goto]').forEach((button) => {
    if (button.dataset.tnTabBound) return;
    button.dataset.tnTabBound = '1';
    button.addEventListener('click', () => showTab(button.dataset.goto));
  });
}

/** Presentation helpers: visible filter labels and complete, readable mobile table rows. */
const filterLabels = {
  teamSearch: 'Search team members', teamRole: 'Role', apptSearch: 'Search appointments', apptStage: 'Stage',
  homeSearch: 'Search homeowner requests', homeStatus: 'Status', activitySearch: 'Search activity',
  activityPerson: 'Person', activityType: 'Activity type',
};
const rowGroups = { apptTable: 'Appointments', teamTable: 'Team activity', homeTable: 'Homeowner requests', territoryTable: 'Territories' };
export function polishManagement(root = document) {
  for (const [id, text] of Object.entries(filterLabels)) {
    const input = root.getElementById(id), field = input?.closest('.filter');
    if (!field || field.querySelector(`label[for="${id}"]`)) continue;
    const label = root.createElement('label');
    label.htmlFor = id; label.className = 'managementFilterLabel'; label.textContent = text;
    field.prepend(label);
  }
  for (const [id, label] of Object.entries(rowGroups)) {
    const tbody = root.getElementById(id), table = tbody?.closest('table');
    if (!table) continue;
    table.dataset.managementCards = 'true'; table.setAttribute('role', 'table'); table.setAttribute('aria-label', label);
    const headings = [...table.querySelectorAll('thead th')];
    table.querySelector('thead')?.setAttribute('role', 'rowgroup'); tbody.setAttribute('role', 'rowgroup');
    headings.forEach(th => { th.scope = 'col'; th.setAttribute('role', 'columnheader'); });
    for (const tr of table.querySelectorAll('tr')) tr.setAttribute('role', 'row');
    for (const tr of tbody.rows) [...tr.cells].forEach((td, index) => {
      td.setAttribute('role', 'cell');
      if (td.colSpan === 1) td.dataset.label = headings[index]?.textContent.trim() || 'Details';
    });
    const wrap = table.closest('.tableWrap');
    if (wrap) { wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', `${label} records`); }
  }
}
if (typeof document !== 'undefined') {
  const main = document.querySelector('.dashMain');
  if (main) {
    let queued = false;
    new MutationObserver(() => {
      if (queued) return; queued = true;
      requestAnimationFrame(() => { queued = false; polishManagement(); });
    }).observe(main, { childList: true, subtree: true });
    document.addEventListener('tn-admin-view', () => polishManagement());
    polishManagement();
  }
}

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

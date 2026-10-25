/** One phone header; move original controls so their handlers and permissions survive. */
export function mountPhoneHeader(header, nav) {
  if (!header || !nav || header.querySelector('.phoneHomeLink')) return;
  document.body.classList.add('tn-phone-header');
  const css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = '/brand/phone-header.css'; document.head.append(css);
  const home = document.createElement('a');
  home.className = 'phoneHomeLink'; home.href = '/';
  home.setAttribute('aria-label', 'True North Restorations, back to the field map');
  home.innerHTML = '<img src="/brand/logo-full.webp" alt="" width="168" height="128"><span>True North<br>Restorations</span>';
  header.prepend(home);
  const field = document.createElement('div');
  field.id = 'phoneFieldOps'; field.className = 'phoneMenuTools';
  field.setAttribute('role', 'group'); field.setAttribute('aria-label', 'Shift and messages');
  nav.querySelector('.workspaceBrand')?.after(field);
  if (!field.isConnected) nav.prepend(field);
  const actions = document.createElement('div');
  actions.className = 'phoneMenuActions'; actions.setAttribute('role', 'group');
  actions.setAttribute('aria-label', 'Page and account tools'); nav.append(actions);
  const moved = [...header.querySelectorAll(':scope > .headerLinks, :scope > .atlasJump')].map(node => {
    const marker = document.createComment('Desktop header control'); node.before(marker); return {node, marker};
  });
  const phone = matchMedia('(max-width:1100px)');
  const place = () => {
    for (const {node, marker} of moved) {
      if (phone.matches) actions.append(node);
      else marker.after(node);
    }
    document.dispatchEvent(new CustomEvent('tn-header-layout'));
  };
  phone.addEventListener('change', place); place();
}

// GPS has independent data/auth code but uses the same phone header presentation.
const standalonePhonePage = document.body.classList.contains('gpsPage') || /\/form-print(?:\.html)?$/.test(location.pathname);
if (standalonePhonePage) {
  const header = document.querySelector('.tnHeader');
  const nav = document.createElement('nav');
  nav.id = 'phoneSections'; nav.className = 'phoneStandaloneNav';
  nav.setAttribute('aria-label', 'Sections');
  nav.innerHTML = '<button type="button" class="phoneNavClose">Close Sections ×</button><a class="workspaceBrand" href="/">Field map</a>';
  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.className = 'workspaceMenuBtn phoneStandaloneToggle';
  toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg><span>Sections</span>';
  toggle.setAttribute('aria-controls', nav.id); toggle.setAttribute('aria-expanded', 'false');
  header.append(toggle); header.after(nav);
  const scrim = document.createElement('button');
  scrim.type = 'button'; scrim.className = 'phoneStandaloneScrim'; scrim.hidden = true;
  scrim.setAttribute('aria-label', 'Close Sections'); document.body.append(scrim);
  const close = () => { nav.classList.remove('isOpen'); toggle.setAttribute('aria-expanded', 'false'); scrim.hidden = true; };
  toggle.onclick = () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    if (!open) { close(); toggle.focus(); return; }
    nav.classList.add('isOpen'); toggle.setAttribute('aria-expanded', 'true'); scrim.hidden = false;
    nav.querySelector('button').focus();
  };
  nav.querySelector('.phoneNavClose').onclick = scrim.onclick = () => { close(); toggle.focus(); };
  nav.addEventListener('click', event => { if (event.target.closest('a, #tnMsgBtn')) close(); });
  nav.addEventListener('keydown', event => {
    if (event.key === 'Escape') { close(); toggle.focus(); }
    if (event.key !== 'Tab') return;
    const focusable = [...nav.querySelectorAll('a,button')].filter(node => !node.hidden && node.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  matchMedia('(max-width:1100px)').addEventListener('change', close);
  mountPhoneHeader(header, nav);
}

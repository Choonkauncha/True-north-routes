/** Prefetch same-origin pages on hover, touch, and for the likely next screens. */
import { loaderHoldHtml, showTransitionLoader } from './loader.js';
import { readStoredUser } from '../lib/management-gate.js';

(function holdForPasswordCheck() {
  try {
    if (/\/reset-password\/?$/.test(location.pathname) || location.pathname.endsWith('/reset-password.html')) return;
    if (!readStoredUser(localStorage) || document.getElementById('tnPasswordHold')) return;
    const hold = document.createElement('div');
    hold.id = 'tnPasswordHold';
    hold.className = 'tnLoader';
    hold.setAttribute('role', 'status');
    hold.setAttribute('aria-busy', 'true');
    hold.innerHTML = loaderHoldHtml();
    (document.body || document.documentElement).appendChild(hold);
  } catch { /* storage unavailable */ }
}());
const gate = document.createElement('script');
gate.type = 'module';
gate.src = '/tn-files/password-gate.js';
document.head.appendChild(gate);

const LIKELY = {
  '/': ['/setter.html', '/rep.html', '/account.html', '/admin.html', '/homeowner.html', '/forms.html'],
  '/index.html': ['/setter.html', '/rep.html', '/account.html', '/admin.html', '/homeowner.html', '/forms.html'],
  '/setter.html': ['/', '/forms.html', '/rep.html', '/admin.html', '/account.html', '/homeowner.html'],
  '/rep.html': ['/', '/setter.html', '/forms.html', '/photo.html', '/account.html'],
  '/forms.html': ['/rep.html', '/', '/account.html', '/photo.html'],
  '/admin.html': ['/', '/setter.html', '/account.html', '/shifts.html', '/homeowner.html', '/forms.html'],
  '/admin': ['/', '/setter.html', '/account.html', '/shifts.html', '/homeowner.html'],
  '/account.html': ['/', '/admin.html', '/setter.html', '/rep.html'],
  '/homeowner.html': ['/', '/setter.html'],
  '/photo.html': ['/rep.html', '/', '/account.html'],
  '/files.html': ['/admin.html', '/', '/account.html'],
  '/shifts.html': ['/admin.html', '/', '/account.html', '/setter.html'],
  '/form-print.html': ['/rep.html', '/account.html', '/'],
  '/reset-password.html': ['/', '/account.html']
};

const queued = new Set();

function prefetch(href) {
  let url;
  try { url = new URL(href, location.href); }
  catch { return; }
  if (url.origin !== location.origin) return;
  if (url.pathname === location.pathname) return;
  const key = url.pathname + url.search;
  if (queued.has(key)) return;
  queued.add(key);
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.href = key;
  document.head.appendChild(link);
}

function fromLink(event) {
  const anchor = event.target?.closest?.('a[href]');
  if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
  prefetch(anchor.href);
}

document.addEventListener('pointerover', fromLink, { passive: true });
document.addEventListener('touchstart', fromLink, { passive: true, capture: true });
document.addEventListener('focusin', fromLink);

const warm = () => (LIKELY[location.pathname] || []).forEach(prefetch);
if ('requestIdleCallback' in window) requestIdleCallback(warm);
else addEventListener('load', warm, { once: true });

function isPageNavigation(anchor, event) {
  if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return false;
  if (event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  let url;
  try { url = new URL(anchor.href, location.href); }
  catch { return false; }
  if (url.origin !== location.origin) return false;
  if (url.pathname === location.pathname && url.search === location.search) return false;
  return true;
}

document.addEventListener('click', (event) => {
  const anchor = event.target?.closest?.('a[href]');
  if (!isPageNavigation(anchor, event)) return;
  showTransitionLoader(document);
}, true);

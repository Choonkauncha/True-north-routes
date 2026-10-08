/** Prefetch same-origin pages on hover, touch, and for the likely next screens. */
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

/** Shared True North loader: stationary emblem, blue line tracing the outline. */

export const LOADER_MARK_HTML = '<div class="bootMark"><img class="bootEmblem" src="/brand/logo-emblem.webp" alt="" width="256" height="259"><svg class="bootOutline" viewBox="0 0 256 259" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false"><path class="bootOutlineTrack" pathLength="100" d="M99.7 0.7 C98.3 2 99 11.7 100.5 13 C101.6 13.9 102 16.4 102 22.5 C102 28.6 101.6 31.1 100.5 32 C99.5 32.8 99 35.1 99 39.1 L99 45 L106.1 45 C112.3 45 113.1 45.2 112.6 46.7 C112.3 47.7 111.6 50.6 110.9 53.2 C109.9 57.5 109.4 58.1 106.1 59 C101.2 60.4 101 60.3 98.9 57.6 C96.6 54.6 91 52.6 86.7 53.3 C84.7 53.5 82.5 53 80.5 51.9 C78.9 50.8 76.9 50 76.1 50 C75.4 50 73.5 48.9 71.8 47.5 C70.2 46.1 68.2 45 67.4 45 C66.6 45 63.5 43.6 60.4 41.9 C55.7 39.2 54.2 38.8 50.2 39.3 C47.6 39.6 37.9 40.8 28.5 41.9 C19.2 43 8.9 44.2 5.8 44.6 L0 45.3 L0 152.1 L0 259 L128 259 L256 259 L256 145.9 L256 32.9 L253.3 34.3 C251.7 35.1 245.8 38.1 240 41 C231.6 45.2 227.9 47.8 221.5 54 C212.5 62.8 208.4 64.4 203.9 60.9 C202.6 59.9 201 59 200.4 59 C199.8 59 197.2 57.9 194.6 56.5 C189 53.5 187.5 53.4 183.5 55.9 C181.8 56.9 178.7 58.3 176.5 59 C174.3 59.7 169.3 62.2 165.4 64.6 C156.7 70 156 70 150.2 64.9 C147.6 62.6 143.5 60 141.1 59.1 C137 57.6 136.5 57.1 135.3 52.5 C133.4 45.1 133.4 45.1 139.8 44.8 L145.5 44.5 L145.8 29.5 C146 17.8 146.4 14.2 147.6 12.9 C148.7 11.7 149 9.6 148.8 5.9 L148.5 0.5 L135.8 0.2 C126.2 0 123 0.2 123 1.2 C123 2.1 122.7 2.1 121.8 1.2 C120.5 -0.1 100.9 -0.6 99.7 0.7 Z"/><path class="bootOutlineTravel" pathLength="100" d="M99.7 0.7 C98.3 2 99 11.7 100.5 13 C101.6 13.9 102 16.4 102 22.5 C102 28.6 101.6 31.1 100.5 32 C99.5 32.8 99 35.1 99 39.1 L99 45 L106.1 45 C112.3 45 113.1 45.2 112.6 46.7 C112.3 47.7 111.6 50.6 110.9 53.2 C109.9 57.5 109.4 58.1 106.1 59 C101.2 60.4 101 60.3 98.9 57.6 C96.6 54.6 91 52.6 86.7 53.3 C84.7 53.5 82.5 53 80.5 51.9 C78.9 50.8 76.9 50 76.1 50 C75.4 50 73.5 48.9 71.8 47.5 C70.2 46.1 68.2 45 67.4 45 C66.6 45 63.5 43.6 60.4 41.9 C55.7 39.2 54.2 38.8 50.2 39.3 C47.6 39.6 37.9 40.8 28.5 41.9 C19.2 43 8.9 44.2 5.8 44.6 L0 45.3 L0 152.1 L0 259 L128 259 L256 259 L256 145.9 L256 32.9 L253.3 34.3 C251.7 35.1 245.8 38.1 240 41 C231.6 45.2 227.9 47.8 221.5 54 C212.5 62.8 208.4 64.4 203.9 60.9 C202.6 59.9 201 59 200.4 59 C199.8 59 197.2 57.9 194.6 56.5 C189 53.5 187.5 53.4 183.5 55.9 C181.8 56.9 178.7 58.3 176.5 59 C174.3 59.7 169.3 62.2 165.4 64.6 C156.7 70 156 70 150.2 64.9 C147.6 62.6 143.5 60 141.1 59.1 C137 57.6 136.5 57.1 135.3 52.5 C133.4 45.1 133.4 45.1 139.8 44.8 L145.5 44.5 L145.8 29.5 C146 17.8 146.4 14.2 147.6 12.9 C148.7 11.7 149 9.6 148.8 5.9 L148.5 0.5 L135.8 0.2 C126.2 0 123 0.2 123 1.2 C123 2.1 122.7 2.1 121.8 1.2 C120.5 -0.1 100.9 -0.6 99.7 0.7 Z"/></svg></div>';

export function loaderMarkHtml() {
  return LOADER_MARK_HTML;
}

export function loaderHoldHtml(label = 'Loading') {
  return `<p class="tnLoaderSr">${label}</p>${LOADER_MARK_HTML}`;
}

export function ensureLoader(doc = document) {
  let hold = doc.getElementById('tnBootHold');
  if (!hold) {
    hold = doc.createElement('div');
    hold.id = 'tnBootHold';
    hold.className = 'tnLoader';
    hold.setAttribute('role', 'status');
    hold.setAttribute('aria-live', 'polite');
    hold.setAttribute('aria-busy', 'true');
    (doc.body || doc.documentElement).prepend(hold);
  }
  if (!hold.querySelector('.bootOutlineTravel')) hold.innerHTML = loaderHoldHtml();
  hold.classList.remove('isGone', 'isDone');
  hold.hidden = false;
  return hold;
}

export function releaseBootHold(doc = document) {
  doc.documentElement.classList.remove('tn-hold-login');
  const hold = doc.getElementById('tnBootHold');
  if (hold) {
    hold.classList.add('isGone');
    hold.setAttribute('aria-busy', 'false');
  }
}

export function revealApp(doc = document) {
  doc.documentElement.classList.remove('tn-signed-out', 'tn-hold-login');
  doc.querySelectorAll('.tnSignInScreen').forEach((el) => el.classList.remove('tnSignInScreen'));
  releaseBootHold(doc);
}

export function mountSignInScreen(container) {
  if (!container) return;
  const doc = container.ownerDocument || document;
  doc.documentElement.classList.add('tn-signed-out');
  doc.documentElement.classList.remove('tn-hold-login');
  const boot = doc.getElementById('tnBootHold');
  if (boot) boot.classList.add('isGone');
  container.classList.add('tnSignInScreen');
}

/** Cover the page immediately, before sign-out finishes, so houses and names cannot show through. */
export function coverForSignOut(doc = document) {
  doc.documentElement.classList.add('tn-signed-out', 'tn-hold-login');
  const boot = ensureLoader(doc);
  boot.classList.remove('isGone', 'isDone');
  doc.querySelectorAll('#app, #tnFilesRoot, #shiftsApp, #main').forEach((el) => {
    if (el.classList.contains('tnSignInScreen')) el.classList.remove('tnSignInScreen');
    if (el.id !== 'tnBootHold') el.replaceChildren();
  });
  return boot;
}

export function showTransitionLoader(doc = document) {
  let hold = doc.getElementById('tnTransition');
  if (!hold) {
    hold = doc.createElement('div');
    hold.id = 'tnTransition';
    hold.className = 'tnLoader';
    hold.setAttribute('role', 'status');
    hold.setAttribute('aria-busy', 'true');
    hold.innerHTML = loaderHoldHtml();
    (doc.body || doc.documentElement).appendChild(hold);
  }
  doc.querySelectorAll('.tn-vt-loader').forEach((el) => el.classList.remove('tn-vt-loader'));
  hold.classList.add('tn-vt-loader');
  hold.classList.remove('isGone', 'isDone');
  hold.hidden = false;
  return hold;
}

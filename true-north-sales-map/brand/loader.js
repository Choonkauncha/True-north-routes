/** Shared True North loader: stationary full logo, blue line tracing its complete exterior. */

export const LOADER_MARK_HTML = '<div class="bootMark"><img class="bootEmblem" src="/brand/logo-full.webp" alt="" width="960" height="724"><svg class="bootOutline" viewBox="0 0 960 724" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false"><path class="bootOutlineTrack" pathLength="100" d="M430 1 L469 1 L473 6 L476 1 L523 3 L523 20 L517 28 L517 85 L494 86 L494 90 L500 112 L516 116 L535 133 L597 104 L606 105 L632 121 L648 119 L681 87 L752 50 L824 23 L841 26 L845 239 L842 258 L830 268 L839 287 L839 305 L832 314 L832 326 L816 362 L813 398 L802 426 L751 475 L768 488 L946 488 L933 514 L933 523 L956 716 L910 687 L821 694 L801 721 L545 712 L157 718 L141 694 L60 690 L45 690 L4 716 L52 547 L37 544 L4 488 L125 487 L130 105 L140 98 L344 75 L398 104 L419 104 L431 116 L448 113 L455 86 L429 85 L429 64 L435 58 Z"/><path class="bootOutlineTravel" pathLength="100" d="M430 1 L469 1 L473 6 L476 1 L523 3 L523 20 L517 28 L517 85 L494 86 L494 90 L500 112 L516 116 L535 133 L597 104 L606 105 L632 121 L648 119 L681 87 L752 50 L824 23 L841 26 L845 239 L842 258 L830 268 L839 287 L839 305 L832 314 L832 326 L816 362 L813 398 L802 426 L751 475 L768 488 L946 488 L933 514 L933 523 L956 716 L910 687 L821 694 L801 721 L545 712 L157 718 L141 694 L60 690 L45 690 L4 716 L52 547 L37 544 L4 488 L125 487 L130 105 L140 98 L344 75 L398 104 L419 104 L431 116 L448 113 L455 86 L429 85 L429 64 L435 58 Z"/></svg></div>';

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

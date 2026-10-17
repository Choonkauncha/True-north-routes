import { putPending, leadQuery } from './store.js';
import { forgotPasswordMarkup } from './password-reset.js';
import { coverForSignOut, mountSignInScreen, revealApp } from '../brand/loader.js';

export { revealApp };

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

export function el(html) {
  const wrap = document.createElement('div');
  wrap.innerHTML = html.trim();
  return wrap.firstElementChild;
}

export async function compressImage(file, maxEdge = 1600, quality = 0.72) {
  if (!file || !String(file.type || '').startsWith('image/')) throw new Error('Choose a photo.');
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('This photo did not open. Take it again with the camera.'); });
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('Could not prepare that photo.');
  if (blob.size > 4.5 * 1024 * 1024) throw new Error('That photo is still too large.');
  return blob;
}

export function mountSignature(canvas) {
  const ctx = canvas.getContext('2d');
  let drawing = false;
  let dirty = false;
  function fit() {
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const snapshot = dirty ? canvas.toDataURL() : '';
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    ctx.lineWidth = 2.4 * ratio;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0c1424';
    if (snapshot) {
      const image = new Image();
      image.onload = () => ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      image.src = snapshot;
    }
  }
  fit();
  const point = (event) => {
    const rect = canvas.getBoundingClientRect();
    const source = event.touches ? event.touches[0] : event;
    return {
      x: (source.clientX - rect.left) * canvas.width / rect.width,
      y: (source.clientY - rect.top) * canvas.height / rect.height
    };
  };
  const start = (event) => { drawing = true; dirty = true; const p = point(event); ctx.beginPath(); ctx.moveTo(p.x, p.y); event.preventDefault(); };
  const move = (event) => { if (!drawing) return; const p = point(event); ctx.lineTo(p.x, p.y); ctx.stroke(); event.preventDefault(); };
  const end = () => { drawing = false; };
  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  if (canvas.getBoundingClientRect().width < 2) requestAnimationFrame(fit);
  return {
    clear() { dirty = false; ctx.clearRect(0, 0, canvas.width, canvas.height); },
    isBlank() { return !dirty; },
    toBlob() { return new Promise((resolve) => canvas.toBlob(resolve, 'image/png')); },
    destroy() { window.removeEventListener('pointerup', end); }
  };
}

export function houseBackHref(lead) {
  const params = leadQuery(lead);
  const address = lead?.address || '';
  if (address) params.set('q', address);
  const query = params.toString();
  return query ? `/?${query}` : '/';
}

/** House sheet: Add Photo, Fill Form, View photos. Door sheet: one outline row, no gallery link. */
export function actionRow(lead, { photos = true, variant = 'house' } = {}) {
  const query = leadQuery(lead).toString();
  const formHref = `/forms.html${query ? `?${query}` : ''}`;
  const viewHref = `/photo.html${query ? `?${query}` : ''}`;
  const door = variant === 'door';
  const row = el(door
    ? `<div class="tnSheetActions tnDoorActions" data-lead="${esc(lead?.id || '')}" data-v="door">
    <label class="tnTap tnOutline" data-photo-only>Add Photo<input type="file" accept="image/*" capture="environment"></label>
    <a class="tnTap tnOutline" href="${esc(formHref)}">Fill Form</a>
  </div>`
    : `<div class="tnSheetActions" data-lead="${esc(lead?.id || '')}" data-v="1">
    <label class="tnTap primary" data-photo-only>Add Photo<input type="file" accept="image/*" capture="environment"></label>
    <a class="tnTap dark" href="${esc(formHref)}">Fill Form</a>
    <a class="tnTap tnWide" data-photo-only href="${esc(viewHref)}">View photos</a>
  </div>`);
  const input = row.querySelector('input');
  input?.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    input.disabled = true;
    try {
      await putPending(file);
      location.href = `/photo.html?${query}${query ? '&' : ''}incoming=1`;
    } catch (error) {
      input.disabled = false;
      alert(error.message || 'Could not open that photo.');
    }
  });
  if (!photos) row.querySelectorAll('[data-photo-only]').forEach((node) => node.remove());
  return row;
}

export function bindSignOut(ctx, button) {
  if (!button) return;
  if (ctx.mode === 'local') button.classList.add('tnHide');
  button.onclick = async () => {
    coverForSignOut(document);
    const { signOut } = await import('./store.js');
    await signOut(ctx);
    location.reload();
  };
}

export function mountSignIn(container) {
  mountSignInScreen(container);
  if (container) container.innerHTML = signInCard();
}

// One-line role subtitle for the shared sign-in card, based on the page being opened.
const SIGN_IN_ROLES = {
  '/training': 'Training: lessons and the voice coach for every rep.',
  '/forms': 'Forms: inspections and paperwork for every rep.',
  '/files': 'Documents: receipts, estimates, and saved forms.',
  '/photo': 'Photos: roof and property photos for reps.',
  '/rep': 'Reps: your inspections, photos, and forms.',
  '/account': 'Account: your profile and password.',
  '/form-print': 'Forms: print a saved form.'
};
export function signInRole(path = typeof location === 'undefined' ? '/' : location.pathname) {
  const key = String(path || '/').replace(/\.html$/, '').replace(/\/$/, '') || '/';
  return SIGN_IN_ROLES[key] || 'Field team sign-in for True North Restorations.';
}

export function signInCard() {
  return `<div class="authCard card"><div class="pad"><img class="signInLogo" src="/brand/logo-full.webp" alt="True North Restorations" width="320" height="242"><div class="eyebrow">TRUE NORTH RESTORATIONS</div><h1>Sign in to True North</h1><p class="tnSignInRole">${esc(signInRole())}</p><form id="tnLogin"><div class="field"><label>Email</label><input id="tnEmail" type="email" required autocomplete="email"></div><div class="field" style="margin-top:10px"><label>Password</label><input id="tnPassword" type="password" required autocomplete="current-password"></div><button class="tnTap primary tnSignInBtn" type="submit">Sign in</button><div id="tnLoginError" class="tnError"></div></form>${forgotPasswordMarkup()}<div class="tnSignInInstall" data-install-section hidden><button type="button" class="tnInstallBtn" data-install-app hidden>Install app</button><p>Open True North from your Home Screen like any other app.</p></div></div></div>`;
}

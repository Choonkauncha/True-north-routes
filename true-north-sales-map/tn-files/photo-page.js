import { bootFiles, signIn, getLead, listPhotos, savePhoto, takePending, photosForLead, plainError } from './store.js';
import { compressImage, esc, bindSignOut, signInCard, houseBackHref } from './ui.js';
import { canUsePhotoBank, formatAddress } from './logic.js';

const app = document.getElementById('app');
const params = new URLSearchParams(location.search);
let ctx;
let lead = leadFromParams();
let pendingBlob = null;
let previewUrl = '';

function leadFromParams() {
  if (!params.get('lead') && !params.get('address') && !params.get('name')) return null;
  return {
    id: params.get('lead') || '',
    name: params.get('name') || '',
    address: params.get('address') || '',
    city: params.get('city') || '',
    state: params.get('state') || '',
    zip: params.get('zip') || ''
  };
}

function backHref() { return houseBackHref(lead); }

async function start() {
  ctx = await bootFiles();
  bindSignOut(ctx, document.getElementById('signOut'));
  if (ctx.mode === 'cloud' && !ctx.session) return renderSignIn();
  if (ctx.mode === 'cloud' && !canUsePhotoBank(ctx.rep?.role)) return renderBlocked();
  if (params.get('lead')) {
    const found = await getLead(ctx, params.get('lead'));
    if (found) lead = { ...lead, ...found };
  }
  if (!lead?.id && !lead?.address) {
    location.replace('/rep.html');
    return;
  }
  if (params.get('incoming') === '1') {
    const pending = await takePending();
    if (pending?.blob) {
      try {
        pendingBlob = await compressImage(pending.blob);
        previewUrl = URL.createObjectURL(pendingBlob);
      } catch (error) {
        app.innerHTML = shell(`<p class="tnError">${esc(error.message)}</p><a class="tnTap dark" href="${esc(location.pathname + location.search.replace(/incoming=1&?/, ''))}">Try again</a>`);
        return;
      }
    }
  }
  render();
}

function shell(inner) {
  const local = ctx?.mode === 'local' ? '<div class="tnBanner">Saved on this phone until Supabase storage is connected.</div>' : '';
  return `${local}<a class="tnTap" href="${esc(backHref())}">Back to this house</a><div style="height:12px"></div>${inner}`;
}

function renderSignIn() {
  app.innerHTML = signInCard();
  document.getElementById('tnLogin').onsubmit = async (event) => {
    event.preventDefault();
    const error = document.getElementById('tnLoginError');
    error.textContent = 'Signing in…';
    try {
      await signIn(ctx, document.getElementById('tnEmail').value, document.getElementById('tnPassword').value);
      start();
    } catch (err) { error.textContent = err.message || 'Could not sign in.'; }
  };
}

function renderBlocked() {
  const query = location.search.replace(/incoming=1&?/, '');
  app.innerHTML = shell(`<h1 class="tnTitle">Photos are for sales reps</h1><p class="tnSub">Setters can still fill forms for this house.</p><a class="tnTap primary" href="/forms.html${esc(query)}">Fill Form</a>`);
}

function render() {
  const title = lead?.address || lead?.name || 'Photo';
  const place = formatAddress(lead);
  if (previewUrl) {
    app.innerHTML = shell(`<h1 class="tnTitle">Save this photo?</h1><p class="tnSub">${esc(place || title)}</p><img class="tnPreview" alt="Photo to save" src="${previewUrl}"><label class="tnLabel" for="caption">Note</label><input class="tnInput" id="caption" placeholder="Front of roof"><div class="tnSticky"><button class="tnTap primary" id="savePhoto" type="button">Save photo</button><label class="tnTap">Retake<input id="retake" type="file" accept="image/*" capture="environment"></label></div><p id="photoError" class="tnError"></p>`);
    document.getElementById('savePhoto').onclick = onSave;
    document.getElementById('retake').onchange = onPick;
    return;
  }
  app.innerHTML = shell(`<h1 class="tnTitle">${esc(title)}</h1><p class="tnSub">${esc(lead?.name || 'Photos for this house')}</p><label class="tnTap primary">Take photo<input id="take" type="file" accept="image/*" capture="environment"></label><div id="gallery" class="tnGallery" style="margin-top:12px"></div>`);
  document.getElementById('take').onchange = onPick;
  loadGallery();
}

async function onPick(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    pendingBlob = await compressImage(file);
    previewUrl = URL.createObjectURL(pendingBlob);
    render();
  } catch (error) {
    const slot = document.getElementById('photoError');
    if (slot) slot.textContent = error.message;
    else alert(error.message);
  }
}

async function onSave() {
  const button = document.getElementById('savePhoto');
  const error = document.getElementById('photoError');
  button.disabled = true;
  error.textContent = 'Saving…';
  try {
    await savePhoto(ctx, { lead, blob: pendingBlob, caption: document.getElementById('caption').value.trim() });
    pendingBlob = null;
    previewUrl = '';
    renderSaved();
  } catch (err) {
    button.disabled = false;
    error.textContent = plainError(err);
  }
}

async function renderSaved() {
  const query = new URLSearchParams({ lead: lead?.id || '', name: lead?.name || '', address: lead?.address || '', city: lead?.city || '', state: lead?.state || '', zip: lead?.zip || '' }).toString();
  app.innerHTML = shell(`<div class="tnSuccess"><img class="brandLogo" src="/brand/logo-header.png" alt="" width="40" height="40"><h1 class="tnTitle">Photo saved</h1><p class="tnSub">${esc(formatAddress(lead) || 'This house')}</p></div><div class="tnStack"><label class="tnTap primary">Add another<input id="take" type="file" accept="image/*" capture="environment"></label><a class="tnTap dark" href="/forms.html?${esc(query)}">Fill Form</a></div><div id="gallery" class="tnGallery" style="margin-top:14px"></div>`);
  document.getElementById('take').onchange = onPick;
  loadGallery();
}

async function loadGallery() {
  const gallery = document.getElementById('gallery');
  if (!gallery) return;
  try {
    const photos = photosForLead(await listPhotos(ctx), lead);
    gallery.innerHTML = photos.length ? photos.map((photo) => `<button type="button" data-src="${esc(photo.url)}"><img alt="${esc(photo.caption || 'House photo')}" src="${esc(photo.url)}"></button>`).join('') : '<p class="tnSub">No photos yet.</p>';
    gallery.querySelectorAll('button').forEach((button) => { button.onclick = () => openLightbox(button.dataset.src); });
  } catch (error) {
    gallery.innerHTML = `<p class="tnError">${esc(plainError(error))}</p>`;
  }
}

function openLightbox(src) {
  const box = document.createElement('div');
  box.className = 'tnLightbox';
  box.innerHTML = `<button class="tnTap" type="button">Close</button><img alt="House photo" src="${esc(src)}">`;
  box.querySelector('button').onclick = () => box.remove();
  document.body.append(box);
}

start();

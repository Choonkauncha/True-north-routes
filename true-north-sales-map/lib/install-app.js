// "Install app" for True North Maps.
// Chrome, Edge and Android: the browser's beforeinstallprompt event is kept and the
// button calls prompt(). iPhone and iPad Safari: the button opens a short sheet
// (Share, then Add to Home Screen). iOS in another browser: the sheet says to open
// the page in Safari. The button hides once the app is installed or running standalone.
// Any element with [data-install-app] is managed here.

const IOS_OTHER_BROWSER = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|YaBrowser|DuckDuckGo|FBAN|FBAV|Instagram|Line\/|Snapchat|LinkedInApp|Twitter|MicroMessenger/;

export function isIOS({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
}

// 'prompt' (browser install dialog), 'ios-safari' (Share sheet steps),
// 'ios-other' (open in Safari), 'installed', or 'none' (nothing useful to offer).
export function installMode({ userAgent = '', platform = '', maxTouchPoints = 0, standalone = false, hasPrompt = false, installed = false } = {}) {
  if (standalone || installed) return 'installed';
  if (hasPrompt) return 'prompt';
  if (isIOS({ userAgent, platform, maxTouchPoints })) return IOS_OTHER_BROWSER.test(userAgent) ? 'ios-other' : 'ios-safari';
  return 'none';
}

const SHARE_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 11H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ADD_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8.5v7M8.5 12h7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const SAFARI_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="m15.5 8.5-2 5-5 2 2-5z" fill="currentColor"/></svg>';

export function sheetContent(mode) {
  if (mode === 'ios-other') {
    return {
      title: 'Open in Safari to install',
      steps: [
        { icon: SAFARI_ICON, text: 'Copy this link and open it in <b>Safari</b>.' },
        { icon: SHARE_ICON, text: 'In Safari, tap <b>Share</b>.' },
        { icon: ADD_ICON, text: 'Tap <b>Add to Home Screen</b>, then <b>Add</b>.' }
      ],
      copy: true
    };
  }
  return {
    title: 'Add True North Maps to your Home Screen',
    steps: [
      { icon: SHARE_ICON, text: 'Tap <b>Share</b> in the Safari toolbar.' },
      { icon: ADD_ICON, text: 'Scroll down and tap <b>Add to Home Screen</b>.' },
      { icon: '<span class="tnInstallStepNum" aria-hidden="true">3</span>', text: 'Tap <b>Add</b>. True North opens from your Home Screen.' }
    ],
    copy: false
  };
}

const STYLE = `.tnInstallBtn[hidden],[data-install-app][hidden]{display:none!important}
.tnInstallSheet{position:fixed;inset:0;z-index:2147483600;display:flex;align-items:flex-end;justify-content:center;background:rgba(7,11,20,.62);padding:12px;padding-bottom:calc(12px + env(safe-area-inset-bottom))}
.tnInstallSheet[hidden]{display:none}
.tnInstallCard{width:min(440px,100%);background:#ffffff;color:#122033;border-radius:18px;padding:20px 18px 16px;box-shadow:0 18px 50px rgba(7,11,20,.4);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
html body #tnInstallSheet.tnInstallSheet .tnInstallCard h2{margin:0 0 4px!important;font-size:20px!important;line-height:1.25!important;color:#0c1424!important;letter-spacing:0!important;text-transform:none!important}
.tnInstallCard>p{margin:0 0 12px;color:#3d5160;font-size:15px;line-height:1.4}
.tnInstallCard ol{list-style:none;margin:0 0 14px;padding:0;display:grid;gap:10px}
.tnInstallCard li{display:flex;align-items:center;gap:12px;font-size:16px;line-height:1.35}
.tnInstallStepIcon{flex:none;display:grid;place-items:center;width:40px;height:40px;border-radius:10px;background:#e8f0ff;color:#1554d6}
.tnInstallStepNum{font-weight:900;font-size:17px}
.tnInstallActions{display:grid;gap:8px}
.tnInstallActions button{min-height:48px;border-radius:12px;font-size:16px;font-weight:800;cursor:pointer}
.tnInstallDone{border:0;background:#1e6bff;color:#ffffff}
.tnInstallCopy{border:1px solid #b7c5d1;background:#ffffff;color:#122033}
.tnInstallActions button:focus-visible{outline:3px solid #32c7f8;outline-offset:2px}
.tnInstallNote{min-height:1.2em;margin:8px 0 0;color:#2E6B4B;font-weight:700;font-size:14px}`;

function browserEnv() {
  const nav = window.navigator;
  return {
    userAgent: nav.userAgent || '', platform: nav.platform || '', maxTouchPoints: nav.maxTouchPoints || 0,
    standalone: Boolean(window.matchMedia?.('(display-mode: standalone)').matches || nav.standalone === true)
  };
}

export function mountInstallApp(win = window) {
  const doc = win.document;
  if (win.__tnInstall) return win.__tnInstall;
  let pending = win.__tnInstallPrompt || null, installed = false, frame = 0;
  const mode = () => installMode({ ...browserEnv(), hasPrompt: Boolean(pending), installed });
  if (!doc.getElementById('tnInstallStyle')) {
    const style = doc.createElement('style'); style.id = 'tnInstallStyle'; style.textContent = STYLE; doc.head.append(style);
  }
  function refresh() {
    const current = mode();
    for (const button of doc.querySelectorAll('[data-install-app]')) {
      const show = current !== 'installed' && current !== 'none';
      button.hidden = !show;
      button.dataset.installMode = current;
      const help = button.closest('[data-install-section]');
      if (help) help.hidden = !show;
    }
    return current;
  }
  const schedule = () => { if (frame) return; frame = win.requestAnimationFrame(() => { frame = 0; refresh(); }); };
  function closeSheet(sheet, opener) { sheet.remove(); opener?.focus?.(); }
  function openSheet(current, opener) {
    doc.getElementById('tnInstallSheet')?.remove();
    const content = sheetContent(current);
    const sheet = doc.createElement('div');
    sheet.id = 'tnInstallSheet'; sheet.className = 'tnInstallSheet';
    sheet.innerHTML = `<div class="tnInstallCard" role="dialog" aria-modal="true" aria-labelledby="tnInstallTitle"><h2 id="tnInstallTitle">${content.title}</h2><p>Install it once, then open True North like any other app.</p><ol>${content.steps.map(step => `<li><span class="tnInstallStepIcon">${step.icon}</span><span>${step.text}</span></li>`).join('')}</ol><div class="tnInstallActions">${content.copy ? '<button type="button" class="tnInstallCopy" data-install-copy>Copy link</button>' : ''}<button type="button" class="tnInstallDone" data-install-close>Got it</button></div><p class="tnInstallNote" role="status"></p></div>`;
    // Inside a sign-in overlay, attach there so page-hiding rules cannot hide the sheet.
    (opener?.closest?.('#loginModal, .tnSignInScreen, [role="dialog"]') || doc.body).append(sheet);
    sheet.addEventListener('click', event => {
      if (event.target === sheet || event.target.closest('[data-install-close]')) closeSheet(sheet, opener);
      if (event.target.closest('[data-install-copy]')) {
        const note = sheet.querySelector('.tnInstallNote');
        Promise.resolve(win.navigator.clipboard?.writeText(win.location.href)).then(() => { note.textContent = 'Link copied. Paste it into Safari.'; }, () => { note.textContent = win.location.href; });
      }
    });
    sheet.addEventListener('keydown', event => { if (event.key === 'Escape') closeSheet(sheet, opener); });
    sheet.querySelector('[data-install-close]').focus();
    return sheet;
  }
  async function activate(button) {
    const current = mode();
    if (current === 'prompt') {
      const prompt = pending; pending = null; win.__tnInstallPrompt = null;
      button.disabled = true;
      try { await prompt.prompt(); const choice = await prompt.userChoice; if (choice?.outcome === 'accepted') installed = true; }
      catch { /* The browser declined to show its dialog; leave the button available. */ }
      finally { button.disabled = false; refresh(); }
      return 'prompt';
    }
    if (current === 'ios-safari' || current === 'ios-other') { openSheet(current, button); return current; }
    return current;
  }
  win.addEventListener('beforeinstallprompt', event => { event.preventDefault(); pending = event; win.__tnInstallPrompt = event; refresh(); });
  win.addEventListener('appinstalled', () => { installed = true; pending = null; win.__tnInstallPrompt = null; refresh(); });
  win.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', refresh);
  doc.addEventListener('click', event => {
    const button = event.target.closest?.('[data-install-app]');
    if (!button) return;
    event.preventDefault();
    activate(button);
  });
  // Sign-in cards and menus are rendered later; manage their buttons as they appear.
  if (typeof win.MutationObserver === 'function') new win.MutationObserver(schedule).observe(doc.documentElement, { childList: true, subtree: true });
  // Register the service worker on the real site only; local previews and tests stay worker-free.
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(win.location.hostname) && !/[?&]sw=1\b/.test(win.location.search);
  if ('serviceWorker' in win.navigator && win.isSecureContext && !local) win.navigator.serviceWorker.register('/sw.js').catch(() => {});
  refresh();
  win.__tnInstall = { refresh, mode, activate, openSheet };
  return win.__tnInstall;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mountInstallApp(), { once: true });
  else mountInstallApp();
}

(() => {
  let pendingPrompt = null;
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const update = () => {
    const section = document.getElementById('installAppSection');
    if (section) section.hidden = standalone();
  };
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    pendingPrompt = event;
    update();
  });
  window.addEventListener('appinstalled', () => {
    pendingPrompt = null;
    const section = document.getElementById('installAppSection');
    if (section) section.hidden = true;
  });
  const init = () => {
    update();
    const button = document.getElementById('installAppBtn');
    const help = document.getElementById('installAppHelp');
    if (!button || !help) return;
    const showHelp = () => {
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      help.textContent = ios
        ? 'Open this page in Safari. Tap Share, then Add to Home Screen, then Add. If shown, keep Open as Web App enabled.'
        : /Android/.test(navigator.userAgent)
          ? 'Open this page in Chrome. Tap the three-dot menu, then Add to Home screen or Install app, and confirm. If you opened a link inside another app, open it in Chrome first.'
          : 'In Chrome or Edge, use the install icon in the address bar or the browser menu’s Install app option. On a phone, open this page in Safari or Chrome to add it to your home screen.';
      help.hidden = false;
      button.setAttribute('aria-expanded', 'true');
    };
    button.addEventListener('click', async () => {
      if (!pendingPrompt) { showHelp(); return; }
      const prompt = pendingPrompt;
      pendingPrompt = null;
      button.disabled = true;
      try {
        await prompt.prompt();
        const choice = await prompt.userChoice;
        help.textContent = choice.outcome === 'accepted' ? 'Installation requested. Look for True North on your home screen or in your apps.' : 'Installation canceled. You can install later from your browser menu.';
        help.hidden = false;
        button.setAttribute('aria-expanded', 'true');
      } catch { showHelp(); }
      finally { button.disabled = false; }
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();

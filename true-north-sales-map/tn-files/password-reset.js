import { validateEmail } from '../lib/account-rules.js';
import { resetEmailError, resetRedirectTo, resetRequestMessage } from '../lib/password-reset.js';

let installed = false;

function messageNode(form) {
  return form.querySelector('[data-forgot-msg]');
}

function showMessage(node, text, ok) {
  if (!node) return;
  node.textContent = text;
  node.classList.remove('isOk', 'isBad');
  node.classList.add('tnResetMsg', ok ? 'isOk' : 'isBad');
}

async function clientForReset() {
  let cfg = null;
  try {
    const response = await fetch('/api/config');
    if (response.ok) cfg = await response.json();
  } catch { /* static preview */ }
  if (!cfg?.configured || !cfg.url || !cfg.publishableKey) return null;
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  return createClient(cfg.url, cfg.publishableKey, {
    auth: {
      flowType: 'implicit',
      detectSessionInUrl: false,
      persistSession: false,
      storageKey: 'tn-reset-request'
    }
  });
}

export function installPasswordReset() {
  if (installed) return;
  installed = true;
  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-forgot]');
    if (!button) return;
    const scope = button.parentElement;
    const form = scope?.querySelector('[data-forgot-form]');
    if (!form) return;
    form.classList.remove('hidden');
    scope.classList.add('isResetting');
    const emailInput = form.querySelector('[data-forgot-email]');
    const typed = scope.querySelector('form:not([data-forgot-form]) input[type="email"]');
    if (emailInput && typed && !emailInput.value) emailInput.value = typed.value;
    form.querySelector('button[type="submit"]')?.scrollIntoView({ block: 'nearest' });
    emailInput?.focus();
  });
  document.addEventListener('submit', async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches('[data-forgot-form]')) return;
    event.preventDefault();
    const msg = messageNode(form);
    const email = form.querySelector('[data-forgot-email]')?.value || '';
    const invalid = resetEmailError(email);
    if (invalid) { showMessage(msg, invalid, false); return; }
    showMessage(msg, 'Sending…', true);
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const sb = await clientForReset();
      if (!sb) { showMessage(msg, 'Password reset needs the live sign-in.', false); return; }
      const { error } = await sb.auth.resetPasswordForEmail(validateEmail(email), {
        redirectTo: resetRedirectTo(location.origin)
      });
      const result = resetRequestMessage(error);
      showMessage(msg, result.message, result.ok);
    } catch {
      showMessage(msg, 'Could not send the reset link. Try again.', false);
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}

export function forgotPasswordMarkup() {
  return `<button type="button" class="tnForgot" data-forgot>Forgot password?</button><form data-forgot-form class="tnForgotForm hidden"><label class="tnLabel" for="tnForgotEmail">Email</label><input class="tnInput" id="tnForgotEmail" data-forgot-email type="email" autocomplete="email" required><button class="tnTap dark" type="submit">Send reset link</button><p data-forgot-msg class="tnResetMsg"></p></form>`;
}

installPasswordReset();

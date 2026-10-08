import { bootFiles, signIn, signOut } from './store.js';
import { bindSignOut, esc, signInCard } from './ui.js';
import { passwordChangeError } from '../lib/password-reset.js';
import { roleLabel } from '../lib/role-access.js';
import { MANAGEMENT_LINKS, canOpenManagement } from '../lib/account-rules.js';
import { mountAccountTraining } from './training-account.js';

const app = document.getElementById('app');

async function start() {
  const ctx = await bootFiles();
  bindSignOut(ctx, document.getElementById('signOut'));
  if (ctx.mode === 'local') {
    app.innerHTML = '<h1 class="tnTitle">My account</h1><p class="tnSub">Password changes need the live Supabase project. This preview is not connected.</p><a class="tnTap" href="/">Back to map</a>';
    return;
  }
  if (!ctx.session) return renderSignIn(ctx);
  renderForm(ctx);
}

function renderSignIn(ctx) {
  app.innerHTML = signInCard();
  document.getElementById('tnLogin').onsubmit = async (event) => {
    event.preventDefault();
    try {
      await signIn(ctx, document.getElementById('tnEmail').value, document.getElementById('tnPassword').value);
      renderForm(ctx);
    } catch (error) {
      document.getElementById('tnLoginError').textContent = error.message;
    }
  };
}

function managementCard(ctx) {
  const email = ctx.session?.user?.email || ctx.rep?.email || '';
  if (!canOpenManagement({ email, rep: ctx.rep, adminEmails: ctx.cfg?.adminEmails })) return '';
  const links = MANAGEMENT_LINKS.map((link) => `<a class="tnTap" href="${esc(link.href)}">${esc(link.label)}</a>`).join('');
  return `<section class="tnCard tnManageCard" id="managementDashboard"><div class="eyebrow">MANAGEMENT</div><b>Management dashboard</b><span>Accounts, the team, documents, messages, and forms. These open the office tools with this same login.</span><div class="tnStack">${links}</div></section>`;
}

function renderForm(ctx) {
  const who = ctx.rep?.name || ctx.session.user.email || 'Signed in';
  const role = ctx.rep?.role ? ` · ${roleLabel(ctx.rep.role)}` : '';
  app.innerHTML = `<h1 class="tnTitle">My account</h1>
    <p class="tnSub">${esc(who)}${esc(role)}</p>
    ${managementCard(ctx)}
    <p class="tnAccountBtns"><a class="tnTap" href="/training.html">Training</a><a class="tnTap" href="/forms.html">My forms</a></p>
    <div id="tnAccountTraining"></div>
    <form id="pwForm" class="tnCard">
      <label class="tnLabel" for="pw1">New password</label>
      <input class="tnInput" id="pw1" type="password" autocomplete="new-password" minlength="8" required>
      <label class="tnLabel" for="pw2">Type it again</label>
      <input class="tnInput" id="pw2" type="password" autocomplete="new-password" minlength="8" required>
      <p class="tnHelp">At least 8 characters. Use this the next time you sign in.</p>
      <button class="tnTap dark" type="submit">Change password</button>
      <p id="pwMsg" class="tnHelp"></p>
    </form>
    <p class="tnAccountBtns" style="margin-top:16px"><a class="tnTap tnOutline" href="/">Back to map</a><button id="accountSignOut" class="tnTap" type="button">Sign out</button></p>`;
  document.getElementById('pwForm').onsubmit = (event) => save(event, ctx);
  mountAccountTraining(document.getElementById('tnAccountTraining'), ctx).catch(() => {});
  document.getElementById('accountSignOut').onclick = async () => { await signOut(ctx); location.href = '/'; };
}

async function save(event, ctx) {
  event.preventDefault();
  const msg = document.getElementById('pwMsg');
  const first = document.getElementById('pw1').value;
  const second = document.getElementById('pw2').value;
  msg.className = 'tnError';
  const problem = passwordChangeError(first, second);
  if (problem) { msg.textContent = problem; return; }
  msg.className = 'tnHelp';
  msg.textContent = 'Saving…';
  const { error } = await ctx.sb.auth.updateUser({ password: first });
  if (error) { msg.className = 'tnError'; msg.textContent = error.message; return; }
  document.getElementById('pw1').value = '';
  document.getElementById('pw2').value = '';
  msg.className = 'tnHelp';
  msg.textContent = 'Password saved.';
}

start();

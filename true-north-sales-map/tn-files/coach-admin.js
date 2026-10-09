import { DEFAULT_COACH_PROMPT, COACH_PROMPT_MAX, validateCoachPrompt } from '../lib/coach-settings.js';

export function mountCoachAdmin(sb, me) {
  if (me.role !== 'admin') return;
  const rail = document.querySelector('#app .rail'), main = document.querySelector('#app .dashMain');
  if (!rail || !main || document.getElementById('tab-coach-settings')) return;
  const button = document.createElement('button');
  button.type = 'button'; button.dataset.tab = 'coach-settings'; button.dataset.tnTabBound = '1'; button.textContent = 'Coach settings';
  rail.append(button);
  const section = document.createElement('section'); section.id = 'tab-coach-settings'; section.className = 'hidden';
  section.innerHTML = `<div class="dashTitle"><div><div class="eyebrow">VOICE COACH</div><h1>Coach settings</h1><p>Set the coaching goal, tone, and company guidance for appointment setters and sales reps.</p></div></div><div class="card pad"><form id="coachSettingsForm"><label for="coachSystemPrompt">Team system prompt</label><textarea id="coachSystemPrompt" rows="15" maxlength="${COACH_PROMPT_MAX}" required style="display:block;width:100%;box-sizing:border-box;margin:12px 0;min-height:260px"></textarea><p>Each new voice session includes this prompt and the signed-in person’s available app context. Privacy and truthful coaching rules remain active.</p><div class="inlineActions"><button type="submit" class="btn primary" id="coachSettingsSave" disabled>Save prompt</button><button type="button" class="btn" id="coachSettingsDefault">Use default prompt</button></div><p id="coachSettingsNotice" role="status" aria-live="polite"></p></form></div>`;
  main.append(section);
  const input = section.querySelector('#coachSystemPrompt'), notice = section.querySelector('#coachSettingsNotice'), save = section.querySelector('#coachSettingsSave');
  input.value = DEFAULT_COACH_PROMPT;
  let loading = false;
  async function load() {
    if (loading) return;
    loading = true; save.disabled = true; notice.textContent = 'Loading Coach settings…';
    try {
      const {data,error} = await sb.from('coach_settings').select('system_prompt').eq('id','team').maybeSingle();
      if (error) throw error;
      input.value = data?.system_prompt || DEFAULT_COACH_PROMPT; notice.textContent = 'Changes apply the next time a team member starts Coach.'; save.disabled = false;
    } catch { notice.textContent = 'Coach settings are not installed yet. Run supabase/migrations/20261009_coach_settings.sql in the Supabase SQL editor. Voice Coach uses the built-in prompt until then.'; }
    finally { loading = false; }
  }
  button.onclick = () => {
    document.dispatchEvent(new CustomEvent('tn-admin-view',{detail:'coach-settings'})); history.replaceState(null,'','#coach-settings');
    main.querySelectorAll('section[id^="tab-"]').forEach(s=>s.classList.toggle('hidden',s!==section)); rail.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b===button)); load();
  };
  section.querySelector('#coachSettingsDefault').onclick = () => { input.value = DEFAULT_COACH_PROMPT; notice.textContent = 'Default prompt loaded. Save to apply it to your team.'; };
  section.querySelector('#coachSettingsForm').onsubmit = async event => {
    event.preventDefault(); if (save.disabled) return;
    try {
      const prompt = validateCoachPrompt(input.value); save.disabled = true; notice.textContent = 'Saving…';
      const {error} = await sb.from('coach_settings').upsert({id:'team',system_prompt:prompt},{onConflict:'id'});
      if (error) throw error;
      notice.textContent = 'Saved. Restart Coach to use the updated prompt.';
    } catch (error) { notice.textContent = 'Could not save: '+error.message; }
    finally { save.disabled = false; }
  };
  if (location.hash === '#coach-settings') button.click();
}

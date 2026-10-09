import {FEATURES,FEATURE_ROLES,featureAllowed} from '../lib/features.js';
export function mountFeatureAdmin(sb,me){
  if(me.role!=='admin')return;
  const rail=document.querySelector('#app .rail'),main=document.querySelector('#app .dashMain');
  if(!rail||!main||document.getElementById('tab-features'))return;
  const button=document.createElement('button');button.type='button';button.dataset.tab='features';button.textContent='Feature access';rail.append(button);
  const section=document.createElement('section');section.id='tab-features';section.className='hidden';
  section.innerHTML='<h1>Feature access</h1><p>Turn field features on or off for each role. Management keeps access. Changes apply when team members refresh or return to the app.</p><p id="featureNotice" role="status"></p><div id="featureControls"></div>';main.append(section);
  button.dataset.tnTabBound='1';button.onclick=()=>{document.dispatchEvent(new CustomEvent('tn-admin-view',{detail:'features'}));history.replaceState(null,'','#features');main.querySelectorAll('section[id^="tab-"]').forEach(s=>s.classList.toggle('hidden',s!==section));rail.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b===button));load();};
  async function load(){
    const notice=section.querySelector('#featureNotice'),root=section.querySelector('#featureControls');
    const {data,error}=await sb.from('feature_permissions').select('*');
    if(error){root.replaceChildren();notice.textContent='Feature permissions are not installed yet. Run supabase/migrations/20261009_feature_permissions.sql in the Supabase SQL editor before using these switches.';return;}
    notice.textContent='';root.innerHTML='<table class="featureMatrix"><thead><tr><th>Feature</th><th>Appointment setters</th><th>Sales reps</th></tr></thead><tbody>'+FEATURES.map(([key,label])=>`<tr><th scope="row">${label}</th>${FEATURE_ROLES.map(role=>`<td><label><input type="checkbox" role="switch" data-feature="${key}" data-role="${role}" aria-label="${label} for ${role==='salesperson'?'sales reps':'appointment setters'}" ${featureAllowed(data,role,key)?'checked':''}><span> ${featureAllowed(data,role,key)?'On':'Off'}</span></label></td>`).join('')}</tr>`).join('')+'</tbody></table>';
    root.querySelectorAll('input').forEach(input=>input.onchange=async()=>{
      const wanted=input.checked;input.disabled=true;notice.textContent='Saving…';
      const {error}=await sb.from('feature_permissions').upsert({role:input.dataset.role,feature:input.dataset.feature,enabled:wanted},{onConflict:'role,feature'});
      input.disabled=false;if(error){input.checked=!wanted;notice.textContent='Could not save: '+error.message;}else{input.nextElementSibling.textContent=wanted?' On':' Off';notice.textContent='Saved. Protected data access updates immediately.';}
    });
  }
  if(location.hash==='#features')button.click();
}

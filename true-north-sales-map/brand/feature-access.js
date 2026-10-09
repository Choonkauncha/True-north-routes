import {FEATURES,featureAllowed} from '../lib/features.js';
let current=null;
const selectors={map:'[data-workspace-link="map"]',routes:'#routeBtn,#mobileRoute,#routeTray,#navBar,#doorSheetRoute,.rowCheck',weather:'#weatherStack',intake:'[data-workspace-link="intake"],a[href="/setter.html"]',forms:'[data-workspace-link="forms"],a[href="/forms.html"]',photos:'[data-workspace-link="photos"],#roofPhotosLink,a[href="/rep.html"]',training:'[data-workspace-link="training"],a[href="/training.html"]',coach:'#tnCoachPanel,#tnCoachTab,.tnCoachCard,[data-training-tab="coach"],[data-tab="coach"]',shifts:'[data-workspace-link="shifts"],.tnShiftsLink,#tnClockBtn',messages:'.tnMessagesBtn,#messagesBtn,#messageBtn,#tnMsgBtn,[data-tn-action="message"]',account:'[data-workspace-link="account"],a[href="/account.html"]'};
function apply(){
  if(!current)return;
  window.tnFeatureAllowed=key=>featureAllowed(current.rows,current.role,key);
  for(const [key] of FEATURES)document.querySelectorAll(selectors[key]||'___').forEach(el=>{
    const off=!featureAllowed(current.rows,current.role,key);
    if(off)el.setAttribute('data-feature-disabled','');else el.removeAttribute('data-feature-disabled');
  });
  if(!featureAllowed(current.rows,current.role,'coach')&&document.getElementById('tnCoachTab')?.getAttribute('aria-selected')==='true')document.getElementById('tnLessonsTab')?.click();
  const brand=document.querySelector('.workspaceBrand span');
  const label=['admin','manager'].includes(current.role)?'MANAGEMENT':'FIELD TOOLS';
  if(brand&&brand.textContent!==label)brand.textContent=label;
  const brandLink=brand?.closest('a');
  if(brandLink)brandLink.href=['admin','manager'].includes(current.role)?'/admin.html':'/';
}
export async function bootFeatureAccess(){
  try{
    const cfg=await fetch('/api/config').then(r=>r.json());if(!cfg.configured)return;
    const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    const sb=createClient(cfg.url,cfg.publishableKey);
    async function refresh(){
      const {data:{session}}=await sb.auth.getSession();if(!session){current=null;return;}
      const {data:rep}=await sb.from('reps').select('role').eq('user_id',session.user.id).eq('active',true).maybeSingle();if(!rep)return;
      const {data:rows,error}=await sb.from('feature_permissions').select('*');
      if(error){if(error.code==='42P01'||error.code==='PGRST205')current={role:rep.role,rows:[]};else return;}else current={role:rep.role,rows:rows||[]};
      apply();
      document.dispatchEvent(new CustomEvent('tn-feature-access',{detail:{coach:featureAllowed(current.rows,current.role,'coach')}}));
      const path=location.pathname.replace(/\.html$/,'').replace(/\/$/,'')||'/';
      const pageKey={'/':'map','/setter':'intake','/forms':'forms','/rep':'photos','/photo':'photos','/training':'training','/shifts':'shifts','/account':'account'}[path];
      if(pageKey&&!featureAllowed(current.rows,rep.role,pageKey)){
        let hold=document.getElementById('featureAccessHold');if(!hold){hold=document.createElement('div');hold.id='featureAccessHold';hold.className='featureAccessHold';hold.innerHTML='<h1>Feature unavailable</h1><p>Management has disabled this feature for your role.</p><a href="/">Field map</a> · <a href="/account.html">My account</a> <button type="button">Sign out</button>';hold.querySelector('button').onclick=()=>sb.auth.signOut().then(()=>location.reload());document.body.append(hold);}
      }else document.getElementById('featureAccessHold')?.remove();
    }
    await refresh();
    new MutationObserver(apply).observe(document.body,{childList:true,subtree:true});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
    sb.auth.onAuthStateChange(()=>setTimeout(refresh,0));
    sb.channel('feature-access').on('postgres_changes',{event:'*',schema:'public',table:'feature_permissions'},refresh).subscribe();
  }catch{/* Existing authentication screens remain responsible for sign-in. */}
}

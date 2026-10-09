import { esc } from './ui.js';
import { createLiveCoach } from './live-coach.js';
import { mountCoachOrb } from './coach-orb.js';

let account='', snapshot=null;
let liveVoice=null, liveVoiceState='idle', liveVoiceError='', liveTranscript=[];
let flight=null, loadVersion=0, authSubscription=null, activeHost=null, orb=null;

function clearCoach() {
  flight?.abort();flight=null;loadVersion+=1;
  stopCoachVoice();orb?.dispose();orb=null;liveTranscript=[];
  snapshot=null;account='';
  if(activeHost?.isConnected)activeHost.replaceChildren();
}

export function invalidateCoachProfile() { snapshot=null; }

export function stopCoachVoice() {
  liveVoice?.stop();liveVoice=null;liveVoiceState='idle';liveVoiceError='';orb?.setState('idle');orb?.setLevels({input:0,output:0});
}

export function coachWorkspaceHtml(lessonsHtml) {
  return `<div class="tnTrainingWorkspace"><header class="tnCoachHeading"><div><p class="eyebrow">TRUE NORTH · GROW WITH PURPOSE</p><h1>Coach &amp; training</h1></div><span class="tnCoachCompass" aria-hidden="true">N<span>✦</span></span></header><div class="tnTrainingTabs" role="tablist" aria-label="Training workspace"><button type="button" id="tnCoachTab" role="tab" aria-selected="true" aria-controls="tnCoachPanel">My Coach</button><button type="button" id="tnLessonsTab" role="tab" aria-selected="false" aria-controls="tnLessonsPanel" tabindex="-1">My lessons</button></div><section id="tnCoachPanel" role="tabpanel" aria-labelledby="tnCoachTab"><div id="tnCoach"></div></section><section id="tnLessonsPanel" role="tabpanel" aria-labelledby="tnLessonsTab" hidden>${lessonsHtml}</section></div>`;
}

export function mountCoachWorkspace(ctx,{showLessons=false,onChange=()=>{}}={}) {
  const coachTab=document.getElementById('tnCoachTab'),learnTab=document.getElementById('tnLessonsTab');
  if(!coachTab||!learnTab)return;
  function choose(learn,focus=false){
    if(learn)stopCoachVoice();
    onChange(learn);
    for(const [button,selected] of [[coachTab,!learn],[learnTab,learn]]){button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;}
    document.getElementById('tnCoachPanel').hidden=learn;
    document.getElementById('tnLessonsPanel').hidden=!learn;
    if(focus)(learn?learnTab:coachTab).focus();
  }
  coachTab.onclick=()=>choose(false);learnTab.onclick=()=>choose(true);
  for(const button of [coachTab,learnTab])button.onkeydown=event=>{
    if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();choose(event.key==='End'||(event.key!=='Home'&&button===coachTab),true);}
  };
  choose(showLessons);
  document.getElementById('tnCoachPanel').addEventListener('click',event=>{if(event.target.closest('[data-coach-lessons]')){event.preventDefault();choose(true,true);}});
  mountCoach(document.getElementById('tnCoach'),ctx);
}

export async function mountCoach(host,ctx) {
  if(!host)return;
  activeHost=host;
  const identity=ctx?.session?.user?.id||ctx?.rep?.user_id||ctx?.rep?.id||'';
  if(identity!==account){clearCoach();account=identity;activeHost=host;}
  authSubscription?.unsubscribe();
  authSubscription=ctx.sb?.auth.onAuthStateChange((event,session)=>{
    if(event==='SIGNED_OUT'||(session?.user?.id&&session.user.id!==identity)){
      clearCoach();
      if(host.isConnected)host.innerHTML='<p class="tnCoachNotice" role="status">Sign in to refresh your personal Coach.</p>';
    }
  })?.data?.subscription;
  if(snapshot){paint(host,ctx);return;}
  const ticket=++loadVersion;
  host.innerHTML='<div class="tnCoachLoading" role="status">Getting your next step ready…</div>';
  try{
    const data=await coachRequest(ctx,'GET');
    if(ticket!==loadVersion||!host.isConnected)return;
    if(data.snapshot?.profile?.id!==ctx.rep?.id)throw Error('Sign in again to refresh your personal Coach.');
    snapshot=data.snapshot;
    paint(host,ctx);
  }catch(error){
    if(ticket!==loadVersion||!host.isConnected)return;
    host.innerHTML=`<div class="tnCoachNotice" role="status">${esc(error.message)}<button type="button" id="tnCoachRetry">Try again</button></div>`;
    document.getElementById('tnCoachRetry').onclick=()=>mountCoach(host,ctx);
  }
}

async function coachRequest(ctx,method,body,signal) {
  const session=await ctx.sb.auth.getSession();
  const token=session.data?.session?.access_token;
  const userId=session.data?.session?.user?.id;
  if(!token||(userId&&account!==userId))throw Error('Sign in again to refresh your personal Coach.');
  const response=await fetch('/api/coach',{method,signal:signal||AbortSignal.timeout(30000),headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:body?JSON.stringify(body):undefined});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||'Your Coach could not load. Try again.');
  return data;
}

function renderLiveVoice(host) {
  const thread=host.querySelector('#tnCoachLiveThread');
  if(!thread)return;
  const rows=liveTranscript.slice(-8);
  while(thread.children.length>rows.length)thread.firstElementChild?.remove();
  while(thread.children.length<rows.length){const entry=document.createElement('div');entry.className='tnCoachLiveLine';entry.append(document.createElement('b'),document.createElement('span'));thread.append(entry);}
  rows.forEach((row,index)=>{const entry=thread.children[index],label=entry.querySelector('b'),content=entry.querySelector('span');label.textContent=row.role==='assistant'?'Coach':'You';if(content.textContent!==row.text)content.textContent=row.text;});
  thread.hidden=!liveTranscript.length;
  thread.scrollTop=thread.scrollHeight;
}

function paintLiveState(host) {
  if(!host?.querySelector)return;
  const button=host.querySelector('#tnCoachLiveToggle');
  const status=host.querySelector('#tnCoachLiveStatus');
  if(!button||!status)return;
  const labels={idle:'Voice Coach is ready.',connecting:'Connecting to Live Coach…',listening:'Listening. Speak naturally.',paused:'Voice paused.',speaking:'Coach is speaking.',error:'Live voice needs another try.'};
  orb?.setState(liveVoiceState);
  status.textContent=liveVoiceState==='error'&&liveVoiceError?liveVoiceError:(labels[liveVoiceState]||labels.idle);
  button.textContent=liveVoiceState==='idle'||liveVoiceState==='error'?'Start live voice':liveVoiceState==='paused'?'Resume live voice':'Pause live voice';
  button.dataset.liveAction=liveVoiceState==='idle'||liveVoiceState==='error'?'start':liveVoiceState==='paused'?'resume':'pause';
  button.disabled=liveVoiceState==='connecting';
  host.querySelector('#tnCoachLiveStop').hidden=liveVoiceState==='idle'||liveVoiceState==='error';
  renderLiveVoice(host);
}

function paint(host,ctx) {
  const {profile,focus,metrics,coverage,metricLimits={}}=snapshot;
  const partial=coverage.some(source=>!source.available||source.limited);
  const value=(n,key)=>n===null?'—':String(n)+(metricLimits[key]?'+':'');
  host.innerHTML=`<section class="tnCoachCard" aria-label="Your personal True North Coach"><div class="tnCoachWelcome"><div><p>${esc(profile.roleLabel)} · Your personal Coach</p><h2>Let’s build momentum, ${esc(profile.firstName)}.</h2></div><span id="tnCoachMode" class="tnCoachMode">Voice Coach</span></div><div class="tnCoachFocus"><span class="tnCoachFocusMark" aria-hidden="true">✦</span><div><b>${esc(focus.title)}</b><p>${esc(focus.detail)}</p></div><a href="${esc(focus.href)}" ${focus.href==='#lessons'?'data-coach-lessons':''}>${esc(focus.action)} <span aria-hidden="true">→</span></a></div><section class="tnCoachLive" aria-label="Gemini Live voice Coach"><div class="tnCoachOrbStage" data-voice-state="idle"><canvas id="tnCoachOrb" class="tnCoachOrb" aria-hidden="true"></canvas><div class="tnCoachOrbCore" aria-hidden="true">✦</div><span class="tnCoachOrbCaption">TRUE NORTH LIVE COACH</span></div><div><b>Live voice Coach</b><span>Talk through a situation hands-free.</span></div><div class="tnCoachLiveActions"><button type="button" id="tnCoachLiveToggle">Start live voice</button><button type="button" id="tnCoachLiveStop" hidden>End voice</button></div><p id="tnCoachLiveStatus" role="status">Voice Coach is ready.</p><div id="tnCoachLiveThread" class="tnCoachLiveThread" role="log" aria-live="polite" aria-label="Live Coach transcript" hidden></div></section><p class="muted">Speak to your Coach to practice a homeowner conversation, work through objections, or plan your next step.</p><details class="tnCoachProfile"><summary>What my Coach uses <span>${partial?'Some data unavailable':'Updated from my app'}</span></summary><p>${esc(snapshot.privacy)}</p><p>${esc(snapshot.period)} for work activity; current assigned leads and lessons.</p><div class="tnCoachStats">${[[metrics.touches,'Field touches','touches'],[metrics.upcoming,'Upcoming inspections','upcoming'],[metrics.photos,'Photos added','photos'],[metrics.forms,'Forms recorded','forms'],[metrics.shiftHours,'Shift hours','shiftHours'],[metrics.messages,'Messages sent','messages'],[metrics.trainingComplete,'Lessons completed','trainingComplete']].map(([n,label,key])=>`<div><b>${value(n,key)}</b><span>${label}</span></div>`).join('')}</div><p>${partial?'Unavailable sources are shown as —. A + marks a lower bound from limited records.':'Counts reflect your own recorded work.'}</p><button type="button" id="tnCoachRefresh">Refresh my profile</button></details></section>`;
  orb?.dispose();orb=mountCoachOrb(host.querySelector('#tnCoachOrb'));
  const liveStatus=host.querySelector('#tnCoachLiveStatus');
  const disclosure=document.createElement('p');disclosure.className='tnCoachLiveDisclosure';disclosure.textContent='Voice audio and the personal Coach context shown below are processed by Google Gemini only while Live voice is active.';
  liveStatus.before(disclosure);
  host.querySelector('#tnCoachLiveThread').setAttribute('aria-relevant','additions text');
  paintLiveState(host);
  host.querySelector('#tnCoachRefresh').onclick=()=>{stopCoachVoice();snapshot=null;mountCoach(host,ctx);};
  host.querySelector('#tnCoachLiveToggle').onclick=async()=>{
    const action=host.querySelector('#tnCoachLiveToggle').dataset.liveAction||'start';
    if(action==='pause'){liveVoice?.pause();return;}
    if(action==='resume'){liveVoice?.resume();return;}
    liveTranscript=[];liveVoiceError='';liveVoice=createLiveCoach(ctx,{onState:next=>{liveVoiceState=next;paintLiveState(activeHost);},onAudioLevel:levels=>orb?.setLevels(levels),onTranscript:row=>{const previous=liveTranscript.at(-1);if(row.final&&!row.text){if(previous)previous.final=true;}else if(previous?.role===row.role&&!previous.final)previous.text+=row.text;else{if(previous)previous.final=true;liveTranscript.push({...row});}paintLiveState(activeHost);},onError:error=>{liveVoiceError=error.message;paintLiveState(activeHost);}});
    await liveVoice.start();
  };
  host.querySelector('#tnCoachLiveStop').onclick=()=>{stopCoachVoice();paintLiveState(activeHost);};
}

// End an active voice session if management disables Coach while this page is open.
document.addEventListener('tn-feature-access',event=>{if(event.detail?.coach===false)stopCoachVoice();});

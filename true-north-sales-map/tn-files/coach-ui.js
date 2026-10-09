import { COACH_TOPICS } from '../lib/coach.js';
import { esc } from './ui.js';
import { createLiveCoach } from './live-coach.js';

let account='', conversation=[], snapshot=null, greeting='', mode='guided';
let practiceActive=false, pendingDraft='', pendingNotice='';
let liveVoice=null, liveVoiceState='idle', liveVoiceError='', liveTranscript=[];
let flight=null, loadVersion=0, authSubscription=null, activeHost=null;

function clearCoach() {
  flight?.abort();flight=null;loadVersion+=1;
  stopCoachVoice();liveTranscript=[];
  practiceActive=false;pendingDraft='';pendingNotice='';conversation=[];snapshot=null;greeting='';account='';
  if(activeHost?.isConnected)activeHost.replaceChildren();
}

export function invalidateCoachProfile() { snapshot=null; }

export function stopCoachVoice() {
  liveVoice?.stop();liveVoice=null;liveVoiceState='idle';liveVoiceError='';
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
    snapshot=data.snapshot;greeting=data.greeting;if(!conversation.length)mode=data.mode;
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

function renderTranscript(host) {
  const thread=host.querySelector('#tnCoachThread');thread.replaceChildren();
  for(const row of [{role:'assistant',content:greeting},...conversation]){
    const entry=document.createElement('div');entry.className='tnCoachMessage is-'+row.role;
    const label=document.createElement('b');label.textContent=row.role==='assistant'?'True North Coach':'You';
    const content=document.createElement('p');content.textContent=row.role==='assistant'?String(row.content).replace(/\[Practice: (opener|objection|handoff|recap)\]/g,(_,phase)=>'Practice · '+({opener:'Introduction',objection:'Respectful objection',handoff:'Clear next step',recap:'Reflect and apply'}[phase])).replace(/\[Feedback: (opener|objection|handoff)\]/g,'Feedback on your response'):row.content;
    entry.append(label,content);thread.append(entry);
  }
  thread.scrollTop=thread.scrollHeight;
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
  const labels={idle:'Voice Coach is ready.',connecting:'Connecting to Live Coach…',listening:'Listening. Speak naturally.',paused:'Voice paused.',error:'Live voice needs another try.'};
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
  host.innerHTML=`<section class="tnCoachCard" aria-label="Your personal True North Coach"><div class="tnCoachWelcome"><div><p>${esc(profile.roleLabel)} · Your personal Coach</p><h2>Let’s build momentum, ${esc(profile.firstName)}.</h2></div><span id="tnCoachMode" class="tnCoachMode">${mode==='ai'?'AI coach':mode==='practice'?'Practice coach':'Guided coach'}</span></div><div class="tnCoachFocus"><span class="tnCoachFocusMark" aria-hidden="true">✦</span><div><b>${esc(focus.title)}</b><p>${esc(focus.detail)}</p></div><a href="${esc(focus.href)}" ${focus.href==='#lessons'?'data-coach-lessons':''}>${esc(focus.action)} <span aria-hidden="true">→</span></a></div><div class="tnCoachTopics" role="group" aria-label="Choose a coaching focus">${COACH_TOPICS.map(topic=>`<button type="button" data-coach-topic="${topic.id}">${esc(topic.label)}</button>`).join('')}</div><section class="tnCoachLive" aria-label="Gemini Live voice Coach"><div><b>Live voice Coach</b><span>Talk through a situation hands-free.</span></div><div class="tnCoachLiveActions"><button type="button" id="tnCoachLiveToggle">Start live voice</button><button type="button" id="tnCoachLiveStop" hidden>End voice</button></div><p id="tnCoachLiveStatus" role="status">Voice Coach is ready.</p><div id="tnCoachLiveThread" class="tnCoachLiveThread" role="log" aria-live="polite" aria-label="Live Coach transcript" hidden></div></section><div class="tnCoachPractice"><button type="button" id="tnCoachPracticeStart">Start a practice round</button><span>Introduction → objection → next step</span><div id="tnCoachPracticeTools" ${practiceActive?'':'hidden'}><button type="button" id="tnCoachHint">Show an example</button><button type="button" id="tnCoachRetryRound">Try that again</button></div></div><div id="tnCoachThread" class="tnCoachThread" role="log" aria-live="polite" aria-label="Coach conversation" aria-relevant="additions text"></div><form id="tnCoachForm" class="tnCoachForm"><label for="tnCoachInput">What would you like to work on?</label><div class="tnCoachComposer"><textarea id="tnCoachInput" rows="2" maxlength="1200" placeholder="Practice a conversation, refine a message, or plan my next step…" required></textarea><button type="submit" id="tnCoachSend">Coach me <span aria-hidden="true">↗</span></button></div><div class="tnCoachFormMeta"><span>Draft messages are for your review. You decide what to send.</span><button type="button" id="tnCoachReset">New conversation</button></div></form><p id="tnCoachStatus" class="tnCoachStatus" role="status"></p><details class="tnCoachProfile"><summary>What my Coach uses <span>${partial?'Some data unavailable':'Updated from my app'}</span></summary><p>${esc(snapshot.privacy)}</p><p>${esc(snapshot.period)} for work activity; current assigned leads and lessons.</p><div class="tnCoachStats">${[[metrics.touches,'Field touches','touches'],[metrics.upcoming,'Upcoming inspections','upcoming'],[metrics.photos,'Photos added','photos'],[metrics.forms,'Forms recorded','forms'],[metrics.shiftHours,'Shift hours','shiftHours'],[metrics.messages,'Messages sent','messages'],[metrics.trainingComplete,'Lessons completed','trainingComplete']].map(([n,label,key])=>`<div><b>${value(n,key)}</b><span>${label}</span></div>`).join('')}</div><p>${partial?'Unavailable sources are shown as —. A + marks a lower bound from limited records.':'Counts reflect your own recorded work.'}</p><button type="button" id="tnCoachRefresh">Refresh my profile</button></details></section>`;
  const liveStatus=host.querySelector('#tnCoachLiveStatus');
  const disclosure=document.createElement('p');disclosure.className='tnCoachLiveDisclosure';disclosure.textContent='Voice audio and the personal Coach context shown below are processed by Google Gemini only while Live voice is active.';
  liveStatus.before(disclosure);
  host.querySelector('#tnCoachLiveThread').setAttribute('aria-relevant','additions text');
  renderTranscript(host);
  paintLiveState(host);
  const input=host.querySelector('#tnCoachInput'),status=host.querySelector('#tnCoachStatus');
  input.value=pendingDraft;status.textContent=pendingNotice;
  input.oninput=()=>{pendingDraft=input.value;};
  const busy=on=>{
    host.querySelector('#tnCoachSend').disabled=on;
    host.querySelector('#tnCoachReset').disabled=on;
    host.querySelector('#tnCoachRefresh').disabled=on;
    host.querySelectorAll('[data-coach-topic],#tnCoachPracticeStart,#tnCoachHint,#tnCoachRetryRound').forEach(button=>button.disabled=on);
    host.querySelector('#tnCoachThread').setAttribute('aria-busy',String(on));
    input.readOnly=on;
  };
  async function send(message,topic='',practiceAction=''){
    if(!topic&&practiceActive)topic='practice';
    if(topic&&topic!=='practice')practiceActive=false;
    if(topic==='practice')practiceActive=true;
    host.querySelector('#tnCoachPracticeTools').hidden=!practiceActive;
    if(flight)return;
    const identity=account;const controller=new AbortController();flight=controller;busy(true);status.textContent='Your Coach is thinking…';
    const history=conversation.slice(-6);
    const userRow={role:'user',content:message};
    conversation.push(userRow);renderTranscript(host);
    try{
      const data=await coachRequest(ctx,'POST',{message,topic,history,practiceAction},AbortSignal.any([controller.signal,AbortSignal.timeout(30000)]));
      if(identity!==account)return;
      conversation.push({role:'assistant',content:data.reply});conversation=conversation.slice(-12);mode=data.mode;pendingDraft='';pendingNotice=data.notice||'';
      if(activeHost?.isConnected&&activeHost.querySelector('#tnCoachInput')&&activeHost.querySelector('#tnCoachThread')){
        activeHost.querySelector('#tnCoachMode').textContent=mode==='ai'?'AI coach':mode==='practice'?'Practice coach':'Guided coach';
        renderTranscript(activeHost);activeHost.querySelector('#tnCoachInput').value='';
        activeHost.querySelector('#tnCoachStatus').textContent=data.notice||'';
      }
    }catch(error){
      if(identity!==account)return;
      conversation=conversation.filter(row=>row!==userRow);pendingDraft=message;
      pendingNotice=error.name==='TimeoutError'?'Your Coach took too long. Your draft is here; try again.':error.message||'Your draft is here. Try again.';
      if(activeHost?.isConnected&&activeHost.querySelector('#tnCoachInput')&&activeHost.querySelector('#tnCoachThread')){renderTranscript(activeHost);activeHost.querySelector('#tnCoachInput').value=message;
        activeHost.querySelector('#tnCoachStatus').textContent=pendingNotice;}
    }finally{if(flight===controller)flight=null;if(identity===account&&activeHost?.isConnected&&activeHost.querySelector('#tnCoachInput')&&activeHost.querySelector('#tnCoachThread')){
      activeHost.querySelectorAll('#tnCoachSend,#tnCoachReset,#tnCoachRefresh,#tnCoachPracticeStart,#tnCoachHint,#tnCoachRetryRound,[data-coach-topic]').forEach(el=>el.disabled=false);
      activeHost.querySelector('#tnCoachInput').readOnly=false;activeHost.querySelector('#tnCoachThread').setAttribute('aria-busy','false');
      if(activeHost===host)input.focus({preventScroll:true});}}
  }
  busy(!!flight);
  if(flight)status.textContent='Your Coach is thinking…';
  host.querySelector('#tnCoachForm').onsubmit=event=>{event.preventDefault();const message=input.value.trim();if(message)send(message);};
  for(const button of host.querySelectorAll('[data-coach-topic]'))button.onclick=()=>{const topic=COACH_TOPICS.find(item=>item.id===button.dataset.coachTopic);send(topic.prompt,topic.id);};
  host.querySelector('#tnCoachPracticeStart').onclick=()=>send('Let’s practice a respectful True North conversation.','practice','start');
  host.querySelector('#tnCoachHint').onclick=()=>send('Show me an example I can adapt.','practice','hint');
  host.querySelector('#tnCoachRetryRound').onclick=()=>send('Let me try that response again.','practice','retry');
  host.querySelector('#tnCoachReset').onclick=()=>{practiceActive=false;pendingDraft='';pendingNotice='';host.querySelector('#tnCoachPracticeTools').hidden=true;conversation=[];input.value='';status.textContent='';renderTranscript(host);input.focus();};
  host.querySelector('#tnCoachRefresh').onclick=()=>{stopCoachVoice();snapshot=null;mountCoach(host,ctx);};
  host.querySelector('#tnCoachLiveToggle').onclick=async()=>{
    const action=host.querySelector('#tnCoachLiveToggle').dataset.liveAction||'start';
    if(action==='pause'){liveVoice?.pause();return;}
    if(action==='resume'){liveVoice?.resume();return;}
    liveTranscript=[];liveVoiceError='';liveVoice=createLiveCoach(ctx,{onState:next=>{liveVoiceState=next;paintLiveState(activeHost);},onTranscript:row=>{const previous=liveTranscript.at(-1);if(row.final&&!row.text){if(previous)previous.final=true;}else if(previous?.role===row.role&&!previous.final)previous.text+=row.text;else{if(previous)previous.final=true;liveTranscript.push({...row});}paintLiveState(activeHost);},onError:error=>{liveVoiceError=error.message;paintLiveState(activeHost);}});
    await liveVoice.start();
  };
  host.querySelector('#tnCoachLiveStop').onclick=()=>{stopCoachVoice();paintLiveState(activeHost);};
}

import {createLiveCoach} from './live-coach.js';
import {mountOrbDragging} from './orb-position.js';
import {mountCoachOrb} from './coach-orb.js';
let active=null;
export function mountMapAssistant(ctx={}){
 active?.dispose();
 const root=document.createElement('aside');root.id='tnMapAssistant';root.className='mapAssistant';root.setAttribute('aria-label','True North voice assistant');
 root.innerHTML=`<section class="mapAssistantPanel" hidden><header><b>True North assistant</b><button type="button" data-close aria-label="Minimize assistant">×</button></header><p>Speak to build a route, manage stops, or check Ohio storms.</p><p class="mapAssistantDisclosure">Google Gemini processes your voice and authorized app context while voice is active.</p><div class="mapAssistantActions"><button type="button" data-start>Start voice</button><button type="button" data-pause hidden>Pause</button><button type="button" data-end hidden>End</button></div><p data-status role="status">Ready when you are.</p><div data-result class="mapAssistantResult" hidden></div></section><button class="mapAssistantLauncher tnCoachOrbStage" type="button" aria-label="Open voice assistant" aria-expanded="false" data-voice-state="idle"><canvas aria-hidden="true"></canvas><span class="mapAssistantOrbFallback" aria-hidden="true">✦</span></button>`;
 document.body.append(root);
 let css=document.querySelector('[data-map-assistant-css]');if(!css){css=document.createElement('link');css.rel='stylesheet';css.href='/tn-files/map-assistant.css';css.dataset.mapAssistantCss='1';document.head.append(css);}
 const panel=root.querySelector('section'),launch=root.querySelector('.mapAssistantLauncher'),status=root.querySelector('[data-status]'),start=root.querySelector('[data-start]'),pause=root.querySelector('[data-pause]'),end=root.querySelector('[data-end]');
 const identity=ctx.rep?.user_id||null;let state='idle',paused=false,busy=false,disposed=false;const controller=new AbortController();
 const orb=mountCoachOrb(root.querySelector('canvas'));
 const disposeDragging=mountOrbDragging(root,launch,panel);
 function show(open){panel.hidden=!open;root.classList.toggle('isOpen',open);disposeDragging.reposition();launch.setAttribute('aria-expanded',String(open));}
 async function executeMapTool(call){
  const session=await ctx.sb.auth.getSession();
  if(!session.data?.session||session.data.session.user.id!==identity)throw Error('Account changed. Restart voice.');
  const token=session.data.session.access_token;
  const r=await fetch('/api/coach',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({workspace:'map',toolCall:{name:call.name,args:call.args}}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])});
  const data=await r.json();if(disposed)throw Error('Assistant ended.');const current=await ctx.sb.auth.getSession();if(current.data?.session?.user?.id!==identity)throw Error('Account changed.');if(!r.ok)throw Error(data.error||'Command denied.');
  if(call.name==='get_live_context')return {...data,map:await ctx.getMapContext()};
  if(call.name==='recent_ohio_storms'){
    const result=root.querySelector('[data-result]');result.replaceChildren();result.hidden=false;
    const title=document.createElement('b');title.textContent=`Ohio: ${data.reportCount} reports across ${data.days} report days${data.partial?' · some sources unavailable':''}`;result.append(title);
    for(const report of data.reports.slice(0,8)){const row=document.createElement('p');const link=document.createElement('a');link.href=report.source;link.target='_blank';link.rel='noopener';link.textContent=`${report.county} · ${report.kind} · ${new Date(report.capturedAt).toLocaleString()}`;row.append(link);result.append(row);}return data;
  }
  if(!data.authorized||data.actorId!==session.data.session.user.id)throw Error('Command authorization failed.');
  if(busy)throw Error('A map command is already running.');busy=true;
  try{
    const result=await ctx.executeMapAction(data.execute.name,data.execute.args);
    const node=root.querySelector('[data-result]');node.hidden=false;node.textContent=result.estimatedMinutes?`${result.stops} houses · approximately ${result.estimatedMinutes} minutes, including ${result.stopMinutes} minutes per house.`:`Route ${result.status}.`;
    return result;
  }finally{busy=false;}
 }
 const voice=createLiveCoach(ctx,{workspace:'map',executeMapTool,onState(value){state=value;orb.setState(value);status.textContent=({idle:'Ready when you are.',connecting:'Connecting…',listening:'Listening. Speak naturally.',speaking:'Speaking. You can interrupt.',paused:'Microphone paused.',error:'Could not connect. Try again.'})[value]||value;const live=!['idle','error'].includes(value);start.hidden=live;pause.hidden=!live;end.hidden=!live;launch.setAttribute('aria-label',live?'Voice assistant active. Open controls.':'Open voice assistant');},onAudioLevel:levels=>orb.setLevels(levels),onError(error){status.textContent=error.message||String(error);show(true);}});
 launch.onclick=()=>show(panel.hidden);root.querySelector('[data-close]').onclick=()=>show(false);
 if(!ctx.sb||!identity){start.disabled=true;start.textContent='Sign in to use voice';status.textContent='Sign in to access your personal assistant.';}
 start.onclick=async()=>{if(!ctx.sb||!identity)return;start.disabled=true;try{await voice.start();}finally{start.disabled=false;}};
 end.onclick=()=>{voice.stop();paused=false;pause.textContent='Pause';};
 pause.onclick=()=>{paused=!paused;if(paused)voice.pause();else voice.resume();pause.textContent=paused?'Resume':'Pause';};
 const auth=ctx.sb?.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'||(session?.user?.id&&session.user.id!==identity))dispose();})?.data?.subscription;
 const feature=event=>{if(event.detail?.coach===false||event.detail?.map===false)voice.stop();};document.addEventListener('tn-feature-access',feature);
 function dispose(){if(disposed)return;disposed=true;controller.abort();voice.stop();disposeDragging();orb.dispose();auth?.unsubscribe();document.removeEventListener('tn-feature-access',feature);root.remove();}
 active={dispose};
 return active;
}

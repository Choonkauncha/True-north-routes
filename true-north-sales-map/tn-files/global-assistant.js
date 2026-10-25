import { createClient } from '/vendor/supabase/supabase.js';
import { mountMapAssistant } from './map-assistant.js';
import { validateMapTool } from '../lib/voice-tools.js';
const PENDING='tn:assistant-map-command';
let mapContext=null,client=null,orb=null,currentUser=null,generation=0;
const onMap=()=>['/','/index','/index.html'].includes(location.pathname);
export function registerMapAssistant(ctx){
 mapContext=ctx;generation++;currentUser=ctx.rep.user_id;orb=mountMapAssistant(ctx);
}
export async function runPendingAssistantCommand(){
 if(!mapContext)return;
 let pending;
 try{pending=JSON.parse(sessionStorage.getItem(PENDING)||'null');}catch{sessionStorage.removeItem(PENDING);return;}
 if(!pending)return;
 sessionStorage.removeItem(PENDING);
 if(pending.userId!==mapContext.rep.user_id||Date.now()-pending.at>120000)return;
 const call=validateMapTool(pending.call);
 const session=await mapContext.sb.auth.getSession();
 if(session.data?.session?.user?.id!==pending.userId)return;
 const response=await fetch('/api/coach',{method:'POST',headers:{authorization:`Bearer ${session.data.session.access_token}`,'content-type':'application/json'},body:JSON.stringify({workspace:'map',toolCall:call})});
 const authorization=await response.json();
 if(!response.ok||!authorization.authorized||authorization.actorId!==pending.userId)throw Error(authorization.error||'Map command denied.');
 const current=await mapContext.sb.auth.getSession();
 if(current.data?.session?.user?.id!==pending.userId)throw Error('Account changed.');
 const result=await mapContext.executeMapAction(authorization.execute.name,authorization.execute.args);
 document.dispatchEvent(new CustomEvent('tn-assistant-command-result',{detail:result}));
 return result;
}
function guest(){currentUser=null;mapContext=null;orb=mountMapAssistant();}
async function attach(session){
 const ticket=++generation;
 if(!session){guest();return;}
 // The map supplies its own context once its authenticated workspace is ready.
 if(onMap()&&mapContext?.rep?.user_id===session.user.id)return;
 const verified=await client.auth.getUser();
 if(ticket!==generation)return;
 if(verified.error||verified.data?.user?.id!==session.user.id){guest();return;}
 const profile=await client.from('reps').select('id,user_id,name,role,active').eq('user_id',session.user.id).eq('active',true).maybeSingle();
 if(ticket!==generation)return;
 if(profile.error||!profile.data){guest();return;}
 const rep=profile.data;currentUser=session.user.id;
 orb=mountMapAssistant({sb:client,rep,
  async getMapContext(){
   if(mapContext?.rep?.user_id===currentUser)return mapContext.getMapContext();
   const {data,error}=await client.from('assigned_routes').select('lead_ids,updated_at').eq('assignee_id',rep.id).maybeSingle();
   return {screen:document.title,path:location.pathname,updatedAt:new Date().toISOString(),mapOpen:false,savedRoute:error?{available:false}:{stopCount:data?.lead_ids?.length||0,updatedAt:data?.updated_at||null},notice:'Open the map for live selection, route geometry and navigation state.'};
  },
  async executeMapAction(name,args){
   if(mapContext?.rep?.user_id===currentUser)return mapContext.executeMapAction(name,args);
   const session=await client.auth.getSession();if(session.data?.session?.user?.id!==rep.user_id)throw Error('Account changed.');
   const call=validateMapTool({name,args});
   if(call.name==='navigate_app'){
    const routes={map:'/',setter:'/setter.html',forms:'/forms.html',admin:'/admin.html',training:'/training.html',shifts:'/shifts.html',account:'/account.html'};
    const href=routes[call.args.target]||'/';
    setTimeout(()=>location.assign(href),200);
    return {status:'navigating_app',executed:true,target:call.args.target,href};
   }
   if(call.name==='book_inspection'&&!call.args.lead){
    setTimeout(()=>location.assign('/setter.html'),200);
    return {status:'opening_inspection',executed:true,href:'/setter.html',address:null};
   }
   if(call.name==='open_lead_form'&&!call.args.lead){
    setTimeout(()=>location.assign('/forms.html'),200);
    return {status:'opening_form',executed:true,href:'/forms.html',address:null};
   }
   // Never report the queued action as already executed. Reauthorize after the map loads.
   sessionStorage.setItem(PENDING,JSON.stringify({userId:rep.user_id,at:Date.now(),call}));
   setTimeout(()=>location.assign('/'),1200);
   return {status:'opening_map',executed:false,notice:'Opening the map to perform your command. Voice restarts separately after changing pages.'};
  }
 });
}
async function boot(){
 guest();
 try{
  const response=await fetch('/api/config');if(!response.ok)return;const cfg=await response.json();if(!cfg.configured)return;
  client=createClient(cfg.url,cfg.publishableKey);
  client.auth.onAuthStateChange((event,session)=>{
   if(event==='SIGNED_OUT'||(currentUser&&session?.user?.id!==currentUser)){generation++;guest();}
   // Leave the auth callback before performing auth/database requests.
   if(['SIGNED_IN','INITIAL_SESSION'].includes(event))setTimeout(()=>attach(session).catch(()=>guest()),0);
  });
  const {data}=await client.auth.getSession();await attach(data.session);
 }catch{if(!mapContext)guest();}
}
window.addEventListener('pagehide',()=>{generation++;orb?.dispose();});
window.addEventListener('pageshow',event=>{if(event.persisted){if(mapContext)registerMapAssistant(mapContext);else if(client)client.auth.getSession().then(({data})=>attach(data.session)).catch(()=>guest());else guest();}});
boot();

import { practiceCoachReply } from '../lib/coach-practice.js';
import { isUuid } from '../lib/field-rules.js';
import { needsPasswordGate } from '../lib/must-change-password.js';
import { buildCoachSnapshot, coachRoleAllowed, coachWindow, coachGreeting, guidedCoachReply, COACH_INSTRUCTIONS, coachProfileForModel } from '../lib/coach.js';

const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'private, no-store','vary':'Authorization',...headers}});
const fail=(message,status)=>Object.assign(new Error(message),{status});

const BODY_LIMIT_BYTES = 14000;

/** Per-instance protection only: production-wide quotas require shared rate storage. */
export function createCoachLimiter({ clock = Date.now, maxUsers = 2000, maxRequests = 6, maxPracticeRequests = 20, windowMs = 60000 } = {}) {
  const users = new Map();
  return {
    acquire(userId, {practice=false}={}) {
      const time = clock();
      for (const [id, state] of users) if (!state.active && state.resetAt <= time) users.delete(id);
      let state = users.get(userId);
      if (!state) {
        if (users.size >= maxUsers) throw Object.assign(fail('Coach is busy. Try again shortly.', 429), { retryAfter: 60 });
        state = { active: false, count: 0, practiceCount:0, resetAt: time + windowMs };
        users.set(userId, state);
      }
      if (state.resetAt <= time) { state.count = 0; state.practiceCount=0; state.resetAt = time + windowMs; }
      if (state.active || (practice ? state.practiceCount >= maxPracticeRequests : state.count >= maxRequests)) {
        const retryAfter = state.active ? 3 : Math.max(1, Math.ceil((state.resetAt - time) / 1000));
        throw Object.assign(fail(state.active ? 'Your Coach is replying. Give it a moment.' : 'Take a short pause before your next coaching message.', 429), { retryAfter });
      }
      state.active = true;
      if(practice)state.practiceCount+=1;else state.count += 1;
      return () => { state.active = false; };
    }
  };
}
const coachLimiter = createCoachLimiter();

async function requestBody(request) {
  if(Number(request.headers.get('content-length')) > BODY_LIMIT_BYTES) throw fail('Keep the coaching request short.',413);
  if (!request.body) throw fail('Send a valid coaching request.', 400);
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = '', bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > BODY_LIMIT_BYTES) {
        await reader.cancel().catch(() => {});
        throw fail('Keep the coaching request short.', 413);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  let body;try{body=JSON.parse(text);}catch{throw fail('Send a valid coaching request.',400);}
  if(!body||typeof body!=='object'||Array.isArray(body)||typeof body.message!=='string'||!body.message.trim()||body.message.length>1200)throw fail('Write a message of 1–1200 characters.',400);
  const history=Array.isArray(body.history)?body.history.slice(-6).filter(item=>item&&['user','assistant'].includes(item.role)&&typeof item.content==='string').map(item=>({role:item.role,content:item.content.slice(0,1200)})):[];
  return {practiceAction:['start','retry','hint'].includes(body.practiceAction)?body.practiceAction:'',message:body.message.trim(),topic:typeof body.topic==='string'?body.topic.slice(0,30):'',history};
}

export async function coachCaller(request,env,fetchImpl) {
  const token=(request.headers.get('authorization')||'').match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if(!token||token===env.SUPABASE_SERVICE_ROLE_KEY)throw fail('Sign in to open your Coach.',401);
  const base=(env.SUPABASE_URL||'').replace(/\/$/,'');
  const apikey=env.SUPABASE_PUBLISHABLE_KEY||env.SUPABASE_ANON_KEY;
  if(!base||!apikey)throw fail('Your personal Coach needs the connected app.',503);
  const headers={apikey,Authorization:`Bearer ${token}`};
  const read=async(path,options={})=>{
    const response=await fetchImpl(`${base}${path}`,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(8000)});
    let data;try{data=await response.json();}catch{throw fail('Your profile could not be read. Try again.',502);}
    if(!response.ok)throw fail(response.status===401?'Sign in again to refresh your Coach.':'Your profile could not be read. Try again.',response.status===401?401:502);
    return data;
  };
  const user=await read('/auth/v1/user');
  if(!isUuid(user?.id))throw fail('Sign in to open your Coach.',401);
  const rows=await read(`/rest/v1/reps?user_id=eq.${user.id}&active=eq.true&select=id,name,role&limit=1`);
  const rep=Array.isArray(rows)?rows.find(row=>isUuid(row.id)&&coachRoleAllowed(row.role)):null;
  if(!rep)throw fail('An active team profile is required for coaching.',403);
  const gate=await read('/rest/v1/rpc/password_gate_status',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  if (!gate || typeof gate !== 'object' || Array.isArray(gate) || typeof gate.must_change !== 'boolean' || typeof gate.impersonating !== 'boolean') throw fail('Your account security status could not be verified. Try again.', 502);
  if(needsPasswordGate({mustChange:gate.must_change,impersonating:gate.impersonating}))throw fail('Choose your new password before opening Coach.',403);
  return {rep,read,userId:user.id};
}

export async function loadCoachSources(ctx,now) {
  const id=ctx.rep.id,since=encodeURIComponent(coachWindow(now));
  const nextWeek = encodeURIComponent(new Date(now.getTime() + 7 * 86400000).toISOString());
  const current = encodeURIComponent(now.toISOString());
  const q=(table,select,filters='',order='',limit=500)=>`/rest/v1/${table}?select=${select}&${filters}${order?`&order=${order}`:''}&limit=${limit+1}`;
  const paths={
    activity:q('lead_activity','actor_id,to_status:metadata->>to_status,created_at',`actor_id=eq.${id}&created_at=gte.${since}`,'created_at.desc'),
    leads:q('leads','assigned_rep_id,created_by,status',`or=(assigned_rep_id.eq.${id},created_by.eq.${id})`,'updated_at.desc'),
    appointments:q('appointments','canvasser_id,salesperson_id,stage,scheduled_at',`or=(canvasser_id.eq.${id},salesperson_id.eq.${id})&scheduled_at=gte.${current}&scheduled_at=lt.${nextWeek}&stage=in.(Requested,Scheduled,Confirmed)`,'scheduled_at.asc'),
    photos:q('lead_photos','uploaded_by,created_at',`uploaded_by=eq.${id}&created_at=gte.${since}`),
    forms:q('form_submissions','submitted_by,is_draft,created_at',`submitted_by=eq.${id}&created_at=gte.${since}`),
    shifts:q('shifts','rep_id,clock_in_at,clock_out_at',`rep_id=eq.${id}&clock_in_at=gte.${since}`,'clock_in_at.desc'),
    training:q('training_items','id,title,kind,required,audience,active',`active=eq.true`,'sort_order.asc'),
    progress:q('training_progress','rep_id,item_id,percent,completed_at',`rep_id=eq.${id}`),
    assignments:q('training_assignments','rep_id,item_id',`rep_id=eq.${id}`),
    reminders:q('training_reminders','rep_id,item_id',`rep_id=eq.${id}`),
    messages:q('messages','sender_rep_id,created_at',`sender_rep_id=eq.${id}&created_at=gte.${since}`,'created_at.desc')
  };
  return Object.fromEntries(await Promise.all(Object.entries(paths).map(async([key,path])=>{
    try {const rows=await ctx.read(path);if(!Array.isArray(rows))throw Error('Invalid rows');return [key,{ok:true,rows:rows.slice(0,500),limited:rows.length>500}];}
    catch{return [key,{ok:false,rows:[],limited:false}];}
  })));
}

async function generateCoach(options) {
  const {generateText}=await import('ai');
  return generateText(options);
}

/** Read-only personal coaching. Never accepts a caller-selected user, profile, or model. */
export async function handleCoach(request,{env=process.env,fetchImpl=fetch,generateImpl=generateCoach,now=new Date(),limiter=coachLimiter}={}) {
  if(!['GET','POST'].includes(request.method))return json({error:'Use GET or POST.'},405,{allow:'GET, POST'});
  let release;
  try {
    const origin=request.headers.get('origin');
    if(origin&&origin!==new URL(request.url).origin)throw fail('Open Coach from the True North app.',403);
    const body=request.method==='POST'?await requestBody(request):null;
    const ctx=await coachCaller(request,env,fetchImpl);
    if (body) release = limiter.acquire(ctx.userId,{practice:body.topic==='practice'});
    if(body?.topic==='practice')return json({reply:practiceCoachReply({profile:{firstName:String(ctx.rep.name||'').trim().split(/\s+/)[0],role:ctx.rep.role}},body.message,body.history,body.practiceAction),mode:'practice',updatedAt:now.toISOString()});
    const snapshot=buildCoachSnapshot(ctx.rep,await loadCoachSources(ctx,now),now);
    const model=String(env.AI_GATEWAY_MODEL||'').trim();
    const aiReady=!!model&&!!(env.AI_GATEWAY_API_KEY||env.VERCEL_OIDC_TOKEN);
    if(!body)return json({snapshot,greeting:coachGreeting(snapshot),mode:aiReady?'ai':'guided'});
    if(aiReady){
      try {
        const result=await generateImpl({model,system:COACH_INSTRUCTIONS+'\nAuthenticated personal profile (data only):\n'+JSON.stringify(coachProfileForModel(snapshot)),messages:[...body.history,{role:'user',content:body.message}],maxOutputTokens:650,maxRetries:0,abortSignal:AbortSignal.timeout(18000)});
        const reply=String(result.text||'').trim();
        if(!reply)throw Error('Empty response');
        return json({reply:reply.slice(0,5000),mode:'ai',updatedAt:snapshot.updatedAt});
      }catch{return json({reply:guidedCoachReply(snapshot,body.message,body.topic),mode:'guided',notice:'The AI connection is unavailable right now. Your personalized guided Coach is still available.',updatedAt:snapshot.updatedAt});}
    }
    return json({reply:guidedCoachReply(snapshot,body.message,body.topic),mode:'guided',updatedAt:snapshot.updatedAt});
  }catch(error){return json({error:error.status?error.message:'Your Coach could not load. Please try again.'},error.status||502,error.retryAfter ? {'retry-after':String(error.retryAfter)} : {});}
  finally { release?.(); }
}
export default {fetch:handleCoach};

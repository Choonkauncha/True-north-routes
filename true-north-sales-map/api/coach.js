import { requireFeature } from '../lib/features.js';
import { isUuid } from '../lib/field-rules.js';
import { needsPasswordGate } from '../lib/must-change-password.js';
import { buildCoachSnapshot, coachRoleAllowed, coachWindow, coachGreeting } from '../lib/coach.js';

const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'private, no-store','vary':'Authorization',...headers}});
const fail=(message,status)=>Object.assign(new Error(message),{status});


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
  await requireFeature(request,'training',{env,fetchImpl});
  await requireFeature(request,'coach',{env,fetchImpl});
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

/** Read-only personal context for the voice Coach. */
export async function handleCoach(request,{env=process.env,fetchImpl=fetch,now=new Date()}={}) {
  if(request.method!=='GET')return json({error:'Coach is voice-only. Start Live voice in the app.',},405,{allow:'GET'});
  try {
    const origin=request.headers.get('origin');
    if(origin&&origin!==new URL(request.url).origin)throw fail('Open Coach from the True North app.',403);
    const ctx=await coachCaller(request,env,fetchImpl);
    const snapshot=buildCoachSnapshot(ctx.rep,await loadCoachSources(ctx,now),now);
    return json({snapshot,greeting:coachGreeting(snapshot),mode:'voice'});
  }catch(error){return json({error:error.status?error.message:'Your Coach could not load. Please try again.'},error.status||502);}
}
export default {fetch:handleCoach};

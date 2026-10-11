import {coachCaller} from './coach.js';
import {normalizeToolCall} from '../lib/voice-tools.js';
import {planVoiceAction} from '../lib/voice-actions.js';
import {isUuid} from '../lib/field-rules.js';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'private, no-store'}});
export async function handleVoiceAction(request,{env=process.env,fetchImpl=fetch}={}){
  if(request.method!=='POST')return json({error:'POST required'},405);
  try{
    const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return json({error:'Origin denied'},403);
    const ctx=await coachCaller(request,env,fetchImpl);
    const body=await request.json();const action=normalizeToolCall(body?.toolCall);
    if(action.action==='route.build'){
      const result=planVoiceAction({role:ctx.rep.role,actorId:ctx.userId,...action,confirmed:false});
      return json({status:'awaiting_confirmation',proposal:{action:'route.build',stops:result.stops},message:`I have ${result.stops.length} stops ready. Please review and confirm them in the CRM before building the route.`});
    }
    if(action.action==='profile.read'){
      if(ctx.rep.role!=='admin')return json({error:'Administrator access required'},403);
      if(!isUuid(action.targetUserId))return json({error:'Invalid user ID'},400);
      // Query with the authenticated user's JWT: RLS must permit the requested profile.
      const rows=await ctx.read(`/rest/v1/reps?user_id=eq.${action.targetUserId}&active=eq.true&select=id,user_id,name,role&limit=1`);
      const target=Array.isArray(rows)?rows[0]:null;
      if(!target||target.user_id!==action.targetUserId)return json({error:'Profile not found or not authorized'},404);
      return json({status:'read_only',profile:{id:target.id,name:target.name,role:target.role},adminProfileImmutable:target.role==='admin'});
    }
    return json({error:'Unsupported action'},400);
  }catch(error){return json({error:error.status?error.message:'Voice action could not be completed'},error.status||400);}
}
export default {fetch:handleVoiceAction};

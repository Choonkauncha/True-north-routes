import {validateMapTool} from './voice-tools.js';

export const ASSISTANT_GREETING = "Hi, I'm your True North assistant — I can build your route, find priority leads, log door status, book inspections, check storms, or summarize your day.";

export const ASSISTANT_GREETING_STEPS = [
 {atMs:0,   energy:.55, text:"Hi, I'm your True North assistant — I can build your route…",       revealStep:1},
 {atMs:95,  energy:.72, text:"Hi, I'm your True North assistant — I can build routes, find priority leads…", revealStep:2},
 {atMs:190, energy:.64, text:"Hi, I'm your True North assistant — I can log door answers, book inspections…", revealStep:3},
 {atMs:285, energy:.52, text:"Hi, I'm your True North assistant — I can check Ohio storms, summarize stats, or navigate.", revealStep:4},
 {atMs:420, energy:0,   text:ASSISTANT_GREETING, revealStep:5}
];

export const ASSISTANT_ACTION_WORDS = [
 {id:'build_route',              label:'Build route',      command:'build_route',              args:{},                   step:1, tone:'primary'},
 {id:'build_timed_route',        label:'Plan 2 hours',     command:'build_timed_route',        args:{minutes:120},        step:1, tone:'cyan'},
 {id:'find_priority_leads',      label:'Priority leads',   command:'find_priority_leads',      args:{count:12},           step:2, tone:'cyan'},
 {id:'filter_untouched',         label:'Untouched homes',  command:'filter_leads',             args:{status:'New'},       step:2, tone:'glass'},
 {id:'select_visible_addresses', label:'Select houses',    command:'select_visible_addresses', args:{},                   step:2, tone:'glass'},
 {id:'log_answered',             label:'Log answered',     command:'log_door_status',          args:{status:'Knocked'},   step:3, tone:'emerald'},
 {id:'log_no_answer',            label:'No answer',        command:'log_door_status',          args:{status:'No Answer'}, step:3, tone:'amber'},
 {id:'book_inspection',          label:'Book inspection',  command:'book_inspection',          args:{},                   step:3, tone:'cyan'},
 {id:'recent_ohio_storms',       label:'Ohio storms',      command:'recent_ohio_storms',       args:{days:3},             step:4, tone:'glass'},
 {id:'summarize_status',         label:'My summary',       command:'summarize_status',         args:{},                   step:4, tone:'glass'},
 {id:'route_navigation',         label:'Start nav',        command:'route_navigation',         args:{action:'start'},     step:4, tone:'cyan'},
 {id:'clear_route',              label:'Clear route',      command:'clear_route',              args:{},                   step:4, tone:'danger'}
];

/** Match spoken or typed natural-language commands to a validated map tool call. */
export function matchAssistantIntent(input){
 const raw=String(input||'').trim();
 if(!raw)return null;
 const text=raw.toLowerCase();
 if(/\b(clear|reset|empty)\b.*\b(route|stops)\b/.test(text))return validateMapTool({name:'clear_route',args:{}});
 const hoursMatch=text.match(/\b(\d+(?:\.\d+)?)\s*(?:hour|hr|hrs)\b/);
 const minsMatch=text.match(/\b(\d+)\s*(?:minute|min|mins)\b/);
 if((hoursMatch||minsMatch)&&/\b(route|plan|build|work)\b/.test(text)){
  const minutes=Math.min(480,Math.max(15,Math.round(hoursMatch?Number(hoursMatch[1])*60:Number(minsMatch[1]))));
  return validateMapTool({name:'build_timed_route',args:{minutes}});
 }
 if(/\bplan\s+2\s+hours\b/.test(text))return validateMapTool({name:'build_timed_route',args:{minutes:120}});
 if(/\b(priority|best|top|high[- ]score\w*|nearby)\s+(leads?|houses|homes|stops)\b/.test(text)){
  const countMatch=text.match(/\b(\d{1,2})\b/);
  const count=countMatch?Math.min(40,Math.max(1,Number(countMatch[1]))):12;
  return validateMapTool({name:'find_priority_leads',args:{count,build:/\bbuild\b/.test(text)}});
 }
 if(/\b(re-?optimize|reorder)\b.*\broute\b/.test(text))return validateMapTool({name:'optimize_route',args:{}});
 if(/\b(select|add)\s+(all\s+)?(visible|screen|cluster|area)\s*(houses|addresses|leads|homes)?\b/.test(text))return validateMapTool({name:'select_visible_addresses',args:{}});
 if(/\b(build|make|create|start)\b.*\broute\b/.test(text)){
  const countMatch=text.match(/\b(\d{1,2})\s*(?:stops?|houses?|homes?|leads?)\b/);
  const mode=/\bwalk(ing)?\b/.test(text)?'walking':undefined;
  return validateMapTool({name:'build_route',args:{...(countMatch?{count:Math.min(80,Math.max(1,Number(countMatch[1])))}:{}),...(mode?{mode}:{})}});
 }
 if(/\b(next\s+stop|advance\s+stop)\b/.test(text))return validateMapTool({name:'route_navigation',args:{action:'next'}});
 if(/\b(pause)\s+(nav|navigation|route)\b/.test(text))return validateMapTool({name:'route_navigation',args:{action:'pause'}});
 if(/\b(resume|continue)\s+(nav|navigation|route)\b/.test(text))return validateMapTool({name:'route_navigation',args:{action:'resume'}});
 if(/\b(stop|end|exit)\s+(nav|navigation)\b/.test(text))return validateMapTool({name:'route_navigation',args:{action:'end'}});
 if(/\b(start\s+nav|navigate|start\s+driving|turn[- ]by[- ]turn)\b/.test(text))return validateMapTool({name:'route_navigation',args:{action:'start'}});
 if(/\b(no\s+answer|didn'?t\s+answer|not\s+home|nobody\s+home)\b/.test(text))return validateMapTool({name:'log_door_status',args:{status:'No Answer'}});
 if(/\b(log\s+answered|they\s+answered|mark\s+answered|mark\s+knocked|door\s+answered)\b/.test(text))return validateMapTool({name:'log_door_status',args:{status:'Knocked'}});
 if(/\b(book|schedule)\s+(an?\s+)?inspection\b/.test(text))return validateMapTool({name:'book_inspection',args:{}});
 if(/\b(file|open|fill)\s+(a\s+)?form\b/.test(text))return validateMapTool({name:'open_lead_form',args:{}});
 if(/\b(storm|hail|wind|noaa|weather)\b/.test(text))return validateMapTool({name:'recent_ohio_storms',args:{days:3}});
 if(/\b(summary|summarize|my\s+stats|how\s+many\s+(stops|houses|leads)|status\s+count)\b/.test(text))return validateMapTool({name:'summarize_status',args:{}});
 if(/\b(filter|show\s+only|show)\b.*\b(untouched|new)\b|\buntouched\s+(homes|houses|leads)\b/.test(text))return validateMapTool({name:'filter_leads',args:{status:'New'}});
 if(/\b(filter|show\s+only|show)\b.*\b(interested)\b/.test(text))return validateMapTool({name:'filter_leads',args:{status:'Interested'}});
 if(/\b(filter|show\s+only|show)\b.*\b(knocked)\b/.test(text))return validateMapTool({name:'filter_leads',args:{status:'Knocked'}});
 if(/\b(filter|show\s+only|show)\b.*\b(all\s+houses|all\s+leads|clear\s+filter)\b/.test(text))return validateMapTool({name:'filter_leads',args:{status:'All'}});
 if(/\b(zoom|center|focus)\b.*\b(me|my\s+location|here)\b/.test(text))return validateMapTool({name:'focus_location',args:{target:'me'}});
 if(/\bclock\s+in\b/.test(text))return validateMapTool({name:'clock_shift',args:{action:'in'}});
 if(/\bclock\s+out\b/.test(text))return validateMapTool({name:'clock_shift',args:{action:'out'}});
 if(/\b(open|go\s+to)\s+(admin|management)\b/.test(text))return validateMapTool({name:'navigate_app',args:{target:'admin'}});
 if(/\b(open|go\s+to)\s+(setter)\b/.test(text))return validateMapTool({name:'navigate_app',args:{target:'setter'}});
 if(/\b(open|go\s+to)\s+(training|coach)\b/.test(text))return validateMapTool({name:'navigate_app',args:{target:'training'}});
 if(/\b(open|go\s+to)\s+(shifts)\b/.test(text))return validateMapTool({name:'navigate_app',args:{target:'shifts'}});
 const searchMatch=raw.match(/^(?:search|find|jump\s+to|locate)\s+(.{3,120})$/i);
 if(searchMatch)return validateMapTool({name:'search_address',args:{query:searchMatch[1].trim()}});
 return null;
}

/** One shared execution lane for voice and buttons, with a fresh server check per command. */
export function createAssistantCommandRunner({authorize,execute,getContext,isCurrent=()=>true,onStart=()=>{},onResult=()=>{}}){
 let queue=Promise.resolve();
 return function run(raw,{signal}={}){
  const call=validateMapTool(raw);
  const assertCurrent=()=>{if(signal?.aborted||!isCurrent())throw Error('Command cancelled. Restart the assistant.');};
  const operation=queue.then(async()=>{
   assertCurrent();onStart(call);
   try{
    const authorization=await authorize(call,{signal});assertCurrent();
    let result;
    if(call.name==='get_live_context')result={...authorization,map:await getContext()};
    else if(call.name==='recent_ohio_storms')result=authorization;
    else {
     if(!authorization.authorized||!authorization.execute)throw Error('Command authorization failed.');
     const approved=validateMapTool(authorization.execute);
     if(approved.name!==call.name)throw Error('The authorized command did not match the request.');
     result=await execute(approved.name,approved.args);
     if(!result||typeof result.status!=='string')throw Error('The app did not confirm the command result.');
    }
    assertCurrent();onResult(call,result);return result;
   }catch(error){onResult(call,{error:error.message||'Command failed.',executed:false});throw error;}
  });
  queue=operation.catch(()=>{});return operation;
 };
}

export function commandResultText(result){
 if(result?.error)return result.error;
 if(result?.status==='opening_map')return 'Opening the field map to finish your command…';
 if(result?.status==='built')return `${result.stops} houses · ${result.estimatedMinutes?`about ${result.estimatedMinutes} minutes including visits`:'route built'}.${result.approximate?' Estimate only; review before navigating.':''}`;
 if(result?.status==='prioritized')return `${result.selectedCount} priority leads selected${result.topAddress?` · Top: ${result.topAddress}`:''}.`;
 if(result?.status==='optimized')return `Route re-optimized · ${result.stops} stops ready.`;
 if(result?.status==='cleared')return `Route cleared. ${result.removed} selected houses removed.`;
 if(result?.status==='selected')return `${result.selectedCount} houses selected. Ready to build.`;
 if(result?.status==='removed')return `Stop removed. ${result.remaining} houses remain.`;
 if(result?.status==='filtered')return `Showing ${result.visibleCount} ${result.filterStatus==='All'?'total':result.filterStatus.toLowerCase()} houses.`;
 if(result?.status==='focused')return `Focused ${result.address||'house'}${result.leadStatus?` (${result.leadStatus})`:''}.`;
 if(result?.status==='focused_location')return result.target==='route'?`Centered on ${result.count||0} route stops.`:result.target==='all'?`Showing ${result.count||0} mapped houses.`:'Centered on your location.';
 if(result?.status==='door_logged')return `Logged ${result.label||result.doorStatus} · ${result.address||'house'}.`;
 if(result?.status==='opening_inspection')return `Opening inspection booking${result.address?` for ${result.address}`:''}…`;
 if(result?.status==='opening_form')return `Opening field form${result.address?` for ${result.address}`:''}…`;
 if(result?.status==='summary')return `${result.total||0} houses (${result.untouched||0} untouched, ${result.knocked||0} knocked, ${result.interested||0} interested) · ${result.routeStops||0} route stops.`;
 if(result?.status==='clock_toggled')return result.clockState==='in'?'Clocked in for shift.':'Clocked out of shift.';
 if(result?.status==='clock_unchanged')return result.clockState==='in'?'Already clocked in.':'Already clocked out.';
 if(result?.status==='opening_shifts')return 'Opening Shifts…';
 if(result?.status==='navigating_app')return `Opening ${result.target}…`;
 if(result?.status==='next_stop')return `Next stop (${result.index}/${result.total}): ${result.address||'stop'}.`;
 if(result?.status==='not_started')return 'Navigation could not start. Check location access.';
 if(result?.status)return `Navigation ${result.status}.`;
 if(result?.map)return `${result.map.selectedCount||0} houses selected · ${result.map.route?.length||0} built stops.`;
 if(Number.isFinite(result?.reportCount))return `${result.reportCount} recent Ohio storm reports${result.partial?' · some sources unavailable':''}.`;
 return 'Command completed.';
}

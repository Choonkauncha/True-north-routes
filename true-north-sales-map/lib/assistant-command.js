import {validateMapTool} from './voice-tools.js';

export const ASSISTANT_GREETING = "Hi, I'm your True North assistant.";

export const ASSISTANT_GREETING_STEPS = [
 {
  atMs:0,
  energy:.58,
  text:"Hi, I'm your True North assistant.",
  revealStep:1,
  parts:[{type:'text',text:"Hi, I'm your True North assistant."}]
 },
 {
  atMs:1350,
  energy:.72,
  text:"I can build your route or find priority leads.",
  revealStep:2,
  parts:[
   {type:'text',text:'I can '},
   {type:'action',id:'build_route',label:'build your route',command:'build_route',args:{}},
   {type:'text',text:' or '},
   {type:'action',id:'priority_leads',label:'find priority leads',command:'find_priority_leads',args:{count:12}},
   {type:'text',text:'.'}
  ]
 },
 {
  atMs:2750,
  energy:.64,
  text:"Or log answered and book an inspection.",
  revealStep:3,
  parts:[
   {type:'text',text:'Or '},
   {type:'action',id:'mark_answered',label:'log answered',command:'log_door_status',args:{status:'Knocked'}},
   {type:'text',text:' and '},
   {type:'action',id:'book_inspection',label:'book an inspection',command:'book_inspection',args:{}},
   {type:'text',text:'.'}
  ]
 },
 {
  atMs:4150,
  energy:0,
  text:"Speak or tap Build route · Priority leads · Book inspection.",
  revealStep:4,
  parts:[
   {type:'text',text:'Speak or tap '},
   {type:'action',id:'build_route',label:'Build route',command:'build_route',args:{}},
   {type:'text',text:' · '},
   {type:'action',id:'priority_leads',label:'Priority leads',command:'find_priority_leads',args:{count:12}},
   {type:'text',text:' · '},
   {type:'action',id:'book_inspection',label:'Book inspection',command:'book_inspection',args:{}}
  ]
 }
];

export const ASSISTANT_ACTION_WORDS = [
 {id:'build_route',     label:'Build route',     command:'build_route',         args:{},                 step:2},
 {id:'priority_leads',  label:'Priority leads',  command:'find_priority_leads', args:{count:12},         step:2},
 {id:'mark_answered',   label:'Log answered',    command:'log_door_status',     args:{status:'Knocked'}, step:3},
 {id:'book_inspection', label:'Book inspection', command:'book_inspection',     args:{},                 step:3}
];

const WORD_NUMBERS = {
 one:1, two:2, three:3, four:4, five:5,
 six:6, seven:7, eight:8, nine:9, ten:10,
 eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15,
 sixteen:16, seventeen:17, eighteen:18, nineteen:19, twenty:20,
 'twenty-five':25, 'twenty five':25, thirty:30, 'thirty-five':35, 'thirty five':35,
 forty:40, 'forty-five':45, 'forty five':45, fifty:50, sixty:60,
 seventy:70, eighty:80, ninety:90
};

function normalizeSpokenNumbers(text){
 let out=text
  .replace(/\b(?:an|one|1)\s+hour\s+and\s+a\s+half\b/g,'90 minutes')
  .replace(/\b(?:one|1)\s+and\s+a\s+half\s+hours?\b/g,'90 minutes')
  .replace(/\b(?:two|2)\s+and\s+a\s+half\s+hours?\b/g,'150 minutes')
  .replace(/\b(?:three|3)\s+and\s+a\s+half\s+hours?\b/g,'210 minutes')
  .replace(/\b(?:half\s+an?\s+hour|a\s+half\s+hour|half[- ]hour)\b/g,'30 minutes')
  .replace(/\ban\s+(?=hours?\b|hr\b)/g,'1 ');
 for(const [word,num] of Object.entries(WORD_NUMBERS)){
  const beforeUnit=new RegExp(`\\b${word}\\b(?=\\s*-?\\s*(?:hours?|hrs?|hr|minutes?|mins?|min|days?|stops?|houses?|homes?|leads?|doors?|addresses|pins?|properties|priority|best|top)\\b)`,'g');
  out=out.replace(beforeUnit,String(num));
  const afterCue=new RegExp(`(\\b(?:top|best|priority|first|next|build|plan|find|select|for|with|of)\\s+)${word}\\b`,'g');
  out=out.replace(afterCue,`$1${num}`);
 }
 return out;
}

/** Clean a spoken or returned message down to a single concise sentence for the minimal HUD. */
export function singleSentenceText(input){
 const clean=String(input||'').replace(/\s+/g,' ').trim();
 if(!clean)return '';
 const match=clean.match(/^[^.!?]+[.!?]/);
 return (match?match[0]:clean).slice(0,120).trim();
}

/** Match spoken or typed natural-language commands to a validated map tool call. */
export function matchAssistantIntent(input){
 const raw=String(input||'').trim();
 if(!raw)return null;
 const text=raw.toLowerCase();
 const norm=normalizeSpokenNumbers(text);

 // 1. Remove a specific stop from the active route
 const removeStopMatch=raw.match(/^(?:remove|delete|drop)\s+(?:route\s+stop\s+|stop\s+)?(.+?)(?:\s+from\s+(?:my\s+|the\s+)?route)?$/i);
 if(removeStopMatch&&!/^(?:my\s+|the\s+|current\s+|all\s+)?(?:route|stops?|houses?|homes?|leads?|addresses|filters?)$/i.test(removeStopMatch[1].trim())){
  if(/\b(stop|from\s+(?:my\s+|the\s+)?route)\b/i.test(raw)){
   return validateMapTool({name:'remove_route_stop',args:{stop:removeStopMatch[1].trim()}});
  }
 }

 // 2. Clear / reset route
 if(!/\bfilters?\b/.test(text)&&(
  /\b(clear|reset|empty|wipe|delete|cancel)\b.*\b(route|stops?)\b/.test(text)||
  /\b(route|stops?)\b.*\b(clear|reset|empty)\b/.test(text)||
  /\b(unselect|deselect|clear)\s+(?:all\s+)?(?:selected\s+)?(houses?|homes?|leads?|addresses|stops?)\b/.test(text)
 )){
  return validateMapTool({name:'clear_route',args:{}});
 }

 // 3. Timed route planning (hours / minutes)
 const hoursMatch=norm.match(/\b(\d+(?:\.\d+)?)\s*-?\s*(?:hours?|hrs?|hr)\b/);
 const minsMatch=norm.match(/\b(\d+)\s*-?\s*(?:minutes?|mins?|min)\b/);
 if((hoursMatch||minsMatch)&&/\b(route|plan\w*|build\w*|make|create|work\w*|knock\w*|canvass\w*|doors?|stops?|houses?|homes?|have|for)\b/.test(norm)){
  const totalMinutes=(hoursMatch?Number(hoursMatch[1])*60:0)+(minsMatch?Number(minsMatch[1]):0);
  const minutes=Math.min(480,Math.max(15,Math.round(totalMinutes)));
  const mode=/\bwalk(ing)?\b/.test(text)?'walking':undefined;
  return validateMapTool({name:'build_timed_route',args:{minutes,...(mode?{mode}:{})}});
 }

 // 4. Find priority / top / best / high-score leads
 if(
  /\b(priority|best|top|high(?:est)?[- ]?(?:scor\w+|priority|value)|hottest)\b.*\b(leads?|houses?|homes?|stops?|doors?|addresses|properties)\b/.test(norm)||
  /\b(leads?|houses?|homes?|stops?|doors?|properties)\b.*\b(priority|high(?:est)?[- ]?scor\w+|top[- ]?rated)\b/.test(norm)||
  /\b(priority|top|best)\s+\d{1,2}\b/.test(norm)
 ){
  const countMatch=norm.match(/\b(\d{1,2})\b/);
  const count=countMatch?Math.min(40,Math.max(1,Number(countMatch[1]))):12;
  return validateMapTool({name:'find_priority_leads',args:{count,build:/\b(build|route)\b/.test(text)}});
 }

 // 5. Optimize / reorder route
 if(
  /\b((?:re-?)?optimize|reorder|recalculate|re-?sequence|sort)\b.*\b(route|stops?)\b/.test(text)||
  /\b(route|stops?)\b.*\b((?:re-?)?optimize|reorder|recalculate)\b/.test(text)
 ){
  const mode=/\bwalk(ing)?\b/.test(text)?'walking':undefined;
  return validateMapTool({name:'optimize_route',args:{...(mode?{mode}:{})}});
 }

 // 6. Select visible / screen / cluster addresses
 if(
  /\b(select|add)\b.*\b(visible|on\s+(?:the\s+)?screen|in\s+view|in\s+this\s+area|cluster|area)\b/.test(text)||
  /\b(select|add)\s+(?:all\s+|these\s+)?(?:visible\s+)?(houses?|addresses|leads?|homes?|doors?|pins?|properties)\b/.test(text)
 ){
  return validateMapTool({name:'select_visible_addresses',args:{}});
 }

 // 7. Route navigation (next / pause / resume / end / start) - evaluated before generic build_route
 if(/\b(next\s+(?:stop|house|home|door|lead|address)|advance\s+(?:to\s+)?(?:the\s+)?(?:next\s+)?stop|skip\s+(?:this\s+|to\s+next\s+)?(?:stop|house|home|door)|go\s+to\s+(?:the\s+)?next\s+(?:stop|house|door))\b/.test(text)){
  return validateMapTool({name:'route_navigation',args:{action:'next'}});
 }
 if(/\b(pause|hold)\b.*\b(nav\w*|route|driving|guidance)\b/.test(text)){
  return validateMapTool({name:'route_navigation',args:{action:'pause'}});
 }
 if(/\b(resume|continue|unpause|restart)\b.*\b(nav\w*|route|driving|guidance)\b/.test(text)){
  return validateMapTool({name:'route_navigation',args:{action:'resume'}});
 }
 if(/\b(stop|end|exit|cancel|quit|finish)\b.*\b(nav\w*|driving|turn[- ]by[- ]turn|guidance)\b/.test(text)){
  return validateMapTool({name:'route_navigation',args:{action:'end'}});
 }
 if(
  !/\bnavigate\s+to\s+(?:admin|management|setter|training|coach|shifts?|forms?|account|map)\b/.test(text)&&(
   /\b(start|begin|launch)\b.*\b(nav\w*|driving|turn[- ]by[- ]turn|guidance)\b/.test(text)||
   /\b(start\s+nav\w*|navigate(?:\s+(?:my\s+|the\s+)?route|\s+now)?|turn[- ]by[- ]turn|let'?s\s+drive|guide\s+me)\b/.test(text)
  )
 ){
  return validateMapTool({name:'route_navigation',args:{action:'start'}});
 }

 // 8. Map focus / zoom / center (me / route / all)
 if(/\b(zoom|center|focus|fit)\b.*\b(my\s+route|the\s+route|current\s+route|route\s+stops|active\s+route)\b|\b(zoom|center|focus|fit)\s+(?:on\s+|to\s+)?route\b/.test(text)){
  return validateMapTool({name:'focus_location',args:{target:'route'}});
 }
 if(/\b(zoom|center|focus|fit)\b.*\b(all\s+(?:houses?|homes?|leads?|pins?|stops?)|entire\s+map|whole\s+map)\b/.test(text)){
  return validateMapTool({name:'focus_location',args:{target:'all'}});
 }
 if(
  /\b(zoom|center|re-?center|focus|find|locate)\b.*\b(me|my\s+location|my\s+position|here|current\s+location)\b/.test(text)||
  /\b(where\s+am\s+i|re-?center(?:\s+(?:the\s+)?map)?|center\s+(?:the\s+)?map)\b/.test(text)
 ){
  return validateMapTool({name:'focus_location',args:{target:'me'}});
 }

 // 9. Summarize status / daily stats / doors or stops left
 if(
  /\b(summary|summarize|my\s+stats|today'?s\s+stats|daily\s+stats|status\s+count|how\s+many\s+(?:stops?|houses?|homes?|leads?|doors?)|(?:doors?|stops?|houses?|homes?|leads?)\s+(?:left|remaining)|how\s+am\s+i\s+doing|my\s+progress|summarize\s+my\s+day|my\s+day\s+summary)\b/.test(text)
 ){
  return validateMapTool({name:'summarize_status',args:{}});
 }

 // 10. Build route
 if(
  /\b(build|make|create|start|plan|generate|draw|set\s+up)\b.*\b(route|walk\s*list)\b/.test(norm)||
  /\broute\s+(?:me\s+to|for|with|of)\b.*\b(\d{1,2}|stops?|houses?|homes?|leads?|doors?|addresses)\b/.test(norm)||
  /\b(build|make|create|plan)\s+(?:a\s+|me\s+a\s+)?(\d{1,2})\s*-?\s*(?:stops?|houses?|homes?|leads?|doors?|addresses)\b/.test(norm)
 ){
  const countMatch=norm.match(/\b(\d{1,2})\s*-?\s*(?:stops?|houses?|homes?|leads?|doors?|addresses|pins?|properties)\b/)||norm.match(/\b(?:with|of|for|to)\s+(\d{1,2})\b/);
  const mode=/\bwalk(ing)?\b/.test(text)?'walking':undefined;
  return validateMapTool({name:'build_route',args:{...(countMatch?{count:Math.min(80,Math.max(1,Number(countMatch[1])))}:{}),...(mode?{mode}:{})}});
 }

 // 11. Filter leads
 if(/\b(clear|reset|remove)\s+(?:the\s+|all\s+|map\s+)?filters?\b|\b(filter|show\s+only|show|display|view)\b.*\b(all\s+(?:houses?|homes?|leads?|doors?|pins?|properties)|everything|clear\s+filter)\b|^show\s+all$/.test(text)){
  return validateMapTool({name:'filter_leads',args:{status:'All'}});
 }
 if(/\b(filter|show\s+only|show|display)\b.*\b(my\s+(?:leads?|houses?|homes?|doors?)|assigned\s+to\s+me|mine)\b/.test(text)){
  return validateMapTool({name:'filter_leads',args:{status:'All',mine:true}});
 }
 if(/\b(filter|show\s+only|show|display|see|find)\b.*\b(untouched|unknocked|unvisited|new|fresh)\b|\b(untouched|unknocked|unvisited|fresh|new)\s+(homes?|houses?|leads?|doors?|properties|pins?)\b/.test(text)){
  return validateMapTool({name:'filter_leads',args:{status:'New'}});
 }
 if(/\b(filter|show\s+only|show|display)\b.*\b(no\s+answers?|not\s+home|unanswered)\b|\bno\s+answer\s+(homes?|houses?|leads?|doors?)\b/.test(text)){
  return validateMapTool({name:'filter_leads',args:{status:'No Answer'}});
 }
 if(/\b(filter|show\s+only|show|display)\b.*\b(not\s+interested)\b|\bnot\s+interested\s+(homes?|houses?|leads?|doors?)\b/.test(text)){
  return validateMapTool({name:'filter_leads',args:{status:'Not Interested'}});
 }
 if(/\b(filter|show\s+only|show|display)\b.*\b(interested)\b|\binterested\s+(homes?|houses?|leads?|doors?)\b/.test(text)){
  return validateMapTool({name:'filter_leads',args:{status:'Interested'}});
 }
 if(/\b(filter|show\s+only|show|display)\b.*\b(do\s+not\s+knock|don'?t\s+knock|dnk)\b/.test(text)){
  return validateMapTool({name:'filter_leads',args:{status:'Do Not Knock'}});
 }
 if(/\b(filter|show\s+only|show|display)\b.*\b(appointments?|booked\s+(?:houses?|homes?|leads?))\b/.test(text)){
  return validateMapTool({name:'filter_leads',args:{status:'Appointment'}});
 }
 if(/\b(filter|show\s+only|show|display)\b.*\b(knocked|visited|answered)\b|\bknocked\s+(homes?|houses?|leads?|doors?)\b/.test(text)){
  return validateMapTool({name:'filter_leads',args:{status:'Knocked'}});
 }

 // 12. Door status logging (No Answer / Knocked / Do Not Knock / Not Interested / Interested)
 if(
  /\b(no\s+answer|didn'?t\s+answer|did\s+not\s+answer|not\s+home|wasn'?t\s+home|weren'?t\s+home|nobody(?:'?s|\s+is|\s+was)?\s+(?:home|there|answering)|no\s+one(?:'?s|\s+is|\s+was)?\s+(?:home|there|answering)|(?:nobody|no\s+one)\s+(?:answered|came\s+to\s+(?:the\s+)?door)|left\s+(?:a\s+)?(?:door\s+)?(?:hanger|flyer)|mark\s+no\s+answer|log\s+no\s+answer)\b/.test(text)
 ){
  return validateMapTool({name:'log_door_status',args:{status:'No Answer'}});
 }
 if(
  /\b(log\s+answered|they\s+answered|mark\s+answered|mark\s+(?:as\s+)?knocked|log\s+knocked|door\s+answered|(?:they|homeowner|owner|someone|somebody|resident|he|she)\s+(?:came\s+to\s+(?:the\s+)?door|answered(?:\s+the\s+door)?|was\s+home|were\s+home)|came\s+to\s+(?:the\s+)?door|answered\s+the\s+door|(?:talked|spoke)\s+(?:to|with)\s+(?:the\s+)?(?:homeowner|owner|resident)|knocked\s+(?:this|the)\s+(?:door|house|home))\b/.test(text)
 ){
  return validateMapTool({name:'log_door_status',args:{status:'Knocked'}});
 }
 if(/\b(mark|log|set)\s+(?:as\s+)?(?:do\s+not\s+knock|don'?t\s+knock|dnk)\b|\b(do\s+not\s+knock|no\s+soliciting)\b/.test(text)){
  return validateMapTool({name:'log_door_status',args:{status:'Do Not Knock'}});
 }
 if(/\b(mark|log|set|they\s+are|they'?re|homeowner\s+is|owner\s+is)\s+(?:as\s+)?not\s+interested\b|^not\s+interested$/.test(text)){
  return validateMapTool({name:'log_door_status',args:{status:'Not Interested'}});
 }
 if(/\b(mark|log|set|they\s+are|they'?re|homeowner\s+is|owner\s+is)\s+(?:as\s+)?interested\b/.test(text)){
  return validateMapTool({name:'log_door_status',args:{status:'Interested'}});
 }

 // 13. Book / schedule roof inspection
 if(/\b(book|schedule|set(?:\s+up)?)\b.*\b(inspection|roof\s+check|appointment|estimate)\b|\b(inspection|appointment)\b.*\b(book|schedule)\b/.test(text)){
  return validateMapTool({name:'book_inspection',args:{}});
 }

 // 14. Open / fill lead or field form
 if(/\b(file|open|fill(?:\s+out)?|start|launch|complete|new)\b.*\b(?:lead|field|intake|documentation|inspection|property|house)?\s*form\b|\b(lead|field|documentation|intake)\s+form\b/.test(text)){
  return validateMapTool({name:'open_lead_form',args:{}});
 }

 // 15. Recent Ohio storms / hail / wind / NOAA weather
 if(/\b(storms?|hail\w*|wind\s*(?:damage|reports?|storms?|alerts?|gusts?|map)?|noaa|weather|tornado\w*|swaths?)\b/.test(text)){
  const daysMatch=norm.match(/\b([1-7])\s*days?\b/);
  const days=daysMatch?Number(daysMatch[1]):3;
  return validateMapTool({name:'recent_ohio_storms',args:{days}});
 }

 // 16. Clock shift in / out / toggle
 if(/\b(clock(?:\s+me)?\s+in|punch\s+in|(?:start|begin|check\s+in\s+for)\s+(?:my\s+|the\s+)?shift)\b/.test(text)){
  return validateMapTool({name:'clock_shift',args:{action:'in'}});
 }
 if(/\b(clock(?:\s+me)?\s+out|punch\s+out|(?:end|finish|stop|check\s+out\s+of)\s+(?:my\s+|the\s+)?shift)\b/.test(text)){
  return validateMapTool({name:'clock_shift',args:{action:'out'}});
 }
 if(/\b(toggle\s+(?:my\s+)?(?:shift|clock))\b/.test(text)){
  return validateMapTool({name:'clock_shift',args:{action:'toggle'}});
 }

 // 17. App workspace navigation (admin / setter / training / shifts / forms / account / map)
 const navPrefix=/\b(open|go\s+to|take\s+me\s+to|switch\s+to|navigate\s+to|bring\s+up|launch|show\s+me)\b/;
 if((navPrefix.test(text)&&/\b(admin\w*|management|manager\s+(?:portal|dashboard|view))\b/.test(text))||/^(?:admin|management)(?:\s+(?:dashboard|portal|page))?$/.test(text)){
  return validateMapTool({name:'navigate_app',args:{target:'admin'}});
 }
 if((navPrefix.test(text)&&/\b(setter|intake|appointment\s+setter)\b/.test(text))||/^setter(?:\s+(?:portal|page|workspace))?$/.test(text)){
  return validateMapTool({name:'navigate_app',args:{target:'setter'}});
 }
 if((navPrefix.test(text)&&/\b(training|coach|coaching|practice|role-?play)\b/.test(text))||/^training(?:\s+(?:page|hub|portal))?$/.test(text)){
  return validateMapTool({name:'navigate_app',args:{target:'training'}});
 }
 if((navPrefix.test(text)&&/\b(shifts?|timesheet|time\s*clock|shift\s+schedule)\b/.test(text))||/^shifts?(?:\s+page)?$/.test(text)){
  return validateMapTool({name:'navigate_app',args:{target:'shifts'}});
 }
 if(navPrefix.test(text)&&/\bforms\b/.test(text)){
  return validateMapTool({name:'navigate_app',args:{target:'forms'}});
 }
 if((navPrefix.test(text)&&/\b(account|profile|settings)\b/.test(text))||/^my\s+(?:account|profile)$/.test(text)){
  return validateMapTool({name:'navigate_app',args:{target:'account'}});
 }
 if((navPrefix.test(text)&&/\b(field\s+map|sales\s+map|map\s+view|the\s+map|map)\b/.test(text))||/\bback\s+to\s+(?:the\s+)?map\b/.test(text)){
  return validateMapTool({name:'navigate_app',args:{target:'map'}});
 }

 // 18. Live context read
 if(/\b(get\s+live\s+context|refresh\s+context|live\s+context)\b/.test(text)){
  return validateMapTool({name:'get_live_context',args:{}});
 }

 // 19. Search street address or homeowner
 const searchMatch=raw.match(/^(?:search(?:\s+for)?|find(?:\s+address|\s+house|\s+homeowner)?|jump\s+to|locate|look\s+up|pull\s+up)\s+(.{3,120})$/i);
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
 if(result?.error)return singleSentenceText(result.error);
 if(result?.status==='opening_map')return 'Opening the field map to finish your command.';
 if(result?.status==='built')return `Built a ${result.stops}-stop route${result.estimatedMinutes?` (~${result.estimatedMinutes} min)`:' for you'}.`;
 if(result?.status==='prioritized')return `Selected ${result.selectedCount} priority leads${result.topAddress?` near ${result.topAddress}`:''}.`;
 if(result?.status==='optimized')return `Re-optimized your ${result.stops}-stop route.`;
 if(result?.status==='cleared')return `Route cleared (${result.removed} stops removed).`;
 if(result?.status==='selected')return `Selected ${result.selectedCount} houses on the map.`;
 if(result?.status==='removed')return `Removed stop (${result.remaining} remaining).`;
 if(result?.status==='filtered')return `Showing ${result.visibleCount} ${result.filterStatus==='All'?'total':result.filterStatus.toLowerCase()} houses.`;
 if(result?.status==='focused')return `Focused on ${result.address||'house'}${result.leadStatus?` (${result.leadStatus})`:''}.`;
 if(result?.status==='focused_location')return result.target==='route'?`Centered on ${result.count||0} route stops.`:result.target==='all'?`Showing ${result.count||0} mapped houses.`:'Centered on your location.';
 if(result?.status==='door_logged')return `Logged ${result.label||result.doorStatus} at ${result.address||'house'}.`;
 if(result?.status==='opening_inspection')return `Opening inspection booking${result.address?` for ${result.address}`:''}.`;
 if(result?.status==='opening_form')return `Opening field form${result.address?` for ${result.address}`:''}.`;
 if(result?.status==='summary')return `${result.total||0} houses (${result.untouched||0} untouched, ${result.knocked||0} knocked) · ${result.routeStops||0} route stops.`;
 if(result?.status==='clock_toggled')return result.clockState==='in'?'Clocked in for your shift.':'Clocked out of your shift.';
 if(result?.status==='clock_unchanged')return result.clockState==='in'?'You are already clocked in.':'You are already clocked out.';
 if(result?.status==='opening_shifts')return 'Opening Shifts.';
 if(result?.status==='navigating_app')return `Opening ${result.target}.`;
 if(result?.status==='next_stop')return `Next stop (${result.index}/${result.total}): ${result.address||'stop'}.`;
 if(result?.status==='not_started')return 'Navigation could not start.';
 if(result?.status)return `Navigation ${result.status}.`;
 if(result?.map)return `${result.map.selectedCount||0} houses selected · ${result.map.route?.length||0} built stops.`;
 if(Number.isFinite(result?.reportCount))return `${result.reportCount} recent Ohio storm reports${result.partial?' (partial)':''}.`;
 return 'Done.';
}

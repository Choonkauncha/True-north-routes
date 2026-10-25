import {validateRouteStops} from './voice-actions.js';
export const ROUTE_TOOL = {name:'draft_route',description:'Collect one or more street addresses into a proposed route. This is a draft only. Ask the user to confirm before executing it.',parameters:{type:'OBJECT',properties:{addresses:{type:'ARRAY',items:{type:'STRING'},description:'Complete street addresses, including city and state when known'}},required:['addresses']}};
export const PROFILE_TOOL = {name:'inspect_team_profile',description:'Admin only: inspect one non-admin team member profile by its UUID. Never disclose other profiles to appointment setters.',parameters:{type:'OBJECT',properties:{user_id:{type:'STRING'}},required:['user_id']}};
export function toolDefinitions(role,{map=false}={}){if(map)return [{functionDeclarations:MAP_TOOLS}];return [{functionDeclarations:role==='admin'?[ROUTE_TOOL,PROFILE_TOOL]:[ROUTE_TOOL]}];}
export function normalizeToolCall(call){if(call?.name==='draft_route')return {action:'route.build',addresses:validateRouteStops(call.args?.addresses)};if(call?.name==='inspect_team_profile')return {action:'profile.read',targetUserId:call.args?.user_id};throw new Error('Voice tool is not allowed.');}

export const LEAD_STATUS_FILTERS=['All','New','Knocked','No Answer','Interested','Appointment','Not Interested','Do Not Knock'];
export const DOOR_LOG_STATUSES=['Knocked','No Answer','Interested','Not Interested','Do Not Knock'];
export const APP_TARGETS=['map','setter','forms','admin','training','shifts','account'];

export const MAP_TOOLS=[
 {name:'get_live_context',description:'Read fresh personal work context and the current map, selected addresses, lead counts and built route. Call before answering questions about the user or current route.',parameters:{type:'OBJECT',properties:{}}},
 {name:'build_route',description:'Actually build and optimize the selected houses. With no selection, choose nearby mapped houses from the current filters (default 20). Use this for build my route without a time budget. Never say it is built before the result.',parameters:{type:'OBJECT',properties:{count:{type:'NUMBER',description:'Optional maximum houses, integer 1–80'},mode:{type:'STRING',enum:['driving','walking']}}}},
 {name:'build_timed_route',description:'Build a route approximately matching total work time (travel plus visits). Uses selected homes, otherwise filtered map homes. Replaces the route only when not navigating. Default five minutes per house. Report actual returned estimate, never guarantee exact duration.',parameters:{type:'OBJECT',properties:{minutes:{type:'NUMBER',description:'Total work minutes, 15–480'},stop_minutes:{type:'NUMBER',description:'Minutes at each house, 1–60, default 5'},mode:{type:'STRING',enum:['driving','walking']}},required:['minutes']}},
 {name:'find_priority_leads',description:'Find and select the highest-priority, top-scored leads near the user and focus the map on them. Optionally build the route immediately.',parameters:{type:'OBJECT',properties:{count:{type:'NUMBER',description:'Number of priority houses to select, integer 1–40, default 12'},build:{type:'BOOLEAN',description:'When true, also optimize and build a route from those priority houses'}}}},
 {name:'optimize_route',description:'Re-optimize and redraw the currently selected houses or active route stops.',parameters:{type:'OBJECT',properties:{mode:{type:'STRING',enum:['driving','walking']}}}},
 {name:'clear_route',description:'Clear the current route and selected houses when the user explicitly asks to clear/reset the route. Ends active navigation. Does not delete addresses or employee saved routes.',parameters:{type:'OBJECT',properties:{}}},
 {name:'remove_route_stop',description:'Remove a specific address or stop ID from the current route, including during navigation. Read live context to find the exact address first.',parameters:{type:'OBJECT',properties:{stop:{type:'STRING'}},required:['stop']}},
 {name:'route_navigation',description:'Start, pause, resume, advance to next stop, or end in-app route navigation when asked.',parameters:{type:'OBJECT',properties:{action:{type:'STRING',enum:['start','pause','resume','end','next']}},required:['action']}},
 {name:'select_visible_addresses',description:'Add all mapped addresses matching the current map filters to the route, up to its capacity.',parameters:{type:'OBJECT',properties:{}}},
 {name:'filter_leads',description:'Filter mapped houses by lead status (New/Untouched, Knocked, No Answer, Interested, Appointment, or All), search query, or assigned-to-me.',parameters:{type:'OBJECT',properties:{status:{type:'STRING',enum:LEAD_STATUS_FILTERS},query:{type:'STRING',description:'Optional address, city, zip or homeowner search text'},mine:{type:'BOOLEAN',description:'Optional filter for only leads assigned to the current rep'}}}},
 {name:'search_address',description:'Search for a house or homeowner by street address or name and focus the map on that property.',parameters:{type:'OBJECT',properties:{query:{type:'STRING',description:'Street address, homeowner name, or lead ID'}},required:['query']}},
 {name:'focus_location',description:'Center and zoom the map on the user location (me), active route (route), or all filtered leads (all).',parameters:{type:'OBJECT',properties:{target:{type:'STRING',enum:['me','route','all']}}}},
 {name:'log_door_status',description:'Record whether the homeowner answered at the active, selected, or nearest house (Knocked for Answered, No Answer for Not answered).',parameters:{type:'OBJECT',properties:{status:{type:'STRING',enum:DOOR_LOG_STATUSES},lead:{type:'STRING',description:'Optional street address or lead ID'}},required:['status']}},
 {name:'book_inspection',description:'Open the inspection booking form (setter workflow) pre-filled with the active or selected house.',parameters:{type:'OBJECT',properties:{lead:{type:'STRING',description:'Optional street address or lead ID'}}}},
 {name:'open_lead_form',description:'Open the field documentation form pre-filled with the active or selected house.',parameters:{type:'OBJECT',properties:{lead:{type:'STRING',description:'Optional street address or lead ID'}}}},
 {name:'summarize_status',description:'Summarize the user current route stops, selected houses, and filtered lead counts by status.',parameters:{type:'OBJECT',properties:{}}},
 {name:'clock_shift',description:'Clock in or clock out of the current field shift, or open shifts.',parameters:{type:'OBJECT',properties:{action:{type:'STRING',enum:['toggle','in','out']}}}},
 {name:'navigate_app',description:'Navigate to another workspace in the True North app (map, setter, forms, admin, training, shifts, account).',parameters:{type:'OBJECT',properties:{target:{type:'STRING',enum:APP_TARGETS}},required:['target']}},
 {name:'recent_ohio_storms',description:'Fetch recent NOAA storm reports across Ohio and active warnings. Use this for recent storm questions. Reports are preliminary and do not prove damage to any roof.',parameters:{type:'OBJECT',properties:{days:{type:'NUMBER',description:'Report days to check, 1–7, default 3'}}}}
];

export const ROUTE_TOOL_NAMES=new Set(['build_route','build_timed_route','find_priority_leads','optimize_route','clear_route','remove_route_stop','route_navigation','select_visible_addresses']);

export function validateMapTool(call){
 const name=call?.name,args=call?.args||{};
 if(typeof args!=='object'||Array.isArray(args))throw Error('Command arguments must be an object.');
 if(!MAP_TOOLS.some(tool=>tool.name===name))throw Error('Map command is not allowed.');
 if(name==='build_route'){
  if(args.count!==undefined&&(!Number.isInteger(args.count)||args.count<1||args.count>80))throw Error('Choose between 1 and 80 houses.');
  if(args.mode!==undefined&&!['driving','walking'].includes(args.mode))throw Error('Invalid travel mode.');
  return {name,args:{...(args.count===undefined?{}:{count:args.count}),...(args.mode===undefined?{}:{mode:args.mode})}};
 }
 if(name==='build_timed_route'){
  if(typeof args.minutes!=='number'||!Number.isFinite(args.minutes)||args.minutes<15||args.minutes>480)throw Error('Route minutes must be 15–480.');
  const stop_minutes=args.stop_minutes??5;
  if(typeof stop_minutes!=='number'||!Number.isFinite(stop_minutes)||stop_minutes<1||stop_minutes>60)throw Error('Visit minutes must be 1–60.');
  if(args.mode&&!['driving','walking'].includes(args.mode))throw Error('Invalid travel mode.');
  return {name,args:{minutes:args.minutes,stop_minutes,...(args.mode?{mode:args.mode}:{})}};
 }
 if(name==='find_priority_leads'){
  const count=args.count??12;
  if(!Number.isInteger(count)||count<1||count>40)throw Error('Priority lead count must be 1–40.');
  if(args.build!==undefined&&typeof args.build!=='boolean')throw Error('Invalid build flag.');
  return {name,args:{count,...(args.build===undefined?{}:{build:args.build})}};
 }
 if(name==='optimize_route'){
  if(args.mode!==undefined&&!['driving','walking'].includes(args.mode))throw Error('Invalid travel mode.');
  return {name,args:{...(args.mode?{mode:args.mode}:{})}};
 }
 if(name==='remove_route_stop'){
  if(typeof args.stop!=='string'||!args.stop.trim()||args.stop.length>240)throw Error('An exact route address or stop ID is required.');
  return {name,args:{stop:args.stop.trim()}};
 }
 if(name==='route_navigation'){
  if(!['start','pause','resume','end','next'].includes(args.action))throw Error('Invalid navigation action.');
  return {name,args:{action:args.action}};
 }
 if(name==='filter_leads'){
  const status=args.status??'All';
  if(!LEAD_STATUS_FILTERS.includes(status))throw Error('Invalid lead status filter.');
  if(args.query!==undefined&&(typeof args.query!=='string'||args.query.length>120))throw Error('Invalid filter query.');
  if(args.mine!==undefined&&typeof args.mine!=='boolean')throw Error('Invalid mine filter.');
  return {name,args:{status,...(args.query!==undefined?{query:args.query.trim()}:{}),...(args.mine!==undefined?{mine:args.mine}:{})}};
 }
 if(name==='search_address'){
  if(typeof args.query!=='string'||!args.query.trim()||args.query.length>160)throw Error('A search address or homeowner name is required.');
  return {name,args:{query:args.query.trim()}};
 }
 if(name==='focus_location'){
  const target=args.target??'me';
  if(!['me','route','all'].includes(target))throw Error('Invalid focus target.');
  return {name,args:{target}};
 }
 if(name==='log_door_status'){
  if(!DOOR_LOG_STATUSES.includes(args.status))throw Error('Invalid door status.');
  if(args.lead!==undefined&&(typeof args.lead!=='string'||!args.lead.trim()||args.lead.length>240))throw Error('Invalid lead reference.');
  return {name,args:{status:args.status,...(args.lead?{lead:args.lead.trim()}:{})}};
 }
 if(name==='book_inspection'||name==='open_lead_form'){
  if(args.lead!==undefined&&(typeof args.lead!=='string'||!args.lead.trim()||args.lead.length>240))throw Error('Invalid lead reference.');
  return {name,args:{...(args.lead?{lead:args.lead.trim()}:{})}};
 }
 if(name==='clock_shift'){
  const action=args.action??'toggle';
  if(!['toggle','in','out'].includes(action))throw Error('Invalid clock action.');
  return {name,args:{action}};
 }
 if(name==='navigate_app'){
  if(!APP_TARGETS.includes(args.target))throw Error('Invalid destination.');
  return {name,args:{target:args.target}};
 }
 if(name==='recent_ohio_storms'){
  const days=args.days??3;if(!Number.isInteger(days)||days<1||days>7)throw Error('Storm days must be 1–7.');
  return {name,args:{days}};
 }
 return {name,args:{}};
}

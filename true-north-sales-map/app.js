import { PASSWORD_UPDATED } from './lib/password-reset.js';
import { ROUTE_STOP_LIMIT, pickRouteStops, routeToggleLabel, visibleRoutePool } from './lib/route-picks.js';
import { ROUTE_TRAY_KEY, routeTrayCollapsedByDefault, routeTraySummary, shouldExpandRouteTray } from './lib/route-tray.js';
import { MAP_FACTS } from './lib/map-facts.js';
import { ARRIVAL_METERS, NAV_CHOICE_KEY, appleDirectionsUrl, arrivedAtStop, etaSeconds, googleDirectionsUrl, googleTravelMode, isAppleDevice, metersBetween, osrmProfile, readNavChoice } from './lib/route-nav.js';
import { createArrayCursor, localStamp, mergeLeadDelta, newestUpdatedAt, nextObjectEnd, normalizeStamp, parseJsonArraySlice, planLeadSync, takeCompleteObjects } from './lib/lead-cache.js';
import { readLeadCache, writeLeadCache } from './lib/lead-store.js';
import { LEAD_OVERLAY_COLUMNS, LEAD_OVERLAY_OR, STATIC_LEAD_SOURCES, mergeLeadOverlay, pageRanges } from './lib/lead-sync.js';
import { STREET_ZOOM, clusterLeads, pinDiff, sampleHeat } from './lib/pin-layer.js';
import { HAIL_MILES, WARNING_COLORS, housesInStorm, readStormCache, reportMarkerText, writeStormCache } from './lib/storm-maps.js';
import { roleLabel } from './lib/field-rules.js';
import { MANAGEMENT_LINKS, canOpenManagement, managementProfile } from './lib/account-rules.js';

const STATUS_OPTIONS=['New','Knocked','No Answer','Interested','Appointment','Not Interested','Do Not Knock'];
const DOOR_STATUSES=['Knocked','No Answer','Interested','Not Interested','Do Not Knock'].filter(s=>STATUS_OPTIONS.includes(s));
const doorSheetMedia=window.matchMedia('(max-width: 960px)');
const HOME_BASE={lat:40.3931,lng:-82.4857};
const HOME_MILES=35;
const LIST_SNAPS=['sheet-collapsed','sheet-half','sheet-full'];
const APPOINTMENT_STAGES=['Scheduled','Confirmed','Completed','No-show','Cancelled'];
const LOCAL_KEY='tnrc2:local';

const state={
  mode:'local', supabase:null, session:null, user:null, currentRep:null,
  leads:[], filtered:[], reps:[], territories:[], appointments:[], activities:[], centers:{},
  selected:new Set(), active:null, map:null, markerLayer:null, heatLayers:[], stormLayer:null,
  stormPack:null, stormHouseIds:null, stormToken:0, radarLayers:[], radarTimer:null, radarSignature:'', warningLayer:null, warningSignature:'', reportLayer:null, reportSignature:'',
  routeLine:null, userMarker:null, routeStops:[], currentLocation:null,
  filters:{q:'',status:'',rep:'',territory:'',source:'',mine:false},
  layerFlags:{pins:true,density:false,opportunity:true,roofAge:false,radar:false,warnings:true,reports:true,territories:true},
  routeMode:'driving', busy:false, config:null, realtimeChannel:null, refreshTimer:null,
  doorLeadId:null, doorSaving:false, doorUndo:null,
  homeArea:true, didFit:false, listSnap:'sheet-collapsed', pinBannerDismissed:false,
  listShown:180, listFilterKey:'', listRows:null, listPaintToken:'', listScrollFrame:0, renderQueued:false,
  leadsById:new Map(), pinMarkers:new Map(), pinShown:new Set(), pinRenderer:null, pinClusters:null, clusterSig:'', clusterSource:null, clusterZoom:null,
  heatTimer:null, heatKey:'', territoryKey:'', bootDone:false, stormBusy:false, fieldWarmed:false, listSortToken:0,
  navigating:false, navIndex:0, navFollow:true, navWatch:null, navPrompted:'', navLegStop:'', navLegFrom:null, routeGeometry:null, navLayers:[],
  pendingPostSignIn:false, paintTicket:0, toolsDeferred:false, pinsMarked:false, cloudReady:false, staticPromise:null,
  tileLayer:null, mapLoaderGen:0, mapSettled:false, pinsPainted:false, awaitingFirstFit:false, factTimer:null, mapLoaderGiveUp:null
};

const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const fmt=n=>Number(n||0).toLocaleString();
const nowISO=()=>new Date().toISOString();
const isCoords=l=>{const lat=Number(l?.lat),lng=Number(l?.lng);return l?.lat!=null&&l?.lng!=null&&Number.isFinite(lat)&&Number.isFinite(lng);};
const leadStatus=l=>l.status||localSaved(l).status||'New';
const leadOwnerName=l=>l.assignedRepName||(state.reps.find(r=>r.id===l.assignedRepId)?.name)||localSaved(l).owner||'';
const localSaved=l=>JSON.parse(localStorage.getItem(`tnrc2:lead:${l.id}`)||'{}');
function saveLocal(l,v){localStorage.setItem(`tnrc2:lead:${l.id}`,JSON.stringify(v));}
function debounce(fn,ms=150){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}}

let cloudToken='';
let cloudFlight=null;
let weatherApiPromise;
function weatherApi(){ weatherApiPromise ||= import('./weather-widget.js'); return weatherApiPromise; }
function deferFieldTools(){
  if(state.toolsDeferred) return;
  state.toolsDeferred=true;
  import('./field-ops.js').catch(()=>{});
  import('./tn-files/password-reset.js').catch(()=>{});
  import('./tn-files/sheet-actions.js').catch(()=>{});
}
function markFirstPins(){
  if(state.pinsMarked) return;
  state.pinsMarked=true;
  window.__tnFirstPins=performance.now();
  document.documentElement.dataset.tnPins='1';
  deferFieldTools();
}

async function boot(){
  bindStaticEvents();
  initMapOnce();
  setTimeout(deferFieldTools, 4000);
  const centersP=fetchJSON('/data/city-centers.json').catch(()=>({}));
  const cfgP=fetchJSON('/api/config').catch(()=>null);
  const cached=await readLeadCache().catch(()=>null);
  if(cached?.leads?.length){
    streamLeads(cached.leads, cached.leads.length, null);
    await new Promise(resolve=>requestAnimationFrame(resolve));
  }else startStaticLeads().catch(error=>console.error(error));
  const [centers, cfg]=await Promise.all([centersP, cfgP]);
  state.centers=centers||{};
  if(cfg?.configured){
    state.config=cfg;
    try{
      const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
      state.supabase=createClient(cfg.url,cfg.publishableKey);
      const {data}=await state.supabase.auth.getSession();
      if(data.session) await enterCloud(data.session);
      else showLogin();
      state.supabase.auth.onAuthStateChange(async(_event,session)=>{
        if(session) await enterCloud(session);
        else { cloudToken=''; state.cloudReady=false; showLogin(); }
      });
    }catch(e){console.error(e);enterLocal(`Cloud client error: ${e.message}`)}
  }else{
    enterLocal('Cloud is not configured on this Vercel deployment. Local device mode is active.');
  }
}

async function fetchJSON(url){const r=await fetch(url);if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json()}

function bindStaticEvents(){
  $('loginForm').addEventListener('submit',login);
  $('logoutBtn').onclick=()=>state.supabase?.auth.signOut();
  $('localModeBtn').onclick=()=>{hideLogin();enterLocal('Local device mode enabled. Connect Supabase for shared live team data.')};
  $('nextBtn').onclick=nextBest; $('nextCardBtn').onclick=nextBest;
  $('mobileNext').onclick=nextBest; $('mobileRoute').onclick=openRouteFromChrome; $('mobileLocate').onclick=locate;
  $('routeBtn').onclick=openRouteFromChrome; $('routeTrayBtn').onclick=openRoutePanel;
  $('routeTrayToggle').onclick=()=>setRouteTrayCollapsed($('routeTrayToggle').getAttribute('aria-expanded')==='true');
  $('selectVisibleBtn').onclick=selectVisibleForRoute; $('clearRouteBtn').onclick=clearRoute;
  $('doorSheetRoute').onclick=()=>{if(!state.doorLeadId)return;toggleSelected(state.doorLeadId);$('doorSheetRoute').textContent=routeToggleLabel(state.selected.has(state.doorLeadId));};
  $('focusBtn').onclick=toggleMapFocus; $('fitBtn').onclick=fitFilteredLeads;
  $('closeDrawer').onclick=closeDrawer;
  $('closeAdmin').onclick=()=>$('adminModal').classList.add('hidden');
  $('tabWork').onclick=()=>switchTab('work');
  $('tabHandoffs').onclick=()=>switchTab('handoffs');
  $('tabTeam').onclick=()=>switchTab('team');
  $('adminBtn').onclick=(e)=>{ if(canOpenManagement({email:state.user?.email, rep:state.currentRep, adminEmails:state.config?.adminEmails})) return; e.preventDefault(); };
  $('postSignInContinue')?.addEventListener('click', ()=>$('postSignIn').classList.add('hidden'));
  $('locateBtn').onclick=locate;
  const scheduleFilterRender=debounce(()=>{syncFilters();renderAll()},150);
  $('clearBtn').onclick=()=>{['search','statusFilter','repFilter','territoryFilter','sourceFilter'].forEach(id=>$(id).value='');$('mineToggle').checked=false;state.stormHouseIds=null;syncFilters();renderAll()};
  $('search').addEventListener('input',scheduleFilterRender);
  ['statusFilter','repFilter','territoryFilter','sourceFilter'].forEach(id=>$(id).addEventListener('change',scheduleFilterRender));
  $('mineToggle').addEventListener('change',scheduleFilterRender);
  $('workList').addEventListener('scroll',()=>{
    if(state.listScrollFrame)return;
    state.listScrollFrame=requestAnimationFrame(()=>{state.listScrollFrame=0;paintWorkList()});
  });
  $('layerBtn').onclick=()=>$('layerMenu').classList.toggle('open');
  $('legendKey').onclick=()=>{
    const legend=$('mapLegend');
    const open=legend.classList.toggle('isOpen');
    $('legendKey').setAttribute('aria-expanded',open?'true':'false');
    if(!open||!useDoorSheet()){legend.style.top='';return;}
    const canvas=document.querySelector('.mapCanvas').getBoundingClientRect();
    const overlay=document.querySelector('.mapTopOverlay').getBoundingClientRect();
    legend.style.top=`${Math.round(overlay.bottom-canvas.top+8)}px`;
  };
  document.addEventListener('click',e=>{
    if(!$('layerMenu').contains(e.target)&&e.target!==$('layerBtn'))$('layerMenu').classList.remove('open');
    if(!$('mapLegend').contains(e.target)&&e.target!==$('legendKey')){$('mapLegend').classList.remove('isOpen');$('legendKey').setAttribute('aria-expanded','false');}
  });
  document.querySelectorAll('[data-layer]').forEach(el=>{
    state.layerFlags[el.dataset.layer]=el.checked;
    el.addEventListener('change',()=>{
      state.layerFlags[el.dataset.layer]=el.checked;
      if(el.dataset.layer==='radar'||el.dataset.layer==='warnings'||el.dataset.layer==='reports')syncStormOverlays();
      else refreshMapLayers();
    });
  });
  $('stormHousesBtn').onclick=housesInStormArea;
  $('routeMode').addEventListener('change',e=>setRouteMode(e.target.value));
  $('trayDrive').onclick=()=>setRouteMode('driving');
  $('trayWalk').onclick=()=>setRouteMode('walking');
  $('startRouteBtn').onclick=startRoute;
  $('navChoiceBtn').onclick=()=>openNavChoice(false);
  $('navInApp').onclick=()=>confirmNavChoice('app');
  $('navGoogle').onclick=()=>confirmNavChoice('google');
  $('navApple').onclick=()=>confirmNavChoice('apple');
  $('navChoiceCancel').onclick=closeNavChoice;
  $('navChoiceClose').onclick=closeNavChoice;
  $('navRecenter').onclick=recenterNav;
  $('navGoogleLeg').onclick=()=>openExternalLeg('google');
  $('navAppleLeg').onclick=()=>openExternalLeg('apple');
  $('navNextStop').onclick=()=>advanceNavStop();
  $('navEnd').onclick=()=>endNavigation('Navigation ended.');
  syncNavChoiceButton();
  $('routeCount').addEventListener('input',e=>$('routeCountValue').textContent=e.target.value); $('routeDistance').textContent='';
  $('optimizeRouteBtn').onclick=optimizeAndDrawRoute;
  $('openGoogleRouteBtn').onclick=openGoogleRouteBlocks;
  $('closeRoute').onclick=closeRoutePanel;
  $('adminImportBtn').onclick=importLeadsToCloud;
  $('adminTerritoryBtn').onclick=syncTerritories;
  $('adminGeocodeBtn').onclick=geocodeAll;
  $('adminStormBtn').onclick=loadStorms;
  $('adminExportBtn').onclick=exportLeads;
  $('appointmentForm').addEventListener('submit',saveAppointmentFromForm);
  $('closeAppointment').onclick=()=>$('appointmentModal').classList.add('hidden');
  $('appStage').addEventListener('change',()=>{});
  $('copyHandoffBtn').onclick=copyCurrentHandoff;
  $('doorSheetClose').onclick=closeDoorSheet;
  $('doorSheetScrim').onclick=closeDoorSheet;
  $('doorSheetFull').onclick=()=>{const id=state.doorLeadId; closeDoorSheet(); if(id) openLead(id);};
  $('toastUndo').onclick=undoDoorStatus;
  $('toastNext').onclick=()=>openNextHouse(state.doorUndo?.id);
  $('homeAreaBtn').onclick=()=>setHomeArea(true);
  $('allOhioBtn').onclick=()=>setHomeArea(false);
  $('pinBannerAction').onclick=openAdmin;
  $('pinBannerDismiss').onclick=()=>{state.pinBannerDismissed=true;$('pinBanner').classList.add('hidden');};
  bindDoorSwipe();
  bindListSheet();
  syncListMode();
  rotateMapFacts();
  setRouteTrayCollapsed(readRouteTrayCollapsed(), {persist:false});
  const onDoorMedia=()=>{
    if(state.map){
      closeDoorSheet();
      state.pinMarkers.forEach(marker=>marker.remove());
      state.pinMarkers.clear();
      state.pinShown.clear();
      state.clusterSig='';
      refreshMapLayers();
    }
    syncListMode();
  };
  if(doorSheetMedia.addEventListener) doorSheetMedia.addEventListener('change',onDoorMedia);
  else doorSheetMedia.addListener(onDoorMedia);
}

function enterLocal(message){
  state.mode='local'; state.session=null; state.currentRep=null; state.cloudReady=false;
  hideLogin(); $('userMenu').classList.add('hidden'); $('adminBtn').classList.add('hidden');
  $('connection').textContent='LOCAL DEVICE'; $('connection').className='chip local';
  $('cloudNotice').textContent=message||'Local mode'; $('cloudNotice').classList.remove('hidden');
  if(!state.bootDone) setBootProgress(0,0);
  loadLocalDataset().catch(e=>{hideBoot();showFatal(e)});
}
async function loadLocalDataset(){
  const manifest=state.staticManifest||await fetchJSON('/data/manifest.json').catch(()=>null);
  const stamp=localStamp(manifest);
  const meta=JSON.parse(localStorage.getItem('tnrc2:leadsMeta')||'{}');
  state.reps=JSON.parse(localStorage.getItem('tnrc2:reps')||'[]');
  state.territories=JSON.parse(localStorage.getItem('tnrc2:territories')||'[]');
  state.appointments=JSON.parse(localStorage.getItem('tnrc2:appointments')||'[]');
  state.activities=JSON.parse(localStorage.getItem('tnrc2:activities')||'[]');
  const total=manifest?.totalRecords||0;
  $('datasetCount').textContent=total?`${fmt(total)} source records`:'';
  initMapOnce();
  const cached=await readLeadCache();
  if(cached?.stamp===stamp && Array.isArray(cached.leads) && cached.leads.length){
    if(!total) $('datasetCount').textContent=`${fmt(cached.leads.length)} source records`;
    if(!state.bootDone) streamLeads(cached.leads, total||cached.leads.length, meta);
    return;
  }
  if(state.staticPromise){
    const leads=await state.staticPromise;
    if(!total && leads) $('datasetCount').textContent=`${fmt(leads.length)} source records`;
    writeLeadCache({stamp, leads, savedAt:Date.now()});
    return;
  }
  const response=await fetch('/data/leads.json');
  if(!response.ok) throw new Error(`HTTP ${response.status}`);
  if(!response.body?.getReader){
    const text=await response.text();
    const leads=await ingestLeadText(text, total, meta);
    if(!total) $('datasetCount').textContent=`${fmt(leads.length)} source records`;
    writeLeadCache({stamp, leads, savedAt:Date.now()});
    return;
  }
  const leads=await readLeadResponse(response, total, meta);
  if(!total) $('datasetCount').textContent=`${fmt(leads.length)} source records`;
  writeLeadCache({stamp, leads, savedAt:Date.now()});
}
function startStaticLeads(){
  if(state.staticPromise) return state.staticPromise;
  state.staticPromise=(async()=>{
    const manifest=await fetchJSON('/data/manifest.json').catch(()=>null);
    state.staticManifest=manifest;
    const total=manifest?.totalRecords||0;
    if(total && $('datasetCount')) $('datasetCount').textContent=`${fmt(total)} source records`;
    const response=await fetch('/data/leads.json');
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    if(!response.body?.getReader){
      const text=await response.text();
      return ingestLeadText(text, total, null);
    }
    return readLeadResponse(response, total, null);
  })();
  return state.staticPromise;
}
async function readLeadResponse(response, total, meta){
  const reader=response.body.getReader();
  const decoder=new TextDecoder();
  let text='';
  const cursor=createArrayCursor();
  let mark=0;
  const leads=[];
  let accept=!state.bootDone;
  state.stopLeadRead=()=>{ accept=false; };
  const take=(batch, last)=>{
    if(batch.length) leads.push(...batch);
    if(accept) ingestLeadChunk(batch, meta, total||leads.length, last);
  };
  while(true){
    const {done,value}=await reader.read();
    text+=decoder.decode(value||new Uint8Array(), {stream:!done});
    while(true){
      const end=takeCompleteObjects(text, cursor, 400);
      if(end<=mark) break;
      const batch=parseJsonArraySlice(text, mark, end);
      mark=end;
      if(!batch.length) break;
      take(batch, false);
      await new Promise(resolve=>requestAnimationFrame(resolve));
    }
    if(done) break;
  }
  const tail=parseJsonArraySlice(text, mark, text.length);
  take(tail, true);
  return leads;
}
async function ingestLeadText(text, total, meta){
  resetLeadStream();
  const cursor=createArrayCursor();
  const leads=[];
  let mark=0;
  let ingested=false;
  while(mark<text.length){
    const end=nextObjectEnd(text, cursor, 2000);
    if(end===mark) break;
    const last=cursor.i>=text.length;
    const batch=parseJsonArraySlice(text, mark, end);
    mark=end;
    if(!batch.length && !last) continue;
    leads.push(...batch);
    ingestLeadChunk(batch, meta, total||leads.length, last);
    ingested=true;
    if(!last) await new Promise(resolve=>requestAnimationFrame(resolve));
  }
  if(!ingested) ingestLeadChunk([], meta, total, true);
  return leads;
}

async function enterCloud(session){
  const token=session?.access_token||'';
  if(!token) return;
  if(token===cloudToken && (cloudFlight || state.cloudReady)) return cloudFlight;
  cloudToken=token;
  state.cloudReady=false;
  cloudFlight=runEnterCloud(session).catch(error=>{ cloudToken=''; throw error; }).finally(()=>{ cloudFlight=null; });
  return cloudFlight;
}
async function runEnterCloud(session){
  state.mode='cloud'; state.session=session; state.user=session.user; hideLogin();
  $('connection').textContent='CLOUD SYNC'; $('connection').className='chip live';
  $('userMenu').classList.remove('hidden');
  $('userIdentity').textContent=session.user.email||session.user.id;
  $('cloudNotice').classList.add('hidden');
  const sideP=loadSideData();
  try{
    await loadLeadBundle();
    const open=canOpenManagement({email:session.user.email, rep:state.currentRep, adminEmails:state.config?.adminEmails});
    $('adminBtn').classList.toggle('hidden', !open);
    if(state.pendingPostSignIn){state.pendingPostSignIn=false; if(open) showPostSignIn();}
    if(!state.map) initMapOnce();
    startRealtime();
    state.cloudReady=true;
    await sideP;
    publishSideData();
  }catch(e){
    console.error(e);
    cloudToken='';
    state.cloudReady=false;
    state.pendingPostSignIn=false;
    enterLocal(`Cloud connection failed: ${e.message}`);
  }
}

async function loadCloudData(){
  const sideP=loadSideData();
  await loadLeadBundle();
  await sideP;
  publishSideData();
}
async function loadLeadBundle(){
  const sb=state.supabase;
  const [reps, territories, leads]=await Promise.all([
    fetchAll(()=>sb.from('reps').select('id,user_id,name,role,active').eq('active',true).order('name')),
    fetchAll(()=>sb.from('territories').select('*').order('name')),
    loadCloudLeadRows()
  ]);
  state.reps=reps;
  state.currentRep=managementProfile({
    email:state.user?.email,
    rep:state.reps.find(r=>r.user_id===state.user.id)||null,
    userId:state.user?.id,
    name:state.user?.user_metadata?.name||''
  });
  if(!state.currentRep) throw new Error('Your Supabase account is signed in, but no active rep profile exists yet. Add the user to public.reps.');
  state.territories=territories;
  if(leads) replaceLeads(leads);
}
function loadSideData(){
  const sb=state.supabase;
  return Promise.all([
    fetchAll(()=>sb.from('appointments').select('*,canvasser:reps!appointments_canvasser_id_fkey(id,name),salesperson:reps!appointments_salesperson_id_fkey(id,name)').order('scheduled_at',{ascending:true})),
    fetchAll(()=>sb.from('lead_activity').select('id,lead_id,actor_id,action,metadata,created_at,actor:reps!lead_activity_actor_id_fkey(name)').order('created_at',{ascending:false}).limit(3000))
  ]).then(([appointments, activities])=>{
    state.appointments=appointments;
    state.activities=activities;
  });
}
function publishSideData(){
  if(!state.bootDone) return;
  renderStats();
  renderHandoffs();
  renderTeam();
  renderSidebarCounts();
  state.listPaintToken='';
  paintWorkList();
}
async function loadCloudLeadRows(){
  const sb=state.supabase;
  const cached=await readLeadCache();
  const cachedLeads=Array.isArray(cached?.leads)?cached.leads:[];
  let boot=null;
  try{
    const rpc=await sb.rpc('lead_map_boot');
    if(!rpc.error && rpc.data) boot=typeof rpc.data==='string'?JSON.parse(rpc.data):rpc.data;
  }catch{ boot=null; }
  let remoteCount=boot&&boot.count!=null?Number(boot.count):null;
  let remoteUpdatedAt=boot?normalizeStamp(boot.newest):'';
  if(!boot){
    try{
      const [countQuery, newest]=await Promise.all([
        sb.from('leads').select('id',{count:'exact',head:true}),
        sb.from('leads').select('updated_at').order('updated_at',{ascending:false}).limit(1)
      ]);
      if(!countQuery.error) remoteCount=countQuery.count;
      remoteUpdatedAt=normalizeStamp(newest.data?.[0]?.updated_at||'');
    }catch{/* a failed stamp check falls through to a full read */}
  }
  const plan=planLeadSync({cachedStamp:normalizeStamp(cached?.stamp||''), cachedCount:cachedLeads.length, remoteCount, remoteUpdatedAt});
  if(plan==='use-cache') return null;
  if(plan==='delta'){
    const since=cached.stamp;
    const head=await sb.from('leads').select('id',{count:'exact',head:true}).gt('updated_at', since);
    const delta=head.count?await fetchAllParallel(()=>sb.from('leads').select('*').gt('updated_at', since).order('updated_at'), head.count):[];
    const merged=mergeLeadDelta(cachedLeads, delta).map(normalizeLead);
    const stamp=remoteUpdatedAt||normalizeStamp(newestUpdatedAt(merged));
    writeLeadCache({stamp, leads:merged, savedAt:Date.now()});
    return merged;
  }
  return loadColdLeads(sb, boot, remoteCount, remoteUpdatedAt);
}
async function loadColdLeads(sb, boot, remoteCount, remoteUpdatedAt){
  const basePromise=state.staticPromise||startStaticLeads();
  let overlay=Array.isArray(boot?.overlay)?boot.overlay:null;
  let added=Array.isArray(boot?.added)?boot.added:null;
  if(!boot){
    const [overlayRows, addedRows]=await Promise.all([fetchOverlayRows(sb), fetchAddedRows(sb)]);
    overlay=overlayRows;
    added=addedRows;
  }
  const base=await basePromise;
  const fixes=await fetchCoordFixes(sb, base).catch(()=>[]);
  let merged=mergeLeadOverlay(base, [...(overlay||[]), ...(fixes||[])], added||[]).map(normalizeLead);
  if(remoteCount!=null && merged.length!==Number(remoteCount)){
    merged=(await fetchAllParallel(()=>sb.from('leads').select('*').order('id'), remoteCount)).map(normalizeLead);
  }
  const stamp=remoteUpdatedAt||normalizeStamp(newestUpdatedAt(merged));
  writeLeadCache({stamp, leads:merged, savedAt:Date.now()});
  return merged;
}
async function fetchOverlayRows(sb){
  const head=await sb.from('leads').select('id',{count:'exact',head:true}).or(LEAD_OVERLAY_OR);
  if(head.error) throw head.error;
  return fetchAllParallel(()=>sb.from('leads').select(LEAD_OVERLAY_COLUMNS).or(LEAD_OVERLAY_OR).order('id'), head.count||0);
}
async function fetchAddedRows(sb){
  const filter=`source.is.null,source.not.in.("${STATIC_LEAD_SOURCES.join('","')}")`;
  const {data, error}=await sb.from('leads').select('*').or(filter);
  if(error) throw error;
  return data||[];
}
async function fetchCoordFixes(sb, leads){
  const ids=(leads||[]).filter(lead=>lead?.lat==null||lead?.lng==null).map(lead=>lead.id).filter(Boolean);
  const out=[];
  for(let index=0; index<ids.length; index+=80){
    const {data, error}=await sb.from('leads').select('id,lat,lng,geocode_match').in('id', ids.slice(index, index+80));
    if(error) return out;
    for(const row of data||[]) if(row?.lat!=null && row?.lng!=null) out.push(row);
  }
  return out;
}
function replaceLeads(rows){
  state.stopLeadRead?.();
  state.paintTicket++;
  const normalized=rows.map(normalizeLead);
  state.leads=normalized;
  state.leadsById=new Map(normalized.map(lead=>[lead.id, lead]));
  state.clusterSource=null;
  state.clusterSig='';
  state.clusterZoom=null;
  state.listFilterKey='';
  state.listRows=null;
  state.heatKey='';
  state.territoryKey='';
  if($('datasetCount')) $('datasetCount').textContent=`${fmt(normalized.length)} live leads`;
  if(!state.map) initMapOnce();
  const fit=!state.didFit;
  state.bootDone=true;
  buildFilters();
  renderNow(fit);
  markFirstPins();
  warmFieldLayers();
}
function resetLeadStream(){
  state.leads=[];
  state.leadsById=new Map();
  state.listFilterKey='';
  state.listRows=null;
  state.bootDone=false;
  state.clusterSource=null;
  state.clusterZoom=null;
  state.territoryKey='';
}
function streamLeads(rows, total, meta){
  const ticket=++state.paintTicket;
  resetLeadStream();
  let index=0;
  const size=2000;
  const step=()=>{
    if(ticket!==state.paintTicket) return;
    const end=Math.min(rows.length, index+size);
    const chunk=[];
    for(let i=index;i<end;i++) chunk.push(rows[i]);
    index=end;
    ingestLeadChunk(chunk, meta, total||rows.length, index>=rows.length);
    if(index<rows.length) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function ingestLeadChunk(rows, meta, total, isLast){
  const saved=meta||{};
  rows.forEach(raw=>{
    const extra=saved[raw.id]||{};
    const lead=normalizeLead({...raw, ...extra, assignedRepName:extra.owner||raw.assignedRepName||''});
    state.leads.push(lead);
    state.leadsById.set(lead.id, lead);
  });
  const totalCount=total||state.leads.length;
  setBootProgress(state.leads.length, totalCount);
  const first=!state.bootDone;
  if(first){
    buildFilters();
    renderNow(isLast);
    state.bootDone=true;
    state.pinsPainted=true;
    markFirstPins();
    settleMapLoader(state.mapLoaderGen);
  }else if(!isLast){
    applyFilters();
    syncPins();
    renderSidebarCounts();
  }
  if(isLast){
    if(!first){
      state.listFilterKey='';
      buildFilters();
      renderNow(true);
    }
    warmFieldLayers();
  }
}
function setBootProgress(done, total){
  const text=total?`Loading ${fmt(done)} of ${fmt(total)} homes…`:'Loading homes…';
  const label=$('bootText'); if(label) label.textContent=text;
  const bar=$('bootBar'); if(bar) bar.style.width=`${total?Math.min(100, Math.round(done/Math.max(1,total)*100)):8}%`;
}
function hideBoot(){hideMapLoader(state.mapLoaderGen);}
function warmFieldLayers(){
  if(state.fieldWarmed)return;
  state.fieldWarmed=true;
  if(state.layerFlags.radar||state.layerFlags.warnings||state.layerFlags.reports) ensureStormMaps();
  weatherApi().then(mod=>mod.startMapWeather(state.map)).catch(()=>{});
}
async function fetchAll(makeBuilder){
  const out=[]; let from=0,step=1000;
  while(true){const {data,error}=await makeBuilder().range(from,from+step-1);if(error)throw error;if(!data?.length)break;out.push(...data);if(data.length<step)break;from+=step;}
  return out;
}
async function fetchAllParallel(makeBuilder, count){
  const total=Number(count);
  if(!Number.isFinite(total) || total<=0) return [];
  const ranges=pageRanges(total, 1000);
  const pages=await Promise.all(ranges.map(([from, to])=>makeBuilder().range(from, to)));
  const out=[];
  for(const result of pages){
    if(result.error) throw result.error;
    if(result.data?.length) out.push(...result.data);
  }
  return out;
}

function normalizeLead(l){return {...l,status:l.status||'New',assignedRepId:l.assigned_rep_id||l.assignedRepId||null,roofAgeYears:l.roof_age_years??l.roofAgeYears??null,roofAgeVerified:l.roof_age_verified??l.roofAgeVerified??false,lat:l.lat??null,lng:l.lng??null};}

function showLogin(){
  deferFieldTools();
  const logo=document.querySelector('#loginModal .signInLogo');
  if(logo?.dataset.src && !logo.getAttribute('src')) logo.src=logo.dataset.src;
  $('loginModal').classList.remove('hidden'); $('appShell').classList.add('blurred');
  $('loginError').textContent='';
  const note=$('loginNote');
  if(note) note.textContent=new URLSearchParams(location.search).get('reset')==='1'?PASSWORD_UPDATED:'';
}
function hideLogin(){ $('loginModal').classList.add('hidden'); $('appShell').classList.remove('blurred'); }
async function login(e){e.preventDefault();if(!state.supabase){return}
  state.pendingPostSignIn=true;
  $('loginError').textContent='Signing in…';
  const {error}=await state.supabase.auth.signInWithPassword({email:$('loginEmail').value.trim(),password:$('loginPassword').value});
  if(error){state.pendingPostSignIn=false;$('loginError').textContent=error.message}
}
function showPostSignIn(){
  const panel=$('postSignIn'); if(!panel) return;
  const who=state.currentRep?.name||state.user?.email||'';
  $('postSignInWho').textContent=who?`${who} is signed in. Management is part of this profile.`:'You are signed in. Management is part of this profile.';
  $('postSignInLinks').innerHTML=MANAGEMENT_LINKS.map(link=>`<a class="postSignInLink" href="${esc(link.href)}"><b>${esc(link.label)}</b><span>${esc(link.hint||'')}</span></a>`).join('');
  panel.classList.remove('hidden');
}
function showFatal(e){$('workList').innerHTML=`<div class="empty"><b>Could not load command center.</b><br>${esc(e.message)}</div>`}

function initMapOnce(){
  if(state.map)return;
  state.map=L.map('map',{zoomControl:true,preferCanvas:true}).setView([40.39,-82.49],11);
  const gen=beginMapLoader(false);
  state.tileLayer=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:20,attribution:'© OpenStreetMap contributors',updateWhenIdle:true,keepBuffer:2}).addTo(state.map);
  state.tileLayer.on('load',()=>settleMapLoader(state.mapLoaderGen));
  state.pinRenderer=L.canvas({padding:.5});
  state.markerLayer=L.layerGroup().addTo(state.map);
  state.pinClusters=L.layerGroup().addTo(state.map);
  state.map.on('dragstart',()=>{ if(state.navigating&&state.navFollow){state.navFollow=false;syncRecenterButton();} });
  state.map.on('moveend',()=>{ if(state.layerFlags.pins) syncPins(); });
  if(!state.map.getPane('radarPane')){
    const pane=state.map.createPane('radarPane');
    pane.style.zIndex='350';
    pane.style.pointerEvents='none';
  }
  requestAnimationFrame(()=>state.map?.invalidateSize());
  return gen;
}
function reducedMotion(){return window.matchMedia('(prefers-reduced-motion: reduce)').matches}
function rotateMapFacts(){
  const el=$('mapLoaderFact'); if(!el||state.factTimer)return;
  let index=0;
  const apply=()=>{el.textContent=MAP_FACTS[index%MAP_FACTS.length];};
  apply();
  state.factTimer=setInterval(()=>{
    const next=()=>{index+=1;apply();el.classList.remove('isFading');};
    if(reducedMotion()){next();return;}
    el.classList.add('isFading');
    setTimeout(next, 320);
  }, 4000);
}
function revealMapLoader(){
  const el=$('mapLoader'); if(!el)return;
  el.classList.remove('isDone','isGone');
  delete el.dataset.hiding;
  el.setAttribute('aria-busy','true');
  if(state.bootDone){
    const label=$('bootText');
    if(label) label.textContent='Updating the map…';
  }
}
function hideMapLoader(gen){
  if(gen!=null&&gen!==state.mapLoaderGen)return;
  clearTimeout(state.mapLoaderGiveUp);
  const el=$('mapLoader'); if(!el||el.classList.contains('isGone')||el.dataset.hiding==='1'){state.mapSettled=true;return;}
  el.dataset.hiding='1';
  el.classList.add('isDone');
  el.setAttribute('aria-busy','false');
  state.mapSettled=true;
  const finish=()=>{if(el.classList.contains('isDone'))el.classList.add('isGone');};
  if(reducedMotion())finish();
  else{el.addEventListener('transitionend',finish,{once:true});setTimeout(finish,480);}
}
function mapTilesPending(){
  const imgs=document.querySelectorAll('#map .leaflet-tile-pane img.leaflet-tile');
  if(!imgs.length)return true;
  return [...imgs].some(img=>!img.complete);
}
function beginMapLoader(showNow){
  const gen=++state.mapLoaderGen;
  state.pinsPainted=false;
  clearTimeout(state.mapLoaderGiveUp);
  state.mapLoaderGiveUp=null;
  if(showNow)revealMapLoader();
  return gen;
}
function settleMapLoader(gen){
  if(gen!==state.mapLoaderGen||!state.pinsPainted||state.awaitingFirstFit)return;
  if(!state.mapLoaderGiveUp)state.mapLoaderGiveUp=setTimeout(()=>hideMapLoader(gen),12000);
  state.map?.invalidateSize();
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    if(gen!==state.mapLoaderGen||!state.pinsPainted||state.awaitingFirstFit)return;
    if(mapTilesPending())return;
    hideMapLoader(gen);
  }));
}

function syncFilters(){
  state.filters={q:$('search').value.trim().toLowerCase(),status:$('statusFilter').value,rep:$('repFilter').value,territory:$('territoryFilter').value,source:$('sourceFilter').value,mine:$('mineToggle').checked};
}
function buildFilters(){
  const territory=$('territoryFilter').value, rep=$('repFilter').value, source=$('sourceFilter').value;
  const cities=[...new Set(state.leads.map(l=>l.city).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const territories=cities.map(city=>({name:city,city}));
  const reps=state.reps.slice().sort((a,b)=>a.name.localeCompare(b.name));
  fillSelect('repFilter','All reps',reps.map(r=>({value:r.id,label:r.name})));
  fillSelect('territoryFilter','All territories',territories.map(t=>({value:t.city,label:t.city})));
  fillSelect('sourceFilter','All sources',[...new Set(state.leads.map(l=>l.source).filter(Boolean))].sort().map(x=>({value:x,label:x})));
  if(territory)$('territoryFilter').value=territory;
  if(rep)$('repFilter').value=rep;
  if(source)$('sourceFilter').value=source;
}
function fillSelect(id,first,items){$(id).innerHTML=`<option value="">${esc(first)}</option>`+items.map(x=>`<option value="${esc(x.value)}">${esc(x.label)}</option>`).join('');}

function applyFilters(){
  const f=state.filters;
  const storm=state.stormHouseIds;
  state.filtered=state.leads.filter(l=>{
    if(storm&&!storm.has(l.id))return false;
    const blob=[l.name,l.address,l.city,l.state,l.zip,l.record_id,l.recordId,l.id,l.full_address,l.fullAddress].join(' ').toLowerCase();
    return (!f.q||blob.includes(f.q)) && (!f.status||leadStatus(l)===f.status) && (!f.rep||l.assignedRepId===f.rep) && (!f.territory||l.city===f.territory) && (!f.source||l.source===f.source) && (!f.mine||!state.currentRep||l.assignedRepId===state.currentRep.id||(state.territories.find(t=>t.name===l.city)?.assigned_rep_id===state.currentRep.id));
  });
}

function renderAll(){
  if(!state.map)return;
  applyFilters();
  state.listFilterKey='';
  if(state.renderQueued)return;
  state.renderQueued=true;
  requestAnimationFrame(()=>{state.renderQueued=false;renderNow()});
}
function renderNow(fit=true){
  if(!state.map)return;
  applyFilters();
  renderSidebarCounts();
  refreshMapLayers();
  updateSelectedBadge();
  updatePinBanner();
  state.pinsPainted=true;
  if(fit && !state.didFit){
    state.didFit=true;
    state.awaitingFirstFit=true;
    setTimeout(()=>{publishListPeek();fitMapToScope(false);state.awaitingFirstFit=false;settleMapLoader(state.mapLoaderGen);},80);
  }
  settleMapLoader(state.mapLoaderGen);
  const token=++state.listSortToken;
  requestAnimationFrame(()=>{
    if(token!==state.listSortToken)return;
    renderStats();
    renderWorkList();
    renderHandoffs();
    renderTeam();
    updateListSummary();
  });
}

function renderStats(){
  const total=state.filtered.length;
  const knocked=state.filtered.filter(l=>['Knocked','No Answer','Interested','Not Interested','Do Not Knock'].includes(leadStatus(l))).length;
  const appts=state.appointments.filter(a=>a.stage!=='Cancelled').length;
  const pinned=state.filtered.filter(isCoords).length;
  $('stats').innerHTML=`<div class="stat"><b>${fmt(total)}</b><span>filtered leads</span></div><div class="stat"><b>${fmt(pinned)}</b><span>mapped houses</span></div><div class="stat"><b>${fmt(knocked)}</b><span>worked</span></div><div class="stat"><b>${fmt(appts)}</b><span>appointments</span></div>`;
  const start=new Date(); start.setHours(0,0,0,0);
  const todayActivities=state.activities.filter(a=>new Date(a.created_at).getTime()>=start.getTime());
  const workedToday=todayActivities.filter(a=>['Knocked','No Answer','Interested','Not Interested','Do Not Knock'].includes(a.metadata?.to_status)).length;
  const apptsToday=state.appointments.filter(a=>a.stage!=='Cancelled'&&new Date(a.scheduled_at).getTime()>=start.getTime()&&new Date(a.scheduled_at).getTime()<start.getTime()+86400000).length;
  const highPriority=state.filtered.filter(l=>l.priority==='High'&&scoreLead(l)>-1000).length;
  $('todayWorked').textContent=fmt(workedToday); $('todayAppts').textContent=fmt(apptsToday); $('highPriorityCount').textContent=fmt(highPriority);
}
function renderSidebarCounts(){
  $('workCount').textContent=fmt(state.filtered.length);
  $('handoffCount').textContent=fmt(state.appointments.filter(a=>!['Completed','Cancelled'].includes(a.stage)).length);
  $('teamCount').textContent=fmt(state.reps.length);
}

function ensureListRows(){
  const key=JSON.stringify(state.filters)+':'+(state.stormHouseIds?state.stormHouseIds.size:0)+':'+state.leads.length;
  if(state.listFilterKey===key && state.listRows) return;
  const previous=state.listFilterKey;
  state.listFilterKey=key;
  state.listRows=state.filtered.slice().sort((a,b)=>scoreLead(b)-scoreLead(a));
  state.listShown=180;
  state.listPaintToken='';
  if(previous) $('workList').scrollTop=0;
}
function renderWorkList(){state.listPaintToken='';paintWorkList()}
function paintWorkList(){
  const list=$('workList'); if(!list) return;
  ensureListRows();
  const rows=state.listRows||[];
  if(!rows.length){list.innerHTML='<div class="empty"><b>No houses match these filters.</b><br>Try Reset, change territory, or use the map search.</div>';return}
  if(list.clientHeight<40){paintPagedList(list, rows);return}
  const rowH=84;
  const start=Math.max(0, Math.floor(list.scrollTop/rowH)-3);
  const end=Math.min(rows.length, Math.ceil((list.scrollTop+list.clientHeight)/rowH)+6);
  const token=`${state.listFilterKey}:${start}:${end}:${state.selected.size}:${state.active||''}`;
  if(state.listPaintToken===token) return;
  state.listPaintToken=token;
  const scroll=list.scrollTop;
  list.innerHTML=`<div style="height:${start*rowH}px"></div>${rows.slice(start,end).map(leadHTML).join('')}<div style="height:${Math.max(0,(rows.length-end)*rowH)}px"></div>`;
  list.scrollTop=scroll;
  bindListRows(list);
}
function paintPagedList(list, rows){
  const shown=Math.min(rows.length, state.listShown||180);
  const top=rows.slice(0, shown);
  const more=rows.length>shown?`<button type="button" id="showMoreLeads" class="showMoreLeads">Show more · ${fmt(shown)} of ${fmt(rows.length)}</button>`:'';
  const scroll=list.scrollTop;
  list.innerHTML=top.map(leadHTML).join('')+more;
  list.scrollTop=scroll;
  bindListRows(list);
  $('showMoreLeads')?.addEventListener('click',()=>{state.listShown=Math.min(rows.length, shown+180);state.listPaintToken='';paintPagedList(list, rows)});
}
function bindListRows(list){
  list.querySelectorAll('.leadRow').forEach(el=>el.onclick=e=>{if(e.target.closest('.rowCheck'))return;openLead(el.dataset.id)});
  list.querySelectorAll('.rowCheck').forEach(cb=>cb.onchange=()=>{cb.checked?state.selected.add(cb.dataset.id):state.selected.delete(cb.dataset.id);updateSelectedBadge();refreshSelectedMarkers();syncRouteButtons(cb.dataset.id)});
}
function leadHTML(l){
  const s=leadStatus(l), owner=leadOwnerName(l), score=scoreLead(l), old=l.year_built??l.yearBuilt;
  const appointment=state.appointments.find(a=>a.lead_id===l.id&&a.stage!=='Cancelled');
  const territoryRep=state.reps.find(r=>r.id===state.territories.find(t=>t.name===l.city)?.assigned_rep_id)?.name||'';
  const distance=state.currentLocation&&isCoords(l)?haversine(state.currentLocation.lat,state.currentLocation.lng,l.lat,l.lng):null;
  return `<div class="leadRow ${state.active===l.id?'active':''}" data-id="${esc(l.id)}">
    <input class="rowCheck" type="checkbox" data-id="${esc(l.id)}" ${state.selected.has(l.id)?'checked':''}>
    <div class="rowBody"><div class="rowHeader"><strong>${esc(l.name||'Property lead')}</strong><span class="status ${statusClass(s)}">${esc(s)}</span></div>
    <div class="addr">${esc(l.address)}<br><span>${esc(l.city)}, ${esc(l.state)} ${esc(l.zip)}</span></div>
    <div class="rowMeta"><span class="score">${score} pts</span>${l.priority==='High'?`<span class="priorityTag">HIGH</span>`:''}${distance!=null?`<span>${distance.toFixed(1)} mi</span>`:''}${old?`<span>Built ${esc(old)}</span>`:''}${owner?`<span>${esc(owner)}</span>`:''}${territoryRep?`<span>Territory · ${esc(territoryRep)}</span>`:''}${appointment?`<span class="apptTag">APPT</span>`:''}</div></div></div>`;
}
function statusClass(s){return s.toLowerCase().replace(/\s+/g,'-')}

function renderHandoffs(){
  const list=$('handoffList');
  const appts=state.appointments.slice().filter(a=>!['Completed','Cancelled'].includes(a.stage)).sort((a,b)=>String(a.scheduled_at).localeCompare(String(b.scheduled_at)));
  list.innerHTML=appts.length?appts.slice(0,120).map(a=>appointmentHTML(a)).join(''):'<div class="empty">No open appointments.</div>';
  list.querySelectorAll('[data-appt]').forEach(el=>el.onclick=()=>openAppointment(el.dataset.appt));
}
function appointmentHTML(a){
  const l=state.leads.find(x=>x.id===a.lead_id)||{};
  return `<div class="appointmentRow" data-appt="${esc(a.id)}"><div><strong>${esc(l.name||'Appointment')}</strong><div>${esc(l.address||'')}</div><small>${esc(formatDate(a.scheduled_at))} · ${esc(a.stage)}</small></div><span class="chev">›</span></div>`;
}
function formatDate(v){try{return new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(v))}catch{return String(v||'')}}

function renderTeam(){
  const list=$('teamList');
  const cutoff=Date.now()-7*86400000;
  const by={}; state.reps.forEach(r=>by[r.id]={rep:r,knocks:0,appts:0,interested:0});
  state.activities.filter(a=>new Date(a.created_at).getTime()>=cutoff).forEach(a=>{if(!by[a.actor_id])return; const to=a.metadata?.to_status; if(['Knocked','No Answer','Interested','Not Interested','Do Not Knock'].includes(to))by[a.actor_id].knocks++;if(to==='Interested')by[a.actor_id].interested++;if(a.action==='appointment_booked')by[a.actor_id].appts++});
  const rows=Object.values(by).sort((a,b)=>(b.appts*10+b.interested*2+b.knocks)-(a.appts*10+a.interested*2+a.knocks));
  list.innerHTML=rows.map((x,i)=>`<div class="teamRow"><div class="rank">${i+1}</div><div class="teamName"><strong>${esc(x.rep.name)}</strong><small>${esc(roleLabel(x.rep.role))}</small></div><div><b>${x.knocks}</b><small>worked</small></div><div><b>${x.appts}</b><small>appts</small></div></div>`).join('')||'<div class="empty">No team members configured.</div>';
}

function scoreLead(l){
  const s=leadStatus(l);
  if(l._score!=null && l._scoreKey===s) return l._score;
  let score=0;
  if(s==='Do Not Knock'||s==='Appointment'||s==='Not Interested')return -1000;
  if(s==='Interested')score+=55; else if(s==='No Answer')score+=24; else if(s==='Knocked')score+=12; else score+=32;
  if(l.priority==='High')score+=45;
  if(String(l.owner_occupied||l.ownerOccupied)==='Y')score+=18;
  const year=Number(l.year_built??l.yearBuilt);
  if(year){const age=Math.max(0,2026-year);score+=Math.min(35,Math.round(age*.8));}
  const roofAge=Number(l.roof_age_years??l.roofAgeYears);
  if(roofAge)score+=Math.min(28,Math.round(roofAge*1.3));
  if(l.city&&state.territories.find(t=>t.name===l.city)?.assigned_rep_id===state.currentRep?.id)score+=8;
  if(isCoords(l)&&state.currentLocation){score+=Math.max(0,20-Math.round(haversine(state.currentLocation.lat,state.currentLocation.lng,l.lat,l.lng)*3));}
  l._scoreKey=s;
  l._score=Math.round(score);
  return l._score;
}

function refreshMapLayers(){
  if(!state.map)return;
  const slow=state.mapSettled && mapTilesPending();
  if(slow){
    const gen=beginMapLoader(true);
    requestAnimationFrame(()=>{
      if(gen!==state.mapLoaderGen)return;
      syncPins();
      syncDecorations();
      state.pinsPainted=true;
      settleMapLoader(gen);
    });
    return;
  }
  syncPins();
  syncDecorations();
}
function syncDecorations(){
  const territoryKey=state.layerFlags.territories?`${state.filtered.length}:${JSON.stringify(state.filters)}:${state.stormHouseIds?state.stormHouseIds.size:0}`:'off';
  if(territoryKey!==state.territoryKey){
    (state._territoryLayers||[]).forEach(x=>x.remove());
    state._territoryLayers=[];
    state.territoryKey=territoryKey;
    if(state.layerFlags.territories)drawTerritories();
  }
  if(state.routeLine){state.map.removeLayer(state.routeLine);state.routeLine=null}
  if(state.routeStops?.length)drawRoutePreview(false);
  else if(state.navigating)drawNavOverlay();
  scheduleHeat();
}
function scheduleHeat(){
  clearTimeout(state.heatTimer);
  const want=state.layerFlags.density||state.layerFlags.opportunity||state.layerFlags.roofAge;
  if(!want){state.heatLayers.forEach(layer=>layer.remove());state.heatLayers=[];state.heatKey='';return}
  state.heatTimer=setTimeout(()=>{ ensureHeat().then(()=>{ if(window.L?.heatLayer) rebuildHeat(); }).catch(()=>{}); }, 180);
}
let heatPromise;
function ensureHeat(){
  if(window.L?.heatLayer) return Promise.resolve();
  heatPromise ||= new Promise((resolve, reject)=>{
    const script=document.createElement('script');
    script.src='/vendor/leaflet/leaflet-heat.js';
    script.onload=()=>resolve();
    script.onerror=()=>reject(new Error('heat map did not load'));
    document.head.appendChild(script);
  });
  return heatPromise;
}
function rebuildHeat(){
  const key=[state.layerFlags.density,state.layerFlags.opportunity,state.layerFlags.roofAge,state.filtered.length,state.listFilterKey].join(':');
  if(key===state.heatKey)return;
  state.heatLayers.forEach(layer=>layer.remove());
  state.heatLayers=[];
  state.heatKey=key;
  if(state.layerFlags.density)drawHeat('density');
  if(state.layerFlags.opportunity)drawHeat('opportunity');
  if(state.layerFlags.roofAge)drawHeat('roof');
}
const PIN_COLORS={new:'#1e6bff',knocked:'#3E4E59','no-answer':'#A66B19',interested:'#467c9e','not-interested':'#8c5e54','do-not-knock':'#A44835',appointment:'#2E6B4B'};
function stylePin(marker, lead){
  const selected=state.selected.has(lead.id);
  const color=selected?'#c54f32':(PIN_COLORS[statusClass(leadStatus(lead))]||'#1e6bff');
  marker.setStyle({radius:selected?9:7, fillColor:color, color:selected?'#fff':'#0c1424', weight:selected?2:1, fillOpacity:.95});
}
function pinPopupHtml(lead){
  const s=leadStatus(lead);
  return `<div class="pinPopup"><b>${esc(lead.name||'Property lead')}</b><div>${esc(lead.address)}, ${esc(lead.city)}</div><div class="popupLine"><span class="miniBadge">${esc(s)}</span><b>${scoreLead(lead)} pts</b></div><div class="popupActions"><button type="button" class="routeToggle" data-popup-route="${esc(lead.id)}">${routeToggleLabel(state.selected.has(lead.id))}</button><button type="button" data-popup-lead="${esc(lead.id)}">Open lead</button></div></div>`;
}
function bindPinPopup(lead){
  setTimeout(()=>{
    const routeBtn=document.querySelector(`[data-popup-route="${CSS.escape(lead.id)}"]`);
    routeBtn?.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();toggleSelected(lead.id);if(routeBtn)routeBtn.textContent=routeToggleLabel(state.selected.has(lead.id));stylePin(state.pinMarkers.get(lead.id), lead)});
    document.querySelector(`[data-popup-lead="${CSS.escape(lead.id)}"]`)?.addEventListener('click',()=>openLead(lead.id));
  },0);
}
function ensurePin(lead){
  let marker=state.pinMarkers.get(lead.id);
  if(marker) return marker;
  marker=L.circleMarker([Number(lead.lat), Number(lead.lng)],{renderer:state.pinRenderer, radius:7, weight:1, color:'#0c1424', fillColor:'#1e6bff', fillOpacity:.95});
  marker._leadId=lead.id;
  stylePin(marker, lead);
  if(useDoorSheet()) marker.on('click', event=>{L.DomEvent.stop(event);openDoorSheet(lead.id)});
  else {marker.bindPopup(()=>pinPopupHtml(state.leadsById.get(lead.id)||lead)); marker.on('popupopen',()=>bindPinPopup(state.leadsById.get(lead.id)||lead))}
  state.pinMarkers.set(lead.id, marker);
  return marker;
}
function clusterIcon(count){
  const size=count>999?46:count>99?40:34;
  return L.divIcon({className:'pinCluster', html:`<span>${fmt(count)}</span>`, iconSize:[size,size], iconAnchor:[size/2,size/2]});
}
function hideStreetPins(){
  state.pinShown.forEach(id=>state.pinMarkers.get(id)?.remove());
  state.pinShown.clear();
}
function syncPins(){
  if(!state.map)return;
  if(!state.layerFlags.pins){hideStreetPins();state.pinClusters?.clearLayers();state.clusterSig='';state.clusterSource=null;return}
  const zoom=state.map.getZoom();
  if(zoom<STREET_ZOOM){
    hideStreetPins();
    if(state.clusterSource===state.filtered && state.clusterZoom===zoom && state.clusterSig) return;
    const clusters=clusterLeads(state.filtered, zoom);
    state.clusterSig=`${zoom}:${clusters.length}:${state.filtered.length}`;
    state.clusterSource=state.filtered;
    state.clusterZoom=zoom;
    state.pinClusters.clearLayers();
    clusters.forEach(cluster=>{
      const marker=L.marker([cluster.lat, cluster.lng],{icon:clusterIcon(cluster.count), keyboard:true, title:`${fmt(cluster.count)} homes`});
      marker.on('click',()=>state.map.setView([cluster.lat, cluster.lng], Math.min(STREET_ZOOM, zoom+2)));
      state.pinClusters.addLayer(marker);
    });
    return;
  }
  if(state.clusterSig){state.pinClusters.clearLayers();state.clusterSig='';state.clusterSource=null;state.clusterZoom=null}
  const bounds=state.map.getBounds().pad(.2);
  const want=new Set();
  state.filtered.forEach(lead=>{if(isCoords(lead)&&bounds.contains([Number(lead.lat), Number(lead.lng)])) want.add(lead.id)});
  const diff=pinDiff(state.pinShown, want);
  diff.remove.forEach(id=>{state.pinMarkers.get(id)?.remove();state.pinShown.delete(id)});
  diff.add.forEach(id=>{
    const lead=state.leadsById.get(id);
    if(!lead)return;
    ensurePin(lead).addTo(state.markerLayer);
    state.pinShown.add(id);
  });
  want.forEach(id=>{const lead=state.leadsById.get(id), marker=state.pinMarkers.get(id); if(lead&&marker) stylePin(marker, lead)});
}
function useDoorSheet(){return doorSheetMedia.matches;}
function drawHeat(kind){
  const points=sampleHeat(state.filtered).map(l=>{let intensity=.2;if(kind==='density')intensity=.35;else if(kind==='opportunity')intensity=Math.min(1,Math.max(.05,scoreLead(l)/140));else{const y=Number(l.year_built??l.yearBuilt), roof=Number(l.roof_age_years??l.roofAgeYears);const age=roof|| (y?2026-y:0);intensity=Math.min(1,Math.max(.08,age/45));}return [Number(l.lat),Number(l.lng),intensity]});
  if(!points.length)return;
  const layer=L.heatLayer(points,{radius:24,blur:18,maxZoom:17,minOpacity:.20}).addTo(state.map); state.heatLayers.push(layer);
}
function drawTerritories(){
  const cities=groupByCity(state.filtered);
  Object.entries(cities).forEach(([city,leads])=>{
    const coords=leads.filter(isCoords); let center=state.centers?.[city];
    if(coords.length){center=[avg(coords.map(x=>Number(x.lat))),avg(coords.map(x=>Number(x.lng)))];}
    if(!center)return;
    const t=state.territories.find(x=>x.name===city)||{};
    const rep=state.reps.find(r=>r.id===t.assigned_rep_id)?.name||'Unassigned';
    const circle=L.circle(center,{radius:Math.max(400,Math.min(4200,Math.sqrt(leads.length)*95)),weight:1.5,fillOpacity:.06,color:t.color||'#0c1424'}).addTo(state.map);
    circle.bindPopup(`<b>${esc(city)}</b><br>${fmt(leads.length)} filtered houses<br><span>${esc(rep)}</span>`);
    state._territoryLayers.push(circle);
  });
}
function groupByCity(arr){return arr.reduce((m,l)=>{if(l.city)(m[l.city]??=[]).push(l);return m},{})}
function avg(a){return a.reduce((x,y)=>x+y,0)/Math.max(1,a.length)}

function nextBest(){
  const pool=state.filtered.filter(l=>scoreLead(l)>-100&&isCoords(l)).sort((a,b)=>scoreLead(b)-scoreLead(a));
  if(!pool.length){toast('No mapped, actionable houses are available in this filter.');return}
  openLead(pool[0].id);
  state.map.setView([pool[0].lat,pool[0].lng],17,{animate:true});
  toast(`Next best house: ${pool[0].address}`);
}

function isHomeLead(l){return isCoords(l)&&haversine(HOME_BASE.lat,HOME_BASE.lng,Number(l.lat),Number(l.lng))<=HOME_MILES;}
function fitMapToScope(animate=false){
  if(!state.map)return;
  const mapped=state.filtered.filter(isCoords);
  const home=mapped.filter(isHomeLead);
  const use=state.homeArea&&home.length?home:mapped;
  if(!use.length){state.map.setView([HOME_BASE.lat,HOME_BASE.lng],12,{animate});watchSlowTiles();return;}
  const bounds=L.latLngBounds(use.map(l=>[Number(l.lat),Number(l.lng)]));
  const phone=useDoorSheet();
  state.map.fitBounds(bounds.pad(.12),{animate,maxZoom:16,paddingTopLeft:[16,phone?128:36],paddingBottomRight:[16,phone?150:28]});
  watchSlowTiles();
}
let tileWatch=0;
function watchSlowTiles(){
  if(!state.mapSettled)return;
  clearTimeout(tileWatch);
  tileWatch=setTimeout(()=>{
    if(!mapTilesPending())return;
    const gen=beginMapLoader(true);
    state.pinsPainted=true;
    settleMapLoader(gen);
  },320);
}
function fitFilteredLeads(){
  if(!state.filtered.filter(isCoords).length){toast('No mapped houses in the current filter.');fitMapToScope(true);return;}
  fitMapToScope(true);
}
function setHomeArea(on){
  state.homeArea=!!on;
  $('homeAreaBtn').classList.toggle('isOn',state.homeArea);
  $('homeAreaBtn').setAttribute('aria-pressed',state.homeArea?'true':'false');
  $('allOhioBtn').classList.toggle('isOn',!state.homeArea);
  $('allOhioBtn').setAttribute('aria-pressed',!state.homeArea?'true':'false');
  fitMapToScope(true);
  updateListSummary();
}
function canManagePins(){return ['admin','manager'].includes(state.currentRep?.role);}
function updatePinBanner(){
  const el=$('pinBanner'); if(!el)return;
  if(state.pinBannerDismissed||!state.leads.length||state.leads.some(isCoords)){el.classList.add('hidden');return;}
  const admin=canManagePins();
  $('pinBannerText').textContent=admin?"Houses aren't pinned yet. Open Admin → Geocode missing house pins.":"Houses aren't pinned yet. Ask an admin to run the pin geocoder.";
  $('pinBannerAction').classList.toggle('hidden',!admin);
  el.classList.remove('hidden');
  if(useDoorSheet()){
    const canvas=document.querySelector('.mapCanvas')?.getBoundingClientRect();
    const overlay=document.querySelector('.mapTopOverlay')?.getBoundingClientRect();
    if(canvas&&overlay)el.style.top=`${Math.round(overlay.bottom-canvas.top+8)}px`;
  }else el.style.top='';
}
function updateListSummary(){
  const el=$('listSheetSummary'); if(!el)return;
  const n=state.filtered.length;
  const ranked=state.listRows&&state.listRows.length===state.filtered.length?state.listRows:state.filtered;
  const next=state.homeArea?(ranked.find(l=>isHomeLead(l)&&scoreLead(l)>-100)||ranked.find(l=>!isCoords(l))||ranked[0]):ranked.find(l=>scoreLead(l)>-100)||ranked[0];
  const label=`${fmt(n)} house${n===1?'':'s'}`;
  el.textContent=next?.address?`${label} · Next: ${next.address}`:label;
}
function setListSheet(snap){
  const sheet=$('listSheet'); if(!sheet)return;
  if(!useDoorSheet()){
    sheet.classList.remove('sheet-collapsed','sheet-half','sheet-full','panel-open','sheet-suppressed');
    document.documentElement.style.setProperty('--list-sheet-peek','0px');
    return;
  }
  const next=LIST_SNAPS.includes(snap)?snap:'sheet-collapsed';
  LIST_SNAPS.forEach(name=>sheet.classList.remove(name));
  sheet.classList.add(next);
  sheet.classList.toggle('panel-open',next!=='sheet-collapsed');
  state.listSnap=next;
  $('listSheetGrab')?.setAttribute('aria-expanded',next==='sheet-collapsed'?'false':'true');
  publishListPeek();
  requestAnimationFrame(()=>renderWorkList());
}
function publishListPeek(){
  const root=document.documentElement;
  if(!useDoorSheet()){root.style.setProperty('--list-sheet-peek','0px');return;}
  const h=Math.round($('listSheetGrab')?.getBoundingClientRect().height||52);
  const bottom=getComputedStyle(root).getPropertyValue('--list-sheet-bottom').trim()||'78px';
  root.style.setProperty('--list-sheet-peek',`calc(${h}px + ${bottom})`);
}
function syncListMode(){setListSheet(useDoorSheet()?(state.listSnap||'sheet-collapsed'):'sheet-collapsed');syncListOverlay();}
function listOverlayOpen(){return $('doorSheet')?.classList.contains('open')||($('toast')?.classList.contains('show')&&!$('toastActions')?.classList.contains('hidden'));}
function syncListOverlay(){
  const sheet=$('listSheet'); if(!sheet)return;
  const block=listOverlayOpen()&&useDoorSheet();
  if(block&&!sheet.classList.contains('sheet-collapsed'))setListSheet('sheet-collapsed');
  sheet.classList.toggle('sheet-suppressed',block);
}
function bindListSheet(){
  const grab=$('listSheetGrab'); if(!grab)return;
  let startY=0,moved=0,dragging=false,startSnap='sheet-collapsed';
  grab.addEventListener('pointerdown',e=>{
    if(!useDoorSheet()||e.button>0)return;
    dragging=true; startY=e.clientY; moved=0; startSnap=state.listSnap||'sheet-collapsed';
    grab.setPointerCapture?.(e.pointerId);
  });
  grab.addEventListener('pointermove',e=>{if(dragging)moved=e.clientY-startY;});
  const end=()=>{
    if(!dragging)return;
    dragging=false;
    const i=Math.max(0,LIST_SNAPS.indexOf(startSnap));
    if(moved<-36&&i<LIST_SNAPS.length-1)setListSheet(LIST_SNAPS[i+1]);
    else if(moved>36&&i>0)setListSheet(LIST_SNAPS[i-1]);
    else if(Math.abs(moved)<12)setListSheet(i<LIST_SNAPS.length-1?LIST_SNAPS[i+1]:'sheet-collapsed');
  };
  grab.addEventListener('pointerup',end);
  grab.addEventListener('pointercancel',end);
  window.addEventListener('resize',()=>{syncListMode();state.map?.invalidateSize();});
}

function toggleMapFocus(){
  document.body.classList.toggle('mapFocus');
  const on=document.body.classList.contains('mapFocus');
  $('focusBtn').textContent=on?'Exit focus':'Focus map';
  setTimeout(()=>state.map.invalidateSize(),220);
}

async function quickStatus(id,status,continueNext=false){
  const l=state.leads.find(x=>x.id===id); if(!l)return;
  await persistLeadPatch(l,{status});
  if(status==='Appointment'){openAppointmentForm(l);return;}
  renderAll();
  toast(`${status} · ${l.address}`);
  if(continueNext){closeDrawer();setTimeout(nextBest,150);}
}

function openDoorSheet(id){
  const l=state.leads.find(x=>x.id===id); if(!l)return;
  dismissDoorToast();
  state.doorLeadId=id;
  state.doorSaving=false;
  state.map?.closePopup();
  const s=leadStatus(l);
  $('doorSheetAddress').textContent=l.address||'Property lead';
  const nameEl=$('doorSheetName');
  nameEl.textContent=l.name||'';
  nameEl.classList.toggle('hidden',!l.name);
  $('doorSheetPlace').textContent=[l.city,l.state,l.zip].filter(Boolean).join(', ');
  const badge=$('doorSheetStatus');
  badge.textContent=s;
  badge.className=`status ${statusClass(s)}`;
  $('doorSheetBook').href=`/setter.html?lead=${encodeURIComponent(l.id)}`;
  $('doorSheetRoute').textContent=routeToggleLabel(state.selected.has(l.id));
  $('doorSheetActions').innerHTML=DOOR_STATUSES.map(status=>`<button type="button" class="doorStatus doorStatus-${statusClass(status)}${s===status?' isCurrent':''}" data-door-status="${esc(status)}" aria-pressed="${s===status?'true':'false'}"><span class="doorStatusDot" aria-hidden="true"></span><span>${esc(status)}</span></button>`).join('');
  $('doorSheetActions').querySelectorAll('[data-door-status]').forEach(btn=>{btn.onclick=()=>applyDoorStatus(l.id,btn.dataset.doorStatus);});
  const sheet=$('doorSheet');
  const card=$('doorSheetCard');
  card.style.transform='';
  card.style.transition='';
  clearTimeout(openDoorSheet._t);
  sheet.classList.remove('hidden');
  sheet.setAttribute('aria-hidden','false');
  sheet.getBoundingClientRect();
  sheet.classList.add('open');
  syncListOverlay();
  requestAnimationFrame(()=>panPinAboveSheet(l));
}
function closeDoorSheet(){
  const sheet=$('doorSheet'); if(!sheet||sheet.classList.contains('hidden'))return;
  const card=$('doorSheetCard');
  card.style.transform='';
  card.style.transition='';
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden','true');
  state.doorLeadId=null;
  state.doorSaving=false;
  clearTimeout(openDoorSheet._t);
  openDoorSheet._t=setTimeout(()=>{if(!sheet.classList.contains('open'))sheet.classList.add('hidden');},240);
  syncListOverlay();
}
function panPinAboveSheet(l){
  if(!state.map||!isCoords(l))return;
  const card=$('doorSheetCard');
  const mapRect=state.map.getContainer().getBoundingClientRect();
  const cardTop=window.innerHeight-(card?.offsetHeight||Math.round(window.innerHeight*0.5));
  let bandBottom=Math.min(mapRect.bottom, cardTop)-18;
  const panel=document.querySelector('.sidePanel');
  if(panel){
    const pr=panel.getBoundingClientRect();
    if(getComputedStyle(panel).display!=='none'&&pr.height>40&&pr.width>mapRect.width*0.7&&pr.top<bandBottom)bandBottom=Math.min(bandBottom, pr.top-12);
  }
  const bandTop=mapRect.top+48;
  if(bandBottom<bandTop+28)bandBottom=cardTop-18;
  const targetY=bandTop+Math.max(0, bandBottom-bandTop)*0.55;
  const pin=state.map.latLngToContainerPoint([Number(l.lat),Number(l.lng)]);
  const dy=(mapRect.top+pin.y)-targetY;
  if(Math.abs(dy)>8)state.map.panBy([0,dy],{animate:true,duration:.28});
}
function bindDoorSwipe(){
  const card=$('doorSheetCard');
  let startY=null, dragging=false;
  card.addEventListener('pointerdown',e=>{
    if(e.button>0)return;
    if(!e.target.closest('.doorSheetHead')||e.target.closest('button'))return;
    startY=e.clientY; dragging=true;
    card.style.transition='none';
    card.setPointerCapture?.(e.pointerId);
  });
  card.addEventListener('pointermove',e=>{
    if(!dragging)return;
    const dy=Math.max(0,e.clientY-startY);
    card.style.transform=`translateY(${dy}px)`;
  });
  const end=e=>{
    if(!dragging)return;
    const dy=e.clientY-startY;
    dragging=false; startY=null;
    if(dy>70){
      card.style.transition='transform .2s ease';
      card.style.transform='translateY(110%)';
      const sheet=$('doorSheet');
      sheet.classList.remove('open');
      sheet.setAttribute('aria-hidden','true');
      state.doorLeadId=null;
      state.doorSaving=false;
      clearTimeout(openDoorSheet._t);
      openDoorSheet._t=setTimeout(()=>{card.style.transition='';card.style.transform='';if(!sheet.classList.contains('open'))sheet.classList.add('hidden');},220);
      return;
    }
    card.style.transition='';
    card.style.transform='';
  };
  card.addEventListener('pointerup',end);
  card.addEventListener('pointercancel',end);
}
function nearestUnknocked(from){
  if(!from||!isCoords(from))return null;
  let best=null, bestD=Infinity;
  for(const l of state.leads){
    if(l.id===from.id||!isCoords(l)||leadStatus(l)!=='New')continue;
    const d=haversine(Number(from.lat),Number(from.lng),Number(l.lat),Number(l.lng));
    if(d<bestD){best=l; bestD=d;}
  }
  return best;
}
function openNextHouse(fromId){
  const from=state.leads.find(x=>x.id===fromId);
  const next=nearestUnknocked(from);
  dismissDoorToast();
  if(!next){toast('No un-knocked houses left nearby.');return;}
  state.map?.setView([Number(next.lat),Number(next.lng)],18,{animate:false});
  openDoorSheet(next.id);
}
async function undoDoorStatus(){
  const pending=state.doorUndo; if(!pending)return;
  state.doorUndo=null;
  $('toastActions').classList.add('hidden');
  const l=state.leads.find(x=>x.id===pending.id);
  if(!l||leadStatus(l)!==pending.to){toast('That door already changed.');return;}
  try{await persistLeadPatch(l,{status:pending.from});}
  catch{return;}
  renderAll();
  toast(`Restored · ${pending.from}`);
}
async function applyDoorStatus(id,status){
  const l=state.leads.find(x=>x.id===id); if(!l||state.doorSaving)return;
  if(!DOOR_STATUSES.includes(status))return;
  const previous=leadStatus(l);
  if(previous===status){renderAll();closeDoorSheet();toast(`Already ${status} · ${l.address}`);maybeAdvanceNav(id);return;}
  state.doorSaving=true;
  const buttons=[...$('doorSheetActions').querySelectorAll('button')];
  buttons.forEach(b=>{b.disabled=true;});
  const tapped=buttons.find(b=>b.dataset.doorStatus===status);
  const label=tapped?.querySelector('span:last-child');
  if(label) label.textContent='Saving…';
  try{await persistLeadPatch(l,{status});}
  catch{state.doorSaving=false;buttons.forEach(b=>{b.disabled=false;});if(label) label.textContent=status;return;}
  state.doorSaving=false;
  renderAll();
  closeDoorSheet();
  toastDoorResult(l, previous, status);
  maybeAdvanceNav(id);
}
function toastDoorResult(lead, fromStatus, toStatus){
  const el=$('toast'); if(!el)return;
  $('toastText').textContent=`${toStatus} · ${lead.address}`;
  $('toastActions').classList.remove('hidden');
  state.doorUndo={id:lead.id, from:fromStatus, to:toStatus};
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t=setTimeout(()=>{el.classList.remove('show'); $('toastActions').classList.add('hidden'); state.doorUndo=null; syncListOverlay();},5000);
  syncListOverlay();
}
function dismissDoorToast(){
  clearTimeout(toast._t);
  $('toast')?.classList.remove('show');
  $('toastActions')?.classList.add('hidden');
  state.doorUndo=null;
  syncListOverlay();
}

async function persistLeadPatch(l,patch){
  const previous=leadStatus(l);
  const normalized={...patch};
  if('assignedRepId' in normalized){normalized.assigned_rep_id=normalized.assignedRepId;delete normalized.assignedRepId;}
  if('roofAgeYears' in normalized){normalized.roof_age_years=normalized.roofAgeYears;delete normalized.roofAgeYears;}
  if('roofAgeVerified' in normalized){normalized.roof_age_verified=normalized.roofAgeVerified;delete normalized.roofAgeVerified;}
  Object.assign(l,normalized);
  l.assignedRepId=l.assigned_rep_id??l.assignedRepId??null;
  l.roofAgeYears=l.roof_age_years??l.roofAgeYears??null;
  l.roofAgeVerified=l.roof_age_verified??l.roofAgeVerified??false;
  if(state.mode==='cloud'){
    const payload={...normalized,updated_at:nowISO(),updated_by:state.currentRep.id};
    const {error}=await state.supabase.from('leads').update(payload).eq('id',l.id);
    if(error){alert(error.message);throw error;}
    if(normalized.status&&previous!==normalized.status){
      await logActivity(l.id,'status_changed',{from_status:previous,to_status:normalized.status});
      window.TrueNorthField?.captureDoorStatus?.({leadId:l.id,status:normalized.status});
    }
  }else{
    const meta=JSON.parse(localStorage.getItem('tnrc2:leadsMeta')||'{}'); meta[l.id]={status:l.status,owner:leadOwnerName(l),notes:l.notes||''}; localStorage.setItem('tnrc2:leadsMeta',JSON.stringify(meta)); saveLocal(l,meta[l.id]);
    if(normalized.status&&previous!==normalized.status)localAppendActivity({lead_id:l.id,actor_id:'local',action:'status_changed',metadata:{from_status:previous,to_status:normalized.status},created_at:nowISO()});
  }
}

function openLead(id){
  const l=state.leads.find(x=>x.id===id);if(!l)return;
  state.active=id;
  const appt=state.appointments.find(a=>a.lead_id===id&&a.stage!=='Cancelled');
  const notes=l.notes||localSaved(l).notes||'';
  const reps=state.reps.slice().sort((a,b)=>a.name.localeCompare(b.name));
  $('drawerContent').innerHTML=`<div class="drawerTop" data-lead-id="${esc(l.id)}"><div><div class="eyebrow">FIELD RECORD</div><h2>${esc(l.name||'Property lead')}</h2><div class="drawerAddr">${esc(l.address)}<br>${esc(l.city)}, ${esc(l.state)} ${esc(l.zip)}</div></div><span class="bigScore">${scoreLead(l)}</span></div>
    <div class="detailGrid"><div><small>Source</small><b>${esc(l.source)}</b></div><div><small>Priority</small><b>${esc(l.priority||'Standard')}</b></div><div><small>Built</small><b>${esc(l.year_built??l.yearBuilt??'Unknown')}</b></div><div><small>Mapped</small><b>${isCoords(l)?'Exact geocode':'Needs geocode'}</b></div></div>
    <div class="drawerActions"><button id="drawerMaps" class="darkBtn">Open Google Maps</button><button id="drawerDir" class="outlineBtn">Directions</button></div>
    <div class="fieldActions"><button data-qstatus="Knocked">Knocked</button><button data-qstatus="No Answer">No answer</button><button data-qstatus="Interested">Interested</button><button data-qstatus="Not Interested">Not interested</button></div>
    <label>Sales status</label><select id="dStatus">${STATUS_OPTIONS.map(x=>`<option value="${esc(x)}" ${leadStatus(l)===x?'selected':''}>${esc(x)}</option>`).join('')}</select>
    <label>Assigned rep</label><select id="dOwner"><option value="">Unassigned</option>${reps.map(r=>`<option value="${esc(r.id)}" ${l.assignedRepId===r.id?'selected':''}>${esc(r.name)} · ${esc(roleLabel(r.role))}</option>`).join('')}</select>
    <div class="verifiedGrid"><label>Roof age (verified)</label><input id="dRoofAge" type="number" min="0" max="100" value="${esc(l.roof_age_years??l.roofAgeYears??'')}" placeholder="e.g. 16"><label><input id="dRoofVerified" type="checkbox" ${l.roof_age_verified||l.roofAgeVerified?'checked':''}> verified</label></div>
    <label>Notes</label><textarea id="dNotes" placeholder="Homeowner response, roof condition, next action…">${esc(notes)}</textarea>
    <button id="saveLeadBtn" class="saveBtn">Save field result</button>
    <div class="drawerSection"><div class="sectionTitle">Appointment handoff</div>${appt?`<div class="apptCard"><b>${esc(formatDate(appt.scheduled_at))}</b><div>Salesperson: ${esc(appt.salesperson?.name||'Unassigned')}</div><span class="status ${statusClass(appt.stage)}">${esc(appt.stage)}</span><button id="editApptBtn">Edit handoff</button></div>`:`<button id="bookApptBtn" class="outlineBtn">Book / hand off this lead</button>`}</div>`;
  $('drawer').classList.remove('hidden');
  $('drawerMaps').onclick=()=>openMaps(l); $('drawerDir').onclick=()=>openDirections(l);
  if($('drawerSetter')) $('drawerSetter').onclick=()=>{location.href=`/setter.html?lead=${encodeURIComponent(l.id)}`;};
  $('drawer').querySelectorAll('[data-qstatus]').forEach(btn=>btn.onclick=()=>quickStatus(l.id,btn.dataset.qstatus,true));
  $('saveLeadBtn').onclick=()=>saveLead(l);
  $('bookApptBtn')?.addEventListener('click',()=>openAppointmentForm(l));
  $('editApptBtn')?.addEventListener('click',()=>openAppointmentForm(l,appt));
}
function closeDrawer(){$('drawer').classList.add('hidden');state.active=null;}
async function saveLead(l){
  const status=$('dStatus').value, repId=$('dOwner').value||null, roofAge=$('dRoofAge').value?Number($('dRoofAge').value):null, roofVerified=$('dRoofVerified').checked, notes=$('dNotes').value;
  try{await persistLeadPatch(l,{status,assigned_rep_id:repId,assignedRepId:repId,roof_age_years:roofAge,roofAgeYears:roofAge,roof_age_verified:roofVerified,roofAgeVerified:roofVerified,notes});}
  catch{return}
  closeDrawer();renderAll();
  if(status==='Appointment')openAppointmentForm(l); else toast('Field result saved');
}

async function logActivity(leadId,action,metadata={}){
  if(state.mode==='cloud'){const {data,error}=await state.supabase.from('lead_activity').insert({lead_id:leadId,actor_id:state.currentRep.id,action,metadata}).select('id,lead_id,actor_id,action,metadata,created_at').single();if(!error&&data)state.activities.unshift(data)}else localAppendActivity({lead_id:leadId,actor_id:'local',action,metadata,created_at:nowISO()});
}
function localAppendActivity(a){state.activities.unshift(a);localStorage.setItem('tnrc2:activities',JSON.stringify(state.activities.slice(0,4000)))}

function openMaps(l){window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l.full_address||l.fullAddress||addressOf(l))}`,'_blank','noopener')}
function openDirections(l){window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(l.full_address||l.fullAddress||addressOf(l))}&travelmode=${state.routeMode}`,'_blank','noopener')}
function addressOf(l){return [l.address,l.city,l.state,l.zip].filter(Boolean).join(', ')}

function openRoutePanel(){
  $('selectedCountRoute').textContent=fmt(state.selected.size);
  $('routePanel').classList.remove('hidden');
}
function closeRoutePanel(){$('routePanel').classList.add('hidden')}
async function optimizeAndDrawRoute(){
  const raw=[...state.selected].map(id=>state.leads.find(l=>l.id===id)).filter(Boolean);
  const mapped=raw.filter(isCoords); const max=Number($('routeCount').value||25); const leads=mapped.slice(0,max);
  if(!leads.length){alert('Select mapped houses first. Unmapped addresses need geocoding before they can be optimized.');return}
  if(raw.length>max)$('routeWarning').textContent=`Using the first ${max} mapped selections.`;else if(mapped.length<raw.length)$('routeWarning').textContent=`${raw.length-mapped.length} selected houses have no coordinates yet.`;else $('routeWarning').textContent='';
  const start=state.currentLocation||{lat:leads[0].lat,lng:leads[0].lng};
  state.routeStops=nearestNeighbor2Opt(leads,start);
  renderRouteStops();
  $('routeDistance').textContent='Optimizing…';
  await fetchRoadRoute(start,state.routeStops);
}
async function fetchRoadRoute(start,stops){
  try{const points=[start,...stops].map(p=>({lat:p.lat,lng:p.lng}));const r=await fetch('/api/route',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({profile:osrmProfile(state.routeMode),coordinates:points})});const data=await r.json();if(!r.ok)throw new Error(data.error||'Route service failed');
    if(Array.isArray(data.order)&&data.order.length===stops.length){const ordered=data.order.map(i=>stops[i-1]).filter(Boolean);if(ordered.length===stops.length){state.routeStops=ordered;renderRouteStops();}}
    state.routeGeometry=data.geometry||null;
    drawRoutePreview(!state.navigating);
    const summary=`${fmtDistance(data.distance/1609.344)} · ${fmtDuration(data.duration)} · ${state.routeMode==='walking'?'walking':'driving'}`;
    $('routeDistance').textContent=`${summary} · road-network optimized`;
    $('routeTrayStats').textContent=summary;
  }catch(e){state.routeGeometry=null;drawRoutePreview();$('routeDistance').textContent=`Road router unavailable · ≈ ${fmtDistance(routeHaversineDistance(start,stops))}`;$('routeTrayStats').textContent=`≈ ${fmtDistance(routeHaversineDistance(start,stops))} straight line`;console.warn(e)}
}
function routeHaversineDistance(start,stops){let total=0,cur=start;for(const p of stops){total+=haversine(cur.lat,cur.lng,p.lat,p.lng);cur=p}return total}
function fmtDistance(miles){const n=Number(miles||0);return n<10?`${n.toFixed(1)} mi`:`${Math.round(n)} mi`}
function fmtDuration(sec){const m=Math.round(Number(sec||0)/60);return m<60?`${m} min`:`${Math.floor(m/60)}h ${m%60}m`}
function nearestNeighbor2Opt(leads,start){
  const remaining=leads.slice(); const out=[]; let cur=start;
  while(remaining.length){let bestIdx=0,best=Infinity;remaining.forEach((l,i)=>{const d=haversine(cur.lat,cur.lng,l.lat,l.lng);if(d<best){best=d;bestIdx=i}});const next=remaining.splice(bestIdx,1)[0];out.push(next);cur=next}
  if(out.length<4)return out;
  let improved=true;let loops=0;
  while(improved&&loops++<6){improved=false;for(let i=0;i<out.length-2;i++){for(let j=i+2;j<out.length;j++){const a=out[i],b=out[i+1],c=out[j],d=out[j+1];const before=haversine(a.lat,a.lng,b.lat,b.lng)+(d?haversine(c.lat,c.lng,d.lat,d.lng):0);const after=haversine(a.lat,a.lng,c.lat,c.lng)+(d?haversine(b.lat,b.lng,d.lat,d.lng):0);if(after+0.000001<before){const rev=out.slice(i+1,j+1).reverse();out.splice(i+1,rev.length,...rev);improved=true}}}}
  return out;
}
function drawRoutePreview(fit=true){
  if(state.routeLine){state.map.removeLayer(state.routeLine);state.routeLine=null}
  if(!state.routeStops?.length||!state.map)return;
  if(state.routeGeometry)state.routeLine=L.geoJSON(state.routeGeometry,{style:{color:'#203a29',weight:5,opacity:.78}}).addTo(state.map);
  else{const coords=state.routeStops.map(l=>[Number(l.lat),Number(l.lng)]);state.routeLine=L.polyline(coords,{weight:5,opacity:.75,dashArray:'8 7'}).addTo(state.map);}
  if(fit){try{state.map.fitBounds(state.routeLine.getBounds().pad(.12));}catch{}}
  if(state.navigating)drawNavOverlay();
}
function renderRouteStops(){
  $('routeStops').innerHTML=state.routeStops.map((l,i)=>`<div class="routeStop"><span>${i+1}</span><div><b>${esc(l.address)}</b><small>${esc(l.city)} · ${scoreLead(l)} pts</small></div><button data-route-lead="${esc(l.id)}">×</button></div>`).join('')||'<div class="empty">No route yet.</div>';
  $('routeStops').querySelectorAll('[data-route-lead]').forEach(btn=>btn.onclick=()=>{state.selected.delete(btn.dataset.routeLead);optimizeAndDrawRoute();updateSelectedBadge()});
}
function openGoogleRouteBlocks(){
  if(!state.routeStops.length){alert('Optimize a route first.');return}
  const chunks=[];for(let i=0;i<state.routeStops.length;i+=9)chunks.push(state.routeStops.slice(i,i+9));
  const travel=googleTravelMode(state.routeMode);
  chunks.forEach((chunk,idx)=>{const origin=idx===0?(state.currentLocation?`${state.currentLocation.lat},${state.currentLocation.lng}`:addressOf(chunk[0])):addressOf(state.routeStops[idx*9-1]);const destination=addressOf(chunk.at(-1));const mids=chunk.slice(0,-1).map(addressOf);const u=`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}${mids.length?`&waypoints=${encodeURIComponent(mids.join('|'))}`:''}&travelmode=${encodeURIComponent(travel)}`;window.open(u,'_blank','noopener')});
}
function openAppleRoute(stops=state.routeStops){
  const points=(stops||[]).filter(isCoords);
  if(!points.length){toast('Optimize a route first.');return}
  window.open(appleDirectionsUrl(state.currentLocation, points, state.routeMode),'_blank','noopener');
}

function openAppointmentForm(l,appt=null){
  const appointment=appt||{lead_id:l.id,stage:'Scheduled',scheduled_at:'',salesperson_id:''};
  $('appointmentModal').classList.remove('hidden'); $('appointmentTitle').textContent=appt?'Edit handoff':'Book appointment';
  $('appLeadId').value=l.id; $('appScheduled').value=appointment.scheduled_at?new Date(appointment.scheduled_at).toISOString().slice(0,16):''; $('appStage').value=appointment.stage||'Scheduled';
  $('appSalesperson').innerHTML='<option value="">Unassigned</option>'+state.reps.filter(r=>['salesperson','manager','admin'].includes(r.role)).map(r=>`<option value="${esc(r.id)}" ${appointment.salesperson_id===r.id||appointment.salesperson?.id===r.id?'selected':''}>${esc(r.name)} · ${esc(roleLabel(r.role))}</option>`).join('');
  $('appNotes').value=appointment.notes||l.notes||''; $('appId').value=appointment.id||'';
}
async function saveAppointmentFromForm(e){e.preventDefault();
  const l=state.leads.find(x=>x.id===$('appLeadId').value); if(!l)return;
  const data={lead_id:l.id,canvasser_id:state.mode==='cloud'?state.currentRep.id:null,salesperson_id:$('appSalesperson').value||null,scheduled_at:new Date($('appScheduled').value).toISOString(),stage:$('appStage').value,notes:$('appNotes').value.trim()};
  if(state.mode==='cloud'){
    let result;
    if($('appId').value)result=await state.supabase.from('appointments').update(data).eq('id',$('appId').value).select('*').single();
    else result=await state.supabase.from('appointments').insert(data).select('*').single();
    if(result.error){alert(result.error.message);return}
    const fresh=result.data; const idx=state.appointments.findIndex(a=>a.id===fresh.id);if(idx>=0)state.appointments[idx]=fresh;else state.appointments.push(fresh);
    await logActivity(l.id,'appointment_booked',{scheduled_at:data.scheduled_at,salesperson_id:data.salesperson_id});
    const {error}=await state.supabase.from('leads').update({status:'Appointment',updated_at:nowISO(),updated_by:state.currentRep.id}).eq('id',l.id);if(error){alert(error.message);return}
    l.status='Appointment';
    window.TrueNorthField?.captureDoorStatus?.({leadId:l.id,status:'Appointment'});
  }else{
    const id=$('appId').value||`local-${Date.now()}`;const rec={...data,id,salesperson_name:state.reps.find(r=>r.id===data.salesperson_id)?.name||''};const idx=state.appointments.findIndex(a=>a.id===id);if(idx>=0)state.appointments[idx]=rec;else state.appointments.push(rec);localStorage.setItem('tnrc2:appointments',JSON.stringify(state.appointments));l.status='Appointment';localAppendActivity({lead_id:l.id,actor_id:'local',action:'appointment_booked',metadata:{scheduled_at:data.scheduled_at},created_at:nowISO()});
  }
  $('appointmentModal').classList.add('hidden');renderAll();closeDrawer();
  switchTab('handoffs');
}
function openAppointment(id){const a=state.appointments.find(x=>String(x.id)===String(id));if(!a)return;const l=state.leads.find(x=>x.id===a.lead_id);if(l)openAppointmentForm(l,a)}
async function copyCurrentHandoff(){
  const id=$('appLeadId').value; const l=state.leads.find(x=>x.id===id);if(!l)return;
  const text=`True North Restorations — Sales Handoff\nHomeowner: ${l.name||'Property lead'}\nAddress: ${addressOf(l)}\nAppointment: ${formatDate($('appScheduled').value)}\nSalesperson: ${state.reps.find(r=>r.id===$('appSalesperson').value)?.name||'Unassigned'}\nNotes: ${$('appNotes').value||'—'}`;
  try{await navigator.clipboard.writeText(text);$('copyHandoffBtn').textContent='Copied';setTimeout(()=>$('copyHandoffBtn').textContent='Copy handoff',1200)}catch{alert(text)}
}

function switchTab(tab){document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));$('tab'+tab.charAt(0).toUpperCase()+tab.slice(1)).classList.add('active');['workPanel','handoffPanel','teamPanel'].forEach(id=>$(id).classList.add('hidden'));$(tab==='work'?'workPanel':tab==='handoffs'?'handoffPanel':'teamPanel').classList.remove('hidden')}

function openAdmin(){
  $('adminModal').classList.remove('hidden');
  const accounts=$('adminAccountsLink');
  if(accounts){
    accounts.href='/admin#accounts';
    accounts.classList.toggle('hidden', !canOpenManagement({email:state.user?.email, rep:state.currentRep, adminEmails:state.config?.adminEmails}));
  }
  $('adminCloudStatus').textContent=state.mode==='cloud'?`Connected as ${state.currentRep?.name||state.user?.email}`:'Local device mode';
  $('adminLeadCount').textContent=fmt(state.leads.length); $('adminMappedCount').textContent=fmt(state.leads.filter(isCoords).length); $('adminTerritoryCount').textContent=fmt(state.territories.length);
  renderTerritoryAdmin();
}
function renderTerritoryAdmin(){
  const cities=[...new Set(state.leads.map(l=>l.city).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  $('territoryAdmin').innerHTML=cities.slice(0,260).map(city=>{const t=state.territories.find(x=>x.name===city)||{};return `<div class="territoryRow"><div><b>${esc(city)}</b><small>${fmt(state.leads.filter(l=>l.city===city).length)} leads</small></div><select data-territory="${esc(city)}"><option value="">Unassigned</option>${state.reps.map(r=>`<option value="${esc(r.id)}" ${t.assigned_rep_id===r.id?'selected':''}>${esc(r.name)}</option>`).join('')}</select></div>`}).join('');
  $('territoryAdmin').querySelectorAll('[data-territory]').forEach(el=>el.onchange=()=>saveTerritoryAssignment(el.dataset.territory,el.value||null));
}
async function saveTerritoryAssignment(city,repId){
  const existing=state.territories.find(t=>t.name===city);const center=state.centers?.[city];
  const row={id:existing?.id||crypto.randomUUID(),name:city,city,assigned_rep_id:repId,center_lat:center?.[0]??null,center_lng:center?.[1]??null,color:existing?.color||null};
  if(state.mode==='cloud'){const {data,error}=await state.supabase.from('territories').upsert(row,{onConflict:'name'}).select('*').single();if(error){alert(error.message);return}const idx=state.territories.findIndex(t=>t.name===city);if(idx>=0)state.territories[idx]=data;else state.territories.push(data)}else{const idx=state.territories.findIndex(t=>t.name===city);if(idx>=0)state.territories[idx]=row;else state.territories.push(row);localStorage.setItem('tnrc2:territories',JSON.stringify(state.territories))}
  renderAll();
}

async function importLeadsToCloud(){
  if(state.mode!=='cloud'){alert('Configure Supabase and sign in as an admin/manager first.');return}
  if(!['admin','manager'].includes(state.currentRep.role)){alert('Admin/manager role required.');return}
  const local=await fetchJSON('/data/leads.json');const total=local.length;let done=0;
  setAdminProgress(0,`Importing ${fmt(total)} source leads…`);
  for(let i=0;i<total;i+=400){const batch=local.slice(i,i+400).map(l=>({id:l.id,source:l.source,name:l.name,address:l.address,secondary_address:l.secondaryAddress||'',city:l.city,state:l.state,zip:l.zip,full_address:l.fullAddress,record_id:l.recordId||null,record_type:l.recordType||null,year_built:l.yearBuilt??null,priority:l.priority||null,owner_occupied:l.ownerOccupied||null,pdf_page:l.pdfPage??null,lat:l.lat??null,lng:l.lng??null,geocode_match:l.geocodeMatch??null}));const {error}=await state.supabase.from('leads').upsert(batch,{onConflict:'id',ignoreDuplicates:true});if(error){alert(`Import stopped: ${error.message}`);return}done+=batch.length;setAdminProgress(Math.round(done/total*100),`Imported ${fmt(done)} / ${fmt(total)}`)}
  await loadCloudData();renderAll();$('adminLeadCount').textContent=fmt(state.leads.length);$('adminMappedCount').textContent=fmt(state.leads.filter(isCoords).length);
  alert(`Cloud dataset initialized with ${fmt(state.leads.length)} leads.`);
}
async function syncTerritories(){
  if(state.mode!=='cloud'){alert('Cloud mode required.');return}
  const cities=[...new Set(state.leads.map(l=>l.city).filter(Boolean))];const rows=cities.map(city=>{const c=state.centers?.[city];return{name:city,city,center_lat:c?.[0]??null,center_lng:c?.[1]??null}});const {error}=await state.supabase.from('territories').upsert(rows,{onConflict:'name',ignoreDuplicates:true});if(error){alert(error.message);return}await loadCloudData();renderAll();openAdmin();
}
function setAdminProgress(p,msg){$('adminProgress').style.width=`${p}%`;$('adminProgressLabel').textContent=msg}

async function geocodeAll(){
  if(state.mode!=='cloud'){alert('Cloud mode required. Seed the shared database first.');return}
  const missing=state.leads.filter(l=>!isCoords(l)); if(!missing.length){alert('All current leads already have coordinates.');return}
  const batchSize=500;let done=0,matched=0;
  setAdminProgress(0,`Geocoding ${fmt(missing.length)} addresses…`);
  for(let i=0;i<missing.length;i+=batchSize){
    const batch=missing.slice(i,i+batchSize);
    const r=await fetch('/api/geocode',{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${state.session.access_token}`},body:JSON.stringify({addresses:batch.map(l=>({id:l.id,address:l.address,city:l.city,state:l.state,zip:(l.zip||'').split('-')[0]}))})});
    const payload=await r.json();if(!r.ok)throw new Error(payload.error||`Geocode HTTP ${r.status}`);
    const updates=payload.results.filter(x=>Number.isFinite(Number(x.lat))&&Number.isFinite(Number(x.lng))).map(x=>({id:x.id,lat:Number(x.lat),lng:Number(x.lng),geocode_match:x.matchType||x.status||null}));
    matched+=updates.length;done+=batch.length;
    if(updates.length){const {error}=await state.supabase.from('leads').upsert(updates,{onConflict:'id'});if(error)throw error;const by=new Map(updates.map(x=>[x.id,x]));state.leads.forEach(l=>{const u=by.get(l.id);if(u){l.lat=u.lat;l.lng=u.lng;l.geocode_match=u.geocode_match}})}
    setAdminProgress(Math.round(done/missing.length*100),`Geocoded ${fmt(done)} / ${fmt(missing.length)} · matched ${fmt(matched)}`);
  }
  renderAll();$('adminMappedCount').textContent=fmt(state.leads.filter(isCoords).length);alert(`Geocoding complete: ${fmt(matched)} matched, ${fmt(missing.length-matched)} unmatched.`);
}

function emptyStormPack(){return {radar:[],warnings:[],reports:[]}}
async function ensureStormMaps(force=false){
  if(state.stormPack&&!force)return state.stormPack;
  if(state.stormBusy&&!force)return state.stormPack;
  state.stormBusy=true;
  const mine=++state.stormToken;
  try{
    if(!force){
      const cached=readStormCache(sessionStorage);
      if(cached){
        state.stormPack=cached;
        if(mine===state.stormToken)syncStormOverlays();
        return cached;
      }
    }
    const response=await fetch('/api/storm-maps');
    if(!response.ok)throw new Error('storm maps unavailable');
    const data=await response.json();
    if(mine!==state.stormToken)return state.stormPack;
    const pack={
      radar:Array.isArray(data.radar)?data.radar:[],
      warnings:Array.isArray(data.warnings)?data.warnings:[],
      reports:Array.isArray(data.reports)?data.reports:[]
    };
    state.stormPack=pack;
    writeStormCache(sessionStorage, pack);
    syncStormOverlays();
  }catch(error){
    console.warn(error);
    if(mine===state.stormToken&&!state.stormPack)state.stormPack=emptyStormPack();
    if(mine===state.stormToken)syncStormOverlays();
  }finally{
    if(mine===state.stormToken)state.stormBusy=false;
  }
  return state.stormPack||emptyStormPack();
}
function syncStormOverlays(){
  if(!state.map)return;
  if(!state.stormPack){
    if(state.layerFlags.radar||state.layerFlags.warnings||state.layerFlags.reports) ensureStormMaps();
    return;
  }
  syncRadar(state.layerFlags.radar?state.stormPack.radar:[]);
  syncWarnings(state.layerFlags.warnings?state.stormPack.warnings:[]);
  syncReports(state.layerFlags.reports?state.stormPack.reports:[]);
}
function stopRadar(){
  clearInterval(state.radarTimer);state.radarTimer=null;
  (state.radarLayers||[]).forEach(layer=>layer.remove());
  state.radarLayers=[];state.radarSignature='';
}
function syncRadar(frames){
  const list=Array.isArray(frames)?frames.filter(frame=>frame?.url):[];
  const sig=list.map(frame=>`${frame.time}|${frame.url}`).join(',');
  if(!list.length){stopRadar();return;}
  if(sig===state.radarSignature&&state.radarLayers.length)return;
  stopRadar();
  state.radarSignature=sig;
  state.radarLayers=list.map((frame,index)=>L.tileLayer(frame.url,{
    pane:'radarPane',opacity:index===list.length-1?0.45:0,zIndex:index+1,maxZoom:20,updateWhenIdle:true,keepBuffer:2
  }).addTo(state.map));
  if(list.length<2)return;
  let cursor=list.length-1;
  state.radarTimer=setInterval(()=>{
    cursor=(cursor+1)%state.radarLayers.length;
    state.radarLayers.forEach((layer,index)=>layer.setOpacity(index===cursor?0.45:0));
  },700);
}
function warningPopup(warning){
  const lines=[`<b>${esc(warning.event||'Warning')}</b>`];
  if(warning.headline)lines.push(esc(warning.headline));
  if(warning.hail)lines.push(`Hail ${esc(warning.hail)}`);
  if(warning.wind)lines.push(`Wind ${esc(warning.wind)}`);
  if(warning.expiresLabel)lines.push(`Until ${esc(warning.expiresLabel)}`);
  return `<div class="stormPopup">${lines.join('<br>')}</div>`;
}
function syncWarnings(warnings){
  const list=Array.isArray(warnings)?warnings:[];
  const sig=list.map(warning=>warning.id).join('|');
  if(sig===state.warningSignature&&(list.length?state.warningLayer:!state.warningLayer))return;
  if(state.warningLayer){state.map.removeLayer(state.warningLayer);state.warningLayer=null;}
  state.warningSignature=sig;
  if(!list.length)return;
  state.warningLayer=L.geoJSON({type:'FeatureCollection',features:list.map(warning=>({type:'Feature',properties:warning,geometry:warning.geometry}))},{
    style:feature=>{
      const color=WARNING_COLORS[feature.properties?.kind]||WARNING_COLORS.thunderstorm;
      return {color,weight:2,fillColor:color,fillOpacity:.28};
    },
    onEachFeature:(feature,layer)=>layer.bindPopup(warningPopup(feature.properties))
  }).addTo(state.map);
}
function reportRadius(report){
  const size=Number(report.measure);
  if(report.kind==='hail')return Math.max(7,Math.min(16, (Number.isFinite(size)?size:1)*6));
  if(report.kind==='wind')return Math.max(7,Math.min(16, (Number.isFinite(size)?size:40)/8));
  return 11;
}
function syncReports(reports){
  const list=Array.isArray(reports)?reports:[];
  const sig=list.map(report=>`${report.kind}:${report.lat}:${report.lng}:${report.time}`).join('|');
  if(sig===state.reportSignature&&(list.length?state.reportLayer:!state.reportLayer))return;
  if(state.reportLayer){state.map.removeLayer(state.reportLayer);state.reportLayer=null;}
  state.reportSignature=sig;
  if(!list.length)return;
  const group=L.layerGroup();
  list.forEach(report=>{
    if(!Number.isFinite(Number(report.lat))||!Number.isFinite(Number(report.lng)))return;
    const color=report.kind==='torn'?WARNING_COLORS.tornado:report.kind==='wind'?WARNING_COLORS.wind:WARNING_COLORS.hail;
    const marker=L.circleMarker([Number(report.lat),Number(report.lng)],{radius:reportRadius(report),color:'#fff',weight:2,fillColor:color,fillOpacity:.95});
    const place=[report.location,report.county,report.state].filter(Boolean).join(', ');
    marker.bindPopup(`<div class="stormPopup"><b>${esc(reportMarkerText(report))}</b>${place?`<br>${esc(place)}`:''}</div>`);
    group.addLayer(marker);
  });
  state.reportLayer=group.addTo(state.map);
}
async function loadStorms(){
  const box=document.querySelector('[data-layer="warnings"]');
  if(box)box.checked=true;
  state.layerFlags.warnings=true;
  await ensureStormMaps(true);
  const count=state.stormPack?.warnings?.length||0;
  toast(count?`Showing ${fmt(count)} warning areas.`:'No active warning areas right now.');
}
async function housesInStormArea(){
  const pack=await ensureStormMaps();
  const hits=housesInStorm(state.leads, pack?.warnings||[], pack?.reports||[]);
  if(!hits.length){toast(`No houses are inside a warning or within ${HAIL_MILES} miles of a hail report.`);return;}
  state.stormHouseIds=new Set(hits.map(lead=>lead.id));
  const ranked=hits.slice().sort((a,b)=>scoreLead(b)-scoreLead(a));
  state.selected.clear();
  const {chosen,leftOut}=pickRouteStops(ranked.map(lead=>lead.id), state.selected, ROUTE_STOP_LIMIT);
  chosen.forEach(id=>state.selected.add(id));
  const note=leftOut?`${fmt(hits.length)} houses in the storm area. ${fmt(chosen.length)} queued for the route.`:`${fmt(chosen.length)} storm-area houses queued for the route.`;
  $('routeTrayNote').textContent=note;
  $('routeWarning').textContent=leftOut?note:'';
  toast(note);
  renderAll();
  fitMapToScope(true);
  openRoutePanel();
}

function locate(){
  if(document.visibilityState==='hidden')return;
  if(!navigator.geolocation){alert('Browser location is unavailable.');return}
  const token=++locate._seq;
  navigator.geolocation.getCurrentPosition(pos=>{
    if(document.visibilityState==='hidden'||token!==locate._seq||!state.map)return;
    state.currentLocation={lat:pos.coords.latitude,lng:pos.coords.longitude};
    weatherApi().then(mod=>mod.setWeatherLocation(state.currentLocation)).catch(()=>{});
    if(state.userMarker)state.userMarker.remove();
    state.userMarker=L.marker([pos.coords.latitude,pos.coords.longitude]).addTo(state.map).bindPopup('You are here').openPopup();
    state.map.setView([pos.coords.latitude,pos.coords.longitude],16);
    renderWorkList();
  },()=>alert('Location permission was not granted.'),{enableHighAccuracy:true,maximumAge:0,timeout:10000});
}
locate._seq=0;

function updateSelectedBadge(){
  const prev=state.routeCountSeen;
  const n=state.selected.size;
  state.routeCountSeen=n;
  $('selectedCount').textContent=n;$('selectedCountRoute').textContent=n;$('routeTrayCount').textContent=n;$('mobileRouteCount').textContent=n;
  updateRouteTraySummary();
  if(shouldExpandRouteTray(prev,n))setRouteTrayCollapsed(false);
}
function readRouteTrayCollapsed(){
  let saved=null;
  try{saved=localStorage.getItem(ROUTE_TRAY_KEY);}catch{}
  return routeTrayCollapsedByDefault({saved,phone:window.matchMedia('(max-width: 960px)').matches,houseCount:state.selected.size});
}
function updateRouteTraySummary(){
  const summary=routeTraySummary(state.selected.size,state.routeMode);
  const label=$('routeTrayCompact'); if(label)label.textContent=summary;
  const btn=$('routeTrayToggle'); if(!btn)return;
  const collapsed=$('routeTray')?.classList.contains('isCollapsed');
  btn.setAttribute('aria-label', collapsed?`${summary}. Show route tools`:`${summary}. Hide route tools`);
}
function setRouteTrayCollapsed(collapsed,{persist=true}={}){
  const tray=$('routeTray'); if(!tray)return;
  const on=!!collapsed;
  tray.classList.toggle('isCollapsed',on);
  document.documentElement.classList.remove('routeTrayStartCollapsed');
  const btn=$('routeTrayToggle');
  if(btn)btn.setAttribute('aria-expanded',on?'false':'true');
  if(persist){try{localStorage.setItem(ROUTE_TRAY_KEY,on?'1':'0');}catch{}}
  updateRouteTraySummary();
}
function openRouteFromChrome(){
  setRouteTrayCollapsed(false);
  openRoutePanel();
}
function toggleSelected(id){
  if(state.selected.has(id))state.selected.delete(id);else state.selected.add(id);
  document.querySelectorAll(`.rowCheck[data-id="${CSS.escape(id)}"]`).forEach(box=>{box.checked=state.selected.has(id)});
  updateSelectedBadge();refreshSelectedMarkers();syncRouteButtons(id);
}
function syncRouteButtons(id){
  const label=routeToggleLabel(state.selected.has(id));
  document.querySelectorAll(`[data-popup-route="${CSS.escape(id)}"]`).forEach(btn=>{btn.textContent=label});
  if(state.doorLeadId===id&&$('doorSheetRoute'))$('doorSheetRoute').textContent=label;
}
function refreshSelectedMarkers(){
  state.pinShown.forEach(id=>{
    const lead=state.leadsById.get(id);
    const marker=state.pinMarkers.get(id);
    if(lead&&marker) stylePin(marker, lead);
  });
}
function selectVisibleForRoute(){
  const mapped=state.filtered.filter(isCoords);
  let inView=[];
  if(state.map){const bounds=state.map.getBounds();inView=mapped.filter(lead=>bounds.contains([Number(lead.lat),Number(lead.lng)]));}
  const pool=visibleRoutePool(inView,mapped).slice().sort((a,b)=>scoreLead(b)-scoreLead(a));
  const {chosen,leftOut}=pickRouteStops(pool.map(lead=>lead.id),state.selected,ROUTE_STOP_LIMIT);
  chosen.forEach(id=>state.selected.add(id));
  const note=leftOut?`Route stop limit is ${ROUTE_STOP_LIMIT}. Added ${fmt(chosen.length)} mapped houses; ${fmt(leftOut)} more stayed off this route.`:(chosen.length?`Added ${fmt(chosen.length)} mapped houses from the map.`:'No mapped houses in this view.');
  $('routeTrayNote').textContent=note;
  $('routeWarning').textContent=leftOut?note:'';
  toast(note);
  updateSelectedBadge();refreshSelectedMarkers();renderWorkList();
}
function clearRoute(){
  endNavigation('');
  state.selected.clear();state.stormHouseIds=null;state.routeStops=[];state.routeGeometry=null;
  $('routeWarning').textContent='';$('routeDistance').textContent='';$('routeTrayStats').textContent='';
  $('routeStops').innerHTML='<div class="empty">No route yet.</div>';
  $('routeTrayNote').textContent='Select homes, then build an optimized route.';
  renderAll();
}
function setRouteMode(mode){
  const next=mode==='walking'?'walking':'driving';
  const changed=state.routeMode!==next;
  state.routeMode=next;
  if($('routeMode')&&$('routeMode').value!==next)$('routeMode').value=next;
  $('trayDrive').classList.toggle('isOn', next==='driving');
  $('trayDrive').setAttribute('aria-pressed', next==='driving'?'true':'false');
  $('trayWalk').classList.toggle('isOn', next==='walking');
  $('trayWalk').setAttribute('aria-pressed', next==='walking'?'true':'false');
  updateRouteTraySummary();
  if(changed&&state.routeStops?.length)optimizeAndDrawRoute();
}
function syncNavChoiceButton(){
  const saved=readNavChoice(localStorage.getItem(NAV_CHOICE_KEY));
  const btn=$('navChoiceBtn'); if(!btn)return;
  const labels={app:'In-app nav', google:'Google Maps', apple:'Apple Maps'};
  btn.classList.toggle('hidden', !saved);
  btn.textContent=saved?`Nav: ${labels[saved]}`:'Change nav app';
}
function openNavChoice(launch){
  state.navLaunch=launch;
  const apple=isAppleDevice(navigator.userAgent, navigator.maxTouchPoints);
  $('navApple').classList.toggle('hidden', !apple);
  $('navChoiceMode').textContent=state.routeMode==='walking'?'Walking. Google Maps and Apple Maps use Walk.':'Driving. Google Maps and Apple Maps use Drive.';
  $('navRemember').checked=Boolean(readNavChoice(localStorage.getItem(NAV_CHOICE_KEY)));
  $('navChoice').classList.remove('hidden');
}
function closeNavChoice(){$('navChoice').classList.add('hidden')}
function confirmNavChoice(choice){
  if($('navRemember').checked)localStorage.setItem(NAV_CHOICE_KEY, choice);
  else localStorage.removeItem(NAV_CHOICE_KEY);
  const launch=state.navLaunch;
  closeNavChoice();
  syncNavChoiceButton();
  if(launch)runNavChoice(choice);
  else toast($('navRemember').checked?`Saved. Next routes use ${choice==='app'?'in-app navigation':choice==='apple'?'Apple Maps':'Google Maps'}.`:'Next routes will ask again.');
}
async function startRoute(){
  if(!state.routeStops?.length){await optimizeAndDrawRoute();if(!state.routeStops?.length)return}
  const saved=readNavChoice(localStorage.getItem(NAV_CHOICE_KEY));
  if(saved){runNavChoice(saved);return}
  openNavChoice(true);
}
function runNavChoice(choice){
  if(choice==='google'){openGoogleRouteBlocks();return}
  if(choice==='apple'){openAppleRoute();return}
  beginInAppNav();
}
function beginInAppNav(){
  if(!state.routeStops?.length){toast('Build a route first.');return}
  if(!navigator.geolocation){$('routeTrayNote').textContent='This browser cannot share location. Use Google Maps for turn-by-turn.';toast('Location is unavailable. Open Google Maps instead.');return}
  if(state.navWatch!=null)navigator.geolocation.clearWatch(state.navWatch);
  state.navigating=true;state.navIndex=0;state.navFollow=true;state.navPrompted='';state.navLegStop='';state.navLegFrom=null;state.navLegGeometry=null;
  if(state.userMarker){state.userMarker.remove();state.userMarker=null}
  $('navBar').classList.remove('hidden');
  $('routeTray').classList.add('isNavHidden');
  $('navAppleLeg').classList.toggle('hidden', !isAppleDevice(navigator.userAgent, navigator.maxTouchPoints));
  syncRecenterButton();
  $('navTitle').textContent='Next stop';
  $('navMeta').textContent='Waiting for location…';
  state.navWatch=navigator.geolocation.watchPosition(onNavPosition, onNavError, {enableHighAccuracy:true, maximumAge:2000, timeout:15000});
}
function endNavigation(message){
  if(state.navWatch!=null&&navigator.geolocation)navigator.geolocation.clearWatch(state.navWatch);
  state.navWatch=null;state.navigating=false;state.navLegGeometry=null;
  clearNavLayers();
  $('navBar')?.classList.add('hidden');
  $('routeTray')?.classList.remove('isNavHidden');
  if(message)toast(message);
}
function onNavError(err){
  const denied=err&&err.code===1;
  const message=denied?'Location is blocked. Allow it in the browser, or use Google Maps.':'Location is unavailable right now. You can still open Google Maps.';
  if($('navMeta'))$('navMeta').textContent=message;
  if($('routeTrayNote'))$('routeTrayNote').textContent=message;
  toast(message);
}
function onNavPosition(pos){
  if(!state.navigating||!state.map)return;
  const here={lat:pos.coords.latitude,lng:pos.coords.longitude,accuracy:pos.coords.accuracy,heading:pos.coords.heading};
  state.currentLocation=here;
  const stop=state.routeStops[state.navIndex];
  if(!stop){endNavigation('Route complete.');return}
  const meters=metersBetween(here, stop);
  drawNavOverlay();
  if(state.navLegStop!==stop.id||!state.navLegFrom||metersBetween(here, state.navLegFrom)>30){
    state.navLegStop=stop.id;state.navLegFrom={lat:here.lat,lng:here.lng};loadNavLeg(here, stop);
  }else updateNavReadout(stop, state.navLegMeters, state.navLegSeconds, !state.navLegGeometry);
  if(arrivedAtStop(here, stop)&&state.navPrompted!==stop.id){
    state.navPrompted=stop.id;openDoorSheet(stop.id);
    toast(`You're within ${ARRIVAL_METERS} m. Mark this door, and the route moves to the next stop.`);
  }else if(state.navPrompted===stop.id&&meters>ARRIVAL_METERS+25)state.navPrompted='';
  if(state.navFollow)state.map.panTo([here.lat, here.lng],{animate:true});
}
let navLegToken=0;
async function loadNavLeg(here, stop){
  const token=++navLegToken;
  const meters=metersBetween(here, stop);
  state.navLegMeters=meters;state.navLegSeconds=etaSeconds(meters, state.routeMode);state.navLegGeometry=null;
  updateNavReadout(stop, meters, state.navLegSeconds, true);
  try{
    const r=await fetch('/api/route',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({profile:osrmProfile(state.routeMode),service:'route',coordinates:[{lat:here.lat,lng:here.lng},{lat:Number(stop.lat),lng:Number(stop.lng)}]})});
    const data=await r.json();
    if(!r.ok||token!==navLegToken||!state.navigating)throw new Error(data.error||'Route leg failed');
    state.navLegGeometry=data.geometry||null;
    state.navLegMeters=Number(data.distance)||meters;
    state.navLegSeconds=Number(data.duration)||state.navLegSeconds;
    updateNavReadout(stop, state.navLegMeters, state.navLegSeconds, false);
    drawNavOverlay();
  }catch{if(token===navLegToken)drawNavOverlay()}
}
function updateNavReadout(stop, meters, seconds, estimate){
  $('navTitle').textContent=`Next · ${stop.address||'Stop'} · ${state.navIndex+1} of ${state.routeStops.length}`;
  const mode=state.routeMode==='walking'?'walk':'drive';
  $('navMeta').textContent=`${fmtDistance((Number(meters)||0)/1609.344)} · ${fmtDuration(seconds)} ${mode}${estimate?' · estimate':''}`;
}
function clearNavLayers(){(state.navLayers||[]).forEach(layer=>{try{layer.remove()}catch{}});state.navLayers=[]}
function drawNavOverlay(){
  if(!state.map||!state.navigating)return;
  clearNavLayers();
  const here=state.currentLocation;
  const stop=state.routeStops[state.navIndex];
  if(here&&Number.isFinite(Number(here.lat))&&Number.isFinite(Number(here.lng))){
    const radius=Math.max(8, Math.min(250, Number(here.accuracy)||30));
    const circle=L.circle([here.lat, here.lng],{radius, color:'#1e6bff', weight:1, fillColor:'#1e6bff', fillOpacity:.18}).addTo(state.map);
    const dot=L.circleMarker([here.lat, here.lng],{radius:8, color:'#fff', weight:3, fillColor:'#1e6bff', fillOpacity:1}).addTo(state.map);
    state.navLayers.push(circle, dot);
    if(Number.isFinite(Number(here.heading))){
      const rad=Number(here.heading)*Math.PI/180; const reach=28;
      const dLat=(reach*Math.cos(rad))/111320;
      const dLng=(reach*Math.sin(rad))/(111320*Math.cos(Number(here.lat)*Math.PI/180));
      state.navLayers.push(L.polyline([[here.lat, here.lng],[here.lat+dLat, here.lng+dLng]],{color:'#1e6bff', weight:5, opacity:.95}).addTo(state.map));
    }
  }
  if(stop&&isCoords(stop)){
    state.navLayers.push(L.circleMarker([Number(stop.lat), Number(stop.lng)],{radius:16, color:'#1e6bff', weight:3, fillColor:'#1e6bff', fillOpacity:.15}).addTo(state.map));
    if(here){
      if(state.navLegGeometry)state.navLayers.push(L.geoJSON(state.navLegGeometry,{style:{color:'#1e6bff', weight:6, opacity:.92}}).addTo(state.map));
      else state.navLayers.push(L.polyline([[here.lat, here.lng],[Number(stop.lat), Number(stop.lng)]],{color:'#1e6bff', weight:5, opacity:.9}).addTo(state.map));
    }
  }
}
function syncRecenterButton(){const btn=$('navRecenter');if(!btn)return;btn.textContent=state.navFollow?'Following':'Recenter';btn.classList.toggle('isOn', state.navFollow)}
function recenterNav(){state.navFollow=true;syncRecenterButton();if(state.currentLocation&&state.map)state.map.setView([state.currentLocation.lat, state.currentLocation.lng], Math.max(state.map.getZoom(),17))}
function openExternalLeg(kind){
  const stop=state.routeStops[state.navIndex];
  if(!stop){toast('No stop left on this route.');return}
  if(kind==='apple'){openAppleRoute([stop]);return}
  window.open(googleDirectionsUrl(state.currentLocation, stop, state.routeMode),'_blank','noopener');
}
function advanceNavStop(){
  if(!state.navigating)return;
  state.navIndex+=1;state.navPrompted='';state.navLegStop='';state.navLegGeometry=null;
  const stop=state.routeStops[state.navIndex];
  if(!stop){endNavigation('Route complete.');return}
  closeDoorSheet();
  toast(`Next stop · ${stop.address}`);
  if(state.currentLocation)onNavPosition({coords:{latitude:state.currentLocation.lat,longitude:state.currentLocation.lng,accuracy:state.currentLocation.accuracy,heading:state.currentLocation.heading}});
}
function maybeAdvanceNav(id){
  if(!state.navigating)return;
  const stop=state.routeStops[state.navIndex];
  if(stop&&stop.id===id)advanceNavStop();
}

function haversine(lat1,lon1,lat2,lon2){const R=3958.7613,rad=Math.PI/180;const dLat=(lat2-lat1)*rad,dLon=(lon2-lon1)*rad;const a=Math.sin(dLat/2)**2+Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(a))}

function exportLeads(){
  const rows=state.leads.map(l=>({id:l.id,name:l.name,address:l.address,city:l.city,state:l.state,zip:l.zip,status:leadStatus(l),assigned_rep:leadOwnerName(l),lat:l.lat??'',lng:l.lng??'',year_built:l.year_built??l.yearBuilt??'',roof_age_years:l.roof_age_years??'',roof_age_verified:l.roof_age_verified??'',notes:l.notes||''}));
  const head=Object.keys(rows[0]||{});const csv=[head.join(','),...rows.map(r=>head.map(k=>`"${String(r[k]??'').replaceAll('"','""')}"`).join(','))].join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='true-north-sales-map-export.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

function toast(message, ms=2600){
  const el=$('toast'); if(!el)return;
  $('toastText').textContent=message;
  $('toastActions').classList.add('hidden');
  state.doorUndo=null;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t=setTimeout(()=>{el.classList.remove('show'); syncListOverlay();}, ms);
  syncListOverlay();
}

function startRealtime(){
  if(state.mode!=='cloud'||!state.supabase||state.realtimeChannel)return;
  state.realtimeChannel=state.supabase.channel('tnrc-field-live')
    .on('postgres_changes',{event:'*',schema:'public',table:'leads'},payload=>{
      const idx=state.leads.findIndex(l=>l.id===payload.old?.id||l.id===payload.new?.id);
      if(payload.eventType==='DELETE'){if(idx>=0)state.leads.splice(idx,1);}
      else {const incoming=normalizeLead(payload.new);if(idx>=0)state.leads[idx]={...state.leads[idx],...incoming};else state.leads.push(incoming);}
      renderAll(); toast('Live lead update received');
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'appointments'},payload=>{
      const idx=state.appointments.findIndex(a=>a.id===payload.old?.id||a.id===payload.new?.id);
      if(payload.eventType==='DELETE'){if(idx>=0)state.appointments.splice(idx,1);}
      else if(idx>=0)state.appointments[idx]={...state.appointments[idx],...payload.new}; else state.appointments.push(payload.new);
      renderAll(); toast('Appointment board updated');
    })
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'lead_activity'},payload=>{state.activities.unshift(payload.new);state.activities=state.activities.slice(0,3000);renderStats();renderTeam();})
    .subscribe();
}

function closeModal(){document.querySelectorAll('.modalOverlay').forEach(x=>x.classList.add('hidden'))}

document.addEventListener('keydown',e=>{
  if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) return;
  if(e.key==='/'){e.preventDefault();$('search').focus();}
  else if(e.key.toLowerCase()==='n') nextBest();
  else if(e.key.toLowerCase()==='r') openRoutePanel();
  else if(e.key.toLowerCase()==='l') locate();
  else if(e.key==='Escape'){closeDoorSheet();closeDrawer();closeRoutePanel();$('adminModal').classList.add('hidden');$('appointmentModal').classList.add('hidden');}
});

boot();

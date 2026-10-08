import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const STATUS_OPTIONS=['New','Knocked','No Answer','Interested','Appointment','Not Interested','Do Not Knock'];
const DOOR_STATUSES=['Knocked','No Answer','Interested','Not Interested','Do Not Knock'].filter(s=>STATUS_OPTIONS.includes(s));
const doorSheetMedia=window.matchMedia('(max-width: 960px)');
const HOME_BASE={lat:40.3931,lng:-82.4857};
const HOME_MILES=35;
const LIST_SNAPS=['sheet-collapsed','sheet-half','sheet-full'];
const APPOINTMENT_STAGES=['Scheduled','Confirmed','Completed','No-show','Cancelled'];
const ROLE_OPTIONS=['admin','manager','canvasser','salesperson'];
const LOCAL_KEY='tnrc2:local';

const state={
  mode:'local', supabase:null, session:null, user:null, currentRep:null,
  leads:[], filtered:[], reps:[], territories:[], appointments:[], activities:[], centers:{},
  selected:new Set(), active:null, map:null, markerLayer:null, heatLayers:[], stormLayer:null,
  routeLine:null, userMarker:null, routeStops:[], currentLocation:null,
  filters:{q:'',status:'',rep:'',territory:'',source:'',mine:false},
  layerFlags:{pins:true,density:false,opportunity:true,roofAge:false,storms:false,territories:true},
  routeMode:'driving', busy:false, config:null, realtimeChannel:null, refreshTimer:null,
  doorLeadId:null, doorSaving:false, doorUndo:null,
  homeArea:true, didFit:false, listSnap:'sheet-collapsed', pinBannerDismissed:false
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

async function boot(){
  bindStaticEvents();
  state.centers=await fetchJSON('/data/city-centers.json').catch(()=>({}));
  const cfg=await fetchJSON('/api/config').catch(()=>null);
  if(cfg?.configured){
    state.config=cfg;
    try{
      state.supabase=createClient(cfg.url,cfg.publishableKey);
      const {data}=await state.supabase.auth.getSession();
      if(data.session) await enterCloud(data.session);
      else showLogin();
      state.supabase.auth.onAuthStateChange(async(_event,session)=>{
        if(session) await enterCloud(session); else showLogin();
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
  $('mobileNext').onclick=nextBest; $('mobileRoute').onclick=openRoutePanel; $('mobileLocate').onclick=locate;
  $('routeBtn').onclick=openRoutePanel; $('routeTrayBtn').onclick=openRoutePanel;
  $('focusBtn').onclick=toggleMapFocus; $('fitBtn').onclick=fitFilteredLeads;
  $('closeDrawer').onclick=closeDrawer;
  $('closeAdmin').onclick=()=>$('adminModal').classList.add('hidden');
  $('tabWork').onclick=()=>switchTab('work');
  $('tabHandoffs').onclick=()=>switchTab('handoffs');
  $('tabTeam').onclick=()=>switchTab('team');
  $('adminBtn').onclick=(e)=>{ if(state.currentRep?.role==='admin'||state.currentRep?.role==='manager') return; e.preventDefault(); };
  $('locateBtn').onclick=locate;
  $('clearBtn').onclick=()=>{['search','statusFilter','repFilter','territoryFilter','sourceFilter'].forEach(id=>$(id).value='');$('mineToggle').checked=false;syncFilters();renderAll()};
  $('search').addEventListener('input',debounce(()=>{syncFilters();renderAll()},120));
  ['statusFilter','repFilter','territoryFilter','sourceFilter'].forEach(id=>$(id).addEventListener('change',()=>{syncFilters();renderAll()}));
  $('mineToggle').addEventListener('change',()=>{syncFilters();renderAll()});
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
  document.querySelectorAll('[data-layer]').forEach(el=>el.addEventListener('change',()=>{state.layerFlags[el.dataset.layer]=el.checked;refreshMapLayers()}));
  $('routeMode').addEventListener('change',e=>state.routeMode=e.target.value);
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
  const onDoorMedia=()=>{if(state.map){closeDoorSheet();refreshMapLayers();}syncListMode();};
  if(doorSheetMedia.addEventListener) doorSheetMedia.addEventListener('change',onDoorMedia);
  else doorSheetMedia.addListener(onDoorMedia);
}

function enterLocal(message){
  state.mode='local'; state.session=null; state.currentRep=null;
  hideLogin(); $('userMenu').classList.add('hidden'); $('adminBtn').classList.add('hidden');
  $('connection').textContent='LOCAL DEVICE'; $('connection').className='chip local';
  $('cloudNotice').textContent=message||'Local mode'; $('cloudNotice').classList.remove('hidden');
  Promise.all([fetchJSON('/data/leads.json'),fetchJSON('/data/manifest.json')]).then(([leads,manifest])=>{
    const meta=JSON.parse(localStorage.getItem('tnrc2:leadsMeta')||'{}');
    state.leads=leads.map(l=>normalizeLead({...l,...(meta[l.id]||{}),assignedRepName:meta[l.id]?.owner||''}));
    state.reps=JSON.parse(localStorage.getItem('tnrc2:reps')||'[]');
    state.territories=JSON.parse(localStorage.getItem('tnrc2:territories')||'[]');
    state.appointments=JSON.parse(localStorage.getItem('tnrc2:appointments')||'[]');
    state.activities=JSON.parse(localStorage.getItem('tnrc2:activities')||'[]');
    $('datasetCount').textContent=`${fmt(manifest?.totalRecords||leads.length)} source records`;
    initMapOnce(); buildFilters(); renderAll();
  }).catch(e=>showFatal(e));
}

async function enterCloud(session){
  state.mode='cloud'; state.session=session; state.user=session.user; hideLogin();
  $('connection').textContent='CLOUD SYNC'; $('connection').className='chip live';
  $('userMenu').classList.remove('hidden');
  $('userIdentity').textContent=session.user.email||session.user.id;
  $('cloudNotice').classList.add('hidden');
  try{
    await loadCloudData();
    const adminAllowed=!state.config?.adminEmails?.length || state.config.adminEmails.includes(String(session.user.email||'').toLowerCase()); $('adminBtn').classList.toggle('hidden',!(adminAllowed && (state.currentRep?.role==='admin'||state.currentRep?.role==='manager')));
    initMapOnce(); buildFilters(); renderAll(); startRealtime();
  }catch(e){console.error(e);enterLocal(`Cloud connection failed: ${e.message}`)}
}

async function loadCloudData(){
  const sb=state.supabase;
  state.reps=await fetchAll(()=>sb.from('reps').select('id,user_id,name,role,active').eq('active',true).order('name'));
  state.currentRep=state.reps.find(r=>r.user_id===state.user.id)||null;
  if(!state.currentRep) throw new Error('Your Supabase account is signed in, but no active rep profile exists yet. Add the user to public.reps.');
  state.territories=await fetchAll(()=>sb.from('territories').select('*').order('name'));
  state.leads=(await fetchAll(()=>sb.from('leads').select('*').order('city').order('address'))).map(normalizeLead);
  state.appointments=await fetchAll(()=>sb.from('appointments').select('*,canvasser:reps!appointments_canvasser_id_fkey(id,name),salesperson:reps!appointments_salesperson_id_fkey(id,name)').order('scheduled_at',{ascending:true}));
  state.activities=await fetchAll(()=>sb.from('lead_activity').select('id,lead_id,actor_id,action,metadata,created_at,actor:reps!lead_activity_actor_id_fkey(name)').order('created_at',{ascending:false}).limit(3000));
  $('datasetCount').textContent=`${fmt(state.leads.length)} live leads`;
}

async function fetchAll(makeBuilder){
  const out=[]; let from=0,step=1000;
  while(true){const {data,error}=await makeBuilder().range(from,from+step-1);if(error)throw error;if(!data?.length)break;out.push(...data);if(data.length<step)break;from+=step;}
  return out;
}

function normalizeLead(l){return {...l,status:l.status||'New',assignedRepId:l.assigned_rep_id||l.assignedRepId||null,roofAgeYears:l.roof_age_years??l.roofAgeYears??null,roofAgeVerified:l.roof_age_verified??l.roofAgeVerified??false,lat:l.lat??null,lng:l.lng??null};}

function showLogin(){
  $('loginModal').classList.remove('hidden'); $('appShell').classList.add('blurred');
  $('loginError').textContent='';
}
function hideLogin(){ $('loginModal').classList.add('hidden'); $('appShell').classList.remove('blurred'); }
async function login(e){e.preventDefault();if(!state.supabase){return}
  $('loginError').textContent='Signing in…';
  const {error}=await state.supabase.auth.signInWithPassword({email:$('loginEmail').value.trim(),password:$('loginPassword').value});
  if(error)$('loginError').textContent=error.message;
}
function showFatal(e){$('workList').innerHTML=`<div class="empty"><b>Could not load command center.</b><br>${esc(e.message)}</div>`}

function initMapOnce(){
  if(state.map)return;
  state.map=L.map('map',{zoomControl:true,preferCanvas:true}).setView([40.39,-82.49],11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:20,attribution:'© OpenStreetMap contributors'}).addTo(state.map);
  state.markerLayer=L.markerClusterGroup({chunkedLoading:true,maxClusterRadius:42,showCoverageOnHover:false,spiderfyOnMaxZoom:true}).addTo(state.map);
}

function syncFilters(){
  state.filters={q:$('search').value.trim().toLowerCase(),status:$('statusFilter').value,rep:$('repFilter').value,territory:$('territoryFilter').value,source:$('sourceFilter').value,mine:$('mineToggle').checked};
}
function buildFilters(){
  const cities=[...new Set(state.leads.map(l=>l.city).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const territories=cities.map(city=>({name:city,city}));
  const reps=state.reps.slice().sort((a,b)=>a.name.localeCompare(b.name));
  fillSelect('repFilter','All reps',reps.map(r=>({value:r.id,label:r.name})));
  fillSelect('territoryFilter','All territories',territories.map(t=>({value:t.city,label:t.city})));
  fillSelect('sourceFilter','All sources',[...new Set(state.leads.map(l=>l.source).filter(Boolean))].sort().map(x=>({value:x,label:x})));
}
function fillSelect(id,first,items){$(id).innerHTML=`<option value="">${esc(first)}</option>`+items.map(x=>`<option value="${esc(x.value)}">${esc(x.label)}</option>`).join('');}

function applyFilters(){
  const f=state.filters;
  state.filtered=state.leads.filter(l=>{
    const blob=[l.name,l.address,l.city,l.state,l.zip,l.record_id,l.recordId,l.id,l.full_address,l.fullAddress].join(' ').toLowerCase();
    return (!f.q||blob.includes(f.q)) && (!f.status||leadStatus(l)===f.status) && (!f.rep||l.assignedRepId===f.rep) && (!f.territory||l.city===f.territory) && (!f.source||l.source===f.source) && (!f.mine||!state.currentRep||l.assignedRepId===state.currentRep.id||(state.territories.find(t=>t.name===l.city)?.assigned_rep_id===state.currentRep.id));
  });
}

function renderAll(){
  if(!state.map)return;
  applyFilters(); renderStats(); renderWorkList(); renderHandoffs(); renderTeam(); renderSidebarCounts(); refreshMapLayers(); updateSelectedBadge(); updateListSummary(); updatePinBanner();
  if(!state.didFit){state.didFit=true;setTimeout(()=>{publishListPeek();fitMapToScope(false);},80);}
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

function renderWorkList(){
  const list=$('workList');
  const top=state.filtered.slice().sort((a,b)=>scoreLead(b)-scoreLead(a)).slice(0,180);
  if(!top.length){list.innerHTML='<div class="empty"><b>No houses match these filters.</b><br>Try Reset, change territory, or use the map search.</div>';return}
  list.innerHTML=top.map(l=>leadHTML(l)).join('');
  list.querySelectorAll('.leadRow').forEach(el=>el.onclick=e=>{if(e.target.closest('.rowCheck'))return;openLead(el.dataset.id)});
  list.querySelectorAll('.rowCheck').forEach(cb=>cb.onchange=()=>{cb.checked?state.selected.add(cb.dataset.id):state.selected.delete(cb.dataset.id);updateSelectedBadge()});
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
  list.innerHTML=rows.map((x,i)=>`<div class="teamRow"><div class="rank">${i+1}</div><div class="teamName"><strong>${esc(x.rep.name)}</strong><small>${esc(x.rep.role)}</small></div><div><b>${x.knocks}</b><small>worked</small></div><div><b>${x.appts}</b><small>appts</small></div></div>`).join('')||'<div class="empty">No team members configured.</div>';
}

function scoreLead(l){
  let score=0;
  const s=leadStatus(l);
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
  return Math.round(score);
}

function refreshMapLayers(){
  if(!state.map)return;
  state.markerLayer?.clearLayers();
  (state._territoryLayers||[]).forEach(x=>x.remove());
  state._territoryLayers=[];
  state.heatLayers.forEach(layer=>layer.remove()); state.heatLayers=[]
  if(state.stormLayer){state.map.removeLayer(state.stormLayer);state.stormLayer=null}
  if(state.routeLine){state.map.removeLayer(state.routeLine);state.routeLine=null}
  if(state.layerFlags.pins){drawLeadPins()}
  if(state.layerFlags.density)drawHeat('density');
  if(state.layerFlags.opportunity)drawHeat('opportunity');
  if(state.layerFlags.roofAge)drawHeat('roof');
  if(state.layerFlags.territories)drawTerritories();
  if(state.layerFlags.storms && !state.stormLayer)loadStorms(false);
  if(state.routeStops?.length)drawRoutePreview();
}
function useDoorSheet(){return doorSheetMedia.matches;}
function pinIconFor(l){
  const selected=state.selected.has(l.id), s=leadStatus(l);
  const phone=useDoorSheet();
  const size=phone?44:18;
  return L.divIcon({className:phone?'pinWrap pinHit':'pinWrap',html:`<span class="housePin${selected?' selectedPin':''} status-${statusClass(s)}">${selected?'◆':'●'}</span>`,iconSize:[size,size],iconAnchor:[size/2,size/2]});
}
function drawLeadPins(){
  const group=state.markerLayer;
  const candidates=state.filtered.filter(isCoords);
  const phone=useDoorSheet();
  candidates.forEach(l=>{
    const s=leadStatus(l);
    const m=L.marker([l.lat,l.lng],{icon:pinIconFor(l),title:l.address,keyboard:true});
    if(phone){
      m.on('click',e=>{L.DomEvent.stop(e);openDoorSheet(l.id);});
    }else{
      m.bindPopup(`<div class="pinPopup"><b>${esc(l.name||'Property lead')}</b><div>${esc(l.address)}, ${esc(l.city)}</div><div class="popupLine"><span class="miniBadge">${esc(s)}</span><b>${scoreLead(l)} pts</b></div><button data-popup-lead="${esc(l.id)}">Open lead</button></div>`);
      m.on('popupopen',()=>setTimeout(()=>document.querySelector(`[data-popup-lead="${CSS.escape(l.id)}"]`)?.addEventListener('click',()=>openLead(l.id)),0));
    }
    group.addLayer(m);
  });
}
function drawHeat(kind){
  const points=state.filtered.filter(isCoords).map(l=>{let intensity=.2;if(kind==='density')intensity=.35;else if(kind==='opportunity')intensity=Math.min(1,Math.max(.05,scoreLead(l)/140));else{const y=Number(l.year_built??l.yearBuilt), roof=Number(l.roof_age_years??l.roofAgeYears);const age=roof|| (y?2026-y:0);intensity=Math.min(1,Math.max(.08,age/45));}return [Number(l.lat),Number(l.lng),intensity]});
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
    const circle=L.circle(center,{radius:Math.max(400,Math.min(4200,Math.sqrt(leads.length)*95)),weight:1.5,fillOpacity:.06,color:t.color||'#132B3A'}).addTo(state.map);
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
  if(!use.length){state.map.setView([HOME_BASE.lat,HOME_BASE.lng],12,{animate});return;}
  const bounds=L.latLngBounds(use.map(l=>[Number(l.lat),Number(l.lng)]));
  const phone=useDoorSheet();
  state.map.fitBounds(bounds.pad(.12),{animate,maxZoom:16,paddingTopLeft:[16,phone?128:36],paddingBottomRight:[16,phone?150:28]});
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
  const ranked=state.filtered.filter(l=>scoreLead(l)>-100).sort((a,b)=>scoreLead(b)-scoreLead(a));
  const next=state.homeArea?(ranked.find(l=>isHomeLead(l))||ranked.find(l=>!isCoords(l))||ranked[0]):ranked[0];
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
  if(previous===status){renderAll();closeDoorSheet();toast(`Already ${status} · ${l.address}`);return;}
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
    if(normalized.status&&previous!==normalized.status)await logActivity(l.id,'status_changed',{from_status:previous,to_status:normalized.status});
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
  $('drawerContent').innerHTML=`<div class="drawerTop"><div><div class="eyebrow">FIELD RECORD</div><h2>${esc(l.name||'Property lead')}</h2><div class="drawerAddr">${esc(l.address)}<br>${esc(l.city)}, ${esc(l.state)} ${esc(l.zip)}</div></div><span class="bigScore">${scoreLead(l)}</span></div>
    <div class="detailGrid"><div><small>Source</small><b>${esc(l.source)}</b></div><div><small>Priority</small><b>${esc(l.priority||'Standard')}</b></div><div><small>Built</small><b>${esc(l.year_built??l.yearBuilt??'Unknown')}</b></div><div><small>Mapped</small><b>${isCoords(l)?'Exact geocode':'Needs geocode'}</b></div></div>
    <div class="drawerActions"><button id="drawerMaps" class="darkBtn">Open Google Maps</button><button id="drawerDir" class="outlineBtn">Directions</button></div>
    <div class="fieldActions"><button data-qstatus="Knocked">Knocked</button><button data-qstatus="No Answer">No answer</button><button data-qstatus="Interested">Interested</button><button data-qstatus="Not Interested">Not interested</button></div>
    <label>Sales status</label><select id="dStatus">${STATUS_OPTIONS.map(x=>`<option value="${esc(x)}" ${leadStatus(l)===x?'selected':''}>${esc(x)}</option>`).join('')}</select>
    <label>Assigned rep</label><select id="dOwner"><option value="">Unassigned</option>${reps.map(r=>`<option value="${esc(r.id)}" ${l.assignedRepId===r.id?'selected':''}>${esc(r.name)} · ${esc(r.role)}</option>`).join('')}</select>
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
  if(state.routeMode==='driving') await fetchRoadRoute(start,state.routeStops); else {drawRoutePreview();$('routeDistance').textContent=`≈ ${fmtDistance(routeHaversineDistance(start,state.routeStops))} straight-line estimate`;}
}
async function fetchRoadRoute(start,stops){
  try{const points=[start,...stops].map(p=>({lat:p.lat,lng:p.lng}));const r=await fetch('/api/route',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({profile:'driving',coordinates:points})});const data=await r.json();if(!r.ok)throw new Error(data.error||'Route service failed');
    if(Array.isArray(data.order)&&data.order.length===stops.length){const ordered=data.order.map(i=>stops[i-1]).filter(Boolean);if(ordered.length===stops.length){state.routeStops=ordered;renderRouteStops();}}
    if(state.routeLine){state.map.removeLayer(state.routeLine);state.routeLine=null}
    state.routeLine=L.geoJSON(data.geometry,{style:{color:'#203a29',weight:5,opacity:.78}}).addTo(state.map);
    if(data.geometry?.coordinates?.length)state.map.fitBounds(state.routeLine.getBounds().pad(.12));
    $('routeDistance').textContent=`${fmtDistance(data.distance/1609.344)} · ${fmtDuration(data.duration)} · road-network optimized`;
  }catch(e){drawRoutePreview();$('routeDistance').textContent=`Road router unavailable · ≈ ${fmtDistance(routeHaversineDistance(start,stops))}`;console.warn(e)}
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
function drawRoutePreview(){
  if(state.routeLine){state.map.removeLayer(state.routeLine);state.routeLine=null}
  if(!state.routeStops?.length)return;
  const coords=state.routeStops.map(l=>[Number(l.lat),Number(l.lng)]);
  state.routeLine=L.polyline(coords,{weight:5,opacity:.75,dashArray:'8 7'}).addTo(state.map);
  state.map.fitBounds(state.routeLine.getBounds().pad(.12));
}
function renderRouteStops(){
  $('routeStops').innerHTML=state.routeStops.map((l,i)=>`<div class="routeStop"><span>${i+1}</span><div><b>${esc(l.address)}</b><small>${esc(l.city)} · ${scoreLead(l)} pts</small></div><button data-route-lead="${esc(l.id)}">×</button></div>`).join('')||'<div class="empty">No route yet.</div>';
  $('routeStops').querySelectorAll('[data-route-lead]').forEach(btn=>btn.onclick=()=>{state.selected.delete(btn.dataset.routeLead);optimizeAndDrawRoute();updateSelectedBadge()});
}
function openGoogleRouteBlocks(){
  if(!state.routeStops.length){alert('Optimize a route first.');return}
  const chunks=[];for(let i=0;i<state.routeStops.length;i+=9)chunks.push(state.routeStops.slice(i,i+9));
  chunks.forEach((chunk,idx)=>{const origin=idx===0?(state.currentLocation?`${state.currentLocation.lat},${state.currentLocation.lng}`:addressOf(chunk[0])):addressOf(state.routeStops[idx*9-1]);const destination=addressOf(chunk.at(-1));const mids=chunk.slice(0,-1).map(addressOf);const u=`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}${mids.length?`&waypoints=${encodeURIComponent(mids.join('|'))}`:''}&travelmode=${encodeURIComponent(state.routeMode)}`;window.open(u,'_blank','noopener')});
}

function openAppointmentForm(l,appt=null){
  const appointment=appt||{lead_id:l.id,stage:'Scheduled',scheduled_at:'',salesperson_id:''};
  $('appointmentModal').classList.remove('hidden'); $('appointmentTitle').textContent=appt?'Edit handoff':'Book appointment';
  $('appLeadId').value=l.id; $('appScheduled').value=appointment.scheduled_at?new Date(appointment.scheduled_at).toISOString().slice(0,16):''; $('appStage').value=appointment.stage||'Scheduled';
  $('appSalesperson').innerHTML='<option value="">Unassigned</option>'+state.reps.filter(r=>['salesperson','manager','admin'].includes(r.role)).map(r=>`<option value="${esc(r.id)}" ${appointment.salesperson_id===r.id||appointment.salesperson?.id===r.id?'selected':''}>${esc(r.name)} · ${esc(r.role)}</option>`).join('');
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
  for(let i=0;i<total;i+=400){const batch=local.slice(i,i+400).map(l=>({id:l.id,source:l.source,name:l.name,address:l.address,secondary_address:l.secondaryAddress||'',city:l.city,state:l.state,zip:l.zip,full_address:l.fullAddress,record_id:l.recordId||null,record_type:l.recordType||null,year_built:l.yearBuilt??null,priority:l.priority||null,owner_occupied:l.ownerOccupied||null,pdf_page:l.pdfPage??null}));const {error}=await state.supabase.from('leads').upsert(batch,{onConflict:'id',ignoreDuplicates:true});if(error){alert(`Import stopped: ${error.message}`);return}done+=batch.length;setAdminProgress(Math.round(done/total*100),`Imported ${fmt(done)} / ${fmt(total)}`)}
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

async function loadStorms(showAlert=true){
  try{const r=await fetch('/api/storms?state=OH');const data=await r.json();if(!r.ok)throw new Error(data.error||'Storm feed failed');
    if(state.stormLayer){state.map.removeLayer(state.stormLayer)}
    state.stormLayer=L.geoJSON(data,{style:feature=>({color:'#9a3b20',weight:2,fillOpacity:.13}),pointToLayer:(_f,latlng)=>L.circleMarker(latlng,{radius:9,weight:2,color:'#9a3b20',fillOpacity:.2}),onEachFeature:(f,layer)=>layer.bindPopup(`<b>${esc(f.properties?.event||'NWS alert')}</b><br>${esc(f.properties?.headline||'')}<br><small>${esc(f.properties?.severity||'')}</small>`)}).addTo(state.map);
    if(showAlert)alert(`Loaded ${fmt(data.features?.length||0)} active NWS alerts.`);
  }catch(e){if(showAlert)alert(`Storm layer unavailable: ${e.message}`);else console.warn(e)}
}

function locate(){
  if(document.visibilityState==='hidden')return;
  if(!navigator.geolocation){alert('Browser location is unavailable.');return}
  const token=++locate._seq;
  navigator.geolocation.getCurrentPosition(pos=>{
    if(document.visibilityState==='hidden'||token!==locate._seq||!state.map)return;
    state.currentLocation={lat:pos.coords.latitude,lng:pos.coords.longitude};
    if(state.userMarker)state.userMarker.remove();
    state.userMarker=L.marker([pos.coords.latitude,pos.coords.longitude]).addTo(state.map).bindPopup('You are here').openPopup();
    state.map.setView([pos.coords.latitude,pos.coords.longitude],16);
    renderWorkList();
  },()=>alert('Location permission was not granted.'),{enableHighAccuracy:true,maximumAge:0,timeout:10000});
}
locate._seq=0;

function updateSelectedBadge(){const n=state.selected.size;$('selectedCount').textContent=n;$('selectedCountRoute').textContent=n;$('routeTrayCount').textContent=n;$('mobileRouteCount').textContent=n;$('routeTray').classList.toggle('hidden',n===0)}

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

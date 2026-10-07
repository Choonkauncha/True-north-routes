const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'public,max-age=120'}});
export default {async fetch(request){
  try{
    const u=new URL(request.url);const area=u.searchParams.get('state')||'OH';
    const r=await fetch(`https://api.weather.gov/alerts/active?area=${encodeURIComponent(area)}`,{headers:{accept:'application/geo+json','user-agent':'True North Restorations Sales Map'}});
    if(!r.ok)throw new Error(`NWS HTTP ${r.status}`);const data=await r.json();
    const events=['Tornado Warning','Tornado Watch','Severe Thunderstorm Warning','Severe Thunderstorm Watch','Special Weather Statement','High Wind Warning','Wind Advisory','Hail'];
    data.features=(data.features||[]).filter(f=>events.some(e=>String(f.properties?.event||'').toLowerCase().includes(e.toLowerCase())));
    return json(data);
  }catch(e){return json({error:e.message},500)}
}};

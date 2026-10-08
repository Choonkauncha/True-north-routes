const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'public,max-age=30'}});
export default {async fetch(request){
  if(request.method!=='POST')return json({error:'POST required'},405);
  try{
    const body=await request.json();const coords=Array.isArray(body.coordinates)?body.coordinates:[];
    if(coords.length<2||coords.length>80)return json({error:'Send 2-80 coordinates.'},400);
    const profile=body.profile==='foot'||body.profile==='walking'?'foot':'driving';
    const service=body.service==='route'?'route':'trip';
    const packed=coords.map(p=>`${Number(p.lng)},${Number(p.lat)}`).join(';');
    const url=service==='route'
      ?`https://router.project-osrm.org/route/v1/${profile}/${packed}?overview=full&geometries=geojson&steps=false`
      :`https://router.project-osrm.org/trip/v1/${profile}/${packed}?roundtrip=false&source=first&destination=any&overview=full&geometries=geojson&steps=false`;
    const r=await fetch(url,{headers:{accept:'application/json','user-agent':'True North Restorations Sales Map'}});if(!r.ok)throw new Error(`OSRM HTTP ${r.status}`);
    const data=await r.json();if(data.code!=='Ok')throw new Error(data.message||data.code||'No road trip found');
    if(service==='route'){
      const road=data.routes?.[0];
      return json({code:data.code,geometry:road?.geometry,distance:road?.distance,duration:road?.duration,profile,source:'OpenStreetMap / OSRM'});
    }
    const trip=data.trips?.[0];
    const order=(data.waypoints||[]).map((w,i)=>({inputIndex:i,tripIndex:w.waypoint_index})).sort((a,b)=>a.tripIndex-b.tripIndex).map(x=>x.inputIndex).filter(i=>i!==0);
    return json({code:data.code,geometry:trip?.geometry,distance:trip?.distance,duration:trip?.duration,order,profile,source:'OpenStreetMap / OSRM Trip'});
  }catch(e){return json({error:e.message},500)}
}};

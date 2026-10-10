import { normalizeRouteRequest, routeServiceUrl } from '../lib/route-request.js';

const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
const fail = (message, status) => Object.assign(new Error(message), { status });

export async function handleRoute(request, { fetchImpl = fetch, env = process.env } = {}) {
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405);
  try {
    let body;
    try { body = await request.json(); }
    catch { throw fail('Send valid JSON.', 400); }
    const normalized = normalizeRouteRequest(body);
    if (normalized.error) throw fail(normalized.error, 400);
    const { coordinates, profile, service, wantSteps } = normalized;
    const response = await fetchImpl(routeServiceUrl(normalized, env), {
      headers: { accept: 'application/json', 'user-agent': 'True North Restorations Sales Map' },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw fail(`Road router HTTP ${response.status}`, 502);
    let data;
    try { data = await response.json(); }
    catch { throw fail('Road router returned an invalid response.', 502); }
    if (data.code !== 'Ok') throw fail(data.message || data.code || 'No road trip found', 502);
    if (service === 'route') {
      const road = data.routes?.[0];
      if (!road?.geometry) throw fail('Road router did not return a route.', 502);
      let along=0;
      const steps=wantSteps?(road?.legs||[]).flatMap(leg=>(leg.steps||[]).map(step=>{
        const distance=Number(step.distance)||0;
        along+=distance;
        return {type:step.maneuver?.type||'continue',modifier:step.maneuver?.modifier||'',name:step.name||'',distance,duration:Number(step.duration)||0,endMeters:along,location:step.maneuver?.location||null};
      })):[];
      return json({code:data.code,geometry:road.geometry,distance:road.distance,duration:road.duration,steps,profile,source:'OpenStreetMap / OSRM'});
    }
    const trip = data.trips?.[0];
    if (!trip?.geometry) throw fail('Road router did not return a trip.', 502);
    const order=(data.waypoints||[]).map((w,i)=>({inputIndex:i,tripIndex:w.waypoint_index})).sort((a,b)=>a.tripIndex-b.tripIndex).map(x=>x.inputIndex).filter(i=>i!==0);
    return json({code:data.code,geometry:trip?.geometry,distance:trip?.distance,duration:trip?.duration,order,profile,source:'OpenStreetMap / OSRM Trip'});
  } catch (error) {
    if (error?.name === 'TimeoutError') return json({ error: 'Road router timed out. Try again.' }, 502);
    return json({ error: error?.message || 'Route service failed.' }, error?.status || 502);
  }
}

export default { fetch: handleRoute };

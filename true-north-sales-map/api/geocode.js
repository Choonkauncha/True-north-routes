import { requirePasswordReady } from '../lib/server-access.js';
const cors={"access-control-allow-origin":"*","access-control-allow-headers":"authorization,content-type","access-control-allow-methods":"POST,OPTIONS"};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json',...cors}});
const csvEscape=v=>`"${String(v??'').replaceAll('"','""')}"`;
function parseCsvLine(line){const out=[];let cur='',quote=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quote&&line[i+1]==='"'){cur+='"';i++;}else quote=!quote;}else if(c===','&&!quote){out.push(cur);cur='';}else cur+=c;}out.push(cur);return out;}
async function userFromRequest(request){
  const auth=request.headers.get('authorization')||'';const token=auth.startsWith('Bearer ')?auth.slice(7):'';const url=process.env.SUPABASE_URL||'';const secret=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||'';
  if(!token)throw Object.assign(new Error('Sign in required.'),{status:401});
  if(!url||!secret)throw Object.assign(new Error('Cloud authentication is not configured.'),{status:503});
  const r=await fetch(`${url}/auth/v1/user`,{headers:{apikey:secret,Authorization:`Bearer ${token}`}});if(!r.ok)throw Object.assign(new Error('Unauthorized'),{status:401});
  const user=await r.json();
  if(!user.id)throw Object.assign(new Error('Unauthorized'),{status:401});
  const profiles=await fetch(`${url}/rest/v1/reps?user_id=eq.${encodeURIComponent(user.id)}&active=eq.true&select=id,role&limit=1`,{headers:{apikey:secret,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(12000)});
  if(!profiles.ok)throw Object.assign(new Error('Team access could not be verified.'),{status:503});
  const rep=(await profiles.json())?.[0];
  if(!rep||!['admin','manager'].includes(rep.role))throw Object.assign(new Error('An active management profile is required for batch geocoding.'),{status:403});
  return user;
}
export default {async fetch(request){
  if(request.method==='OPTIONS')return new Response(null,{headers:cors});
  if(request.method!=='POST')return json({error:'POST required'},405);
  try{
    await requirePasswordReady(request);
    await userFromRequest(request);
    const body=await request.json();const addresses=Array.isArray(body.addresses)?body.addresses:[];
    if(!addresses.length||addresses.length>500)return json({error:'Send between 1 and 500 addresses per batch.'},400);
    const lines=addresses.map(a=>[a.id,a.address,a.city,a.state,a.zip].map(csvEscape).join(','));
    const form=new FormData();form.append('addressFile',new Blob([lines.join('\n')+'\n'],{type:'text/csv'}),'batch.csv');form.append('benchmark','Public_AR_Current');
    const r=await fetch('https://geocoding.geo.census.gov/geocoder/locations/addressbatch',{method:'POST',body:form,signal:AbortSignal.timeout(30000)});
    const text=await r.text();if(!r.ok)throw new Error(`Census geocoder HTTP ${r.status}`);
    const results=text.split(/\r?\n/).filter(Boolean).map(parseCsvLine).map(row=>{
      const id=row[0];const status=row[2]||'';const matchType=row[3]||'';const coords=row[5]||'';let lat=null,lng=null;if(coords){const [x,y]=coords.split(',').map(Number);if(Number.isFinite(x)&&Number.isFinite(y)){lng=x;lat=y;}}
      return {id,status,matchType,matchedAddress:row[4]||'',lng,lat};
    });
    return json({results,source:'U.S. Census Geocoder',benchmark:'Public_AR_Current'});
  }catch(e){return json({error:e.message||'Geocode failed'},e.status||502)}
}};

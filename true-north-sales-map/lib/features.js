export const FEATURES = Object.freeze([
  ['map','Field map'],['routes','Routes and navigation'],['weather','Weather'],
  ['intake','Book inspection'],['forms','My forms'],['photos','Roof photos'],
  ['training','Training'],['coach','Personal Coach'],['shifts','Shifts'],
  ['messages','Messages'],['account','My account']
]);
export const FEATURE_ROLES = ['appointment_setter','salesperson'];
export function featureRole(role){return role==='canvasser'?'appointment_setter':role;}
export function featureAllowed(rows,role,key){
  if(['admin','manager'].includes(role))return true;
  if(!FEATURES.some(([id])=>id===key))return false;
  const row=rows.find(row=>row.role===featureRole(role)&&row.feature===key);
  return row ? row.enabled===true : key!=='photos'||role==='salesperson';
}
export async function requireFeature(request,key,{env=process.env,fetchImpl=fetch}={}){
  const token=request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if(!token)throw Object.assign(Error('Sign in required.'),{status:401,public:true});
  const base=(env.SUPABASE_URL||'').replace(/\/$/,'');
  const response=await fetchImpl(`${base}/rest/v1/rpc/feature_enabled`,{method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY||env.SUPABASE_ANON_KEY,Authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({requested:key})});
  if(!response.ok)throw Object.assign(Error('Feature access could not be verified.'),{status:503,public:true});
  if(await response.json()!==true)throw Object.assign(Error('Management has disabled this feature for your role.'),{status:403,public:true});
}

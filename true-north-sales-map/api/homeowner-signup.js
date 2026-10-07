function clean(v,max=500){return String(v??'').trim().slice(0,max)}
function json(status,body){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}})}

export default {
  async fetch(request){
    if(request.method!=='POST') return json(405,{error:'Method not allowed'});
    const secret=process.env.SUPABASE_SECRET_KEY||'';
    const base=process.env.SUPABASE_URL||'';
    if(!secret||!base) return json(503,{error:'Cloud intake is not configured yet.'});
    let body;
    try{body=await request.json()}catch{return json(400,{error:'Invalid request.'})}
    if(clean(body.website,100)) return json(400,{error:'Invalid submission.'});
    const required=['first_name','last_name','phone','address','city','state','zip'];
    for(const k of required){if(!clean(body[k]))return json(400,{error:`Please provide ${k.replaceAll('_',' ')}.`})}
    if(body.consent_contact!==true)return json(400,{error:'Please confirm that True North may contact you about your inspection request.'});

    const now=new Date().toISOString();
    const leadId=`HOME-${Date.now()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
    const homeownerName=`${clean(body.first_name,80)} ${clean(body.last_name,80)}`.trim();
    const address=clean(body.address,180);
    const city=clean(body.city,80); const state=clean(body.state,3)||'OH'; const zip=clean(body.zip,20);
    const lead={id:leadId,source:'Homeowner public form',name:homeownerName,address,secondary_address:'',city,state,zip,full_address:[address,city,state,zip].filter(Boolean).join(', '),status:'Interested',notes:clean(body.notes,1500),updated_at:now};
    const intake={lead_id:leadId,first_name:clean(body.first_name,80),last_name:clean(body.last_name,80),phone:clean(body.phone,40),email:clean(body.email,160),address,city,state,zip,homeowner_confirmed:body.homeowner_confirmed===true,concern:clean(body.concern,120),what_they_noticed:clean(body.what_they_noticed,1500),other_contractor:clean(body.other_contractor,40),timing:clean(body.timing,60),preferred_date:clean(body.preferred_date,30),preferred_time_window:clean(body.preferred_time_window,80),notes:clean(body.notes,1500),consent_contact:true,source:'public_homeowner_form',status:'New',created_at:now,updated_at:now};
    const headers={'apikey':secret,'Authorization':`Bearer ${secret}`,'content-type':'application/json','Prefer':'return=minimal'};
    const leadResp=await fetch(`${base}/rest/v1/leads`,{method:'POST',headers,body:JSON.stringify(lead)});
    if(!leadResp.ok){const t=await leadResp.text();return json(502,{error:'Could not create the inspection request.',detail:t.slice(0,400)})}
    const intakeResp=await fetch(`${base}/rest/v1/homeowner_intakes`,{method:'POST',headers,body:JSON.stringify(intake)});
    if(!intakeResp.ok){const t=await intakeResp.text();return json(502,{error:'Lead created but intake record failed.',detail:t.slice(0,400)})}
    await fetch(`${base}/rest/v1/lead_activity`,{method:'POST',headers,body:JSON.stringify({lead_id:leadId,action:'homeowner_request_submitted',metadata:{source:'public_homeowner_form',preferred_date:clean(body.preferred_date,30),preferred_time_window:clean(body.preferred_time_window,80)},created_at:now})});
    return json(201,{ok:true,reference:leadId,message:'Thanks. True North Restorations received your inspection request. A team member will contact you to confirm the next step.'});
  }
};

import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
const server=http.createServer((req,res)=>{try {res.setHeader('content-type',req.url.endsWith('.js')?'text/javascript':'text/html');res.end(readFileSync(new URL('..'+req.url,import.meta.url)));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
try {
 const page=await browser.newPage();
 await page.route('**/fixture',route=>route.fulfill({contentType:'text/html',body:'<div id="app"><nav class="rail"></nav><main class="dashMain"></main></div><script type="module" src="/tn-files/accounts-admin.js"></script>'}));
 await page.route('**/api/config',route=>route.fulfill({json:{configured:true,url:'http://test',publishableKey:'public'}}));
 await page.route('**/vendor/supabase/supabase.js',route=>route.fulfill({contentType:'application/javascript',body:`
 const users=[{id:'admin',user_id:'admin-user',name:'Admin',role:'admin',active:true},{id:'other',user_id:'other-user',name:'Other Admin',role:'admin',active:true},{id:'sales',user_id:'sales-user',name:'Sales',email:'sales@example.test',role:'salesperson',active:true}];
 export function createClient(){return {auth:{getSession:async()=>({data:{session:{access_token:'token',user:{id:'admin-user',email:'admin@example.test'}}}})},from(){return {select(){return this},eq(){return this},maybeSingle:async()=>({data:users[0]})}},rpc:async()=>({data:users.filter(u=>!window.deleted||u.id!=='sales')})}}` }));
 let mutations=0;
 await page.route('**/api/accounts',async route=>{
  const body=route.request().postDataJSON();
  if(body.action==='delete') {mutations++;await page.evaluate(()=>window.deleted=true);await route.fulfill({json:{ok:true}});}
  else if(body.action==='archive') await route.fulfill({json:{profiles:[{name:'Sales',email:'sales@example.test',role:'salesperson',deleted_at:new Date().toISOString()}]}});
  else await route.fulfill({status:409,json:{error:'That email already has a login.'}});
 });
 await page.goto(origin+'/fixture');await page.getByRole('button',{name:'Accounts',exact:true}).click();
 await page.locator('[data-rep="sales"] [data-act="delete"]').waitFor();
 assert.equal(await page.locator('[data-rep="other"] [data-act]').count(),0);
 assert.equal(await page.locator('[data-rep="admin"] [data-act="delete"]').count(),0);
 page.on('dialog',dialog=>dialog.accept());
 await page.locator('[data-rep="sales"] [data-act="delete"]').click();
 await page.getByText('Profile deleted. Login removed and profile moved to the archive.').waitFor();
 assert.equal(await page.locator('[data-rep="sales"]').count(),0);assert.equal(mutations,1);
 await page.getByLabel('Account settings').click();await page.getByRole('button',{name:'Deleted profiles archive'}).click();
 await page.getByRole('heading',{name:'Deleted profiles archive'}).waitFor();assert.equal(await page.getByText('sales@example.test',{exact:false}).count(),1);
 await page.locator('.accountCreate summary').click();
 await page.locator('#acctName').fill('Sam Sales');await page.locator('#acctEmail').fill('sam@example.test');await page.locator('#acctPassword').fill('temporary-password');
 await page.getByLabel('Show initial password').check();assert.equal(await page.locator('#acctPassword').getAttribute('type'),'text');
 await page.getByRole('button',{name:'Create login',exact:true}).click();await page.getByText('That email already has a login.').waitFor();
 assert.equal(await page.locator('#acctName').inputValue(),'Sam Sales');assert.equal(await page.locator('#acctPassword').inputValue(),'');
 console.log('Account browser flows: admin protection, deletion, settings archive and create-error recovery passed');
} finally {await browser.close();server.close();}

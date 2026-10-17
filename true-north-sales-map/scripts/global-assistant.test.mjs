import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {clampOrbPosition,avoidObstacles,safeOrbPosition,ORB_OBSTACLES} from '../tn-files/orb-position.js';
const root=new URL('../',import.meta.url);
for(const file of readdirSync(root).filter(file=>file.endsWith('.html'))){
 const html=readFileSync(new URL(file,root),'utf8');assert.equal(html.split('src="/tn-files/global-assistant.js"').length-1,1,`${file} must load one shared overlay`);
}
assert.deepEqual(clampOrbPosition(-50,-50,390,844,64),{x:8,y:8});
assert.deepEqual(clampOrbPosition(999,999,390,844,64),{x:318,y:772});
const position=clampOrbPosition(200,400,320,500,82);assert.ok(position.x>=8&&position.x<=230&&position.y<=410);
const code=readFileSync(new URL('../tn-files/global-assistant.js',import.meta.url),'utf8');
assert.ok(code.includes('guest();'));assert.ok(code.includes('client.auth.getUser()'));assert.ok(code.includes('pending.userId!==mapContext.rep.user_id'));assert.ok(code.includes("/api/coach"));
// Default placement clears the phone bottom sheet and Build route bar.
const sheet={left:0,top:640,right:390,bottom:776},bar={left:7,top:777,right:383,bottom:837};
const phone=safeOrbPosition({size:64,width:390,height:844,obstacles:[sheet,bar]});
assert.ok(phone.y+64<=sheet.top,'orb sits above the bottom sheet on phones');
// On desktop it stays on the map, left of the list panel and above the Leaflet attribution.
const panel={left:1050,top:68,right:1440,bottom:900},attribution={left:850,top:880,right:1050,bottom:900};
const desk=safeOrbPosition({size:82,width:1440,height:900,anchor:{left:0,top:68,right:1050,bottom:900},obstacles:[panel,attribution]});
assert.ok(desk.x+82<=panel.left,'orb never covers list card badges');assert.ok(desk.y+82<=attribution.top,'orb never covers the map attribution');
// A dragged orb dropped on a toast is nudged clear, and stays inside the viewport.
const toast={left:8,top:700,right:382,bottom:790};const dropped=avoidObstacles({x:300,y:720},{size:64,width:390,height:844,obstacles:[toast]});
assert.ok(dropped.y+64<=toast.top&&dropped.y>=8);
for(const sel of ['.leaflet-control-attribution','#doorSheetCard','#toast.show','#routeTray','#mobileBar','.sidePanel'])assert.ok(ORB_OBSTACLES.includes(sel),sel);
assert.match(code,/function guest\(\)\{[^}]*orb\?\.dispose\(\)/,'signed-out visitors get no orb');
assert.equal(/function guest\(\)\{[^}]*mountMapAssistant/.test(code),false,'guest mode must not mount the orb');
const css=readFileSync(new URL('../tn-files/map-assistant.css',import.meta.url),'utf8');assert.ok(css.includes('html.tn-signed-out .mapAssistant'));assert.ok(css.includes('html.tn-map .mapAssistant{z-index:850}'));
console.log('All-screen overlay inclusion, drag bounds and authenticated command handoff checks passed');

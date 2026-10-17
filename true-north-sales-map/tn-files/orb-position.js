// Assistant orb placement. The orb is draggable, but it must never sit on top of
// working controls: list badges, the Leaflet attribution, the bottom sheet,
// toasts, or the Build route bar. Placement is a pure function so it can be tested.
export const ORB_MARGIN=8;
export function clampOrbPosition(x,y,width,height,size=82,margin=ORB_MARGIN){
 const maxX=Math.max(margin,width-size-margin),maxY=Math.max(margin,height-size-margin);
 return {x:Math.max(margin,Math.min(maxX,Number.isFinite(x)?x:maxX)),y:Math.max(margin,Math.min(maxY,Number.isFinite(y)?y:maxY))};
}
const overlaps=(a,b,gap)=>a.x<b.right+gap&&a.x+a.size>b.left-gap&&a.y<b.bottom+gap&&a.y+a.size>b.top-gap;
// Moves a proposed point up (then left) until it clears every obstacle rectangle.
export function avoidObstacles(point,{size=82,width,height,obstacles=[],gap=10,margin=ORB_MARGIN}={}){
 let {x,y}=clampOrbPosition(point.x,point.y,width,height,size,margin);
 for(let pass=0;pass<12;pass++){
  const hit=obstacles.find(rect=>overlaps({x,y,size},rect,gap));
  if(!hit)return {x,y};
  const up=hit.top-gap-size;
  if(up>=margin){y=up;continue;}
  const left=hit.left-gap-size;
  if(left>=margin){x=left;continue;}
  break;
 }
 return clampOrbPosition(x,y,width,height,size,margin);
}
// Default home: bottom-right of the anchor (the map on the field map, the viewport elsewhere).
export function safeOrbPosition({size=82,width,height,anchor,obstacles=[],gap=10,margin=12}={}){
 const box=anchor||{left:0,top:0,right:width,bottom:height};
 return avoidObstacles({x:box.right-size-margin,y:box.bottom-size-margin},{size,width,height,obstacles,gap});
}
// Every control the orb must leave visible. Hidden elements have no box and are ignored.
export const ORB_OBSTACLES=['.leaflet-control-attribution','.leaflet-control-zoom','#mapInfo','#mobileBar','#listSheet','.sidePanel','#doorSheetCard','#toast.show','.toast.show','#routeTray','#navBar','#routeForBanner','.tnToast','.mapLegend'];
function visibleRects(selectors){
 const rects=[];
 for(const el of document.querySelectorAll(selectors.join(','))){
  if(el.closest('#tnMapAssistant'))continue;
  const style=getComputedStyle(el);if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)continue;
  const r=el.getBoundingClientRect();if(r.width<2||r.height<2||r.bottom<=0||r.top>=innerHeight)continue;
  rects.push({left:r.left,top:r.top,right:r.right,bottom:r.bottom});
 }
 return rects;
}
function mapAnchor(){
 const map=document.getElementById('map');if(!map)return null;
 const r=map.getBoundingClientRect();if(r.width<120||r.height<120)return null;
 return {left:r.left,top:r.top,right:Math.min(r.right,innerWidth),bottom:Math.min(r.bottom,innerHeight)};
}
export function mountOrbDragging(root,launcher,panel){
 const KEY='tn:assistant-orb-position';let pointer=null,origin=null,moved=false,saved=null,frame=0;
 try{saved=JSON.parse(localStorage.getItem(KEY)||'null');}catch{}
 const sizeOf=()=>launcher.getBoundingClientRect().width||82;
 function alignPanel(){
  const box=launcher.getBoundingClientRect(),above=box.top-20,below=innerHeight-box.bottom-20;
  root.classList.toggle('orbPanelLeft',box.left<Math.min(330,innerWidth-28));
  root.classList.toggle('orbPanelBelow',below>above);
  if(panel)panel.style.maxHeight=Math.max(80,Math.max(above,below))+'px';
 }
 function apply(point){
  root.style.left=point.x+'px';root.style.top=point.y+'px';root.style.right='auto';root.style.bottom='auto';
  alignPanel();
 }
 function settle(){
  if(pointer!==null)return;
  const size=sizeOf(),obstacles=visibleRects(ORB_OBSTACLES);
  const opts={size,width:innerWidth,height:innerHeight,obstacles};
  const point=saved&&Number.isFinite(saved.x)&&Number.isFinite(saved.y)
   ?avoidObstacles({x:saved.x*(innerWidth-size-ORB_MARGIN),y:saved.y*(innerHeight-size-ORB_MARGIN)},opts)
   :safeOrbPosition({...opts,anchor:mapAnchor()});
  apply(point);
 }
 const schedule=()=>{if(frame)return;frame=requestAnimationFrame(()=>{frame=0;settle();});};
 function drop(x,y){
  const size=sizeOf(),point=avoidObstacles({x,y},{size,width:innerWidth,height:innerHeight,obstacles:visibleRects(ORB_OBSTACLES)});
  saved={x:point.x/Math.max(1,innerWidth-size-ORB_MARGIN),y:point.y/Math.max(1,innerHeight-size-ORB_MARGIN)};
  try{localStorage.setItem(KEY,JSON.stringify(saved));}catch{}
  apply(point);
 }
 const down=event=>{if(event.button!==0)return;pointer=event.pointerId;moved=false;const box=launcher.getBoundingClientRect();origin={x:event.clientX,y:event.clientY,left:box.left,top:box.top};launcher.setPointerCapture?.(pointer);};
 const move=event=>{if(pointer!==event.pointerId||!origin)return;const dx=event.clientX-origin.x,dy=event.clientY-origin.y;if(Math.hypot(dx,dy)>5)moved=true;if(moved){event.preventDefault();apply(clampOrbPosition(origin.left+dx,origin.top+dy,innerWidth,innerHeight,sizeOf()));}};
 const up=event=>{if(pointer!==event.pointerId)return;launcher.releasePointerCapture?.(pointer);pointer=null;const wasOrigin=origin;origin=null;if(moved&&wasOrigin){const rect=launcher.getBoundingClientRect();drop(rect.left,rect.top);}};
 const click=event=>{alignPanel();if(moved){event.preventDefault();event.stopImmediatePropagation();moved=false;}};
 const key=event=>{const offsets={ArrowLeft:[-12,0],ArrowRight:[12,0],ArrowUp:[0,-12],ArrowDown:[0,12]};if(!event.shiftKey||!offsets[event.key])return;event.preventDefault();const rect=launcher.getBoundingClientRect(),[x,y]=offsets[event.key];drop(rect.left+x,rect.top+y);};
 launcher.addEventListener('pointerdown',down);launcher.addEventListener('pointermove',move);launcher.addEventListener('pointerup',up);launcher.addEventListener('pointercancel',up);launcher.addEventListener('click',click,true);launcher.addEventListener('keydown',key);
 window.addEventListener('resize',schedule);
 // Sheets, toasts and the route bar open and close by toggling classes or [hidden].
 const watcher=typeof MutationObserver==='function'?new MutationObserver(schedule):null;
 watcher?.observe(document.body,{subtree:true,attributes:true,attributeFilter:['class','hidden']});
 const tick=setInterval(schedule,1500);
 launcher.title='Drag to move. Click to open. Shift + arrow keys also move the orb.';
 settle();
 const cleanup=()=>{cancelAnimationFrame(frame);clearInterval(tick);watcher?.disconnect();window.removeEventListener('resize',schedule);launcher.removeEventListener('pointerdown',down);launcher.removeEventListener('pointermove',move);launcher.removeEventListener('pointerup',up);launcher.removeEventListener('pointercancel',up);launcher.removeEventListener('click',click,true);launcher.removeEventListener('keydown',key);};
 cleanup.reposition=alignPanel;cleanup.settle=settle;return cleanup;
}

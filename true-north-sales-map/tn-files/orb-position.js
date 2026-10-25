export function clampOrbPosition(x,y,width,height,size=74){
 const maxX=Math.max(8,width-size-8),maxY=Math.max(8,height-size-8);
 return {x:Math.max(8,Math.min(maxX,Number.isFinite(x)?x:maxX)),y:Math.max(8,Math.min(maxY,Number.isFinite(y)?y:maxY))};
}
export function mountOrbDragging(root,launcher,hud){
 const KEY='tn:assistant-orb-position';let pointer=null,origin=null,moved=false,saved=null;
 try{saved=JSON.parse(localStorage.getItem(KEY)||'null');}catch{}
 function alignHud(){
  const box=launcher.getBoundingClientRect(),above=box.top-14,below=innerHeight-box.bottom-14;
  const anchorLeft=(box.left+box.width/2)<(innerWidth/2);
  root.classList.toggle('orbPanelLeft',anchorLeft);
  root.classList.toggle('orbHudLeft',anchorLeft);
  root.classList.toggle('orbPanelBelow',below>above);
  root.classList.toggle('orbHudBelow',below>above);
  if(hud){
   const maxW=Math.min(innerWidth<500?256:308,Math.max(200,innerWidth-20));
   const rawLeft=anchorLeft?box.left:(box.right-maxW);
   const clampedLeft=Math.max(10,Math.min(innerWidth-maxW-10,rawLeft));
   hud.style.setProperty('--hud-shift-x',Math.round(clampedLeft-rawLeft)+'px');
  }
 }
 function position(x,y,persist=false){
  const size=launcher.getBoundingClientRect().width||74;
  const point=clampOrbPosition(x,y,innerWidth,innerHeight,size);
  root.style.left=point.x+'px';root.style.top=point.y+'px';root.style.right='auto';root.style.bottom='auto';
  alignHud();
  if(persist){saved={x:point.x/Math.max(1,innerWidth-size-8),y:point.y/Math.max(1,innerHeight-size-8)};try{localStorage.setItem(KEY,JSON.stringify(saved));}catch{}}
 }
 function restore(){const size=launcher.getBoundingClientRect().width||74;if(saved&&Number.isFinite(saved.x)&&Number.isFinite(saved.y))position(saved.x*(innerWidth-size-8),saved.y*(innerHeight-size-8));else alignHud();}
 const down=event=>{if(event.button!==0)return;pointer=event.pointerId;moved=false;const box=launcher.getBoundingClientRect();origin={x:event.clientX,y:event.clientY,left:box.left,top:box.top};launcher.setPointerCapture?.(pointer);};
 const move=event=>{if(pointer!==event.pointerId||!origin)return;const dx=event.clientX-origin.x,dy=event.clientY-origin.y;if(Math.hypot(dx,dy)>5)moved=true;if(moved){event.preventDefault();position(origin.left+dx,origin.top+dy);}};
 const up=event=>{if(pointer!==event.pointerId)return;if(moved){const rect=launcher.getBoundingClientRect();position(rect.left,rect.top,true);}launcher.releasePointerCapture?.(pointer);pointer=null;origin=null;};
 const click=event=>{alignHud();if(moved){event.preventDefault();event.stopImmediatePropagation();moved=false;}};
 const key=event=>{const offsets={ArrowLeft:[-12,0],ArrowRight:[12,0],ArrowUp:[0,-12],ArrowDown:[0,12]};if(!event.shiftKey||!offsets[event.key])return;event.preventDefault();const rect=launcher.getBoundingClientRect(),[x,y]=offsets[event.key];position(rect.left+x,rect.top+y,true);};
 launcher.addEventListener('pointerdown',down);launcher.addEventListener('pointermove',move);launcher.addEventListener('pointerup',up);launcher.addEventListener('pointercancel',up);launcher.addEventListener('click',click,true);launcher.addEventListener('keydown',key);window.addEventListener('resize',restore);
 launcher.title='Tap to start or stop True North Assistant. Drag to move.';
 restore();
 const cleanup=()=>{window.removeEventListener('resize',restore);launcher.removeEventListener('pointerdown',down);launcher.removeEventListener('pointermove',move);launcher.removeEventListener('pointerup',up);launcher.removeEventListener('pointercancel',up);launcher.removeEventListener('click',click,true);launcher.removeEventListener('keydown',key);};
 cleanup.reposition=alignHud;return cleanup;
}

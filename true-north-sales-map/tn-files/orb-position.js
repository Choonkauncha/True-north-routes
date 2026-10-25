export function clampOrbPosition(x,y,width,height,size=74){
 const maxX=Math.max(8,width-size-8),maxY=Math.max(8,height-size-8);
 return {x:Math.max(8,Math.min(maxX,Number.isFinite(x)?x:maxX)),y:Math.max(8,Math.min(maxY,Number.isFinite(y)?y:maxY))};
}

function computeDefaultAnchor(size){
 let rightOffset=24;
 let bottomOffset=innerWidth<=900?158:28;
 if(typeof document!=='undefined'){
  const sheet=document.querySelector('#listSheet, .sidePanel');
  if(sheet){
   const rect=sheet.getBoundingClientRect();
   if(rect.width>0&&rect.height>0){
    if(innerWidth>900&&rect.left>=innerWidth*0.45&&rect.height>innerHeight*0.4){
     // Desktop right-hand address sidebar: place orb to the left of the sidebar on the open map canvas
     rightOffset=Math.max(rightOffset,Math.round(innerWidth-rect.left+24));
    }else if(innerWidth<=900&&rect.top>innerHeight*0.35&&rect.top<innerHeight){
     // Mobile bottom sheet: place orb cleanly above the "Nearby addresses" sheet header
     bottomOffset=Math.max(bottomOffset,Math.round(innerHeight-rect.top+20));
    }
   }
  }
 }
 return clampOrbPosition(innerWidth-size-rightOffset,innerHeight-size-bottomOffset,innerWidth,innerHeight,size);
}

export function mountOrbDragging(root,launcher,hud){
 const KEY='tn:assistant-orb-position';let pointer=null,origin=null,moved=false,saved=null;
 try{saved=JSON.parse(localStorage.getItem(KEY)||'null');}catch{}
 function alignHud(){
  const box=launcher.getBoundingClientRect(),above=box.top-14,below=innerHeight-box.bottom-14;
  const anchorLeft=(box.left+box.width/2)<(innerWidth*0.42);
  root.classList.toggle('orbPanelLeft',anchorLeft);
  root.classList.toggle('orbHudLeft',anchorLeft);
  root.classList.toggle('orbPanelBelow',below>above);
  root.classList.toggle('orbHudBelow',below>above);
  if(hud){
   hud.style.setProperty('--hud-shift-x','0px');
   if(!hud.hidden){
    const hr=hud.getBoundingClientRect();
    let shift=0;
    if(hr.left<10)shift=10-hr.left;
    else if(hr.right>innerWidth-10)shift=(innerWidth-10)-hr.right;
    if(shift)hud.style.setProperty('--hud-shift-x',Math.round(shift)+'px');
   }
  }
 }
 function position(x,y,persist=false){
  const r=launcher.getBoundingClientRect();const size=(r.width>=40&&r.width<=120)?r.width:(innerWidth<=720?64:72);
  const point=clampOrbPosition(x,y,innerWidth,innerHeight,size);
  root.style.left=point.x+'px';root.style.top=point.y+'px';root.style.right='auto';root.style.bottom='auto';
  alignHud();
  if(persist){saved={x:point.x/Math.max(1,innerWidth-size-8),y:point.y/Math.max(1,innerHeight-size-8)};try{localStorage.setItem(KEY,JSON.stringify(saved));}catch{}}
 }
 function applyDefaultAnchor(){
  const r=launcher.getBoundingClientRect();const size=(r.width>=40&&r.width<=120)?r.width:(innerWidth<=720?64:72);
  const sheet=typeof document!=="undefined"&&document.querySelector("#listSheet, .sidePanel");
  if(sheet){
   const rect=sheet.getBoundingClientRect();
   if(rect.width>0&&rect.height>0){
    const def=computeDefaultAnchor(size);
    root.style.left=def.x+"px";root.style.top=def.y+"px";root.style.right="auto";root.style.bottom="auto";
   }
  }
  alignHud();
 }
 function restore(){
  const r=launcher.getBoundingClientRect();const size=(r.width>=40&&r.width<=120)?r.width:(innerWidth<=720?64:72);
  if(saved&&Number.isFinite(saved.x)&&Number.isFinite(saved.y)){
   position(saved.x*(innerWidth-size-8),saved.y*(innerHeight-size-8));
  }else{
   applyDefaultAnchor();
  }
 }
 const down=event=>{if(event.button!==0)return;pointer=event.pointerId;moved=false;const box=launcher.getBoundingClientRect();origin={x:event.clientX,y:event.clientY,left:box.left,top:box.top};launcher.setPointerCapture?.(pointer);};
 const move=event=>{if(pointer!==event.pointerId||!origin)return;const dx=event.clientX-origin.x,dy=event.clientY-origin.y;if(Math.hypot(dx,dy)>5)moved=true;if(moved){event.preventDefault();position(origin.left+dx,origin.top+dy);}};
 const up=event=>{if(pointer!==event.pointerId)return;if(moved){const rect=launcher.getBoundingClientRect();position(rect.left,rect.top,true);}launcher.releasePointerCapture?.(pointer);pointer=null;origin=null;};
 const click=event=>{alignHud();if(moved){event.preventDefault();event.stopImmediatePropagation();moved=false;}};
 const key=event=>{const offsets={ArrowLeft:[-12,0],ArrowRight:[12,0],ArrowUp:[0,-12],ArrowDown:[0,12]};if(!event.shiftKey||!offsets[event.key])return;event.preventDefault();const rect=launcher.getBoundingClientRect(),[x,y]=offsets[event.key];position(rect.left+x,rect.top+y,true);};
 launcher.addEventListener('pointerdown',down);launcher.addEventListener('pointermove',move);launcher.addEventListener('pointerup',up);launcher.addEventListener('pointercancel',up);launcher.addEventListener('click',click,true);launcher.addEventListener('keydown',key);window.addEventListener('resize',restore);
 launcher.title='Tap to start or stop True North Assistant. Drag to move.';
 restore();
 const cleanup=()=>{window.removeEventListener('resize',restore);launcher.removeEventListener('pointerdown',down);launcher.removeEventListener('pointermove',move);launcher.removeEventListener('pointerup',up);launcher.removeEventListener('pointercancel',up);launcher.removeEventListener('click',click,true);launcher.removeEventListener('keydown',key);};
 cleanup.reposition=()=>{if(!saved&&pointer===null)applyDefaultAnchor();else alignHud();};
 return cleanup;
}

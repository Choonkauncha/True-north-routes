/** WebGL-rendered 3D Coach orb, driven by actual Gemini Live audio levels. */
export function mountCoachOrb(canvas) {
  const stage=canvas.closest('.tnCoachOrbStage');
  let state='idle',input=0,output=0,frame=0,dead=false,energy=0;
  const gl=canvas.getContext('webgl',{alpha:true,antialias:true,powerPreference:'low-power'});
  const setState=s=>{state=s;stage?.setAttribute('data-voice-state',s);};
  const setLevels=v=>{if(Number.isFinite(v?.input))input=Math.max(0,Math.min(1,v.input));if(Number.isFinite(v?.output))output=Math.max(0,Math.min(1,v.output));};
  const fallback=()=>{canvas.hidden=true;stage?.classList.add('tnCoachOrbFallback');return {setState,setLevels,dispose(){dead=true;}};};
  if(!gl)return fallback();
  let program,buffer;
  try {
    function shader(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
    const v=shader(gl.VERTEX_SHADER,'attribute vec2 p; varying vec2 uv;void main(){uv=p;gl_Position=vec4(p,0.,1.);}');
    const f=shader(gl.FRAGMENT_SHADER,`precision mediump float;varying vec2 uv;uniform float time;uniform float energy;
    void main(){vec2 p=uv;float r=length(p);float a=atan(p.y,p.x);float edge=.70+(sin(a*15.+time*1.5)+sin(a*27.-time))* (.005+energy*.025)+energy*.045;
    float mask=1.-smoothstep(edge-.015,edge+.015,r);float z=sqrt(max(0.,1.-pow(r/max(edge,.01),2.)));
    vec3 n=normalize(vec3(p/max(edge,.01),z));float lit=max(0.,dot(n,normalize(vec3(-.6,.8,1.))));float rim=pow(1.-z,2.7);
    vec3 color=mix(vec3(.018,.13,.19),vec3(.23,.95,.82),.22+lit*.55)+rim*vec3(.15,.75,1.2);
    float halo=exp(-pow(max(0.,r-edge)*8.,2.))*(.08+energy*.4);
    gl_FragColor=vec4(color*mask+vec3(.2,.9,.8)*halo*(1.-mask),max(mask,halo*.6));}`);
    program=gl.createProgram();gl.attachShader(program,v);gl.attachShader(program,f);gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('Orb shader link failed');
    buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    gl.useProgram(program);const p=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(p);gl.vertexAttribPointer(p,2,gl.FLOAT,false,0,0);
  }catch{return fallback();}
  const time=gl.getUniformLocation(program,'time'),amp=gl.getUniformLocation(program,'energy');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  function render(now){if(dead)return;frame=requestAnimationFrame(render);if(document.hidden)return;
    const size=Math.max(1,Math.min(512,Math.round(canvas.getBoundingClientRect().width*Math.min(devicePixelRatio||1,2))));
    if(canvas.width!==size){canvas.width=size;canvas.height=size;gl.viewport(0,0,size,size);}
    const target=['idle','paused','error'].includes(state)?0:state==='speaking'?output:input;
    energy+=(target-energy)*.18;gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);gl.uniform1f(time,reduced?0:now*.001);gl.uniform1f(amp,energy);gl.drawArrays(gl.TRIANGLES,0,6);
  }
  frame=requestAnimationFrame(render);
  return {setState,setLevels,dispose(){dead=true;cancelAnimationFrame(frame);gl.deleteBuffer(buffer);gl.deleteProgram(program);}};
}

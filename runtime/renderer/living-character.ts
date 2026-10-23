import type { Expression, PetAction } from '../shared/contracts';
import { KimiLive2DRuntime } from './kimi-live2d';
import './living-character.css';

/** Kimi Cubism 5 Live2D renderer (LD4) with automatic 2D WebGL deformation fallback. */
export const CHARACTER_ANCHORS={width:1024,height:1536,neck:{x:507,y:247},head:{x:501,y:145},eyes:[{x:455,y:177},{x:526,y:155}],mouth:{x:498,y:206},chest:{x:486,y:350},waist:{x:478,y:510},feet:{x:480,y:1450}} as const;
type Point={x:number;y:number};
type Spring={x:number;y:number;vx:number;vy:number};
type Pose={headX:number;headY:number;headAngle:number;bodyX:number;bodyY:number;hairX:number;hairY:number;inertiaX:number;inertiaY:number;breath:number;time:number;touch:number};
const clamp=(v:number,min=-1,max=1)=>Math.max(min,Math.min(max,v));
const smooth=(a:number,b:number,v:number)=>{const t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t);};
const spring=():Spring=>({x:0,y:0,vx:0,vy:0});
function step(s:Spring,target:Point,dt:number,k:number,damping:number){s.vx+=(k*(target.x-s.x)-damping*s.vx)*dt;s.vy+=(k*(target.y-s.y)-damping*s.vy)*dt;s.x+=s.vx*dt;s.y+=s.vy*dt;}
const vertexShader=`attribute vec2 aPosition;attribute vec2 aUv;uniform vec2 uViewport;varying vec2 vUv;void main(){vUv=aUv;gl_Position=vec4(aPosition.x/uViewport.x*2.0-1.0,1.0-aPosition.y/uViewport.y*2.0,0.0,1.0);}`;
const fragmentShader=`precision highp float;
varying vec2 vUv;uniform sampler2D uBase;uniform sampler2D uPrevious;uniform sampler2D uCurrent;uniform sampler2D uBlink;uniform float uMix;uniform float uIntensity;uniform float uBlinkAmount;uniform float uMouth;uniform vec2 uGaze;
float ellipse(vec2 p,vec2 center,vec2 radius){return 1.0-smoothstep(.68,1.1,length((p-center)/radius));}
vec2 eyeLocal(vec2 p,vec2 center){vec2 d=p-center;return mat2(.955,.296,-.296,.955)*d;}
void main(){vec2 p=vUv*vec2(1024.,1536.);vec2 eyeA=vec2(455.,177.),eyeB=vec2(526.,155.);
 vec2 ea=eyeLocal(p,eyeA),eb=eyeLocal(p,eyeB);float iris=max(ellipse(ea,vec2(0.),vec2(12.,9.)),ellipse(eb,vec2(0.),vec2(12.,9.)));
 vec2 uv=vUv-uGaze*vec2(3.2,2.0)/vec2(1024.,1536.)*iris*(1.-uBlinkAmount);
 vec4 base=texture2D(uBase,uv);vec4 face=mix(texture2D(uPrevious,uv),texture2D(uCurrent,uv),uMix);
 float faceMask=ellipse(p,vec2(498.,176.),vec2(116.,119.));vec4 color=mix(base,face,faceMask*uIntensity);
 float lids=max(ellipse(ea,vec2(0.),vec2(24.,15.)),ellipse(eb,vec2(0.),vec2(24.,15.)));
 vec2 center=length(ea)<length(eb)?eyeA:eyeB;vec2 closedUv=uv;closedUv.y=(center.y+(p.y-center.y)/max(.12,1.-uBlinkAmount*.88))/1536.;
 vec4 flattened=mix(texture2D(uPrevious,closedUv),texture2D(uCurrent,closedUv),uMix);
 color=mix(color,flattened,lids*uBlinkAmount*.38);color=mix(color,texture2D(uBlink,vUv),lids*smoothstep(.1,.98,uBlinkAmount));
 vec2 mouth=p-vec2(498.,206.);float opening=ellipse(mouth,vec2(0.),vec2(5.3,1.+uMouth*3.2))*uMouth;
 vec3 oral=mix(vec3(.48,.23,.31),vec3(.79,.48,.54),clamp(mouth.y*.2+.5,0.,1.));color.rgb=mix(color.rgb,oral*color.a,opening*.88);
 float teeth=ellipse(mouth,vec2(0.,-1.2),vec2(3.8,.65))*uMouth*uMouth;color.rgb=mix(color.rgb,vec3(.95,.9,.88)*color.a,teeth*.62);
 gl_FragColor=color;
}`;

export class LivingCharacter {
 readonly canvas=document.createElement('canvas');
 private gl:WebGLRenderingContext|null;
 private live2d?:KimiLive2DRuntime;
 private textures=new Map<Expression,WebGLTexture>();
 private images=new Map<Expression,HTMLImageElement>();
 private alpha?:Uint8Array;
 private program?:WebGLProgram;
 private buffer?:WebGLBuffer;
 private indices?:WebGLBuffer;
 private uniforms=new Map<string,WebGLUniformLocation|null>();
 private frame=0;private lastFrame=0;private clock=0;private draws=0;private lastDt=1/60;
 private visible=true;private reduced=false;private quiet=false;private ready=false;
 private head=spring();private body=spring();private hair=spring();private inertia=spring();
 private pose:Pose={headX:0,headY:0,headAngle:0,bodyX:0,bodyY:0,hairX:0,hairY:0,inertiaX:0,inertiaY:0,breath:0,time:0,touch:0};
 private pointer:Point={x:0,y:0};private lastPointer?:Point;private pointerMovedAt=0;
 private nextGlance=0;private glance:Point={x:.1,y:0};private nextBlink=2.6;private blinkStart=-10;private blinkDuration=.23;private blinkAmount=0;
 private mouthUntil=0;private mouthStart=0;private touchAt=-10;private actionAt=-10;private action:PetAction='idle';private revision=-1;
 private roamActive=false;private roamDirection:-1|0|1=0;
 private audioCtx?:AudioContext;private audioSource?:AudioBufferSourceNode;private audioEnvelope?:Float32Array;private audioStart=0;private audioUntil=0;
 private expression:Expression='neutral';private previous:Expression='neutral';private expressionAt=0;private forcedBlink=false;
 private intensity=1;
 private source:Float32Array;private vertices:Float32Array;private indexData:Uint16Array;
 private resizeObserver:ResizeObserver;private media=matchMedia('(prefers-reduced-motion: reduce)');
 constructor(private host:HTMLElement){
  this.canvas.className='living-canvas';this.canvas.setAttribute('aria-hidden','true');host.append(this.canvas);host.classList.add('living-character');
  const cols=28,rows=42;this.source=new Float32Array((cols+1)*(rows+1)*2);this.vertices=new Float32Array((cols+1)*(rows+1)*4);const triangles:number[]=[];
  for(let y=0;y<=rows;y++)for(let x=0;x<=cols;x++){const i=y*(cols+1)+x;this.source[i*2]=x/cols*1024;this.source[i*2+1]=y/rows*1536;this.vertices[i*4+2]=x/cols;this.vertices[i*4+3]=y/rows;if(x<cols&&y<rows){const b=i+cols+1;triangles.push(i,i+1,b,i+1,b+1,b);}}
  this.indexData=new Uint16Array(triangles);
  this.gl=this.canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:true,depth:false,stencil:false,preserveDrawingBuffer:true,powerPreference:'low-power'});
  Object.defineProperty(this.canvas,'getLivingDiagnostics',{value:()=>this.getDiagnostics(),writable:false});
  try{
   if(!this.gl)throw new Error('WebGL unavailable');
   this.initialize();
   this.canvas.dataset.renderer='webgl';
   this.live2d=new KimiLive2DRuntime(this.gl,()=>{
    this.ready=true;
    this.host.dataset.renderer='webgl';
    this.canvas.dataset.live2d='true';
    if(!this.alpha)this.canvas.dataset.hitGeometry='deformed-alpha';
    if(this.visible&&!this.reduced&&!this.media.matches)this.updateLoop();
   });
   void this.live2d.load();
  }catch{this.gl=null;host.dataset.renderer='static-fallback';this.canvas.remove();}
  this.resizeObserver=new ResizeObserver(()=>this.renderOnce());this.resizeObserver.observe(host);this.media.addEventListener('change',()=>this.updateLoop());
  this.canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();this.ready=false;this.stop();this.host.dataset.renderer='static-fallback';});
 }
 private initialize(){const gl=this.gl!;const compile=(type:number,source:string)=>{const shader=gl.createShader(type)!;gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader)||'shader compile');return shader;};
  const vs=compile(gl.VERTEX_SHADER,vertexShader),fs=compile(gl.FRAGMENT_SHADER,fragmentShader),program=gl.createProgram()!;gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('shader link');this.program=program;
  gl.useProgram(program);this.buffer=gl.createBuffer()!;gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,this.vertices,gl.DYNAMIC_DRAW);
  const pos=gl.getAttribLocation(program,'aPosition'),uv=gl.getAttribLocation(program,'aUv');gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,16,0);gl.enableVertexAttribArray(uv);gl.vertexAttribPointer(uv,2,gl.FLOAT,false,16,8);
  this.indices=gl.createBuffer()!;gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.indices);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,this.indexData,gl.STATIC_DRAW);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
  for(const name of ['uViewport','uBase','uPrevious','uCurrent','uBlink','uMix','uIntensity','uBlinkAmount','uMouth','uGaze'])this.uniforms.set(name,gl.getUniformLocation(program,name));
 }
 setImage(expression:Expression,image:HTMLImageElement){
  this.images.set(expression,image);if(!this.gl)return;const gl=this.gl;let texture=this.textures.get(expression);if(!texture){texture=gl.createTexture()!;this.textures.set(expression,texture);}gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  if(expression==='neutral'){try{const cache=document.createElement('canvas');cache.width=1024;cache.height=1536;const ctx=cache.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(image,0,0,1024,1536);const rgba=ctx.getImageData(0,0,1024,1536).data;this.alpha=new Uint8Array(1024*1536);for(let i=0;i<this.alpha.length;i++)this.alpha[i]=rgba[i*4+3];}catch{this.alpha=undefined;}this.ready=true;this.host.dataset.renderer='webgl';this.canvas.dataset.hitGeometry=this.alpha||this.live2d?.isReady()?'deformed-alpha':'rectangle-fallback';}
  this.renderOnce();this.updateLoop();
 }
 setState(expression:Expression,action:PetAction,revision:number,options:{visible:boolean;reducedMotion:boolean;quiet:boolean;intensity?:number}){
  this.intensity=Number.isFinite(options.intensity)?clamp(options.intensity!,0,1):1;
  this.forcedBlink=expression==='blink';const target=this.forcedBlink?this.expression:expression;if(target!==this.expression){this.previous=this.expression;this.expression=target;this.expressionAt=this.clock;}
  if(revision!==this.revision){this.revision=revision;this.action=action;this.actionAt=this.clock;}
  this.visible=options.visible;this.reduced=options.reducedMotion;this.quiet=options.quiet;this.renderOnce();this.updateLoop();
 }
 setRoamState(active:boolean,direction:-1|0|1){
  this.roamActive=active;this.roamDirection=direction;
  this.host.dataset.roaming=active?(direction<0?'left':'right'):'idle';
  if(active)this.updateLoop();
 }
 setVisible(visible:boolean){this.visible=visible;if(!visible){this.blinkAmount=0;this.mouthUntil=0;}this.updateLoop();}
 pointerAt(x:number,y:number){
  const rect=this.host.getBoundingClientRect(),scale=Math.min(rect.width/1024,rect.height/1536),left=rect.left+(rect.width-1024*scale)/2,top=rect.top+(rect.height-1536*scale)/2;
  if(!this.lastPointer||Math.hypot(x-this.lastPointer.x,y-this.lastPointer.y)>1){this.pointerMovedAt=this.clock;this.lastPointer={x,y};}
  this.pointer={x:clamp((x-left-501*scale)/(rect.width*.8)),y:clamp((y-top-145*scale)/(rect.height*.5))};
 }
 touch(x:number,y:number){this.pointerAt(x,y);this.touchAt=this.clock;this.head.vy-=.45;this.hair.vx+=this.pointer.x*.65;}
 dragDelta(dx:number,dy:number){this.inertia.vx-=clamp(dx,-30,30)*.085;this.inertia.vy-=clamp(dy,-30,30)*.05;this.head.vx-=clamp(dx,-30,30)*.035;}
 playText(text:string){if(!text.trim()){this.mouthUntil=0;return;}this.mouthStart=this.clock;this.mouthUntil=this.clock+clamp(text.length*.09,2.4,12);}
 private speechRevision=0;
 private fallbackAudio?:HTMLAudioElement;
 stopSpeech(){
  this.speechRevision++;
  try{this.audioSource?.stop();}catch{}
  this.audioSource=undefined;
  this.fallbackAudio?.pause();this.fallbackAudio=undefined;
  window.speechSynthesis?.cancel();
  this.audioUntil=0;this.audioEnvelope=undefined;this.mouthUntil=0;
 }
 async playAudio(audioBase64:string,mimeType='audio/wav',isCurrent:()=>boolean=()=>true){
  if(!audioBase64)return;
  if(!isCurrent())return;
  this.stopSpeech();
  const revision=this.speechRevision;
  const current=()=>revision===this.speechRevision&&isCurrent();
  try{
   const bin=atob(audioBase64);const bytes=new Uint8Array(bin.length);
   for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
   const AudioCtx=(window.AudioContext||(window as unknown as {webkitAudioContext?:typeof AudioContext}).webkitAudioContext);
   if(!AudioCtx)return;
   if(!this.audioCtx)this.audioCtx=new AudioCtx();
   if(this.audioCtx.state==='suspended')await this.audioCtx.resume();
   const decoded=await this.audioCtx.decodeAudioData(bytes.buffer.slice(0));
   if(!current())return;
   const ch=decoded.getChannelData(0),fps=60,totalFrames=Math.max(1,Math.ceil(decoded.duration*fps)),samplesPerFrame=Math.max(1,Math.floor(ch.length/totalFrames));
   const env=new Float32Array(totalFrames);
   for(let f=0;f<totalFrames;f++){
    let sum=0,count=0,start=f*samplesPerFrame,end=Math.min(ch.length,start+samplesPerFrame);
    for(let i=start;i<end;i++){const v=ch[i];sum+=v*v;count++;}
    env[f]=count?Math.min(1,Math.sqrt(sum/count)*3.4):0;
   }
   const src=this.audioCtx.createBufferSource();src.buffer=decoded;src.connect(this.audioCtx.destination);
   this.audioSource=src;this.audioEnvelope=env;this.audioStart=this.clock;this.audioUntil=this.clock+decoded.duration;
   this.mouthStart=this.clock;this.mouthUntil=Math.max(this.mouthUntil,this.audioUntil);
   src.onended=()=>{if(this.audioSource===src){this.audioUntil=0;this.audioEnvelope=undefined;}};
   src.start(0);
   this.updateLoop();
  }catch{
   if(!current())return;
   try{
    const audio=new Audio(`data:${mimeType};base64,${audioBase64}`);
    this.fallbackAudio=audio;
    void audio.play();
   }catch{}
  }
 }
 speakFallback(text:string,speed=1){
  if(!text.trim()||typeof window.speechSynthesis==='undefined')return;
  this.stopSpeech();
  const revision=this.speechRevision;
  try{
   window.speechSynthesis.cancel();
   const utter=new SpeechSynthesisUtterance(text);
   utter.lang='zh-CN';utter.rate=clamp(speed,.6,1.6);
   this.playText(text);
   utter.onend=()=>{if(revision===this.speechRevision)this.mouthUntil=0;};
   window.speechSynthesis.speak(utter);
  }catch{}
 }
 private stop(){if(this.frame)cancelAnimationFrame(this.frame);this.frame=0;this.lastFrame=0;this.canvas.dataset.motion='paused';}
 private updateLoop(){if(!this.gl||!this.ready||!this.visible||this.reduced||this.media.matches){this.stop();if(this.visible)this.renderOnce();return;}if(!this.frame)this.frame=requestAnimationFrame(this.tick);}
 private tick=(now:number)=>{this.frame=0;if(!this.visible||this.reduced||this.media.matches||!this.ready)return;if(this.lastFrame&&now-this.lastFrame<1000/60-.6){this.frame=requestAnimationFrame(this.tick);return;}const dt=this.lastFrame?Math.min(.05,(now-this.lastFrame)/1000):1/60;this.lastFrame=now;this.lastDt=dt;this.clock+=dt;this.advance(dt);this.draw();this.frame=requestAnimationFrame(this.tick);};
 private advance(dt:number){const t=this.clock,amount=this.quiet ? .62 : 1;
  if(t>this.nextGlance){this.glance={x:(Math.random()-.5)*.55,y:(Math.random()-.5)*.3};this.nextGlance=t+2.5+Math.random()*4.8;}
  const attention=1-smooth(1.4,4.6,t-this.pointerMovedAt),target={x:(this.pointer.x*.76*attention+this.glance.x*(1-attention))*amount,y:(this.pointer.y*.7*attention+this.glance.y*(1-attention))*amount};
  step(this.head,target,dt,46,11);step(this.body,{x:this.head.x*.32,y:this.head.y*.15},dt,22,8);step(this.hair,{x:this.head.x*.5+this.body.x*.7,y:this.head.y*.2},dt,12,5);step(this.inertia,{x:0,y:0},dt,22,8);
  const elapsed=t-this.actionAt,decay=Math.exp(-elapsed*1.2),touchElapsed=t-this.touchAt,touch=Math.sin(touchElapsed*10)*Math.exp(-touchElapsed*3);
  let actionAngle=0,bounce=0;
  const running=this.roamActive||(this.action==='run'&&elapsed<9);
  if(running){
   const dir=this.roamDirection||(Math.sin(t*.48)>=0?1:-1);
   const stride=t*11.5;
   bounce=-Math.abs(Math.sin(stride))*10.5;
   actionAngle=dir*.045+Math.sin(stride)*.032;
   this.body.vx+=(dir*.55+Math.cos(stride)*.35-this.body.x)*dt*14;
   this.hair.vx+=(-dir*.65+Math.sin(stride*2)*.5)*dt*16;
  }else{
   if(this.action==='nod')actionAngle=Math.sin(elapsed*10)*.042*decay;if(this.action==='peek')actionAngle=.038*Math.sin(elapsed*3)*decay;if(this.action==='sway'||this.action==='wave')actionAngle=Math.sin(elapsed*4)*.035*Math.exp(-elapsed*.65);if(this.action==='celebrate')bounce=-Math.abs(Math.sin(elapsed*9))*8*decay;if(this.action==='sulk')actionAngle=.04*Math.exp(-elapsed*.35);
  }
  actionAngle*=this.intensity;bounce*=this.intensity;
  this.pose={headX:this.head.x*12,headY:this.head.y*4,headAngle:clamp(this.head.x*.075+actionAngle+touch*.018,-.11,.11),bodyX:this.body.x*9,bodyY:bounce,hairX:this.hair.x*14,hairY:this.hair.y*5,inertiaX:clamp(this.inertia.x,-2,2)*12,inertiaY:clamp(this.inertia.y,-2,2)*8,breath:Math.sin(t*1.32)*amount,time:t,touch};
  if(t>=this.nextBlink){this.blinkStart=t;this.blinkDuration=.21+Math.random()*.06;this.nextBlink=t+3.2+Math.random()*5.3;}
  const blinkPhase=(t-this.blinkStart)/this.blinkDuration;this.blinkAmount=this.forcedBlink?1:blinkPhase>=0&&blinkPhase<1?Math.pow(Math.sin(blinkPhase*Math.PI),.75):0;
 }
 private warp(x:number,y:number):Point{const p=this.pose,head=1-smooth(225,325,y),neck=CHARACTER_ANCHORS.neck;const ca=Math.cos(p.headAngle),sa=Math.sin(p.headAngle),hx=x-neck.x,hy=y-neck.y;
  const torso=smooth(215,340,y)*(1-smooth(600,810,y)),outer=smooth(70,230,Math.abs(x-500)),hair=smooth(155,310,y)*(1-smooth(720,1000,y))*outer,cape=smooth(280,365,y)*(1-smooth(610,780,y))*outer,skirt=smooth(650,850,y)*(1-smooth(1370,1510,y))*outer;
  const pin=1-smooth(1250,1510,y);
  return{x:x+(ca*hx-sa*hy-hx+p.headX)*head+p.bodyX*torso+p.breath*(x-486)*.007*torso+(p.hairX+Math.sin(p.time*1.1+y*.011)*3)*hair+Math.sin(p.time*.86+y*.009)*3.2*skirt+p.inertiaX*pin,
   y:y+(sa*hx+ca*hy-hy+p.headY+p.breath*1.6)*head+p.breath*2.1*torso+p.bodyY*pin+(p.hairY+Math.sin(p.time*.95+y*.012)*1.7)*hair+p.breath*2.6*cape+p.inertiaY*pin};}
 hit(x:number,y:number):boolean|undefined{
  if(!this.ready||!this.gl)return undefined;const rect=this.host.getBoundingClientRect(),scale=Math.min(rect.width/1024,rect.height/1536),left=rect.left+(rect.width-1024*scale)/2,top=rect.top+(rect.height-1536*scale)/2;
  const target={x:(x-left)/scale,y:(y-top)/scale};let source={...target};for(let i=0;i<5;i++){const point=this.warp(source.x,source.y);source={x:source.x+target.x-point.x,y:source.y+target.y-point.y};}
  const px=Math.floor(source.x),py=Math.floor(source.y);if(px<0||py<0||px>=1024||py>=1536)return false;if(!this.alpha)return true;return this.alpha[py*1024+px]>=32;
 }
 private renderOnce(){if(!this.gl||!this.ready||!this.visible)return;if(this.reduced||this.media.matches)this.blinkAmount=this.forcedBlink?1:0;this.lastDt=0;this.draw();}
 private draw(){const gl=this.gl;if(!gl||!this.ready||!this.program)return;const rect=this.host.getBoundingClientRect();if(!rect.width||!rect.height)return;const dpr=Math.min(devicePixelRatio,1.75),width=Math.round(rect.width*dpr),height=Math.round(rect.height*dpr);if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}gl.viewport(0,0,width,height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
  const mix=this.reduced||this.media.matches?1:smooth(0,.3,this.clock-this.expressionAt);
  const talkTime=this.clock-this.mouthStart,talking=this.visible&&!this.reduced&&this.clock<this.mouthUntil;
  let mouth=talking?clamp((.45+Math.sin(talkTime*13)*.32+Math.sin(talkTime*21)*.23)*(1-smooth(this.mouthUntil-.45,this.mouthUntil,this.clock)),0,1):0;
  if(this.visible&&!this.reduced&&this.audioEnvelope&&this.clock<this.audioUntil){
   const idx=Math.min(this.audioEnvelope.length-1,Math.max(0,Math.floor((this.clock-this.audioStart)*60)));
   mouth=clamp(Math.max(mouth*.35,this.audioEnvelope[idx]),0,1);
  }
  const gazeX=this.head.x+Math.sin(this.clock*3.7)*.025,gazeY=this.head.y;
  if(this.live2d?.isReady()){
   this.live2d.render(width,height,{dt:this.lastDt,headX:this.pose.headX,headY:this.pose.headY,headAngle:this.pose.headAngle,bodyX:this.pose.bodyX,bodyY:this.pose.bodyY,breath:this.pose.breath,blinkAmount:this.blinkAmount,mouth,gazeX,gazeY,expression:this.expression,previous:this.previous,mix,intensity:this.intensity});
   this.canvas.dataset.live2d='true';
  }else{
   gl.useProgram(this.program);
   const scale=Math.min(rect.width/1024,rect.height/1536),left=(rect.width-1024*scale)/2,top=(rect.height-1536*scale)/2;
   for(let i=0;i<this.source.length/2;i++){const point=this.warp(this.source[i*2],this.source[i*2+1]);this.vertices[i*4]=left+point.x*scale;this.vertices[i*4+1]=top+point.y*scale;}
   gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer!);gl.bufferSubData(gl.ARRAY_BUFFER,0,this.vertices);
   const pos=gl.getAttribLocation(this.program,'aPosition'),uv=gl.getAttribLocation(this.program,'aUv');gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,16,0);gl.enableVertexAttribArray(uv);gl.vertexAttribPointer(uv,2,gl.FLOAT,false,16,8);
   gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.indices!);gl.uniform2f(this.uniforms.get('uViewport')!,rect.width,rect.height);
   const bind=(name:string,expression:Expression,unit:number)=>{gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,this.textures.get(expression)||this.textures.get('neutral')!);gl.uniform1i(this.uniforms.get(name)!,unit);};bind('uBase','neutral',0);bind('uPrevious',this.previous,1);bind('uCurrent',this.expression,2);bind('uBlink','blink',3);
   gl.uniform1f(this.uniforms.get('uMix')!,mix);gl.uniform1f(this.uniforms.get('uIntensity')!,this.intensity);gl.uniform1f(this.uniforms.get('uBlinkAmount')!,this.textures.has('blink')?this.blinkAmount:0);
   gl.uniform1f(this.uniforms.get('uMouth')!,mouth);gl.uniform2f(this.uniforms.get('uGaze')!,gazeX,gazeY);gl.drawElements(gl.TRIANGLES,this.indexData.length,gl.UNSIGNED_SHORT,0);
  }
  this.canvas.dataset.frameCount=String(++this.draws);this.canvas.dataset.blink=String(this.blinkAmount);this.canvas.dataset.mouth=String(mouth);this.canvas.dataset.head=String(this.pose.headAngle);this.canvas.dataset.hair=String(this.pose.hairX);this.canvas.dataset.motion=this.visible&&!this.reduced&&!this.media.matches?'continuous':'paused';
 }
 getDiagnostics(){return{renderer:this.gl?'webgl':'static-fallback',frameCount:this.draws,visible:this.visible,reducedMotion:this.reduced||this.media.matches,loopRunning:!!this.frame,intensity:this.intensity,roaming:this.roamActive,roamDirection:this.roamDirection,ttsActive:this.clock<this.audioUntil,headOffset:{x:this.pose.headX,y:this.pose.headY,angle:this.pose.headAngle},bodyOffset:{x:this.pose.bodyX,y:this.pose.bodyY},hairOffset:{x:this.pose.hairX,y:this.pose.hairY},blinkAmount:this.blinkAmount,mouthOpen:Number(this.canvas.dataset.mouth||0),mouthSource:'text-only',hitGeometry:this.alpha||this.live2d?.isReady()?'deformed-alpha':'rectangle-fallback',...this.live2d?.getDiagnostics()};}
 destroy(){this.stopSpeech();this.stop();try{this.audioSource?.stop();void this.audioCtx?.close();}catch{}this.resizeObserver.disconnect();this.live2d?.destroy();if(this.gl){for(const texture of this.textures.values())this.gl.deleteTexture(texture);if(this.buffer)this.gl.deleteBuffer(this.buffer);if(this.indices)this.gl.deleteBuffer(this.indices);if(this.program)this.gl.deleteProgram(this.program);}this.canvas.remove();}
}

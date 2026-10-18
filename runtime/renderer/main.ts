import type { AppSnapshot, AppCommand, Expression, GalAgentBridge } from '../shared/contracts';
import './style.css';
import { PetHitTest } from './pet-hit-test';
import { LivingCharacter } from './living-character';

const app = document.querySelector<HTMLDivElement>('#app')!;
const pet = new URLSearchParams(location.search).get('view') === 'pet';
const expressions: Expression[] = ['neutral','curious','pleased','flustered','annoyed','softened','blink'];
const asset = (expression: Expression) => new URL(`assets/character/${expression}.png`, document.baseURI).href;
const prism = '<svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M20 2 36 12v17L20 38 4 29V12Z" stroke="currentColor"/><path d="M13 11v18m0-8 13-10M13 21l13 8M20 2v36M4 12l32 17M36 12 4 29" stroke="currentColor" opacity=".65"/></svg>';
let snapshot: AppSnapshot;
let page = 'chat';
let lastMessages = '';
let lastContent = '';
let lastVisualRevision = -1;
let bubbleTimer: ReturnType<typeof setTimeout>;
let errorTimer: ReturnType<typeof setTimeout>;
let localBlink=false;
let living:LivingCharacter|undefined;
const petHitTest=new PetHitTest();
let refreshPointer=()=>{};
const preview = !window.galagent;
const previewSnapshot: AppSnapshot = {
 identity:{id:'preview',name:'她',onboarding:'intro',stage:'S0'},visual:{expression:'neutral',action:'idle',bubble:'',revision:0},messages:[],memories:[],diary:[],
 settings:{observationEnabled:false,windowTitlesEnabled:false,initiativeEnabled:true,mischiefEnabled:true,roamingEnabled:true,ttsEnabled:false,ttsBaseUrl:'',ttsModel:'tts-1',ttsVoice:'xiaoxiao',ttsSpeed:1,quietUntil:0,proactiveIntervalMinutes:20,proactiveHourlyLimit:2,proactiveDailyLimit:12,petScale:1,reducedMotion:false,screenCaptureEnabled:true,clipboardEnabled:true,captureBlocklist:[],forbiddenPaths:[]},
 provider:{configured:false,baseUrl:'https://api.moonshot.cn/v1',model:'kimi-k3'}, status:{busy:false,online:false,embedding:'idle',contextTokens:0,contextBudget:6000,tasks:[]},observation:{available:false,observedAt:''},stats:{conversations:0,memories:0,proactiveToday:0,tokensToday:0}
};
snapshot=previewSnapshot;
const bridge: GalAgentBridge = window.galagent || {getSnapshot:async()=>previewSnapshot,onSnapshot:()=>()=>{},dispatch:async()=>({ok:false,error:'浏览器外观预览未连接桌面运行时，不能调用真实模型或保存记忆。'})};
let nativeWindowVisible:boolean|undefined;
let visibilityRevision=0;
let lastSpokenRevision=-1;
const hasNativeVisibility=!!(bridge.getWindowVisibility||bridge.onWindowVisibility);
function windowCanAnimate(){return !document.hidden&&(hasNativeVisibility?nativeWindowVisible===true:true);}
function syncWindowVisibility(){
 document.body.classList.toggle('not-visible',!windowCanAnimate());
 living?.setVisible(windowCanAnimate());
 if(!windowCanAnimate()&&localBlink){localBlink=false;showExpression();}
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className='', text='') { const element=document.createElement(tag); element.className=className; element.textContent=text; return element; }
function toast(text:string) { const box=document.querySelector<HTMLElement>('#toast')!; box.textContent=text; box.classList.add('visible'); clearTimeout(errorTimer); errorTimer=setTimeout(()=>box.classList.remove('visible'),6500); }
async function command(value:AppCommand) { try { const result=await bridge.dispatch(value); if(!result.ok) toast(result.error || '这一步没有完成，请稍后重试。'); return result; } catch(error) { toast(error instanceof Error ? error.message : '桌面连接暂时中断。'); return {ok:false}; } }
async function speakText(text:string,notifyOnError=false){
 const clean=text.trim();if(!clean||typeof bridge.synthesizeSpeech!=='function')return;
 try{
  const res=await bridge.synthesizeSpeech(clean);
  if(!res.ok){if(notifyOnError)toast(res.error||'语音合成未完成。');return;}
  if(res.audioBase64){
   if(living)await living.playAudio(res.audioBase64,res.mimeType||'audio/wav');
   else{const audio=new Audio(`data:${res.mimeType||'audio/wav'};base64,${res.audioBase64}`);void audio.play();}
  }else if(res.provider==='web-speech'){
   if(living)living.speakFallback(clean,snapshot.settings.ttsSpeed||1);
   else if(typeof window.speechSynthesis!=='undefined'){window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(clean);u.lang='zh-CN';u.rate=snapshot.settings.ttsSpeed||1;window.speechSynthesis.speak(u);}
  }
 }catch(err){if(notifyOnError)toast(err instanceof Error?err.message:'语音合成暂时不可用。');}
}
function characterMarkup() { return `<div class="character" aria-label="人物立绘">${expressions.map(x=>`<img class="expression" data-expression="${x}" src="${asset(x)}" alt="" draggable="false">`).join('')}<span class="asset-loading">正在等待她的身影<span>✧</span></span></div>`; }
if(pet) {
 document.body.classList.add('pet-view');
 app.innerHTML=`<main class="pet-stage"><div id="bubble" class="pet-bubble" role="status"></div><form id="pet-input" class="pet-input" hidden><textarea id="pet-text" rows="2" maxlength="1200" aria-label="对她说" placeholder="轻轻说一句……"></textarea><div class="pet-input-actions"><button id="pet-input-close" type="button">收起</button><button type="submit">发送 ↗</button></div><p id="pet-input-note" class="pet-input-note" role="status"></p></form><button id="pet-body" class="pet-body" aria-label="拖动她；双击轻声说话">${characterMarkup()}<span class="pet-foot">✧</span></button><button class="pet-handle" aria-label="展开相处菜单">${prism}</button><div id="toast" role="alert"></div></main>`;
 const body=document.querySelector<HTMLElement>('#pet-body')!;
 let drag: {x:number;y:number; moved:boolean;pointer:number} | null=null;
 let latestPointer:{x:number;y:number}|null=null,frame=0,lastInteractive:boolean|undefined;
 const character=body.querySelector<HTMLElement>('.character')!;
 if(new URLSearchParams(location.search).get('living')!=='off')living=new LivingCharacter(character);
 bridge.onRoamState?.(state=>{living?.setRoamState(state.active,state.direction);});
 const characterHit=(x:number,y:number)=>living?.hit(x,y)??petHitTest.hit(character,x,y);
 const contains=(element:HTMLElement,x:number,y:number)=>{const rect=element.getBoundingClientRect();return x>=rect.left&&x<rect.right&&y>=rect.top&&y<rect.bottom;};
 const interactive=(x:number,y:number)=>{const bubble=document.querySelector<HTMLElement>('#bubble')!,handle=document.querySelector<HTMLElement>('.pet-handle')!,input=document.querySelector<HTMLElement>('#pet-input')!;return !!drag||contains(handle,x,y)||(!input.hidden&&contains(input,x,y))||(input.hidden&&bubble.classList.contains('visible')&&contains(bubble,x,y))||characterHit(x,y);};
 const nativeBridge=bridge as GalAgentBridge&{onHitTest?:(listener:(point:{x:number;y:number})=>boolean)=>()=>void};
 const nativeHitTest=!!nativeBridge.onHitTest;
 nativeBridge.onHitTest?.(point=>{latestPointer={x:point.x,y:point.y};living?.pointerAt(point.x,point.y);return interactive(point.x,point.y);});
 const setInteractive=(value:boolean)=>{if(value===lastInteractive)return;lastInteractive=value;void command({type:'shell.pointer',interactive:value});};
 refreshPointer=()=>{if(frame)return;frame=requestAnimationFrame(()=>{frame=0;setInteractive(!!drag||!!latestPointer&&interactive(latestPointer.x,latestPointer.y));});};
 app.addEventListener('pointermove',event=>{latestPointer={x:event.clientX,y:event.clientY};living?.pointerAt(event.clientX,event.clientY);refreshPointer();});
 // Electron's click-through forwarding guarantees mousemove; also handle
 // pointermove for normal/captured interaction without sending duplicate IPC.
 app.addEventListener('mousemove',event=>{latestPointer={x:event.clientX,y:event.clientY};living?.pointerAt(event.clientX,event.clientY);refreshPointer();});
 app.addEventListener('pointerover',event=>{latestPointer={x:event.clientX,y:event.clientY};refreshPointer();});
 body.addEventListener('pointerdown',event=>{if(event.button!==0||!characterHit(event.clientX,event.clientY))return;latestPointer={x:event.clientX,y:event.clientY};living?.touch(event.clientX,event.clientY);drag={x:event.screenX,y:event.screenY,moved:false,pointer:event.pointerId};body.setPointerCapture(event.pointerId);setInteractive(true);body.classList.add('held');});
 body.addEventListener('pointermove',event=>{if(!drag)return;const dx=event.screenX-drag.x,dy=event.screenY-drag.y;if(!drag.moved&&Math.hypot(dx,dy)<5)return;drag.moved=true;drag.x=event.screenX;drag.y=event.screenY;living?.dragDelta(dx,dy);void command({type:'shell.drag',dx,dy});});
 body.addEventListener('pointerup',event=>{if(!drag)return;void command({type:'pet.interact',interaction:drag.moved?'drag':'tap'});drag=null;latestPointer={x:event.clientX,y:event.clientY};body.classList.remove('held');refreshPointer();});
 body.addEventListener('pointercancel',()=>{drag=null;body.classList.remove('held');refreshPointer();});
 const input=document.querySelector<HTMLFormElement>('#pet-input')!,text=document.querySelector<HTMLTextAreaElement>('#pet-text')!,note=document.querySelector<HTMLElement>('#pet-input-note')!;let petComposing=false;
 const closeInput=async()=>{input.hidden=true;document.querySelector('.pet-stage')!.classList.remove('input-open');await command({type:'shell.input',open:false});refreshPointer();};
 const openInput=async()=>{input.hidden=false;document.querySelector('.pet-stage')!.classList.add('input-open');note.textContent=snapshot.provider.configured?'文字会发送到你配置的模型。':'尚未连接模型；可从菜单进入「连接」设置。';const result=await command({type:'shell.input',open:true});if(result.ok)text.focus();refreshPointer();};
 body.addEventListener('dblclick',event=>{if(characterHit(event.clientX,event.clientY))void openInput();});
 document.querySelector('#pet-input-close')!.addEventListener('click',()=>void closeInput());
 text.addEventListener('compositionstart',()=>petComposing=true);text.addEventListener('compositionend',()=>petComposing=false);
 text.addEventListener('keydown',event=>{if(event.isComposing||petComposing)return;if(event.key==='Escape'){event.preventDefault();void closeInput();}else if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();input.requestSubmit();}});
 input.onsubmit=async event=>{event.preventDefault();const value=text.value.trim();if(!value||snapshot.status.busy)return;if(!snapshot.provider.configured&&!value.startsWith('/任务 ')&&value!=='/取消任务'){note.textContent='尚未配置模型，文字已保留。请从菜单打开连接设置。';return;}note.textContent='正在等待她的回应……';const result=await command({type:'chat.send',text:value});if(result.ok){if(text.value.trim()===value)text.value='';await closeInput();}else note.textContent=result.error||'暂时没有完成，文字已保留。';};
 app.addEventListener('contextmenu',event=>{event.preventDefault();if(interactive(event.clientX,event.clientY))void command({type:'shell.menu'});});
 document.querySelector('.pet-handle')!.addEventListener('click',()=>void command({type:'shell.menu'}));
 app.addEventListener('pointerleave',()=>{if(nativeHitTest)return;latestPointer=null;if(!drag)setInteractive(false);});
} else {
 app.innerHTML=`<main class="notebook"><aside class="portrait-panel"><header class="brand"><span class="prism">${prism}</span><span>GALAGENT<small>一颗留在桌面的星</small></span><span class="edition">01</span></header><div class="portrait-stage"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><span class="star star-one">✧</span><span class="star star-two">✦</span><span class="portrait-coordinate">YOUR LITTLE CONSTELLATION</span>${characterMarkup()}<div class="portrait-caption"><span class="eyebrow">一 起 ， 慢 慢 来</span><h1 id="portrait-name">她</h1><p id="portrait-note">先认识一下，再把日子记下来。</p></div></div><footer class="portrait-footer"><span><i id="connection-dot"></i><span id="connection">等一个初次相遇</span></span><button id="pet-return" class="text-button">回到桌面 ↗</button></footer></aside><section class="workspace"><header class="workspace-head"><div><span class="eyebrow">STELLAR NOTEBOOK</span><h2 id="page-title">相处的片刻</h2></div><button id="quiet" class="quiet-button" title="安静 30 分钟">☾ <span>安静一会</span></button></header><nav aria-label="札记导航"><button data-page="chat" class="active">交流<span>01</span></button><button data-page="memory">记忆<span>02</span></button><button data-page="diary">札记<span>03</span></button><button data-page="settings">相处<span>04</span></button><button data-page="config" aria-label="模型配置">连接<span>05</span></button></nav><div id="preview-label" class="preview-label" ${preview?'':'hidden'}>外观预览 · 未连接真实模型 · 内容不会保存</div><div id="runtime-error" class="runtime-error" role="status" hidden></div><section id="chat-page" class="page chat-page"><div id="messages" class="messages" aria-live="polite"><div class="empty-chat"><span class="empty-star">✧</span><h3>故事从一句话开始</h3><p>可以告诉她怎么称呼你，<br>或者说一件想让她记住的小事。</p><span class="fine-line"></span></div></div><div id="thinking" class="thinking" hidden><span></span><span></span><span></span><small>她在整理思绪</small><button id="cancel" class="text-button">停一下</button></div><form id="composer" class="composer"><textarea id="input" placeholder="把今天的一小片，告诉她……" rows="2" maxlength="12000" aria-label="对她说"></textarea><div class="composer-foot"><span>Enter 发送 · Shift + Enter 换行</span><button type="submit" id="send">交给她 <span>↗</span></button></div></form></section><section id="content-page" class="page content-page" hidden></section><footer class="workspace-footer"><span id="footer-note">在这里，每一份记忆都有来处。</span><details class="runtime-details"><summary>运行概况</summary><div id="runtime-info"></div></details></footer></section><div id="toast" role="alert"></div></main>`;
 document.querySelectorAll<HTMLButtonElement>('[data-page]').forEach(button=>button.onclick=()=>{page=button.dataset.page!;document.querySelectorAll('[data-page]').forEach(x=>x.classList.toggle('active',(x as HTMLElement).dataset.page===page));document.querySelector('#chat-page')!.toggleAttribute('hidden',page!=='chat');document.querySelector('#content-page')!.toggleAttribute('hidden',page==='chat');document.querySelector('#page-title')!.textContent=({chat:'相处的片刻',memory:'她记得的事',diary:'星图札记',settings:'我们的节奏',config:'让声音抵达'} as Record<string,string>)[page];renderContent();});
 const input=document.querySelector<HTMLTextAreaElement>('#input')!;
 let composing=false;input.addEventListener('compositionstart',()=>composing=true);input.addEventListener('compositionend',()=>composing=false);
 input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&!composing){event.preventDefault();document.querySelector<HTMLFormElement>('#composer')!.requestSubmit();}});
 document.querySelector<HTMLFormElement>('#composer')!.onsubmit=async event=>{event.preventDefault();const text=input.value.trim();if(!text||snapshot.status.busy)return; input.value='';const result=await command({type:'chat.send',text});if(!result.ok&&input.value==='')input.value=text;};
 document.querySelector('#cancel')!.addEventListener('click',()=>void command({type:'chat.cancel'}));
 document.querySelector('#quiet')!.addEventListener('click',()=>void command({type:'settings.update',settings:{quietUntil:snapshot.settings.quietUntil>Date.now()?0:Date.now()+30*60*1000}}));
 document.querySelector('#pet-return')!.addEventListener('click',()=>void command({type:'shell.chat',open:false}));
}
function showExpression() {
 document.body.classList.toggle('blinking',localBlink||snapshot.visual.expression==='blink');
 const wanted=snapshot.visual.expression;
 const loaded=document.querySelector<HTMLImageElement>(`[data-expression="${wanted}"]`);
 const fallback=loaded?.naturalWidth?wanted:'neutral';
 const blinkLoaded=!!document.querySelector<HTMLImageElement>('[data-expression="blink"]')?.naturalWidth;
 document.querySelectorAll<HTMLElement>('.expression').forEach(img=>{const shown=img.dataset.expression==='neutral'||img.dataset.expression===fallback||(localBlink&&blinkLoaded&&img.dataset.expression==='blink');img.classList.toggle('shown',shown);img.style.opacity=shown?String(img.dataset.expression==='neutral'||img.dataset.expression==='blink'?1:Math.max(0,Math.min(1,snapshot.visual.intensity??1))):'0';});
}
for(const img of document.querySelectorAll<HTMLImageElement>('.expression')) {img.onload=()=>{living?.setImage(img.dataset.expression as Expression,img);if(img.dataset.expression==='neutral'){img.parentElement!.classList.add('asset-ready');if(pet){petHitTest.cache(img);document.querySelector<HTMLElement>('.pet-stage')!.dataset.hitTest=petHitTest.mode;refreshPointer();}}showExpression();};if(img.complete&&img.naturalWidth)img.onload?.(new Event('load'));}
function blinkLater() {setTimeout(()=>{if(windowCanAnimate()&&!snapshot.settings.reducedMotion&&!matchMedia('(prefers-reduced-motion: reduce)').matches){localBlink=true;showExpression();setTimeout(()=>{localBlink=false;showExpression();},155);}blinkLater();},6500+Math.random()*4000);}
if(!pet||!living)blinkLater();

function render(next:AppSnapshot) {
 const firstSnapshot=lastVisualRevision===-1;
 snapshot=next;document.body.classList.toggle('reduced-motion',next.settings.reducedMotion);document.body.classList.toggle('quiet-mode',next.settings.quietUntil>Date.now());
 const character=document.querySelector<HTMLElement>('.character')!;
 living?.setState(next.visual.expression,next.visual.action,next.visual.revision,{visible:windowCanAnimate(),reducedMotion:next.settings.reducedMotion,quiet:next.settings.quietUntil>Date.now(),intensity:next.visual.intensity});
 if(lastVisualRevision!==next.visual.revision){character.removeAttribute('data-action');void character.offsetWidth;character.dataset.action=next.visual.action;}
 // Native shell resizes the whole pet window; applying scale here too would double it.
 character.style.setProperty('--pet-scale','1');
 showExpression();
 if(pet) {
  if(lastVisualRevision!==next.visual.revision){
   const bubble=document.querySelector<HTMLElement>('#bubble')!;
   bubble.textContent=next.visual.bubble;
   bubble.classList.toggle('visible',!!next.visual.bubble);
   clearTimeout(bubbleTimer);
   living?.playText(next.visual.bubble);
   if(!firstSnapshot&&next.visual.bubble&&next.settings.ttsEnabled&&next.settings.quietUntil<=Date.now()&&lastSpokenRevision!==next.visual.revision){
    lastSpokenRevision=next.visual.revision;
    void speakText(next.visual.bubble);
   }
   if(next.visual.bubble){bubbleTimer=setTimeout(()=>{bubble.classList.remove('visible');living?.playText('');refreshPointer();},Math.min(22000,7000+next.visual.bubble.length*100));}
   lastVisualRevision=next.visual.revision;
   refreshPointer();
  }
  return;
 }
 lastVisualRevision=next.visual.revision;
 document.querySelector('#portrait-name')!.textContent=next.identity.name || '她';document.querySelector('#portrait-note')!.textContent=next.identity.onboarding==='ready'?'一点点熟悉，一点点把你放在心上。':'先认识一下，再把日子记下来。';
 document.querySelector('#connection')!.textContent=next.status.busy?'她在听，也在想':!next.provider.configured?'连接模型后，开始相遇':next.status.online?'在你身边':'暂时离线';document.querySelector('#connection-dot')!.classList.toggle('online',next.status.online);
 const error=document.querySelector<HTMLElement>('#runtime-error')!;error.textContent=next.status.error||(!next.provider.configured?'还没有连接模型。到「连接」填入你的 Kimi API 配置，即可开始真实对话。':'');error.hidden=!error.textContent;
 const quiet=document.querySelector('#quiet')!;quiet.classList.toggle('selected',next.settings.quietUntil>Date.now());quiet.querySelector('span')!.textContent=next.settings.quietUntil>Date.now()?'恢复主动':'安静一会';
 document.querySelector('#thinking')!.toggleAttribute('hidden',!next.status.busy);document.querySelector<HTMLButtonElement>('#send')!.disabled=next.status.busy;
 const signature=JSON.stringify(next.messages);if(signature!==lastMessages) {lastMessages=signature;renderMessages();}
 document.querySelector('#footer-note')!.textContent=`${next.stats.memories} 件记忆 · ${next.stats.conversations} 次相处`;
 document.querySelector('#runtime-info')!.textContent=`上下文 ${next.status.contextTokens} / ${next.status.contextBudget} tokens\n记忆检索：${({ready:'语义索引就绪',loading:'索引加载中',fallback:'关键词降级',idle:'尚未索引'})[next.status.embedding]}\n今日主动 ${next.stats.proactiveToday} 次 · 今日用量 ${next.stats.tokensToday} tokens\n${next.status.pool?`并发 ${next.status.pool.inflight}/${next.status.pool.effectiveLimit} · 排队 ${next.status.pool.queued} · 峰值 ${next.status.pool.peak}\n`:''}${next.status.attention?`注意力：${next.status.attention.paused?'暂停（'+(({quiet:'安静中','initiative-disabled':'主动互动已关','not-configured':'未连接模型',onboarding:'尚未认识',locked:'锁屏'} as Record<string,string>)[next.status.attention.paused]||next.status.attention.paused)+'）':next.status.attention.running?'判断中':'待命'} · 判断 ${next.status.attention.evaluations} 次 · 叫醒 ${next.status.attention.wakes} 次 · 关注 ${next.status.attention.activeWatches} 项${next.status.attention.lastReason?'\n上次：'+next.status.attention.lastReason:''}\n`:''}${next.status.journal?`日记：${next.status.journal.counter}/${next.status.journal.every} 次互动\n`:''}${next.status.tasks.filter(x=>x.state!=='done').map(x=>`${x.label} · ${x.state}${x.detail?' · '+x.detail:''}`).join('\n')||'没有待处理的后台工作'}`;
 // Configuration and settings forms retain their DOM while snapshots arrive, preserving typing and IME.
 const contentSignature=contentKey(next);
 const editingMemory=page==='memory'&&document.activeElement instanceof HTMLTextAreaElement&&document.querySelector('#content-page')!.contains(document.activeElement);
 if((page==='memory'||page==='diary')&&contentSignature!==lastContent&&!editingMemory){lastContent=contentSignature;renderContent();}
 if(page==='settings'&&contentSignature!==lastContent){lastContent=contentSignature;renderGoals();renderWatches();}
 if(page==='settings')document.querySelectorAll<HTMLInputElement>('[data-setting]').forEach(input=>{if(document.activeElement===input)return;const key=input.dataset.setting as keyof AppSnapshot['settings'];if(input.type==='checkbox')input.checked=!!next.settings[key];});
 const agentStatus=document.querySelector('#agent-status');if(agentStatus)agentStatus.textContent=next.agent?.busy?'后台执行中；聊天可继续。':next.agent?.lastResult?`${next.agent.lastResult.status==='done'?'执行回合结束':next.agent.lastResult.status==='cancelled'?'已取消':'执行未完成'} · ${next.agent.lastResult.toolCount} 次工具调用`:'工具执行器待命';
 renderAgentQuestions(next);
}
function renderAgentQuestions(next:AppSnapshot){
 if(pet)return;let host=document.querySelector<HTMLElement>('#agent-questions');if(!host){host=el('section','agent-questions');host.id='agent-questions';document.querySelector('.workspace')!.append(host);}const requests=next.agent?.questions||[],signature=JSON.stringify(requests.map(q=>q.id));if(host.dataset.signature===signature)return;host.dataset.signature=signature;host.replaceChildren();
 for(const request of requests){const form=el('form','agent-question-form');form.append(el('h3','','任务需要你的选择'));const fields:{question:string;choices:HTMLInputElement[];custom:HTMLInputElement}[]=[];
  for(const [index,question] of request.questions.entries()){const block=el('fieldset');block.append(el('legend','',question.question));const choices:HTMLInputElement[]=[];for(const option of question.options){const label=el('label','agent-choice'),input=el('input');input.type=question.multi_select?'checkbox':'radio';input.name=request.id+'-'+index;input.value=option.label;choices.push(input);label.append(input,el('span','',option.label+(option.description?' · '+option.description:'')));block.append(label);}const custom=el('input');custom.type='text';custom.placeholder='也可以输入自己的回答';custom.maxLength=3000;custom.setAttribute('aria-label','自定义回答：'+question.question);block.append(custom);fields.push({question:question.question,choices,custom});form.append(block);}
  const submit=el('button','primary-button','提交选择');submit.type='submit';form.append(submit,button('暂不回答',()=>void command({type:'agent.answer',id:request.id,answers:{}})));form.onsubmit=async event=>{event.preventDefault();const answers:Record<string,string>=Object.create(null);for(const field of fields){const answer=field.custom.value.trim()||field.choices.filter(c=>c.checked).map(c=>c.value).join(', ');if(answer)answers[field.question]=answer;}if(!Object.keys(answers).length){toast('请选择一项、填写回答，或点击暂不回答。');return;}await command({type:'agent.answer',id:request.id,answers});};host.append(form);
 }
}
function renderMessages() {
 const container=document.querySelector<HTMLElement>('#messages')!;if(!snapshot.messages.length){const empty=el('div','empty-chat');empty.append(el('span','empty-star','✧'),el('h3','','故事从一句话开始'),el('p','','可以告诉她怎么称呼你，\n或者说一件想让她记住的小事。'),el('span','fine-line'));container.replaceChildren(empty);return;}
 const nearBottom=container.scrollHeight-container.scrollTop-container.clientHeight<90;
 container.replaceChildren();for(const message of snapshot.messages){const row=el('article',`message ${message.role}`);const meta=el('div','message-meta',`${message.role==='user'?'你':snapshot.identity.name || '她'} · ${new Date(message.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}${message.source==='initiative'?' · 她先开口':''}`);row.append(meta,el('p','message-text',message.text));container.append(row);}if(nearBottom)container.scrollTop=container.scrollHeight;
}
function button(text:string,action:()=>void,className='small-button') {const b=el('button',className,text);b.type='button';b.onclick=action;return b;}
function contentKey(state:AppSnapshot){return JSON.stringify(page==='settings'?{page,goals:state.story?.goals,watches:state.watches,browser:state.browser}:page==='memory'?{page,items:state.memories}:page==='diary'?{page,items:state.diary}:{page});}
function renderGoals(){
 const block=document.querySelector<HTMLElement>('#shared-goals');if(!block)return;
 block.replaceChildren();const goals=snapshot.story?.goals;
 const row=(label:string,value:string)=>{const item=el('div','goal-row');item.append(el('span','goal-label',label+'：'),el('span','goal-value',value));block.append(item);};
 if(typeof goals?.position?.placed==='boolean')row('桌面位置',goals.position.placed?'已由你摆放':'等待你摆放');
 const entries=goals?.notebook?.entries;
 if(typeof entries==='number'&&Number.isSafeInteger(entries)&&entries>=0)row('星图札记',`${entries}篇`);
 if(snapshot.browser?.connected)row('浏览器感知',`已连接 · ${snapshot.browser.tabCount}个标签 · 历史${snapshot.browser.historyCount}条 · 收藏${snapshot.browser.bookmarkCount}条${snapshot.browser.pageContent?.readable?' · 当前页正文可用':''}`);
 block.hidden=!block.childElementCount;
}
function renderWatches(){
 const list=document.querySelector<HTMLElement>('#watch-items');if(!list)return;
 list.replaceChildren();const watches=snapshot.watches||[];
 if(!watches.length){list.append(el('p','form-note','当前没有正在留意的事项。'));return;}
 for(const item of watches){
  const row=el('div','watch-row');
  row.append(el('span','watch-text',item.title+(item.condition?`（条件：${item.condition}）`:'')),button('移除',()=>void command({type:'watch.dismiss',id:item.id})));
  list.append(row);
 }
}
function renderContent() {
 if(pet||page==='chat'||!snapshot)return;const content=document.querySelector<HTMLElement>('#content-page')!;content.replaceChildren();
 lastContent=contentKey(snapshot);
 if(page==='memory') {
 content.append(el('p','section-intro','真实的事、共同的经历、她的感受，分开保存。你可以随时纠正。'));
 const form=el('form','remember-form');const field=el('textarea');field.placeholder='有一件事，希望你记住……';field.setAttribute('aria-label','新增记忆');field.maxLength=1500;const save=el('button','small-button','记住这件事');form.append(field,save);form.onsubmit=async event=>{event.preventDefault();if(field.value.trim()){const result=await command({type:'memory.remember',text:field.value.trim()});if(result.ok)field.value='';}};content.append(form);
 const items=snapshot.memories.filter(x=>x.valid);if(!items.length)content.append(el('p','empty-state','还没有留下记忆。慢慢来，我们有时间。'));
 for(const item of items){const card=el('article','memory-card');card.append(el('span','memory-kind',({fact:'真实的事',episode:'共同经历',reflection:'她的感受'})[item.kind]),el('p','',item.text));const source=el('details','memory-source');source.append(el('summary','','查看来处'),el('p','',`来源 ${item.sourceId || '用户主动记录'} · ${new Date(item.createdAt).toLocaleString('zh-CN')}`));card.append(source);const actions=el('div','card-actions');actions.append(button('纠正',()=>{const editor=el('textarea','memory-editor');editor.value=item.text;editor.maxLength=1500;editor.setAttribute('aria-label','纠正记忆');const controls=el('div','card-actions');controls.append(button('保存纠正',async()=>{if(editor.value.trim())await command({type:'memory.correct',id:item.id,text:editor.value.trim()});}),button('取消',renderContent));card.replaceChildren(el('span','memory-kind','纠正这件事'),editor,controls);}),button('删除',()=>{const confirmation=el('div','delete-confirm','这条记忆、来源消息、同源其他记忆和相关札记将一起删除。');confirmation.append(button('确认删除',()=>void command({type:'memory.delete',id:item.id})),button('保留',renderContent));card.append(confirmation);}));card.append(actions);content.append(card);}
 } else if(page==='diary') {
 content.append(el('p','section-intro','她的感受与小念头。札记是相处的回声，不会自行变成事实。'));
 if(!snapshot.diary.length)content.append(el('div','empty-state','第一颗星还没有落在纸上。完成一次对话后，札记会慢慢长出来。'));
 for(const entry of [...snapshot.diary].reverse()){const card=el('article','diary-card');card.classList.toggle('journal',entry.kind==='journal');card.append(el('time','',new Date(entry.createdAt).toLocaleDateString('zh-CN',{month:'long',day:'numeric'})+(entry.kind==='journal'?' · 日记'+(entry.title?'《'+entry.title+'》':''):'')),el('p','',entry.text),el('small','',`引用 ${entry.sourceIds.length} 份真实相处记录`));content.append(card);}
 } else if(page==='settings') {
 content.append(el('p','section-intro','你决定她靠近的方式。安静、暂停观察，都不会影响你们的关系。'));
 const goals=el('section','shared-goals');goals.id='shared-goals';goals.setAttribute('aria-label','相处记录');content.append(goals);renderGoals();
 const watchSection=el('section','watch-section');watchSection.setAttribute('aria-label','关注事项');watchSection.append(el('strong','','她在留意的事项'));
 const watchList=el('div','watch-items');watchList.id='watch-items';watchSection.append(watchList);
 const watchForm=el('form','remember-form watch-form');const watchInput=el('input');watchInput.type='text';watchInput.placeholder='添加一件想让她帮你留意的事……';watchInput.maxLength=200;watchInput.setAttribute('aria-label','新增关注事项');const watchAdd=el('button','small-button','添加留意');watchAdd.type='submit';watchForm.append(watchInput,watchAdd);watchForm.onsubmit=async event=>{event.preventDefault();if(watchInput.value.trim()){const result=await command({type:'watch.add',title:watchInput.value.trim()});if(result.ok)watchInput.value='';}};watchSection.append(watchForm);content.append(watchSection);renderWatches();
 const switches:[keyof AppSnapshot['settings'],string,string][]=[['initiativeEnabled','让她主动开口','在有来由的时刻，轻轻发起一段相处。'],['mischiefEnabled','偶尔的小胡闹','只作用于她自己的表情与微动作。'],['roamingEnabled','让她在桌面自在小跑','允许她的 Live2D 身影在桌面左右来回轻快跑动；鼠标靠近或对话时会自动停下。'],['ttsEnabled','语音播报她的回应','她开口说话时自动调用 TTS 合成语音，并驱动 Live2D 实时口型同步。'],['observationEnabled','感知桌面节奏','读取前台应用、输入空闲与时间；不读取输入内容。'],['windowTitlesEnabled','允许读取窗口标题','标题可能包含私人信息，开启后可进入模型上下文。'],['screenCaptureEnabled','截屏观察','画面有变化时最多每分钟一张，只交给后台注意力判断；原图不落盘，只留文字摘要。空闲、锁屏、全屏和黑名单应用不截。'],['clipboardEnabled','剪贴板观察','只保留最近 50 条文字，密码管理器标记为敏感的内容会跳过。不读取按键内容。'],['reducedMotion','更安静的动效','减少呼吸、摇摆与过渡；系统减少动态也会生效。']];
 for(const [key,title,description] of switches){const label=el('label','setting-row');const text=el('span');text.append(el('strong','',title),el('small','',description));const input=el('input');input.type='checkbox';input.dataset.setting=key;input.checked=!!snapshot.settings[key];input.setAttribute('role','switch');input.onchange=()=>void command({type:'settings.update',settings:{[key]:input.checked}});label.append(text,input);content.append(label);}
 const blockLabel=el('label','setting-row blocklist-row');const blockText=el('span');blockText.append(el('strong','','截屏黑名单'),el('small','','这些应用或窗口标题在前台时不截屏，每行一个（如密码管理器、网银）。'));const blockArea=el('textarea');blockArea.rows=4;blockArea.value=snapshot.settings.captureBlocklist.join('\n');blockArea.setAttribute('aria-label','截屏黑名单');blockArea.onchange=()=>void command({type:'settings.update',settings:{captureBlocklist:blockArea.value.split('\n').map(x=>x.trim()).filter(Boolean).slice(0,80).map(x=>x.slice(0,80))}});blockLabel.append(blockText,blockArea);content.append(blockLabel);
 const forbiddenLabel=el('label','setting-row blocklist-row');const forbiddenText=el('span');forbiddenText.append(el('strong','','禁止访问的文件夹'),el('small','','默认全访问；填入的路径及子目录禁止任务工具读写或执行，每行一个。修改后会立即更新权限版本并停止进行中的任务。'));const forbiddenArea=el('textarea');forbiddenArea.rows=3;forbiddenArea.value=(snapshot.settings.forbiddenPaths||[]).join('\n');forbiddenArea.setAttribute('aria-label','禁止访问的文件夹');forbiddenArea.onchange=()=>void command({type:'settings.update',settings:{forbiddenPaths:forbiddenArea.value.split('\n').map(x=>x.trim()).filter(Boolean).slice(0,200).map(x=>x.slice(0,500))}});forbiddenLabel.append(forbiddenText,forbiddenArea);content.append(forbiddenLabel);
 const scale=el('label','setting-row');scale.append(el('strong','','桌面身影大小'));const range=el('input');range.type='range';range.min='0.65';range.max='1.25';range.step='0.05';range.value=String(snapshot.settings.petScale);range.setAttribute('aria-label','桌面身影大小');range.onchange=()=>void command({type:'settings.update',settings:{petScale:Number(range.value)}});scale.append(range);content.append(scale);
 const frequency=el('label','setting-row');frequency.append(el('strong','','主动互动最短间隔'));const select=el('select');for(const minute of [20,40,60]){const option=el('option','',`${minute} 分钟`);option.value=String(minute);select.append(option);}select.value=String(snapshot.settings.proactiveIntervalMinutes);select.onchange=()=>void command({type:'settings.update',settings:{proactiveIntervalMinutes:Number(select.value)}});frequency.append(select);content.append(frequency);
 const controls=el('div','archive-controls');controls.append(button('让她在桌面跑一圈',async()=>{const res=await command({type:'pet.roam',active:true});if(res.ok)toast('她正迈开步子在桌面上来回小跑呢。');}),button('导出相处存档',()=>void command({type:'app.export'})),button('恢复自己的存档',()=>void command({type:'app.import'})),button('把她移回屏幕',()=>void command({type:'shell.resetPosition'})));content.append(controls,el('p','form-note','恢复存档会由桌面运行时提示影响范围。请保存自己的导出文件。'));
 } else if(page==='config') {
 content.append(el('p','section-intro','支持「Mira 本地反代（平台 K3 适配）」与「官方 / 原生无工具 API（由 GalAgent 在本机直接绑定并提供 KimiCode 全部 25 个本地工具）」两种接入模式。'));
 const form=el('form','config-form');
 const modeLabel=el('label');modeLabel.append(el('span','','API 接入模式'));
 const modeSelect=el('select');modeSelect.name='mode';
 const optMira=el('option','','Mira 本地反代（适配平台 K3 + 本机 KimiCode 25 工具）');optMira.value='mira-proxy';
 const optNative=el('option','','官方 / 原生无工具 API（由 GalAgent 本地绑定并提供 KimiCode 25 工具）');optNative.value='native-api';
 modeSelect.append(optMira,optNative);
 const currentMode=snapshot.provider.mode||(/^https?:\/\/(127\.0\.0\.1|localhost):(18890|8787)\b/i.test(snapshot.provider.baseUrl)?'mira-proxy':'native-api');
 modeSelect.value=currentMode;
 modeLabel.append(modeSelect);form.append(modeLabel);
 const modeNote=el('p','form-note');
 const syncModeNote=()=>{
  if(modeSelect.value==='native-api'){
   modeNote.textContent='当前为「官方 / 原生无工具 API」模式：上游仅需提供纯模型接口（如 Moonshot 官方、Kimi Coding 官方或任意 OpenAI 兼容 API），GalAgent 会在本机类比 Kimi Code 为其绑定并提供全部 25 个本地工具（Read / Write / Edit / Glob / Grep / Bash / ReadMediaFile / AgentSwarm 等），不依赖本地 Mira 反代。';
  }else{
   modeNote.textContent='当前为「Mira 本地反代」模式：自动检测并拉起本机 Mira 反代服务（127.0.0.1:18890），启用平台 K3 思考链与多模态协议适配，并挂载本机 25 个 Kimi Code 工具。';
  }
 };
 syncModeNote();
 form.append(modeNote);
 const presetRow=el('div','archive-controls');
 const fields:Record<string,HTMLInputElement>={};
 presetRow.append(
  button('预设：Mira 本地反代',()=>{modeSelect.value='mira-proxy';fields.baseUrl.value='http://127.0.0.1:18890/v1';fields.model.value='kimi-code/k3';syncModeNote();}),
  button('预设：Moonshot 官方 API',()=>{modeSelect.value='native-api';fields.baseUrl.value='https://api.moonshot.cn/v1';fields.model.value='kimi-k2.5';syncModeNote();}),
  button('预设：Kimi Coding 官方',()=>{modeSelect.value='native-api';fields.baseUrl.value='https://api.kimi.com/coding/v1';fields.model.value='kimi-for-coding';syncModeNote();})
 );
 form.append(presetRow);
 modeSelect.onchange=()=>{
  if(modeSelect.value==='mira-proxy'&&fields.baseUrl.value.includes('moonshot.cn')){fields.baseUrl.value='http://127.0.0.1:18890/v1';fields.model.value='kimi-code/k3';}
  else if(modeSelect.value==='native-api'&&fields.baseUrl.value.includes('127.0.0.1:18890')){fields.baseUrl.value='https://api.moonshot.cn/v1';fields.model.value='kimi-k2.5';}
  syncModeNote();
 };
 for(const [key,title,value] of [['baseUrl','API 地址',snapshot.provider.baseUrl],['model','模型',snapshot.provider.model],['apiKey','API Key','']]){const label=el('label');label.append(el('span','',title));const input=el('input');input.type=key==='apiKey'?'password':'text';input.value=value;input.name=key;input.autocomplete='off';input.spellcheck=false;input.required=key!=='apiKey';input.placeholder=key==='apiKey'?(snapshot.provider.configured?'已安全保存；留空保留原密钥':'填入你的 API Key（Mira 本地反代可自动读取本地密钥）'):'';label.append(input);fields[key]=input;form.append(label);}const save=el('button','primary-button','保存连接');form.append(save,el('p','form-note','密钥只交给桌面进程通过 Windows DPAPI 保存，不会写入浏览器存储或显示在相处记录中。'));form.onsubmit=async event=>{event.preventDefault();const key=fields.apiKey.value;fields.apiKey.value='';const result=await command({type:'config.save',baseUrl:fields.baseUrl.value.trim(),model:fields.model.value.trim(),mode:modeSelect.value as 'mira-proxy'|'native-api',...(key?{apiKey:key}:{})});if(result.ok)toast('连接配置已保存。现在可以回到交流，向她打个招呼。');};content.append(form);
 const ttsForm=el('form','config-form');ttsForm.append(el('h3','','语音合成 (TTS) 接口 · 小米 MiMo-V2.5-TTS 导演模式'),el('p','form-note','已原生适配小米官方 MiMo-V2.5-TTS（https://api.xiaomimimo.com/v1，自动按可黎人设与当前表情注入导演级语气指导；可选中文女声「冰糖」「茉莉」），同时兼容 OpenAI /v1/audio/speech 及 Windows 离线语音。'));
 const ttsEnableLabel=el('label','setting-row');const ttsEnableText=el('span');ttsEnableText.append(el('strong','','启用 TTS 语音播报'),el('small','','开启后，她的气泡与回复将自动转为语音并驱动 Live2D 口型。'));const ttsEnableInput=el('input');ttsEnableInput.type='checkbox';ttsEnableInput.checked=!!snapshot.settings.ttsEnabled;ttsEnableInput.setAttribute('role','switch');ttsEnableLabel.append(ttsEnableText,ttsEnableInput);ttsForm.append(ttsEnableLabel);
 const ttsFields:Record<string,HTMLInputElement>={};
 for(const [key,title,val,placeholder] of [['baseUrl','TTS API 地址',snapshot.settings.ttsBaseUrl||'https://api.xiaomimimo.com/v1','小米官方 https://api.xiaomimimo.com/v1 或本地 TTS 地址'],['model','TTS 模型',snapshot.settings.ttsModel||'mimo-v2.5-tts','mimo-v2.5-tts / mimo-v2.5-tts-voicedesign / tts-1'],['voice','音色 (Voice)',snapshot.settings.ttsVoice||'冰糖','小米女声推荐：冰糖（清甜少女）/ 茉莉（温柔甜润）/ mimo_default'],['speed','语速 (0.5 - 2.0)',String(snapshot.settings.ttsSpeed||1),'1.0'],['apiKey','TTS API Key（可选）','','已安全加密保存；留空可保留原密钥']]){
  const label=el('label');label.append(el('span','',title));const input=el('input');input.type=key==='apiKey'?'password':'text';input.value=val;input.name='tts_'+key;input.placeholder=placeholder;input.autocomplete='off';input.spellcheck=false;label.append(input);ttsFields[key]=input;ttsForm.append(label);
 }
 const ttsSave=el('button','primary-button','保存语音配置');ttsSave.type='submit';
 const ttsTest=button('试听她的声音',async()=>{
  const result=await command({type:'tts.speak',text:'哼，这首刚练好的曲子，我只弹给你一个人听哦。'});
  if(result.ok&&result.data){
   const d=result.data as {audioBase64?:string;mimeType?:string;provider?:string};
   if(d.audioBase64){const audio=new Audio(`data:${d.mimeType||'audio/wav'};base64,${d.audioBase64}`);void audio.play();}
   else if(d.provider==='web-speech'){void speakText('哼，这首刚练好的曲子，我只弹给你一个人听哦。',true);}
   toast('正在播放可黎的试听语音……');
  }
 });
 ttsForm.append(ttsSave,ttsTest);
 ttsForm.onsubmit=async event=>{
  event.preventDefault();
  const key=ttsFields.apiKey.value.trim();ttsFields.apiKey.value='';
  const speedNum=Number(ttsFields.speed.value);
  const result=await command({
   type:'tts.configure',
   ttsEnabled:ttsEnableInput.checked,
   ttsBaseUrl:ttsFields.baseUrl.value.trim(),
   ttsModel:ttsFields.model.value.trim()||'mimo-v2.5-tts',
   ttsVoice:ttsFields.voice.value.trim()||'冰糖',
   ttsSpeed:Number.isFinite(speedNum)?Math.max(0.5,Math.min(2,speedNum)):1,
   ...(key?{ttsApiKey:key}:{}),
  });
  if(result.ok)toast('TTS 语音配置已保存。');
 };
 content.append(ttsForm);
 const guardNote=snapshot.agent?.mode==='directory-guarded'?`已启用目录保护（禁止访问 ${snapshot.agent.forbiddenPaths?.length||0} 个文件夹 · 权限版本 v${snapshot.agent.policyVersion||1}）。`:'默认完整访问（可在「相处」中添加禁止访问的文件夹）。';
 const agentForm=el('form','config-form');agentForm.append(el('h3','','执行任务 · 本机 KimiCode 25 工具宿主'),el('p','form-note',`当前模式：${currentMode==='native-api'?'官方 / 原生 API（已在本机绑定 KimiCode 25 工具）':'Mira 本地反代（K3 适配 + 本机 KimiCode 25 工具）'}。${guardNote}`));
 const directoryLabel=el('label');directoryLabel.append(el('span','','任务工作目录'));const directory=el('input');directory.value=snapshot.agent?.cwd||'';directory.name='agentDirectory';directory.required=true;directoryLabel.append(directory);agentForm.append(directoryLabel,button('保存工作目录',async()=>{const result=await command({type:'agent.configure',cwd:directory.value.trim()});if(result.ok)toast('任务工作目录已保存。');}));
 const taskLabel=el('label');taskLabel.append(el('span','','要她完成的任务'));const task=el('textarea');task.name='agentTask';task.maxLength=12000;task.required=true;task.rows=3;taskLabel.append(task);agentForm.append(taskLabel);const run=el('button','primary-button','开始执行');run.type='submit';agentForm.append(run,button('取消执行',()=>void command({type:'agent.cancel'})));const status=el('p','form-note');status.id='agent-status';status.textContent=snapshot.agent?.busy?'后台执行中':'工具执行器待命';agentForm.append(status);agentForm.onsubmit=async event=>{event.preventDefault();const result=await command({type:'agent.run',task:task.value.trim()});if(result.ok)toast('任务已交给后台执行代理，结果会回到交流记录。');};content.append(agentForm);
 const creditsCard=el('section','config-form');creditsCard.append(el('h3','','致谢名单 (Acknowledgments)'),el('p','form-note','特别鸣谢：Gemini4argon · opus5.5 · gpt-Astra'));content.append(creditsCard);
 }
}
document.addEventListener('visibilitychange',syncWindowVisibility);
bridge.onWindowVisibility?.(visible=>{if(typeof visible!=='boolean')return;visibilityRevision++;nativeWindowVisible=visible;syncWindowVisibility();});
const initialVisibilityRevision=visibilityRevision;
syncWindowVisibility();
bridge.getWindowVisibility?.().then(visible=>{if(visibilityRevision!==initialVisibilityRevision||typeof visible!=='boolean')return;nativeWindowVisible=visible;syncWindowVisibility();}).catch(()=>{if(visibilityRevision===initialVisibilityRevision&&nativeWindowVisible===undefined){nativeWindowVisible=true;syncWindowVisibility();}});
bridge.onSnapshot(render);
bridge.getSnapshot().then(render).catch(error=>toast(String(error)));

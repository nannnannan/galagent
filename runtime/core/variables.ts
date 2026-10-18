import {createHash} from 'node:crypto';
import type {AppSnapshot, Expression, Message, PersonaFace, PersonaStage, PersonaVariables, PetAction, StorySnapshot} from '../shared/contracts';
import {Store} from './store';
import {personaTraits,personaHobbies} from './persona';

type Identity = AppSnapshot['identity'];
type PracticeKind = 'conversation' | 'expression' | 'repair' | 'play' | 'placement';
type Practice = {id: string; kind: PracticeKind; sourceIds: string[]; createdAt: string};
export type VariableArchive = {
  version: 1; identityId: string;
  baseline: {proficiency: number; stage: PersonaStage; migrated: boolean};
  events: Practice[];
  retired: {day:string;kind:PracticeKind;points:number}[];
  transient: {face: PersonaFace; expression: Expression; action: PetAction; intensity: number; startedAt: number; expiresAt: number};
};
const stages: PersonaStage[] = ['adapting','awkward','tsundere','settled'];
const kinds: PracticeKind[] = ['conversation','expression','repair','play','placement'];
const weights: Record<PracticeKind,number> = {conversation:2,expression:3,repair:2,play:2,placement:1};
const caps: Record<PracticeKind,number> = {conversation:4,expression:3,repair:2,play:2,placement:1};
const expressions: Expression[] = ['neutral','curious','pleased','flustered','annoyed','softened','blink'];
const actions: PetAction[] = ['idle','nod','sway','peek','sulk','celebrate','wave','sparkle','doodle','run'];
const day = (time:number) => new Date(time).toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});
const eventId = (kind: PracticeKind, ids: string[]) => createHash('sha256').update(JSON.stringify([kind,ids])).digest('hex');
const rank = (stage: PersonaStage) => stages.indexOf(stage);
const maxStage = (a: PersonaStage,b: PersonaStage) => stages[Math.max(rank(a),rank(b))];
const clamp = (n:unknown) => typeof n==='number'&&Number.isFinite(n)?Math.min(100,Math.max(0,n)):0;

// Classification is a bounded presentation hint, never a statement about user feelings.
export function classifyInteraction(text:string): {face:PersonaFace; kind?:PracticeKind} {
  if (/(误会|不同意|说错|弄错|不对|纠正|分歧)/u.test(text)) return {face:'disagreement',kind:'repair'};
  if (/(代码|coding|debug|编译|报错|修复|实现|函数|测试|bug)/iu.test(text)) return {face:'work'};
  if (/(你.{0,8}(感觉|感受|喜欢|表情|心情|情绪|害羞|身体)|你怎么想|你在想什么)/u.test(text)) return {face:'daily',kind:'expression'};
  if (/(开玩笑|逗你|玩笑|闹着玩)/u.test(text)) return {face:'daily',kind:'play'};
  return {face:'daily'};
}

export class CharacterVariables {
  constructor(private store:Store,private clock=()=>Date.now()){}
  private key(identity:Identity) {return 'persona-variables:'+identity.id;}
  initialize(identity:Identity,legacy:boolean) {
    const saved=this.store.get<VariableArchive>(this.key(identity));
    if(saved) {this.validate(saved,identity.id,id=>this.store.get<Message>(id),id=>this.store.kind(id));return;}
    const stage:PersonaStage=legacy?({S0:'adapting',S2:'awkward',S3:'tsundere',S4:'settled'} as const)[identity.stage]:'adapting';
    this.store.put('state',this.key(identity),{version:1,identityId:identity.id,baseline:{proficiency:({adapting:0,awkward:20,tsundere:50,settled:80})[stage],stage,migrated:legacy},events:[],retired:[],transient:{face:'daily',expression:'neutral',action:'idle',intensity:0.2,startedAt:0,expiresAt:0}} satisfies VariableArchive);
  }
  private state(identity:Identity):VariableArchive {
    const state=this.store.get<VariableArchive>(this.key(identity));
    if(!state)throw new Error('人物变量尚未初始化');
    return state;
  }
  private save(identity:Identity,state:VariableArchive) {this.store.put('state',this.key(identity),state);}
  private progress(state:VariableArchive) {
    const totals=new Map<string,{total:number;byKind:Partial<Record<PracticeKind,number>>}>();
    let proficiency=state.baseline.proficiency;
    const credits=new Map<string,number>();
    for(const credit of state.retired){const budget=totals.get(credit.day)||{total:0,byKind:{}};budget.total+=credit.points;budget.byKind[credit.kind]=(budget.byKind[credit.kind]||0)+credit.points;totals.set(credit.day,budget);proficiency+=credit.points;}
    for(const event of [...state.events].sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)||kinds.indexOf(a.kind)-kinds.indexOf(b.kind)||a.id.localeCompare(b.id))) {
      const date=day(Date.parse(event.createdAt)),budget=totals.get(date)||{total:0,byKind:{}};
      const delta=Math.max(0,Math.min(weights[event.kind],caps[event.kind]-(budget.byKind[event.kind]||0),6-budget.total));
      budget.byKind[event.kind]=(budget.byKind[event.kind]||0)+delta;budget.total+=delta;totals.set(date,budget);proficiency+=delta;credits.set(event.id,delta);
    }
    return {proficiency:Math.min(100,proficiency),practiceDays:totals.size,eventKinds:[...new Set([...state.events.map(e=>e.kind),...state.retired.map(e=>e.kind)])].sort(),credits};
  }
  private relationship():PersonaVariables['relationship'] {
    const raw=this.store.get<Partial<PersonaVariables['relationship']>>('relationship')||{};
    return {trust:clamp(raw.trust),familiarity:clamp(raw.familiarity),self_awareness:clamp(raw.self_awareness),exposure:clamp(raw.exposure)};
  }
  // Legacy fields are retained for archive compatibility, never used to select personality.
  syncStage(identity:Identity) { this.state(identity); }
  private add(identity:Identity,kind:PracticeKind,sourceIds:string[],createdAt:string) {
    const state=this.state(identity),id=eventId(kind,sourceIds);
    if(state.events.some(e=>e.id===id))return;
    // Store only credited event categories per day, keeping repeated clicks/chats bounded.
    const used=state.events.filter(e=>e.kind===kind&&day(Date.parse(e.createdAt))===day(Date.parse(createdAt))).length+Math.ceil((state.retired.find(c=>c.day===day(Date.parse(createdAt))&&c.kind===kind)?.points||0)/weights[kind]);
    if(used>=Math.ceil(caps[kind]/weights[kind]))return;
    state.events.push({id,kind,sourceIds,createdAt});this.save(identity,state);
  }
  chat(identity:Identity,user:Message,assistant:Message) {
    if(this.store.kind(user.id)!=='message'||this.store.kind(assistant.id)!=='message'||user.role!=='user'||assistant.role!=='assistant'||user.source!=='chat'||assistant.source!=='chat'||user.createdAt!==assistant.createdAt)throw new Error('人物成长缺少完成的对话来源');
    this.add(identity,'conversation',[user.id,assistant.id],assistant.createdAt);
    const candidate=classifyInteraction(user.text);if(candidate.kind)this.add(identity,candidate.kind,[user.id,assistant.id],assistant.createdAt);
    this.syncStage(identity);
  }
  placement(identity:Identity,sourceId:string) {
    const source=this.store.get<{kind:string;createdAt:string}>(sourceId);
    if(this.store.kind(sourceId)!=='story-source'||source?.kind!=='drag'||this.store.dead(sourceId))throw new Error('人物成长缺少真实拖动来源');
    this.add(identity,'placement',[sourceId],source.createdAt);this.syncStage(identity);
  }
  present(identity:Identity,face:PersonaFace,expression:Expression,action:PetAction,quiet:boolean,mischief:boolean) {
    if(face==='work'||quiet||(!mischief&&['sulk','doodle'].includes(action)))action='idle';
    const intensity=face==='work'?0.2:0.85;
    const applied=quiet?Math.min(0.2,intensity):intensity;
    const state=this.state(identity),now=this.clock();state.transient={face,expression,action,intensity:applied,startedAt:now,expiresAt:now+120000};this.save(identity,state);
    return {expression,action,intensity:applied};
  }
  clearPresentation(identity:Identity) {const state=this.state(identity);state.transient={face:'daily',expression:'neutral',action:'idle',intensity:0.2,startedAt:0,expiresAt:0};this.save(identity,state);}
  snapshot(identity:Identity,mood:StorySnapshot['mood']):PersonaVariables {
    const state=this.state(identity),{credits:_credits,...progress}=this.progress(state),now=this.clock(),active=now>=state.transient.startedAt&&now<state.transient.expiresAt;
    const last=this.store.all<Message>('message').filter(m=>m.role==='assistant'&&m.source==='chat'&&!this.store.dead(m.id)).at(-1)?.createdAt;
    const face=active?state.transient.face:'daily';
    return {version:1,core:{traits:personaTraits,hobbies:personaHobbies,motifs:['星空','棱镜虹彩','K标记']},expression:{...progress,stage:'unified',migrated:state.baseline.migrated},relationship:this.relationship(),emotion:mood,scene:{face,expiresAt:active?state.transient.expiresAt:0},presentation:{expression:active?state.transient.expression:'neutral',action:active?state.transient.action:'idle',intensity:active?state.transient.intensity:0.2,expiresAt:active?state.transient.expiresAt:0},time:{now:new Date(now).toISOString(),lastInteractionAt:last,elapsedSeconds:last?Math.max(0,(now-Date.parse(last))/1000):0,rate:1}};
  }
  context(identity:Identity,mood:StorySnapshot['mood'],face:PersonaFace) {
    const v=this.snapshot(identity,mood);
    return {core:v.core,personality:'unified',relationship:v.relationship.familiarity<5?'初识':v.relationship.familiarity<15?'逐渐熟悉':'熟悉相处',emotion:v.emotion,face,time:v.time,numericUpdatesAllowed:false};
  }

  reconcile(identity:Identity) {
    const state=this.state(identity),dead=state.events.filter(e=>e.sourceIds.some(id=>this.store.dead(id)||!this.store.kind(id))||(e.kind!=='placement'&&e.kind!=='conversation'&&classifyInteraction(this.store.get<Message>(e.sourceIds[0])?.text||'').kind!==e.kind));
    if(!dead.length)return;
    const before=this.progress(state);
    for(const event of dead){const date=day(Date.parse(event.createdAt));let credit=state.retired.find(c=>c.day===date&&c.kind===event.kind);if(!credit){credit={day:date,kind:event.kind,points:0};state.retired.push(credit);}credit.points+=before.credits.get(event.id)||0;}
    state.events=state.events.filter(e=>!dead.includes(e));
    this.save(identity,state);
  }
  export(identity:Identity) {this.reconcile(identity);return this.state(identity);}
  validate(value:unknown,identityId:string,message:(id:string)=>Message|undefined,kind:(id:string)=>string|undefined):VariableArchive {
    const a=value as VariableArchive;
    const finite=(n:unknown)=>typeof n==='number'&&Number.isFinite(n);
    if(!a||a.version!==1||a.identityId!==identityId||!a.baseline||!stages.includes(a.baseline.stage)||!finite(a.baseline.proficiency)||a.baseline.proficiency<0||a.baseline.proficiency>100||typeof a.baseline.migrated!=='boolean'||!Array.isArray(a.events)||a.events.length>20000||!Array.isArray(a.retired)||a.retired.length>20000||!a.transient)throw new Error('人物变量存档格式无效');
    const retiredKeys=new Set<string>(),retiredDays=new Map<string,number>();
    for(const credit of a.retired){if(!credit||typeof credit.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(credit.day)||!Number.isFinite(Date.parse(credit.day))||!kinds.includes(credit.kind)||!finite(credit.points)||credit.points<0||credit.points>caps[credit.kind]||retiredKeys.has(credit.day+credit.kind))throw new Error('人物匿名成长记录无效');retiredKeys.add(credit.day+credit.kind);retiredDays.set(credit.day,(retiredDays.get(credit.day)||0)+credit.points);if(retiredDays.get(credit.day)!>6)throw new Error('人物日成长上限无效');}
    const t=a.transient;
    if(!['daily','work','disagreement'].includes(t.face)||!expressions.includes(t.expression)||!actions.includes(t.action)||!finite(t.intensity)||t.intensity<0||t.intensity>1||!finite(t.startedAt)||!finite(t.expiresAt)||t.startedAt<0||t.expiresAt<t.startedAt||t.expiresAt>8640000000000000||t.expiresAt-t.startedAt>120000)throw new Error('人物临时状态无效');
    const ids=new Set<string>();
    for(const e of a.events) {
      if(!e||!kinds.includes(e.kind)||!Array.isArray(e.sourceIds)||e.sourceIds.some(id=>typeof id!=='string')||e.id!==eventId(e.kind,e.sourceIds)||ids.has(e.id)||typeof e.createdAt!=='string'||!Number.isFinite(Date.parse(e.createdAt)))throw new Error('人物成长事件无效');ids.add(e.id);
      if(e.kind==='placement') {if(e.sourceIds.length!==1||kind(e.sourceIds[0])!=='story-source')throw new Error('人物拖动来源无效');}
      else {
        const [u,r]=e.sourceIds.map(message);
        if(e.sourceIds.length!==2||kind(e.sourceIds[0])!=='message'||kind(e.sourceIds[1])!=='message'||!u||!r||u.role!=='user'||r.role!=='assistant'||u.source!=='chat'||r.source!=='chat'||u.createdAt!==r.createdAt||r.createdAt!==e.createdAt||(e.kind!=='conversation'&&classifyInteraction(u.text).kind!==e.kind))throw new Error('人物成长没有匹配的完成对话');
      }
    }
    return structuredClone(a);
  }
  import(identity:Identity,archive?:VariableArchive) {
    if(!this.store.get(this.key(identity)))this.initialize(identity,!archive);
    if(!archive){const existing=this.state(identity),legacyStage=({S0:'adapting',S2:'awkward',S3:'tsundere',S4:'settled'} as const)[identity.stage];existing.baseline.stage=maxStage(existing.baseline.stage,legacyStage);existing.baseline.proficiency=Math.max(existing.baseline.proficiency,({adapting:0,awkward:20,tsundere:50,settled:80})[legacyStage]);existing.baseline.migrated=true;this.save(identity,existing);this.reconcile(identity);this.syncStage(identity);return;}
    const state=this.state(identity);state.baseline.proficiency=Math.max(state.baseline.proficiency,archive.baseline.proficiency);state.baseline.stage=maxStage(state.baseline.stage,archive.baseline.stage);state.baseline.migrated ||= archive.baseline.migrated;
    for(const credit of archive.retired){const local=state.retired.find(c=>c.day===credit.day&&c.kind===credit.kind);if(local)local.points=Math.max(local.points,credit.points);else state.retired.push({...credit});}
    // Independent device histories share a daily budget; merge never adds more than six anonymous points.
    for(const date of new Set(state.retired.map(c=>c.day))){let remaining=6;for(const credit of state.retired.filter(c=>c.day===date).sort((a,b)=>kinds.indexOf(a.kind)-kinds.indexOf(b.kind))){credit.points=Math.min(credit.points,remaining);remaining-=credit.points;}}
    for(const event of archive.events)if(!state.events.some(e=>e.id===event.id)&&event.sourceIds.every(id=>!this.store.dead(id)&&!!this.store.kind(id)))state.events.push(event);
    if(archive.transient.startedAt>state.transient.startedAt)state.transient=archive.transient;
    this.save(identity,state);this.reconcile(identity);this.syncStage(identity);
  }
}

import {createHash,randomUUID} from 'node:crypto';
import type {Expression,MemoryItem,Message,DiaryEntry,StoryScene,StoryEpisode,StorySnapshot} from '../shared/contracts';
import {Store} from './store';
const day=(now:number)=>new Date(now).toLocaleDateString('en-CA');
const iso=(now:number)=>new Date(now).toISOString();
const uuid=(seed:string)=>{const h=createHash('sha256').update(seed).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;};
const axes=['trust','familiarity','self_awareness','exposure'] as const;
type Axes=Record<typeof axes[number],number>;
type Grant={key:string;kind:StoryScene['type'];createdAt:string};
type Source={id:string;kind:'drag'|'tap'|'observation'|'control';createdAt:string;data:Record<string,unknown>};
type State={lastDragAttempt:number;lastJealousDay:string;reunions:string[];mood:{expression:Expression;initial:number;startedAt:number;expiresAt:number}};
export type StoryArchive={sources:Source[];episodes:StoryEpisode[];state:State;grants:Grant[];baseline?:Axes};
const weights:Record<StoryScene['type'],Axes>={E01:{trust:2,familiarity:1,self_awareness:2,exposure:1},E02:{trust:0,familiarity:1,self_awareness:1,exposure:1},E03:{trust:1,familiarity:1,self_awareness:0,exposure:0},E04:{trust:1,familiarity:1,self_awareness:1,exposure:0},E05:{trust:0,familiarity:1,self_awareness:0,exposure:1},E06:{trust:0,familiarity:0,self_awareness:0,exposure:0}};
const caps:Axes={trust:3,familiarity:3,self_awareness:2,exposure:2};
const expressions:Expression[]=['neutral','curious','pleased','flustered','annoyed','softened','blink'];
export class Story {
    constructor(private store:Store,private clock=()=>Date.now()){}
    private state():State{return this.store.get<State>('story-state')||{lastDragAttempt:0,lastJealousDay:'',reunions:[],mood:{expression:'neutral',initial:0,startedAt:0,expiresAt:0}};}
    private save(state:State){this.store.put('state','story-state',state);}
    source(kind:Source['kind'],data:Source['data']):string{const id=randomUUID();this.store.put('story-source',id,{id,kind,createdAt:iso(this.clock()),data} satisfies Source);return id;}
    private alive(id:string):boolean{return !this.store.dead(id)&&['message','memory','diary','story-source'].includes(this.store.kind(id)||'');}
    knownSource(id:string):boolean{return this.store.kind(id)==='story-source'?this.alive(id):this.store.kind(id)==='episode'&&!!this.store.get<StoryEpisode>(id)?.sourceIds.every(source=>this.alive(source));}
    private relation(){const raw=this.store.get<any>('relationship')||{};const base:Axes=raw.base||Object.fromEntries(axes.map(a=>[a,Math.min(100,Math.max(0,Number(raw[a])||0))])) as Axes;return{base,grants:(raw.grants||[]) as Grant[]};}
    private updateRelation(grant?:Grant){const relation=this.relation();if(grant&&!relation.grants.some(g=>g.key===grant.key))relation.grants.push(grant);const values={...relation.base};const daily=new Map<string,Axes>();for(const g of [...relation.grants].sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt))){const key=day(Date.parse(g.createdAt));const totals=daily.get(key)||{trust:0,familiarity:0,self_awareness:0,exposure:0};for(const axis of axes){const amount=Math.min(weights[g.kind][axis],Math.max(0,caps[axis]-totals[axis]));totals[axis]+=amount;values[axis]=Math.min(100,values[axis]+amount);}daily.set(key,totals);}this.store.put('state','relationship',{...values,base:relation.base,grants:relation.grants,revision:relation.grants.length});}
    private grantKey(scene:StoryScene){return scene.type==='E01'?'first-meeting':scene.type==='E02'?'first-placement':scene.type==='E03'?`fact-source:${scene.sourceIds[1]}`:scene.type==='E05'?`jealous:${day(this.clock())}`:`reunion:${scene.key}`;}
    complete(scene:StoryScene,extraSources:string[]=[],expression?:Expression):StoryEpisode|undefined{
        const sourceIds=[...new Set([...scene.sourceIds,...extraSources])];if(!sourceIds.length||sourceIds.some(id=>!this.alive(id)))return;
        const id=uuid(`${scene.type}:${scene.key}`);if(this.store.dead(id))return;const existing=this.store.get<StoryEpisode>(id);if(existing)return existing;
        const episode:StoryEpisode={...scene,id,sourceIds,createdAt:iso(this.clock())};this.store.put('episode',id,episode);
        if(scene.type!=='E06')this.updateRelation({key:this.grantKey(scene),kind:scene.type,createdAt:episode.createdAt});
        const feeling:Expression=expression||({E01:'curious',E02:'curious',E03:'pleased',E04:'softened',E05:'annoyed',E06:'softened'} as const)[scene.type];this.affect(feeling,scene.type==='E06'?0.2:0.5,scene.type==='E05'?180000:600000);
        if(scene.type==='E04'){const state=this.state();state.reunions.push(scene.key);state.reunions=state.reunions.slice(-128);this.save(state);}
        return episode;
    }
    named(identityId:string,userId:string,assistantId:string){return this.complete({type:'E01',key:identityId,sourceIds:[userId,assistantId],evidence:{identityCompleted:true}});}
    drag(sourceId:string,mayGenerate:boolean):StoryScene|undefined{
        const scene:StoryScene={type:'E02',key:sourceId,sourceIds:[sourceId],evidence:{actualUserPlacement:true}};this.complete(scene);
        const state=this.state(),now=this.clock();if(!mayGenerate||(state.lastDragAttempt&&now>=state.lastDragAttempt&&now-state.lastDragAttempt<1200000))return;
        state.lastDragAttempt=now;this.save(state);return scene;
    }
    fact(fact:MemoryItem){return this.complete({type:'E03',key:fact.id,sourceIds:[fact.id,fact.sourceId],evidence:{factId:fact.id,occurredAt:fact.validFrom||fact.createdAt,evidenceType:'verbatim-user-statement',reflectionIsNotFact:true}});}
    reunion(_lastSeenAt?:string):StoryScene|undefined{
        // Only a completed real chat anchors reunion; a drag or autonomous line cannot steal this eligibility.
        const prior=this.store.all<Message>('message').filter(m=>m.role==='assistant'&&m.source==='chat'&&!this.store.dead(m.id)).sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)).at(-1);if(!prior)return;
        const lastSeenAt=prior.createdAt;if(!Number.isFinite(Date.parse(lastSeenAt))||this.clock()-Date.parse(lastSeenAt)<28800000)return;
        const key=`${prior.id}:${lastSeenAt}`;if(this.state().reunions.includes(key))return;
        const memories=this.store.all<MemoryItem>('memory').filter(m=>m.kind==='fact'&&m.valid&&!this.store.dead(m.id)&&!this.store.dead(m.sourceId)).slice(-2);
        return{type:'E04',key,sourceIds:[...new Set([prior.id,...memories.flatMap(m=>[m.id,m.sourceId])])],evidence:{hoursApart:(this.clock()-Date.parse(lastSeenAt))/3600000,reliableClues:memories.map(m=>({id:m.id,text:m.text.slice(0,180),sourceId:m.sourceId})),unknownWhenNoClue:!memories.length}};
    }
    jealousy(trigger:'process-label'|'user-mention',sourceIds:string[],label:string):StoryScene|undefined{
        const state=this.state(),today=day(this.clock());if(state.lastJealousDay===today)return;
        state.lastJealousDay=today;this.save(state);return{type:'E05',key:today,sourceIds,evidence:{trigger,label:label.slice(0,80),doesNotProveExternalChat:true}};
    }
    control(action:'quiet'|'correction'|'observation-disabled'|'initiative-disabled'|'mischief-disabled',sourceId?:string){const source=sourceId||this.source('control',{action});return this.complete({type:'E06',key:`${action}:${source}`,sourceIds:[source],evidence:{action,permissionImmediate:true,noRelationshipPenalty:true}});}
    affect(expression:Expression,strength=0.4,duration=120000){const state=this.state();state.mood={expression:expression==='blink'?'neutral':expression,initial:Math.max(0,Math.min(1,strength)),startedAt:this.clock(),expiresAt:this.clock()+Math.max(0,Math.min(600000,duration))};this.save(state);}
    tick():boolean{const state=this.state();if(state.mood.initial>0&&(this.clock()>=state.mood.expiresAt||this.clock()<state.mood.startedAt)){state.mood={expression:'neutral',initial:0,startedAt:this.clock(),expiresAt:0};this.save(state);return true;}return false;}
    moodView():StorySnapshot['mood']{const state=this.state(),now=this.clock(),remaining=state.mood.initial>0&&now>=state.mood.startedAt&&state.mood.expiresAt>now?(state.mood.expiresAt-now)/Math.max(1,state.mood.expiresAt-state.mood.startedAt):0;return{expression:remaining>0?state.mood.expression:'neutral',strength:Math.max(0,Math.min(1,state.mood.initial*remaining)),expiresAt:state.mood.expiresAt};}
    private episodeClues(episode:StoryEpisode):{id:string;sourceId:string;text:string;[key:string]:unknown}[]{
        if(episode.type!=='E04')return [];
        return [...(Array.isArray(episode.evidence.reliableClues)?episode.evidence.reliableClues:[]),...(Array.isArray(episode.evidence.historicalClues)?episode.evidence.historicalClues:[])];
    }
    reconcile(){
        for(const stored of this.store.all<StoryEpisode>('episode')){
            let episode=stored,invalid=false;
            if(episode.type==='E04'){
                const clues=this.episodeClues(episode),current:Record<string,unknown>[]=[],past:Record<string,unknown>[]=[];
                const sources=new Set(episode.sourceIds);
                for(const clue of clues){
                    if(!clue||typeof clue.id!=='string'||typeof clue.sourceId!=='string'||typeof clue.text!=='string'){invalid=true;break;}
                    sources.add(clue.id);sources.add(clue.sourceId);
                    const fact=this.store.get<MemoryItem>(clue.id);
                    if(this.store.kind(clue.id)!=='memory'||!fact||fact.kind!=='fact'||fact.sourceId!==clue.sourceId||fact.text.slice(0,180)!==clue.text){invalid=true;break;}
                    const annotated={id:clue.id,sourceId:clue.sourceId,text:clue.text,valid:fact.valid,validFrom:fact.validFrom||fact.createdAt,validTo:fact.validTo};
                    (fact.valid?current:past).push(annotated);
                }
                episode={...episode,sourceIds:[...sources],historical:past.length>0,evidence:{...episode.evidence,reliableClues:current,historicalClues:past,unknownWhenNoClue:current.length===0}};
            }
            if(invalid||episode.sourceIds.some(id=>!this.alive(id))){this.store.tombstone(episode.id);this.store.remove(episode.id);continue;}
            if(episode.type==='E03')episode={...episode,historical:episode.sourceIds.some(id=>this.store.kind(id)==='memory'&&!this.store.get<MemoryItem>(id)?.valid)};
            if(JSON.stringify(episode)!==JSON.stringify(stored))this.store.put('episode',episode.id,episode);
        }
        for(const source of this.store.all<Source>('story-source'))if(this.store.dead(source.id))this.store.remove(source.id);
    }
    snapshot():StorySnapshot{
        const now=this.clock(),state=this.state(),remaining=state.mood.initial>0&&now>=state.mood.startedAt&&state.mood.expiresAt>now?(state.mood.expiresAt-now)/Math.max(1,state.mood.expiresAt-state.mood.startedAt):0;
        const episodes=this.store.all<StoryEpisode>('episode').filter(e=>e.sourceIds.every(id=>this.alive(id))).sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)||a.id.localeCompare(b.id));const placements=episodes.filter(e=>e.type==='E02');const notes=this.store.all<DiaryEntry>('diary').filter(d=>!this.store.dead(d.id)&&d.sourceIds.every(id=>this.alive(id))).sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)||a.id.localeCompare(b.id));
        return{mood:{expression:remaining>0?state.mood.expression:'neutral',strength:Math.max(0,Math.min(1,state.mood.initial*remaining)),expiresAt:state.mood.expiresAt},goals:{position:{placed:placements.length>0,placements:placements.length,lastPlacedAt:placements.at(-1)?.createdAt},notebook:{entries:notes.length,lastEntryAt:notes.at(-1)?.createdAt}},recentEpisodes:episodes.slice(-6)};
    }
    context(){const view=this.snapshot(),relationship=this.store.get<any>('relationship');return{mood:view.mood,goals:view.goals,recentEpisodes:view.recentEpisodes.slice(-3).map(episode=>{const evidence={...episode.evidence};delete evidence.historicalClues;return{...episode,evidence};}),familiarity:!relationship||relationship.familiarity<5?'初识':relationship.familiarity<15?'逐渐熟悉':'熟悉相处',scoresArePrivate:true};}
    export():StoryArchive{this.reconcile();return{sources:this.store.all<Source>('story-source').filter(s=>!this.store.dead(s.id)),episodes:this.store.all<StoryEpisode>('episode'),state:this.state(),grants:this.relation().grants,baseline:this.relation().base};}
    validateArchive(value:unknown,knownIds:Set<string>,knownMemories=new Map(this.store.all<MemoryItem>('memory').map(m=>[m.id,m]))):StoryArchive|undefined{
        if(value===undefined)return;const a=value as StoryArchive;const validId=(id:unknown)=>typeof id==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);const kinds=['E01','E02','E03','E04','E05','E06'];
        if(!a||!Array.isArray(a.sources)||!Array.isArray(a.episodes)||!Array.isArray(a.grants)||!a.state)throw new Error('相处事件存档格式无效');
        const sourceIds=new Set(knownIds),unique=new Set<string>();for(const source of a.sources){if(!source||!validId(source.id)||knownIds.has(source.id)||unique.has(source.id)||(this.store.kind(source.id)!==undefined&&this.store.kind(source.id)!=='story-source')||!['drag','tap','observation','control'].includes(source.kind)||!Number.isFinite(Date.parse(source.createdAt))||!source.data||typeof source.data!=='object'||JSON.stringify(source.data).length>2000)throw new Error('相处事件来源无效');unique.add(source.id);sourceIds.add(source.id);}
        for(const episode of a.episodes){if(!episode||!validId(episode.id)||episode.id!==uuid(`${episode.type}:${episode.key}`)||unique.has(episode.id)||knownIds.has(episode.id)||(this.store.kind(episode.id)!==undefined&&this.store.kind(episode.id)!=='episode')||!kinds.includes(episode.type)||typeof episode.key!=='string'||episode.key.length>200||!Array.isArray(episode.sourceIds)||!episode.sourceIds.length||episode.sourceIds.length>8||episode.sourceIds.some(id=>!sourceIds.has(id))||!Number.isFinite(Date.parse(episode.createdAt))||!episode.evidence||JSON.stringify(episode.evidence).length>4000)throw new Error('相处事件证据无效');unique.add(episode.id);}
        for(const episode of a.episodes)if(episode.type==='E04'){
            for(const field of ['reliableClues','historicalClues'])if(episode.evidence[field]!==undefined&&!Array.isArray(episode.evidence[field]))throw new Error('再见线索格式无效');
            const clues=this.episodeClues(episode);if(clues.length>2)throw new Error('再见线索过多');const normalized=new Set(episode.sourceIds);
            for(const clue of clues){const fact=clue&&knownMemories.get(clue.id);if(!clue||!validId(clue.id)||!validId(clue.sourceId)||!sourceIds.has(clue.id)||!sourceIds.has(clue.sourceId)||typeof clue.text!=='string'||clue.text.length>180||!fact||fact.kind!=='fact'||fact.sourceId!==clue.sourceId||fact.text.slice(0,180)!==clue.text)throw new Error('再见线索没有对应事实来源');normalized.add(clue.id);normalized.add(clue.sourceId);}
            if(normalized.size>8)throw new Error('再见线索来源过多');episode.sourceIds=[...normalized];
        }
        const state=a.state;if(!Number.isFinite(state.lastDragAttempt)||state.lastDragAttempt<0||state.lastDragAttempt>8640000000000000||typeof state.lastJealousDay!=='string'||!Array.isArray(state.reunions)||state.reunions.length>128||state.reunions.some(k=>typeof k!=='string'||k.length>200)||!state.mood||!expressions.includes(state.mood.expression)||![state.mood.initial,state.mood.startedAt,state.mood.expiresAt].every(Number.isFinite)||state.mood.initial<0||state.mood.initial>1||state.mood.startedAt<0||state.mood.expiresAt<0||state.mood.startedAt>8640000000000000||state.mood.expiresAt>8640000000000000||(state.mood.initial>0&&(state.mood.expiresAt<state.mood.startedAt||state.mood.expiresAt-state.mood.startedAt>600000)))throw new Error('相处状态无效');
        const grantKeys=new Set<string>();for(const grant of a.grants){if(!grant||typeof grant.key!=='string'||grant.key.length>200||grantKeys.has(grant.key)||!kinds.includes(grant.kind)||grant.kind==='E06'||!Number.isFinite(Date.parse(grant.createdAt)))throw new Error('关系事件账本无效');grantKeys.add(grant.key);}if(a.baseline&&axes.some(axis=>!Number.isFinite(a.baseline![axis])||a.baseline![axis]<0||a.baseline![axis]>100))throw new Error('关系基线无效');return a;
    }
    import(archive?:StoryArchive){if(!archive)return;const current=this.state();for(const source of archive.sources)if(!this.store.dead(source.id)){const existing=this.store.kind(source.id);if(existing&&existing!=='story-source')throw new Error('相处来源类型冲突');this.store.put('story-source',source.id,source);}for(const episode of archive.episodes)if(!this.store.dead(episode.id)&&episode.sourceIds.every(id=>this.alive(id))){const existing=this.store.kind(episode.id);if(existing&&existing!=='episode')throw new Error('相处事件类型冲突');if(!existing)this.store.put('episode',episode.id,episode);}const relation=this.relation();if(archive.baseline)for(const axis of axes)relation.base[axis]=Math.max(relation.base[axis],archive.baseline[axis]);for(const grant of archive.grants)if(!relation.grants.some(g=>g.key===grant.key))relation.grants.push(grant);this.store.put('state','relationship',{...relation.base,base:relation.base,grants:relation.grants});this.updateRelation();this.save({lastDragAttempt:Math.max(current.lastDragAttempt,archive.state.lastDragAttempt),lastJealousDay:current.lastJealousDay>archive.state.lastJealousDay?current.lastJealousDay:archive.state.lastJealousDay,reunions:[...new Set([...current.reunions,...archive.state.reunions])].slice(-128),mood:current.mood.startedAt>=archive.state.mood.startedAt?current.mood:archive.state.mood});this.reconcile();}
}





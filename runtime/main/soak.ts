import { app } from 'electron';
import { appendFile, mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { AppSnapshot } from '../shared/contracts';

/** Optional local acceptance recorder. Never records dialogue, titles or keys. */
export class SoakRecorder {
  private timer?: ReturnType<typeof setInterval>;
  private last=Date.now();
  private activeMs=0;
  private count=0;
  private writing=Promise.resolve();
  private stopped=false;
  private peakWorkingSetMiB=0;
  private samples: {cpu:number|null;memory:number}[]=[];
  private previousCPU=new Map<number,number>();
  private startedAt=new Date().toISOString();
  constructor(private output:string,private targetMs:number,private snapshot:()=>AppSnapshot) {}
  async start() { await mkdir(path.dirname(this.output),{recursive:true}); await this.sample(); this.timer=setInterval(()=>{this.writing=this.writing.then(()=>this.sample()).catch(()=>{});},60000); }
  private async sample() {
    if(this.stopped)return;
    const now=Date.now(),gap=now-this.last;this.last=now;
    // Sleep gaps cannot masquerade as 48 hours of active observation.
    this.activeMs+=Math.min(gap,120000);
    const metrics=app.getAppMetrics();
    const memoryMiB=metrics.reduce((sum,m)=>sum+m.memory.workingSetSize,0)/1024;
    const reportedCPUPercent=metrics.reduce((sum,m)=>sum+m.cpu.percentCPUUsage,0);
    const allCumulative=metrics.every(m=>typeof m.cpu.cumulativeCPUUsage==='number');
    let deltaSeconds=0;
    const nextCPU=new Map<number,number>();
    for(const metric of metrics){const cumulative=metric.cpu.cumulativeCPUUsage;if(typeof cumulative==='number'){nextCPU.set(metric.pid,cumulative);if(this.previousCPU.has(metric.pid))deltaSeconds+=Math.max(0,cumulative-this.previousCPU.get(metric.pid)!);}}
    const cpu=allCumulative&&this.previousCPU.size&&gap>0?deltaSeconds/(gap/1000)/Math.max(1,os.cpus().length)*100:null;
    this.previousCPU=nextCPU;
    this.peakWorkingSetMiB=Math.max(this.peakWorkingSetMiB,memoryMiB);this.samples.push({cpu,memory:memoryMiB});
    const s=this.snapshot();
    const row={at:new Date(now).toISOString(),sample:++this.count,activeObservedMs:this.activeMs,gapMs:gap,processes:metrics.length,workingSetMiB:memoryMiB,reportedCPUPercent,wholeCPUPercent:cpu,logicalCPUs:os.cpus().length,configured:s.provider.configured,embedding:s.status.embedding,messages:s.messages.length,memories:s.stats.memories,backgroundRunning:s.status.tasks.filter(t=>t.state==='running').length,backgroundQueued:s.status.tasks.filter(t=>t.state==='queued').length,observationAvailable:s.observation.available};
    await appendFile(`${this.output}.jsonl`,`${JSON.stringify(row)}\n`);
    await this.save(this.activeMs>=this.targetMs?'complete':'running');
    if(this.activeMs>=this.targetMs){this.stopped=true;if(this.timer)clearInterval(this.timer);}
  }
  private async save(status:string) {
    const known=this.samples.filter((s):s is {cpu:number;memory:number}=>s.cpu!==null);
    const report={schemaVersion:2,status,pid:process.pid,executable:process.execPath,startedAt:this.startedAt,updatedAt:new Date().toISOString(),targetMs:this.targetMs,activeObservedMs:this.activeMs,sampleCount:this.count,peakWorkingSetMiB:this.peakWorkingSetMiB,meanWholeCPUPercent:known.length?known.reduce((n,s)=>n+s.cpu,0)/known.length:null,firstTenMinuteSamples:this.samples.slice(0,11),note:'Local metadata only. No dialogue, window titles, character identity or API keys. CPU is computed from cumulative process seconds, not a second normalization of reported percentages. Active time excludes long sleep gaps; this record alone does not prove model quality.'};
    await writeFile(`${this.output}.new`,JSON.stringify(report,null,2));await rename(`${this.output}.new`,this.output);
  }
  async stop(){if(this.timer)clearInterval(this.timer);await this.writing;if(!this.stopped){this.stopped=true;await this.save('interrupted');}}
}

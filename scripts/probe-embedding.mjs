import { mkdir, writeFile, readdir, stat } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Embeddings } from '../runtime/core/embedding.ts';

// Fixed before the first model run; invented facts, no personal data.
const facts = [
 ['f01','用户喜欢无糖热咖啡。'],['f02','用户正在开发桌面陪伴应用 GalAgent。'],
 ['f03','用户希望人物有银白长发、深蓝裙子和虹彩配饰。'],['f04','用户的工作时间通常是晚上九点到凌晨一点。'],
 ['f05','用户希望专注写代码时不要主动打断。'],['f06','用户将生日定在六月十五日。'],
 ['f07','用户每周六下午会去游泳。'],['f08','用户不吃香菜。'],
 ['f09','用户更喜欢简短自然的中文回答。'],['f10','用户常用 Windows 11 和 PowerShell。'],
 ['f11','用户的猫叫团团。'],['f12','用户喜欢下雨天听钢琴曲。'],
 ['f13','用户计划明天上午十点去牙科复诊。'],['f14','用户上个月去过杭州西湖。'],
 ['f15','用户要求窗口标题采集默认关闭。'],['f16','用户希望角色自己给自己取名字。'],
 ['f17','用户不喜欢恐怖电影。'],['f18','用户已纠正饮品偏好：现在喜欢温热乌龙茶，不再喜欢冰绿茶。'],
 ['f19','用户昨晚完成了桌面透明窗口的初步验证。'],['f20','用户喜欢冰绿茶。',false],
].map(([id,text,valid=true])=>({id,text,valid}));
const queries = [
 ['咖啡要怎么准备？','f01'],['他喝咖啡加糖吗？','f01'],
 ['他在做什么项目？','f02'],['桌面搭档软件叫什么名字？','f02'],
 ['女孩的发色和服装是什么？','f03'],['形象用什么颜色的裙装？','f03'],
 ['他通常几点工作？','f04'],['晚上写代码到什么时候？','f04'],
 ['他写程序时能主动找他说话吗？','f05'],['专注时应当怎么相处？','f05'],
 ['他的生日是哪一天？','f06'],['六月份有什么纪念日？','f06'],
 ['周末有什么运动安排？','f07'],['星期六下午通常做什么？','f07'],
 ['给他点菜要避开什么？','f08'],['他能吃香菜吗？','f08'],
 ['他喜欢什么语言和长度的回应？','f09'],['回复他的文字应该多长？','f09'],
 ['他使用哪种操作系统？','f10'],['他的终端工具是什么？','f10'],
 ['家里的猫叫什么？','f11'],['团团是什么动物？','f11'],
 ['下雨时喜欢听什么音乐？','f12'],['他喜欢钢琴音乐吗？','f12'],
 ['明早十点有什么安排？','f13'],['下一次牙医预约是什么时候？','f13'],
 ['上月旅行去了哪里？','f14'],['什么时候去了西湖？','f14'],
 ['应该默认读取窗口标题吗？','f15'],['女孩的名字由谁来取？','f16'],
 ['他喜欢看惊悚片吗？','f17'],['现在应该给他泡什么茶？','f18'],
 ['他对冰绿茶的偏好后来怎样改变？','f18'],['饮料偏好以哪条最新纠正为准？','f18'],
 ['昨天晚上验证了什么功能？','f19'],
 ['他的手机号码是多少？',null],['他最喜欢哪支足球队？',null],
 ['他今天午饭吃了什么？',null],['他的显卡型号是什么？',null],['他住在哪个街道？',null],
].map(([text,expected],i)=>({id:`q${String(i+1).padStart(2,'0')}`,text,expected}));
const dir=resolve('docs/evidence'); await mkdir(dir,{recursive:true});
await writeFile(join(dir,'embedding-fixed-fixtures.json'),JSON.stringify({version:1,facts,queries},null,2));
const cacheDir=resolve('.cache/models'); await mkdir(cacheDir,{recursive:true});
const offline=process.argv.includes('--offline');
const embed=new Embeddings(cacheDir,offline?join(cacheDir,'Xenova/multilingual-e5-small'):undefined);
const report={fixtureVersion:1,model:'Xenova/multilingual-e5-small',dtype:'q8',offline,cacheDir,startedAt:new Date().toISOString(),results:[]};
const dot=(a,b)=>a.reduce((n,x,i)=>n+x*b[i],0);
const p95=a=>[...a].sort((a,b)=>a-b)[Math.ceil(a.length*.95)-1];
try {
 const start=performance.now(), cpu=process.cpuUsage();
 const vectors=[];
 for(const fact of facts) {
   const t=performance.now(); vectors.push(await embed.encode(fact.text,false));
   if(vectors.length===1) { report.coldStartMs=performance.now()-start; console.log(JSON.stringify({phase:'model-ready',coldStartMs:report.coldStartMs,dimensions:vectors[0].length,rssMiB:process.memoryUsage().rss/2**20})); }
 }
 report.dimensions=vectors[0].length;
 const latencies=[];
 for(const query of queries) {
  const t=performance.now(),v=await embed.encode(query.text,true);latencies.push(performance.now()-t);
  const ranks=facts.map((f,i)=>({id:f.id,valid:f.valid,score:dot(v,vectors[i])})).filter(f=>f.valid).sort((a,b)=>b.score-a.score);
  report.results.push({...query,top3:ranks.slice(0,3),correctTop1:query.expected?ranks[0].id===query.expected:null,correctTop3:query.expected?ranks.slice(0,3).some(r=>r.id===query.expected):null});
 }
 const positives=report.results.filter(x=>x.expected);
 report.recallTop1=positives.filter(x=>x.correctTop1).length/positives.length;
 report.recallTop3=positives.filter(x=>x.correctTop3).length/positives.length;
 report.queryMs={mean:latencies.reduce((a,b)=>a+b,0)/latencies.length,p95:p95(latencies)};
 const synthetic=Array.from({length:10000},(_,i)=>vectors[i%vectors.length]);
 const scans=[]; let checksum=0;
 for(let pass=0;pass<100;pass++) {const t=performance.now();for(const v of synthetic)checksum+=dot(vectors[0],v);scans.push(performance.now()-t);}
 report.syntheticScan={vectors:10000,dimensions:report.dimensions,passes:100,p95Ms:p95(scans),meanMs:scans.reduce((a,b)=>a+b,0)/scans.length,checksum,note:'Synthetic repeated vectors; not 10000 independently embedded passages.'};
 report.cpuSeconds=Object.values(process.cpuUsage(cpu)).reduce((a,b)=>a+b,0)/1e6;
 report.rssMiB=process.memoryUsage().rss/2**20;
 report.peakRssMiB=process.resourceUsage().maxRSS/1024;
 report.totalMs=performance.now()-start;
 async function walk(p){let out=[];for(const e of await readdir(p,{withFileTypes:true})){const full=join(p,e.name);if(e.isDirectory())out.push(...await walk(full));else out.push({path:relative(cacheDir,full),bytes:(await stat(full)).size,sha256:createHash('sha256').update(await readFile(full)).digest('hex')});}return out;}
 report.modelFiles=await walk(cacheDir);
 console.log(JSON.stringify({...report,results:undefined},null,2));
} catch(error) { report.error=String(error?.stack||error);console.error(report.error);process.exitCode=1; }
finally {await embed.close();await writeFile(join(dir,offline?'embedding-offline-result.json':'embedding-live-result.json'),JSON.stringify(report,null,2));}

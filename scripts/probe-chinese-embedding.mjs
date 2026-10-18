/** Bounded E5 versus one Chinese candidate experiment. Does not change the product model or user database. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {performance} from 'node:perf_hooks';
import os from 'node:os';
const script=fileURLToPath(import.meta.url),root=resolve(dirname(script),'..');
const profiles={
 e5:{id:'Xenova/multilingual-e5-small',base:'intfloat/multilingual-e5-small',modelDir:join(root,'.cache/models/Xenova/multilingual-e5-small'),metadata:join(root,'.cache/models/model-metadata.json'),baseMetadata:join(root,'.cache/models/base-model-metadata.json'),pooling:'mean',queryPrefix:'query: ',passagePrefix:'passage: '},
 chinese:{id:'Xenova/bge-small-zh-v1.5',base:'BAAI/bge-small-zh-v1.5',modelDir:join(root,'.cache/models/candidate-bge-small-zh-v1.5'),metadata:join(root,'.cache/models/candidate-bge-small-zh-v1.5/model-metadata.json'),baseMetadata:join(root,'.cache/models/candidate-bge-small-zh-v1.5/base-model-metadata.json'),pooling:'cls',queryPrefix:'为这个句子生成表示以用于检索相关文章：',passagePrefix:''}
};
const json=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\ufeff/,''));
const p95=values=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1];
if(!isMainThread){
 let pipelinePromise;
 parentPort.on('message',async message=>{
  if(message.close){try{await(await pipelinePromise)?.dispose();}catch{}parentPort.postMessage({closed:true});return;}
  try{
   if(!pipelinePromise)pipelinePromise=(async()=>{const{pipeline,env}=await import('@huggingface/transformers');env.allowRemoteModels=false;env.allowLocalModels=true;env.useFSCache=false;return pipeline('feature-extraction',workerData.modelDir,{dtype:'q8',device:'cpu',session_options:{intraOpNumThreads:2,interOpNumThreads:1,executionMode:'sequential'}});})();
   const extractor=await pipelinePromise,prefix=message.query?workerData.queryPrefix:workerData.passagePrefix;
   const output=await extractor(prefix+message.text,{pooling:workerData.pooling,normalize:true});
   parentPort.postMessage({id:message.id,values:Array.from(output.data)});
  }catch(error){parentPort.postMessage({id:message.id,error:String(error?.stack||error)});}
 });
}else if(process.argv.includes('--child')){
 const profile=process.argv[process.argv.indexOf('--profile')+1],spec=profiles[profile];if(!spec)throw new Error('Unknown benchmark profile');
 const fixture=await json(join(root,'docs/evidence/embedding-fixed-fixtures.json'));
 const baseline=process.memoryUsage().rss;let sampledPeak=baseline;const sampler=setInterval(()=>{sampledPeak=Math.max(sampledPeak,process.memoryUsage().rss);},20);
 let worker,requestId=0;const pending=new Map();
 const run=async(text,query=false)=>{const id=++requestId;return await new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker.postMessage({id,text,query});});};
 const operatingMemory=async()=>{if(process.platform!=='win32')return null;const command=`$p=Get-Process -Id ${process.pid};[pscustomobject]@{pid=$p.Id;workingSetBytes=$p.WorkingSet64;peakWorkingSetBytes=$p.PeakWorkingSet64;privateBytes=$p.PrivateMemorySize64}|ConvertTo-Json -Compress`;const{stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:15000});return JSON.parse(stdout.trim());};
 const report={profile,model:spec.id,pid:process.pid,dtype:'q8',device:'cpu',threads:2,pooling:spec.pooling,queryPrefix:spec.queryPrefix,passagePrefix:spec.passagePrefix,baselineRssMiB:baseline/2**20,startedAt:new Date().toISOString(),results:[],actualModelInference:true,syntheticVectorsUsed:false};
 try{
  const start=performance.now(),cpu=process.cpuUsage();worker=new Worker(script,{workerData:spec});worker.on('message',message=>{const item=pending.get(message.id);if(!item)return;pending.delete(message.id);message.error?item.reject(new Error(message.error)):item.resolve(message.values);});worker.on('error',error=>{for(const item of pending.values())item.reject(error);pending.clear();});
  const vectors=[];for(const fact of fixture.facts){const values=await run(fact.text);if(!values.length||values.some(v=>!Number.isFinite(v)))throw new Error('Invalid real model vector');const norm=Math.sqrt(values.reduce((sum,v)=>sum+v*v,0));if(Math.abs(norm-1)>.002)throw new Error('Model output was not normalized');vectors.push(values);if(vectors.length===1){report.coldFirstVectorMs=performance.now()-start;report.dimensions=values.length;report.firstVectorRssMiB=process.memoryUsage().rss/2**20;}}
  const latencies=[];for(const query of fixture.queries){const begin=performance.now(),vector=await run(query.text,true);latencies.push(performance.now()-begin);const ranking=fixture.facts.map((fact,index)=>({id:fact.id,valid:fact.valid,score:vector.reduce((sum,value,i)=>sum+value*vectors[index][i],0)})).filter(f=>f.valid).sort((a,b)=>b.score-a.score);report.results.push({...query,top3:ranking.slice(0,3),top1Correct:query.expected?ranking[0].id===query.expected:null,top3Correct:query.expected?ranking.slice(0,3).some(f=>f.id===query.expected):null});}
  const positives=report.results.filter(q=>q.expected);report.quality={answerable:positives.length,top1Hits:positives.filter(q=>q.top1Correct).length,top3Hits:positives.filter(q=>q.top3Correct).length,top1:positives.filter(q=>q.top1Correct).length/positives.length,top3:positives.filter(q=>q.top3Correct).length/positives.length};report.unknown=report.results.filter(q=>!q.expected).map(q=>({id:q.id,text:q.text,best:q.top3[0]}));report.queryMs={mean:latencies.reduce((a,b)=>a+b,0)/latencies.length,p95:p95(latencies),samples:latencies.length};report.cpuSeconds=Object.values(process.cpuUsage(cpu)).reduce((a,b)=>a+b,0)/1e6;report.encodingTotalMs=performance.now()-start;
  report.loadedWindowsMemory=await operatingMemory();report.loadedRssMiB=process.memoryUsage().rss/2**20;report.sampledPeakRssMiB=Math.max(sampledPeak,process.memoryUsage().rss)/2**20;report.peakSampleIntervalMs=20;
 }catch(error){report.error=String(error?.stack||error);process.exitCode=1;}
 finally{
  clearInterval(sampler);
  if(worker){await new Promise(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timeout);resolve();};const timeout=setTimeout(finish,3000);worker.on('message',message=>{if(message.closed)finish();});worker.postMessage({close:true});});await worker.terminate();}
  global.gc?.();await new Promise(resolve=>setTimeout(resolve,100));report.afterDisposeRssMiB=process.memoryUsage().rss/2**20;report.afterDisposeWindowsMemory=await operatingMemory();report.workerTerminated=true;
  process.stdout.write(JSON.stringify(report)+'\n');
 }
}else{
 const startedAt=new Date().toISOString();const fixturePath=join(root,'docs/evidence/embedding-fixed-fixtures.json'),fixtureBytes=await readFile(fixturePath),fixture=JSON.parse(fixtureBytes);
 if(fixture.facts.length!==20||fixture.queries.length!==40||fixture.queries.filter(q=>q.expected).length!==35)throw new Error('Fixed corpus changed');
 const verify=async spec=>{const metadata=await json(spec.metadata),base=await json(spec.baseMetadata);if(metadata.id!==spec.id||base.id!==spec.base)throw new Error('Official model IDs do not match');const files=[];for(const filename of ['config.json','tokenizer_config.json','tokenizer.json','onnx/model_quantized.onnx']){const data=await readFile(join(spec.modelDir,filename)),official=metadata.siblings.find(file=>file.rfilename===filename);if(!official)throw new Error('Official file metadata missing');const sha256=createHash('sha256').update(data).digest('hex'),gitBlobSha1=createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');const verified=official.lfs?sha256===official.lfs.sha256:gitBlobSha1===official.blobId;if(!verified||data.length!==official.size)throw new Error('Official file digest or size mismatch: '+filename);files.push({filename,bytes:data.length,sha256,gitBlobSha1,officialLfsSha256:official.lfs?.sha256,officialGitBlobId:official.blobId,verified});}return{model:metadata.id,revision:metadata.sha,baseModel:base.id,baseRevision:base.sha,baseLicense:base.cardData?.license||'metadata unavailable',modelUrl:`https://huggingface.co/${metadata.id}/tree/${metadata.sha}`,baseUrl:`https://huggingface.co/${base.id}/tree/${base.sha}`,files,runtimeBytes:files.reduce((n,f)=>n+f.bytes,0)};};
 const proofs={e5:await verify(profiles.e5),chinese:await verify(profiles.chinese)};
 const runChild=async profile=>await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--expose-gc',script,'--child','--profile',profile],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';const timeout=setTimeout(()=>{if(child.exitCode===null)child.kill();reject(new Error('Owned benchmark process exceeded 180 seconds'));},180000);child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.on('error',error=>{clearTimeout(timeout);reject(error);});child.on('close',(code,signal)=>{clearTimeout(timeout);if(code!==0)return reject(new Error(`${profile} owned child failed (${code}/${signal}): ${stderr} ${stdout}`));try{const result=JSON.parse(stdout.trim().split(/\r?\n/).at(-1));result.childExit={code,signal,handleClosed:true};result.stderr=stderr.trim()||undefined;resolve(result);}catch(error){reject(error);}});});
 // Sequential independent processes: A is fully closed before B starts.
 const a=await runChild('e5');console.log(JSON.stringify({phase:'A-E5-complete',pid:a.pid,quality:a.quality,rssMiB:a.sampledPeakRssMiB,exit:a.childExit}));
 const b=await runChild('chinese');console.log(JSON.stringify({phase:'B-candidate-complete',pid:b.pid,quality:b.quality,rssMiB:b.sampledPeakRssMiB,exit:b.childExit}));
 const transformers=await json(join(root,'node_modules/@huggingface/transformers/package.json')),onnx=await json(join(root,'node_modules/onnxruntime-node/package.json'));
 const report={schema:1,status:'candidate-experiment-only-no-product-migration',startedAt,completedAt:new Date().toISOString(),platform:{node:process.version,platform:process.platform,architecture:process.arch,cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,physicalMemoryBytes:os.totalmem(),transformers:transformers.version,onnxruntimeNode:onnx.version},fixture:{path:'docs/evidence/embedding-fixed-fixtures.json',sha256:createHash('sha256').update(fixtureBytes).digest('hex'),facts:20,queries:40,answerable:35,unknown:5,unchanged:true},models:proofs,runs:{A:a,B:b},comparison:{top1Delta:b.quality.top1-a.quality.top1,top3Delta:b.quality.top3-a.quality.top3,sampledPeakRssReductionMiB:a.sampledPeakRssMiB-b.sampledPeakRssMiB,sampledPeakRssReductionFraction:1-b.sampledPeakRssMiB/a.sampledPeakRssMiB,coldRatio:b.coldFirstVectorMs/a.coldFirstVectorMs,queryP95Ratio:b.queryMs.p95/a.queryMs.p95},limits:['Fixed 20/40 development corpus, not independent acceptance or true Kimi answering.','Only owned Node process plus its worker counted; no Electron, observer or GPU/production process memory included.','Fresh process cold load; OS file cache may be warm; background machine load is not isolated.','RSS sampled every 20ms may miss shorter peaks; Windows PeakWorkingSet adds OS lifetime peak evidence.','Official E5 uses mean plus query/passage prefixes; official BGE uses CLS plus Chinese query instruction and no passage prefix. No pooling variant search was performed.','Unknown queries still retrieve a nearest candidate: cosine is not an answerability guarantee.'],migration:{decided:false,required:['Explicit selection after quality/resource review','Versioned embedding model/revision/pooling/prefix/dtype for every vector','Full source-preserving reindex before querying candidate vectors','Never mix E5 384-dimensional vectors with BGE 512-dimensional vectors, or different same-dimensional models','Real packaged Electron all-process cold peak/idle checks against original 800/400 MiB gates','Independent Chinese/English proper-name and historical/unknown retrieval acceptance']}};
 await mkdir(join(root,'docs/evidence'),{recursive:true});await writeFile(join(root,'docs/evidence/chinese-embedding-candidate.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({report:'docs/evidence/chinese-embedding-candidate.json',comparison:report.comparison,migrationDecided:false},null,2));
}

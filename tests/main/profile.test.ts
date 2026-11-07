import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {selectProfile} from '../../runtime/main/profile';

test('explicit remembered profile survives an ordinary shortcut launch; isolated tests never change that selection',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'gal-profile-select-'));
 const appData=path.join(root,'appdata'),applicationDir=path.join(root,'app');
 const fresh=path.join(root,'fresh-profile');
 try{
  const chosen=selectProfile({appData,applicationDir,argv:['--profile-directory='+fresh,'--remember-profile']});
  assert.equal(chosen.directory,fresh);
  const before=await readFile(chosen.selector,'utf8');
  assert.equal(selectProfile({appData,applicationDir,argv:[]}).directory,fresh);
  const isolated=selectProfile({appData,applicationDir,argv:[],environment:path.join(root,'test-only')});
  assert.equal(isolated.isolated,true);
  assert.equal(await readFile(chosen.selector,'utf8'),before);
  await rm(fresh,{recursive:true,force:true});
  assert.throws(()=>selectProfile({appData,applicationDir,argv:[]}),/不存在/);
  assert.throws(()=>selectProfile({appData,applicationDir,argv:['--profile-directory='+applicationDir]}),/安装目录之外/);
  await writeFile(chosen.selector,'invalid');
  assert.throws(()=>selectProfile({appData,applicationDir,argv:[]}),/选择文件无法读取/);
 }finally{await rm(root,{recursive:true,force:true});}
});

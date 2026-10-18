import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store,grams,KEYWORD_INDEX_VERSION} from '../../runtime/core/store';
test('keyword terms respect Chinese runs, complete Latin words/identifiers and punctuation boundaries',()=>{
    assert.deepEqual(grams('银光。虹色'),['银光','虹色']);
    assert.deepEqual(grams('hello world'),['hello','world']);
    assert.deepEqual(grams('WH-900ZX/alpha_beta 10.5'),['wh','900zx','alpha','beta','10','5']);
    assert.deepEqual(grams('你好SkyGate谢谢'),['你好','skygate','谢谢']);
    assert.deepEqual(grams('Which is the language that I should use?'),['language','use']);
    assert.deepEqual(grams('CAFÉ café １２３'),['café','123']);
});
test('function-word fragments cannot promote unrelated Latin identifiers; complete names remain searchable',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'galagent-keyword-boundary-')),store=new Store(dir);
    try{
        store.index('identifier','HarborSpark luminous-light');store.index('description','静心讨论偏好');store.index('name','用户使用CloudBerry和RX7700设备');
        assert.deepEqual(store.keyword('What is the preference?'),[]);assert.deepEqual(store.keyword('the and which should'),[]);
        assert.deepEqual(store.keyword('HarborSpark'),['identifier']);assert.deepEqual(store.keyword('CloudBerry'),['name']);assert.deepEqual(store.keyword('cloud'),[]);assert.deepEqual(store.keyword('RX7700'),['name']);assert.deepEqual(store.keyword('bor spa'),[]);
    }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
test('opening an old keyword version atomically rebuilds only FTS while preserving history, vectors and deletion markers',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'galagent-keyword-migrate-'));let store=new Store(dir);
    try{
        const memories=[{id:'alive',text:'用户记录HarborSpark。',sourceId:'source-a',valid:true},{id:'past',text:'以前喜欢热茶。',sourceId:'source-p',valid:false,validTo:'2026-08-01T00:00:00Z'},{id:'dead',text:'已经删除的事实。',sourceId:'source-d',valid:true},{id:'source-dead',text:'来源已经删除的事实。',sourceId:'source-x',valid:true}];
        for(const memory of memories)store.put('memory',memory.id,memory);store.put('message','source-a',{text:'original user record'});store.put('state','identity',{name:'preserve name'});store.put('diary','note',{text:'preserve diary'});store.vector('alive',[0.1,0.2]);store.vector('past',[0.3,0.4]);store.tombstone('dead');store.tombstone('source-x');
        store.db.exec('DELETE FROM memory_fts');for(const memory of memories){const chars=[...memory.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'')];store.db.prepare('INSERT INTO memory_fts VALUES(?,?)').run(memory.id,chars.slice(0,-1).map((char,i)=>char+chars[i+1]).join(' '));}store.db.prepare('INSERT INTO memory_fts VALUES(?,?)').run('orphan','harborspark');store.db.prepare('UPDATE index_metadata SET value=? WHERE key=?').run('1-concatenated-bigrams','keyword-version');
        const records=store.db.prepare('SELECT * FROM records ORDER BY id').all(),vectors=store.db.prepare('SELECT * FROM vectors ORDER BY id').all(),dead=store.db.prepare('SELECT * FROM tombstones ORDER BY id').all();store.close();store=new Store(dir);
        assert.deepEqual(store.db.prepare('SELECT * FROM records ORDER BY id').all(),records);assert.deepEqual(store.db.prepare('SELECT * FROM vectors ORDER BY id').all(),vectors);assert.deepEqual(store.db.prepare('SELECT * FROM tombstones ORDER BY id').all(),dead);assert.equal(store.db.prepare('SELECT value FROM index_metadata WHERE key=?').get('keyword-version')!.value,KEYWORD_INDEX_VERSION);
        assert.deepEqual(store.keyword('HarborSpark'),['alive']);assert.deepEqual(store.keyword('热茶',new Set(['past'])),['past']);assert.deepEqual(store.keyword('已经删除'),[]);assert.deepEqual(store.db.prepare('SELECT id FROM memory_fts ORDER BY id').all().map(row=>row.id),['alive','past']);
        const indexRows=store.db.prepare('SELECT * FROM memory_fts ORDER BY id').all();store.close();store=new Store(dir);assert.deepEqual(store.db.prepare('SELECT * FROM memory_fts ORDER BY id').all(),indexRows);
    }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
test('a corrupt old memory rolls back the complete FTS migration and leaves its old version intact',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'galagent-keyword-rollback-'));const setup=new Store(dir);
    setup.db.prepare('INSERT INTO records VALUES(?,?,?)').run('bad','memory','invalid-json');setup.db.prepare('INSERT INTO memory_fts VALUES(?,?)').run('old','legacytoken');setup.db.prepare('UPDATE index_metadata SET value=? WHERE key=?').run('old-version','keyword-version');setup.close();
    try{assert.throws(()=>new Store(dir));const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(join(dir,'companion.sqlite'));try{assert.equal(db.prepare('SELECT value FROM index_metadata WHERE key=?').get('keyword-version')!.value,'old-version');assert.deepEqual(db.prepare('SELECT id,terms FROM memory_fts').all().map(row=>[row.id,row.terms]),[['old','legacytoken']]);assert.equal(db.prepare('SELECT body FROM records WHERE id=?').get('bad')!.body,'invalid-json');}finally{db.close();}}
    finally{await rm(dir,{recursive:true,force:true});}
});

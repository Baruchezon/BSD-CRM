import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const config=fs.readFileSync(new URL('../js/config.js',import.meta.url),'utf8');
const code=config.slice(config.indexOf('// Daily,'),config.indexOf('// 15.09.2026:'));
function environment(useIndexedDB=true, stallStorage=false){
 const persistent=new Map(), local=new Map(), sessionStore=new Map(), calls=[];
 const storage=map=>({getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)});
 const clock={now:Date.parse('2026-09-23T10:00:00Z')};let fail=false, stallNetwork=false, networkDelay=0;
 const tables={businesses:[{id:'b1',internal_name:'Before',updated_at:'2026-09-23'}],leads:Array.from({length:1501},(_,i)=>({id:'l'+i,updated_at:'2026-09-23'}))};
 function indexedDB(){return {open(){const req={};setImmediate(()=>{req.result={transaction(){const tx={objectStore(){return {get:k=>op('get',k),put:(v,k)=>op('put',k,v),delete:k=>op('delete',k)}}};function op(type,k,v){const r={};setImmediate(()=>{if(type==='put')persistent.set(k,structuredClone(v));if(type==='delete')persistent.delete(k);r.result=type==='get'?structuredClone(persistent.get(k)):null;r.onsuccess?.();tx.oncomplete?.()});return r}return tx}};req.onsuccess()});return req}}}
 function page(){
  const session={user:{id:'u1'},access_token:'x.'+Buffer.from(JSON.stringify({session_id:'s1'})).toString('base64')+'.x'};
  const profile={id:'u1',role:'admin',status:'active'};
  const client={auth:{getSession:async()=>({data:{session}})},rpc(){return Promise.resolve({data:[],error:null})},from(table){
   let operation='get',values,id,start=0,end=999999;
   const q={select(){return q},order(){return q},range(a,b){start=a;end=b;return q},eq(k,v){if(k==='id')id=v;return q},update(v){operation='update';values=v;return q},insert(v){operation='insert';values=v;return q},delete(){operation='delete';return q},single(){return q},maybeSingle(){return q},then(ok,bad){return (async()=>{
    calls.push({table,operation,id,start,end});if(stallNetwork)return new Promise(()=>{});if(networkDelay)await new Promise(resolve=>setTimeout(resolve,networkDelay));if(fail)return {error:{message:'offline'},data:null};
    if(operation==='update')Object.assign(tables[table].find(r=>r.id===id),values);
    if(operation==='insert'){tables[table].push(values);return {data:structuredClone(values),error:null}}
    if(operation==='delete')tables[table]=tables[table].filter(r=>r.id!==id);
    return {data:structuredClone(id?tables[table].find(r=>r.id===id)||null:tables[table].slice(start,end+1)),error:null};
   })().then(ok,bad)}};return q;
  }};
  class ClockDate extends Date {constructor(...args){super(...(args.length?args:[clock.now]))}static now(){return clock.now}}
  const sandbox={setTimeout:(fn,ms)=>setTimeout(fn,ms>=15000?100:ms),clearTimeout,window:{supabaseClient:client},Date:ClockDate,Intl,Map,Set,Promise,Proxy,JSON,Object,Math,atob:x=>Buffer.from(x,'base64').toString(),localStorage:storage(local),sessionStorage:storage(sessionStore)};
  if(useIndexedDB)sandbox.indexedDB=stallStorage ? {open:()=>({})} : indexedDB();
  vm.createContext(sandbox);vm.runInContext(code,sandbox);const cache=sandbox.window.BSDDataCache;
  const start=async()=>{await cache.activate(session,profile);cache.observeWrites(client)};
  return {cache,client,session,profile,start,async load(){await start();return Promise.all([cache.rows('businesses',profile.id),cache.rows('leads',profile.id)])}};
 }
 return {page,clock,calls,tables,setFail:v=>fail=v,setStall:v=>stallNetwork=v,setDelay:v=>networkDelay=v};
}
for(const indexed of [true,false])test('daily/session persistence and selective writes '+(indexed?'IndexedDB adapter':'storage fallback'),async()=>{
 const e=environment(indexed);let p=e.page();let data=await p.load();assert.equal(data[1].data.length,1501);assert.equal(e.calls.length,3);
 p.cache.set('businesses-page','u1',{businesses:[{id:'b1'}]});await p.cache.flush();
 p=e.page();await p.load();assert.equal(e.calls.length,3,'new page does not reload either collection');assert.equal(p.cache.get('businesses-page','u1').businesses.length,1);
 p=e.page();await p.load();assert.equal(e.calls.length,3);
 await p.client.from('businesses').update({internal_name:'After'}).eq('id','b1');assert.equal(e.calls.length,5,'write plus one row verification');
 assert.equal((await p.cache.rows('businesses','u1')).data[0].internal_name,'After');assert.equal(p.cache.get('businesses-page','u1'),null);
 p=e.page();await p.load();assert.equal(e.calls.length,5);
 e.clock.now=Date.parse('2026-09-23T21:01:00Z');await p.load();assert.equal(e.calls.length,8,'midnight in Israel starts a new load');await p.load();assert.equal(e.calls.length,8);
 p.cache.reset();assert.equal(p.cache.set('businesses-page','u1',{stale:true}),false);await p.load();assert.equal(e.calls.length,11,'logout invalidates same-day cache');
 p.profile.id='u2';p.session.user.id='u2';await p.load();assert.equal(e.calls.length,14,'user separation');
 p.profile.role='agent';await p.load();assert.equal(e.calls.length,17,'permissions changed');
});
test('simultaneous requests deduplicate and failed requests are not cached',async()=>{
 const e=environment();const p=e.page();await p.start();await Promise.all([p.cache.rows('businesses','u1'),p.cache.rows('businesses','u1')]);assert.equal(e.calls.length,1);
 e.setFail(true);assert.ok((await p.cache.rows('leads','u1')).error);e.setFail(false);assert.equal((await p.cache.rows('leads','u1')).data.length,1501);
});
test('forced refresh heals an empty or stale same-day collection',async()=>{
 const e=environment();e.tables.leads=[];const p=e.page();await p.start();
 assert.equal((await p.cache.rows('leads','u1')).data.length,0);
 e.tables.leads.push({id:'recovered',type:'buyer',updated_at:'2026-09-23'});
 assert.equal((await p.cache.rows('leads','u1')).data.length,0,'ordinary reads remain fast and use the daily cache');
 assert.equal((await p.cache.rows('leads','u1',{forceRefresh:true})).data.length,1,'screen revalidation bypasses an empty cache');
 assert.equal((await p.cache.rows('leads','u1')).data[0].id,'recovered','the repaired result replaces the stale cache');
});
test('a slow successful mobile response is retained instead of becoming an empty list',async()=>{
 const e=environment();const p=e.page();await p.start();e.setDelay(50);
 const result=await p.cache.rows('leads','u1',{forceRefresh:true});
 assert.equal(result.error,null);
 assert.equal(result.data.length,1501);
 assert.equal((await p.cache.rows('leads','u1')).data.length,1501);
});
test('verification reads bypass cache and deletes remove the cached row',async()=>{
 const e=environment();const p=e.page();await p.load();await p.client.from('businesses').select('*').eq('id','b1').single();assert.equal(e.calls.length,4);
 await p.client.from('businesses').delete().eq('id','b1');assert.equal((await p.cache.rows('businesses','u1')).data.length,0);assert.equal(e.calls.length,5);
});
test('changing login session without logout invalidates records',async()=>{
 const e=environment();const p=e.page();await p.load();p.session.access_token='x.'+Buffer.from(JSON.stringify({session_id:'s2'})).toString('base64')+'.x';await p.load();assert.equal(e.calls.length,6);
});
test('all modified page scripts and authentication parse',()=>{
 for(const path of ['businesses.html','leads.html','leads-hub.html']){
  const html=fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
 }
 new vm.Script(fs.readFileSync(new URL('../js/auth.js',import.meta.url),'utf8'));
});

test('buyer screen never trusts an empty page snapshot and loads rows before optional lookups',()=>{
 const html=fs.readFileSync(new URL('../leads.html',import.meta.url),'utf8');
 assert.match(html,/c\.leads\.length === 0[\s\S]*return false/);
 assert.match(html,/loadLeads\(\{ revalidate:true, preserveExisting:restored/);
 assert.match(html,/if \(!LEADS_DATA_READY\) return;/);
 const init=html.slice(html.indexOf('(async function init(){'));
 assert.ok(init.indexOf('await loadLeads({ revalidate:true') < init.indexOf('Promise.allSettled([loadUsers()'), 'optional buyer requests start only after primary rows finish');
 const load=html.slice(html.indexOf('async function loadLeads'), html.indexOf('async function maybeHandleUrlParams'));
 assert.ok(load.indexOf('paintLeadRows(cached)') < load.indexOf('forceRefresh:refresh'), 'stale buyer rows paint before the revalidation request');
});

test('business list paints rows before indicators and counts files from metadata',()=>{
 const html=fs.readFileSync(new URL('../businesses.html',import.meta.url),'utf8');
 const load=html.slice(html.indexOf('async function loadBusinesses'), html.indexOf('let businessIndicatorGen'));
 assert.ok(load.indexOf('paintBusinessRows(data)') < load.indexOf('scheduleBusinessIndicators()'), 'rows render before indicator requests start');
 assert.doesNotMatch(load, /await Promise\.all\(\[loadGrantCounts/);
 assert.match(html, /loadBusinesses\(\{ revalidate:true, preserveExisting:restored/);
 const files=html.slice(html.indexOf('async function loadFilesIndicator'), html.indexOf('function filesIndicatorBadge'));
 assert.match(files, /business_file_meta/);
 assert.doesNotMatch(files, /\.storage\.from\(BIZ_FILES_BUCKET\)\.list/);
 assert.match(html, /scheduleBusinessIndicators\(\)/);
});

test('list freshness expires without making an ordinary read hit the network',async()=>{
 const e=environment();const p=e.page();await p.start();
 await p.cache.rows('businesses','u1');
 assert.equal(p.cache.listFresh('businesses','u1'),true);
 assert.equal(p.cache.shouldRevalidateList('businesses','u1',{revalidate:true}),false);
 assert.equal(p.cache.shouldRevalidateList('businesses','u1',{forceRefresh:true}),true,'explicit retry still bypasses the TTL');
 e.clock.now+=60000;
 assert.equal(p.cache.listFresh('businesses','u1'),false);
 assert.equal(p.cache.shouldRevalidateList('businesses','u1',{revalidate:true}),true);
 await p.cache.flush();
 const next=e.page();await next.start();
 assert.equal(next.cache.listFresh('businesses','u1'),false,'freshness survives a new page');
 assert.equal((await next.cache.rows('businesses','u1')).data.length,1);
 assert.equal(e.calls.length,1,'a stale cache is still served until the screen asks to revalidate');
});

test('stalled browser storage cannot prevent dataset loading',async()=>{
 const e=environment(true,true);const p=e.page();const result=await p.load();assert.equal(result[0].data.length,1);assert.equal(result[1].data.length,1501);
});

test('authentication returns without waiting for unrelated background datasets',async()=>{
 const auth=fs.readFileSync(new URL('../js/auth.js',import.meta.url),'utf8');
 const start=auth.indexOf('async function requireAuth()');const end=auth.indexOf('// ============================================================',start);
 const session={user:{id:'u1'}},profile={id:'u1',role:'admin',status:'active'};
 const query={select(){return this},eq(){return this},single(){return Promise.resolve({data:profile,error:null})}};
 let calls=0;
 const sandbox={setTimeout,clearTimeout,console,document:{getElementById:()=>null},window:{supabaseClient:{auth:{getSession:async()=>({data:{session}})},from:()=>query},BSDDataCache:{activate:async()=>{},observeWrites(){},rows(){calls++;return new Promise(()=>{})}}}};
 vm.createContext(sandbox);vm.runInContext(auth.slice(start,end),sandbox);
 let timer;try {const result=await Promise.race([sandbox.requireAuth(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('authentication is blocked by preloading')),100)})]);assert.equal(result.id,'u1');assert.equal(calls,2);}finally{clearTimeout(timer)}
});

test('stalled data request ends with an error and permits a successful retry',async()=>{
 const e=environment();const p=e.page();await p.start();e.setStall(true);assert.ok((await p.cache.rows('businesses','u1')).error);e.setStall(false);assert.equal((await p.cache.rows('businesses','u1')).data.length,1);
});

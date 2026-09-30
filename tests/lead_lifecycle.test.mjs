import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync(new URL('../js/leadLifecycle.js',import.meta.url),'utf8'),ctx);
const {pending}=ctx.BSDLeadLifecycle;
test('only unresolved leads remain regardless of agreement; archived destination counts as transferred',()=>{
 const leads=[
  {id:'buyer',type:'buyer'}, {id:'partner',type:'partner'},
  {id:'seller',type:'seller'}, {id:'linked',type:'seller'},
  {id:'old-archive',type:'seller'},
  {id:'manual',type:'buyer',website_intake_stage:'new',source:'הזנה ידנית'},
  {id:'site',type:'seller',website_intake_stage:'contacted',source:'אתר BSD החדש'},
  {id:'archive',type:'seller',is_archived:true},
  {id:'training',type:'buyer',website_intake_stage:'training'}
 ];
 const before=JSON.stringify(leads);
 assert.deepEqual(Array.from(pending(leads,[{seller_id:'linked'},{seller_id:'old-archive',is_archived:true}]),l=>l.id),['seller','manual','site']);
 assert.equal(JSON.stringify(leads),before);
 assert.equal(ctx.BSDLeadLifecycle.isWebsite(leads[5]),false);
 assert.equal(ctx.BSDLeadLifecycle.isWebsite(leads[6]),true);
});
test('conversion leaves same buyer card intact but removes it from inbox',()=>{
 const lead={id:'same',type:'buyer',website_intake_stage:'new',notes:'all notes',phone:'0500000000'};
 assert.equal(pending([lead],[]).length,1);
 lead.website_intake_stage=null;
 assert.equal(pending([lead],[]).length,0);
 assert.equal(lead.notes,'all notes');assert.equal(lead.id,'same');
});
const html=fs.readFileSync(new URL('../leads-hub.html',import.meta.url),'utf8');
test('archive action preserves source and tasks, handles failure without success',async()=>{
 const code=html.slice(html.indexOf('async function deleteRecord(id)'),html.indexOf('let NOTES_SUMMARY'));
 for(const fail of [false,true]){
  let callback,updates=0,loads=0,closed=0;
  const c={currentRows:()=>[{id:'1',created_by:'u'}],canEditRecord:()=>true,
    openArchiveReasonModal:(label,fn)=>callback=fn,
    updateArchiveRecord:async(table,id,flag,reason)=>{updates++;assert.equal(table,'leads');assert.equal(flag,true);assert.equal(reason,'לא מעוניין');if(fail)throw Error('denied')},
    closeModal:()=>closed++,loadAll:async()=>loads++,toast:()=>{}};
  vm.createContext(c);vm.runInContext(code,c);await c.deleteRecord('1');
  if(fail)await assert.rejects(callback('לא מעוניין'));else await callback('לא מעוניין');
  assert.equal(updates,1);assert.equal(loads,fail?0:1);assert.equal(closed,fail?0:1);
 }
});
test('historical review is only completed after a persisted, verified destination',async()=>{
 const code=html.slice(html.indexOf('async function transferY2026Review('),html.indexOf('async function markY2026ReviewTransferred('));
 for(const fail of [false,true]){
  let stored=null,marked=0;
  const c={Y2026_REVIEW_ROWS:[{id:'r1',full_name:'Test Person',classification:'קונה עסק'}],CURRENT_PROFILE:{id:'u'},normalizeClassification:x=>x,toast:()=>{},markY2026ReviewTransferred:async(id,table,target)=>{assert.ok(stored);assert.equal(target,'r1');assert.equal(table,'leads');marked++},window:{supabaseClient:{from(){let values;return {select(){return this},eq(){return this},maybeSingle:async()=>({data:stored}),insert(v){values=v;return this},single:async()=>{if(fail)return {error:{message:'failed'}};if(values)stored=values;return {data:stored}}}}}}};
  vm.createContext(c);vm.runInContext(code,c);await c.transferY2026Review('r1');assert.equal(marked,fail?0:1);
 }
});

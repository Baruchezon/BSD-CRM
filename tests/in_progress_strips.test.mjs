import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync(new URL('../leads-hub.html', import.meta.url),'utf8');
const fn = name => html.slice(html.indexOf('function '+name+'('), html.indexOf('\n}', html.indexOf('function '+name+'('))+2);
function harness(editable=true){
 const c={esc:s=>String(s??'').replaceAll('<','&lt;'),canEditRecord:()=>editable,canSendAgreement:()=>true,
 stagedTable:r=>r.__staged==='business'?'businesses':'leads',notesTooltip:()=> 'הערות',
 leadBusinessLabel:r=>r.business_name||'',leadSourceBadge:()=>'<span>מקור</span>',
 leadCallStatusValue:()=> 'not_contacted',LEAD_CALL_ROW_CLASS:{},LEAD_CALL_STATUSES:[['not_contacted','ממתין']],
 leadCallStatusOptions:()=>'<option>ממתין</option>',nextDueHtml:()=>'',fmtDayMonth:()=>'',
 fmtPhone:p=>p,fmtDate:()=> '04.11.2026',waBtn:p=>`<a href="https://wa.me/${p}">WhatsApp</a>`,
 creatorColor:()=>'',userName:()=> 'משתמש',rowNotesCell:r=>r.notes||'—'};
 vm.createContext(c);vm.runInContext(fn('stagedRowHtml'),c);return c;
}
for(const kind of ['business','buyer']) test(kind+' renders full actionable table rows',()=>{
 const c=harness();const r={id:'r1',__staged:kind,crm_stage:'in_progress',owner_name:'בעל העסק',internal_name:'מאפייה',full_name:'קונה',phone:'0520000000',owner_phone:'0500000000',business_number:'BSD-B-42',notes:'תוכן השיחה',created_by:'u'};
 const row=c.stagedRowHtml(r,true);
 assert.equal((row.match(/<td\b/g)||[]).length,8);
 const phone=kind==='business'?r.owner_phone:r.phone;
 assert.ok(row.includes('href="tel:'+phone+'"'));assert.ok(row.includes('https://wa.me/'+phone));
 assert.ok(row.includes(kind==='business'?r.owner_name:r.full_name));
 assert.ok(row.includes('notes-cell'));assert.ok(row.includes(r.notes));
 assert.ok(row.includes("deleteRecord('r1')"));assert.ok(row.includes("stagedSendAgreement('r1')"));
 assert.ok(row.includes('toggleFormsMenu(event)'));assert.ok(row.includes("openStagedCard('r1')"));
 assert.ok(!row.includes('colspan='));assert.ok(!row.includes('tel:BSD-B-42'));
 assert.equal(row.includes('setLeadCallStatus('),kind!=='business');
});
test('read only rows omit mutating actions',()=>{
 const row=harness(false).stagedRowHtml({id:'x',__staged:'business'},false);
 assert.ok(!row.includes('deleteRecord('));assert.ok(!row.includes('stagedSendAgreement('));assert.ok(!row.includes('moveStaged('));
 assert.equal((row.match(/<td\b/g)||[]).length,6);
});
test('archive routes staged records to their actual table',async()=>{
 for(const kind of ['business','buyer',null]){
  const writes=[];const row={id:'r1',__staged:kind};
  const c={currentRows:()=>[row],canEditRecord:()=>true,stagedTable:r=>r.__staged==='business'?'businesses':'leads',
  openArchiveReasonModal:async(t,save)=>save('לא רלוונטי'),updateArchiveRecord:async(...args)=>writes.push(args),closeModal(){},loadAll:async()=>{},toast(){}};
  vm.createContext(c);vm.runInContext('async '+fn('deleteRecord'),c);await c.deleteRecord('r1');await new Promise(r=>setImmediate(r));
  assert.deepEqual(writes,[[kind==='business'?'businesses':'leads','r1',true,'לא רלוונטי']]);
 }
});
test('lead menu selects the requested destination and focuses the corresponding save button',()=>{
 for(const category of ['buyer','seller',null]){
  const target={value:''};const actions=[];const c={ALL_MANUAL:[{id:'x'}],ALL_SELLERS:[],canEditRecord:()=>true,canSendAgreement:()=>true,
   document:{querySelectorAll:()=>[],getElementById:id=>id==='wlTransferTarget'?target:{scrollIntoView(){},focus(){actions.push(id)}}},openWebsiteLead:id=>actions.push(id),toast(){}};
  vm.createContext(c);vm.runInContext(fn('openLeadAction'),c);c.openLeadAction('x',category,!category);
  assert.equal(target.value,category||'');assert.deepEqual(actions,['x',category?'wlSaveBtn':'wlAgreementBtn']);
 }
 assert.ok(html.includes("openLeadAction('${r.id}','buyer')"));assert.ok(html.includes("openLeadAction('${r.id}','seller')"));
 assert.ok(html.includes("openLeadAction('${r.id}',null,true)"));
});
test('in progress has visible table headers and 2026 keeps its independent renderer',()=>{
 assert.ok(fn('isCallStatusTab').includes("CURRENT_TAB === 'in_progress'"));
 assert.ok(fn('renderLeadsTableHead').includes('thead.hidden = false'));
 const review=html.slice(html.indexOf('async function renderY2026ReviewTable'),html.indexOf('function y2026AgreementSummary'));
 assert.ok(!review.includes('stagedRowHtml'));
});

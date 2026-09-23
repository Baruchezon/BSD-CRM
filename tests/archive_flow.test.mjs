import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const shared=read('js/archiveModule.js');
function fn(html,name){const start=html.search(new RegExp('(?:async )?function '+name+'\\('));assert.ok(start>=0,name);return html.slice(start,html.indexOf('\n}',start)+2);}
function harness(biz){
 const nodes=new Map();
 function node(id){const el={id,style:{},value:'',disabled:false,isConnected:true,textContent:'',classList:{remove(){},toggle(){}},focus(){document.activeElement=this},remove(){this.isConnected=false;nodes.delete(this.id)},querySelector(s){return nodes.get(s.slice(1))},querySelectorAll(){return []}};Object.defineProperty(el,'innerHTML',{get(){return el.html||''},set(v){el.html=v;for(const m of v.matchAll(/id="([^"]+)"/g)){const child=node(m[1]);if(m[1]==='archReasonSelect')child.value='לא רלוונטי'}}});nodes.set(id,el);return el}
 const document={activeElement:node('original'),createElement:()=>node('new'),body:{appendChild(el){nodes.set(el.id,el)}},getElementById:id=>nodes.get(id),querySelectorAll:()=>[]};
 node('overlay');node('modalBox');node('bizViewArchiveBtn');node('leadViewArchiveBtn');
 const cache=new Map(),messages=[],writes=[];let behavior='ok';
 let row={id:'r1',is_archived:false,internal_name:'Business',full_name:'Buyer',created_by:'u1',type:'buyer'};
 const client={from(table){let values,id;return {update(v){values=v;return this},eq(k,v){id=v;return this},select(){return this},async single(){writes.push({table,values,id});await Promise.resolve();if(behavior==='network')throw new Error('offline');if(behavior==='error')return {error:{message:'denied'}};if(behavior==='zero')return {data:null};if(behavior==='unchanged')return {data:{...row}};row={...row,...values,archived_by:values.is_archived?'u1':null,archived_at:values.is_archived?'2026-09-23':null,archive_reason:values.is_archived?values.archive_reason:null};return {data:{...row}}}}}};
 const s={document,window:{supabaseClient:client,BSDDataCache:{set:(k,u,v)=>cache.set(k,structuredClone(v)),get:k=>cache.get(k)}},history:{},location:{pathname:'/'},CURRENT_PROFILE:{id:'u1',role:'admin'},ALL_BIZ:biz?[row]:[],ARCHIVED_BIZ:[],ALL_LEADS:biz?[]:[row],ARCHIVED_LEADS:[],ALL_SELLERS:[],ALL_BROKERS_FOR_REFERRAL:[],BROKER_NAME_BY_ID:{},ALL_USERS:[],GRANT_COUNTS:{},FILES_COUNT_BY_BIZ:{},EXTENDED_SUMMARY_FILEMETA_BY_BIZ:{},EXTENDED_SUMMARY_SALEFILE_BY_BIZ:{},VIP_PUBLICATION_BY_BIZ:{},RATING_LEVELS:[],MATCH_COUNT_BY_BUYER:{},toast:t=>messages.push(t),confirm:()=>true,renderTable(){},populateFilters(){},populateStatusFilter(){},populateCreatedByFilter(){},populateRatingFilter(){}};
 const html=read(biz?'businesses.html':'leads.html');const kind=biz?'Biz':'Lead';
 const funcs=['archive'+kind,'restore'+kind+'FromArchive','closeModal','canManage'+kind,'canRestore'+kind,biz?'saveBusinessPageCache':'saveLeadsPageCache',biz?'restoreBusinessPageCache':'restoreLeadsPageCache',biz?'setBizViewMode':'setLeadViewMode'];
 vm.createContext(s);vm.runInContext(shared+'\n'+funcs.map(n=>fn(html,n)).join('\n'),s);
 return {s,nodes,writes,messages,cache,setBehavior:v=>behavior=v,archive:()=>s['archive'+kind]('r1'),restore:()=>s['restore'+kind+'FromArchive']('r1'),active:()=>s[biz?'ALL_BIZ':'ALL_LEADS'],archived:()=>s[biz?'ARCHIVED_BIZ':'ARCHIVED_LEADS'],reload:()=>s[biz?'restoreBusinessPageCache':'restoreLeadsPageCache']()};
}
for(const biz of [true,false]){
 test((biz?'business':'buyer')+' archive, failure/retry, cache navigation and restore',async()=>{
  const h=harness(biz);await h.archive();
  assert.match(h.nodes.get('archiveReasonRoot').innerHTML,/class="overlay open" style="display:flex/);
  h.nodes.get('archReasonCancelBtn').onclick();assert.equal(h.writes.length,0);
  await h.archive();h.nodes.get('archReasonSelect').value='אחר';
  await h.nodes.get('archReasonConfirmBtn').onclick();assert.equal(h.writes.length,0);
  assert.match(h.nodes.get('archReasonStatus').textContent,/נדרשת סיבה/);
  h.nodes.get('archReasonOtherText').value='Custom reason';
  for(const type of ['zero','error','network','unchanged']){
   h.setBehavior(type);await h.nodes.get('archReasonConfirmBtn').onclick();
   assert.match(h.nodes.get('archReasonStatus').textContent,/שגיאה/);
   assert.equal(h.active().length,1);assert.equal(h.archived().length,0);
   assert.equal(h.messages.length,0);assert.equal(h.nodes.get('archReasonOtherText').value,'Custom reason');
  }
  h.setBehavior('ok');h.writes.length=0;
  const button=h.nodes.get('archReasonConfirmBtn');const saving=button.onclick();
  assert.equal(button.disabled,true);await button.onclick();await saving;
  assert.equal(h.writes.length,1);assert.equal(h.active().length,0);assert.equal(h.archived().length,1);
  assert.equal(h.archived()[0].archive_reason,'Custom reason');assert.equal(h.archived()[0].archived_by,'u1');
  assert.equal(h.nodes.has('archiveReasonRoot'),false);
  h.s[biz?'ALL_BIZ':'ALL_LEADS']=[];h.s[biz?'ARCHIVED_BIZ':'ARCHIVED_LEADS']=[];
  h.reload();assert.equal(h.archived().length,1,'navigation restores archived row from cache');
  h.setBehavior('zero');await h.restore();assert.equal(h.archived().length,1);
  h.setBehavior('ok');await h.restore();assert.equal(h.active().length,1);assert.equal(h.archived().length,0);
  assert.equal(h.active()[0].archive_reason,null);
  if(biz)assert.equal(h.active()[0].listing_status,'active');
 });
 test((biz?'business':'buyer')+' does not archive without manage permission',async()=>{
  const h=harness(biz);h.s.CURRENT_PROFILE={id:'someone-else',role:'agent'};
  await h.archive();assert.equal(h.writes.length,0);assert.equal(h.nodes.has('archiveReasonRoot'),false);
 });
}
test('production scripts parse and no nonexistent closeBizForm calls remain',()=>{
 for(const name of ['businesses.html','leads.html']){
  const html=read(name);for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
  assert.ok(!html.includes('closeBizForm()'));
 }
});

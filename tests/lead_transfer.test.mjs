import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync(new URL('../leads-hub.html', import.meta.url), 'utf8');
const code = html.slice(html.indexOf('function websiteLeadTransferNotes('), html.indexOf('async function rejectWebsiteLead('));
function harness({category='seller', investor=false, failInsert=false, failUpdate=false, lostInsert=false, rejectRead=false}={}) {
  const lead = {id:'lead-1',full_name:'Test Owner',phone:'0500000000',email:'test@example.test',business_name:'Test Shop',business_city:'Test City',business_field:'Retail',asking_price:0,notes:'Original inquiry',created_by:'user-1',website_intake_stage:'contacted'};
  const tables={leads:[lead],businesses:[]}; const events=[]; const removed=[];
  let leadWrites=0;
  const db={from(table){let action='select',values,filters=[];const q={
    select(){return q},eq(k,v){filters.push([k,v]);return q},limit(){return q},
    insert(v){action='insert';values=v;return q},update(v){action='update';values=v;return q},
    single(){return run(true)},maybeSingle(){return run(true)},then(ok,bad){return run(false).then(ok,bad)}
  };async function run(single){
    events.push(table+':'+action);
    if(action==='insert'){
      if(failInsert)return {error:{message:'insert denied'}};
      if(tables[table].some(r=>r.id===values.id))return {error:{message:'duplicate'}};
      tables[table].push({...values});
      if(lostInsert)return {error:{message:'response lost'}};
      return {data:{...values}};
    }
    const rows=tables[table].filter(r=>filters.every(([k,v])=>r[k]===v));
    if(action==='update'){
      if(table==='leads'){leadWrites++;if(failUpdate)return {error:{message:'update denied'}};}
      rows.forEach(r=>Object.assign(r,values));
    }
    if(rejectRead && table==='businesses' && filters.some(([k])=>k==='id'))return {data:null,error:{message:'read denied'}};
    return {data:single?structuredClone(rows[0]||null):structuredClone(rows)};
  }return q}};
  const fields={wlSaveBtn:{disabled:false},wlSaveError:{style:{}},wlSaveOk:{style:{}},wlSummary:{value:'Summary'},wlWants:{value:'Wants'},wlDetails:{value:'Details'},wlNotes:{value:'Call note'},wlInvestorFlag:{checked:investor}};
  const ctx={window:{supabaseClient:db,BSDDataCache:{remove:(...x)=>removed.push(x)}},CURRENT_PROFILE:{id:'user-1'},document:{getElementById:k=>fields[k],querySelector:()=>({value:category})},location:{href:''},loadAll:async()=>{},closeModal(){},setTimeout:f=>f(),encodeURIComponent};
  ctx.verifyLeadWrite=async(id,expected)=>({ok:Object.entries(expected).every(([k,v])=>lead[k]===v),mismatches:[]});
  vm.createContext(ctx);vm.runInContext(code,ctx);
  return {ctx,lead,tables,events,fields,removed,get leadWrites(){return leadWrites},run:()=>ctx.saveWebsiteLeadTransfer(lead.id)};
}
test('seller creates linked business with all available mapped data before completing lead; opens card and clears cache',async()=>{
 const h=harness();await h.run();const b=h.tables.businesses[0];
 assert.equal(b.internal_name,'Test Shop');assert.equal(b.seller_id,h.lead.id);assert.equal(b.owner_phone,h.lead.phone);assert.equal(b.asking_price,0);assert.equal(b.city,'Test City');
 for(const text of ['Original inquiry','Summary','Wants','Details','Call note'])assert.ok(b.notes.includes(text));
 assert.equal(h.lead.website_intake_stage,null);assert.match(h.ctx.location.href,/businesses.html\?open=lead-1/);assert.equal(h.removed.length,2);
 assert.ok(h.events.indexOf('businesses:insert')<h.events.indexOf('leads:update'));
});
test('business creation failure leaves lead in inbox, exposes error and allows retry',async()=>{
 const h=harness({failInsert:true});await h.run();assert.equal(h.leadWrites,0);assert.equal(h.lead.website_intake_stage,'contacted');assert.equal(h.fields.wlSaveBtn.disabled,false);assert.equal(h.ctx.location.href,'');
});
test('business verification failure cannot report completed transfer',async()=>{
 const h=harness({rejectRead:true});await h.run();assert.equal(h.leadWrites,0);assert.equal(h.ctx.location.href,'');assert.equal(h.fields.wlSaveError.style.display,'block');
});
test('retry after lead write failure reuses business and preserves edited business fields',async()=>{
 const h=harness({failUpdate:true});await h.run();h.tables.businesses[0].internal_name='Edited name';await h.run();assert.equal(h.tables.businesses.length,1);assert.equal(h.tables.businesses[0].internal_name,'Edited name');assert.equal(h.tables.businesses[0].notes.split('Call note').length,2);
});
test('lost insert response recovers existing linked business',async()=>{
 const h=harness({lostInsert:true});await h.run();assert.equal(h.tables.businesses.length,1);assert.match(h.ctx.location.href,/businesses/);
});
test('double click creates only one business',async()=>{
 const h=harness();await Promise.all([h.run(),h.run()]);assert.equal(h.tables.businesses.length,1);assert.equal(h.leadWrites,1);
});
for(const investor of [false,true])test('buyer or investor retains lead data, clears cache and opens correct card '+investor,async()=>{
 const h=harness({category:'buyer',investor});await h.run();assert.equal(h.tables.businesses.length,0);assert.equal(h.lead.type,investor?'partner':'buyer');assert.ok(h.lead.notes.includes('Summary'));assert.match(h.ctx.location.href,/leads.html\?open=lead-1/);assert.equal(h.removed.length,2);
});
for(const category of ['training',''])test('unconverted paths remain supported '+category,async()=>{
 const h=harness({category});await h.run();assert.equal(h.tables.businesses.length,0);assert.equal(h.ctx.location.href,'');assert.equal(h.lead.website_intake_stage,category?'training':'contacted');
});
test('all inline scripts parse',()=>{
 for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
});

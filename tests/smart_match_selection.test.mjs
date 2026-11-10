import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { buildSuggestions, profileBuyer, profileBusiness, scorePair, MIN_SCORE } from '../supabase/functions/match-suggestions-report/engine.js';
import { parseSelection, selectRecords, readAll, visiblePhones } from '../supabase/functions/match-suggestions-report/selection.js';
const b = {id:'11111111-1111-4111-8111-111111111111',full_name:'בדיקת קונה',requested_field:'מזון',budget:800000,requested_area:'מרכז, חיפה',notes:''};
const z = {id:'22222222-2222-4222-8222-222222222222',internal_name:'בדיקת מסעדה',field:'מסעדה',city:'חיפה',asking_price:650000,short_description:'מסעדה פעילה'};
test('both directions compare selected record against every opposite record', () => {
  const data={buyers:[b,{...b,id:'33333333-3333-4333-8333-333333333333'}],businesses:[z,{...z,id:'44444444-4444-4444-8444-444444444444'}]};
  for(const [type,id,nBuyers,nBiz] of [['business',z.id,2,1],['buyer',b.id,1,2]]){
    const scoped=selectRecords(data,parseSelection({target_type:type,target_id:id}));
    const r=buildSuggestions(scoped);
    assert.equal(r.stats.buyers,nBuyers);assert.equal(r.stats.businesses,nBiz);assert.equal(r.suggestions.length,2);
    assert.ok(r.suggestions.every(s=>s.score>60));
  }
});
test('food includes restaurants and food retail, but not unrelated industry',()=>{
 const r=buildSuggestions({buyers:[b],businesses:[z,{...z,id:'retail',field:'סופרמרקט'},{...z,id:'industry',field:'עיבוד שבבי',short_description:'ייצור חלקי מתכת'}]});
 assert.deepEqual(r.suggestions.map(s=>s.business_id).sort(),[z.id,'retail'].sort());
});
test('explicit no food excludes restaurants and food retail',()=>{
 const r=buildSuggestions({buyers:[{...b,requested_field:'',notes:'מחפש עסק רווחי, לא מזון. פתוח לכל תחום'}],businesses:[z,{...z,id:'retail',field:'סופרמרקט'}]});
 assert.equal(r.suggestions.length,0);assert.equal(r.rejected.length,2);
});
test('budget gap, strict area, and missing sector cannot get above 60 even with other signals',()=>{
 for(const candidate of [{...b,budget:100000},{...b,requested_area:'',notes:'מחפש מסעדה רק באילת'},{...b,requested_field:'',requested_area:'כל הארץ'}]){
   const r=buildSuggestions({buyers:[candidate],businesses:[z]});assert.equal(r.suggestions.length,0);
 }
 assert.equal(MIN_SCORE,61);
});
test('a price far above budget is capped at 60 and excluded by the default threshold',()=>{
 const candidate={...b,requested_field:'מסעדה',requested_area:'',budget:100000};
 const pair=scorePair(profileBuyer(candidate),profileBusiness(z));
 assert.ok(pair && pair.score <= 60, 'capped ' + (pair && pair.score));
 const data={buyers:[candidate],businesses:[z]};
 assert.equal(buildSuggestions(data,{minScore:0}).suggestions.length,1);
 assert.equal(buildSuggestions(data).suggestions.length,0);
});
test('unknown or unauthorized selection is rejected, never broadens search',()=>{
 assert.ok(parseSelection({target_type:'business',target_id:'bad'}).error);
 assert.ok(parseSelection({target_type:'other',target_id:b.id}).error);
 assert.ok(selectRecords({buyers:[b],businesses:[]},{type:'business',id:z.id}).error);
});
test('search phones stay off the wire unless the caller is an admin or manager', () => {
  assert.deepEqual(visiblePhones(false, ['050-1111111', '']), []);
  assert.deepEqual(visiblePhones(true, ['050-1111111', ' ', null]), ['050-1111111']);
});
test('pagination reads beyond 1000 and rejects partial data on error',async()=>{
 const rows=Array.from({length:1207},(_,id)=>({id}));let pages=0;
 const result=await readAll(()=>({order(){return this},async range(a,c){pages++;return {data:rows.slice(a,c+1)}}}));
 assert.equal(result.data.length,1207);assert.equal(pages,3);
 const failed=await readAll(()=>({order(){return this},async range(a,c){return a?{error:{message:'failed'}}:{data:rows.slice(a,c+1)}}}));
 assert.ok(failed.error);assert.equal(failed.data.length,0);
});
test('endpoint authorization, options, selection and live response shape with mocked database',async()=>{
 let handler;let role='admin';let status='active';let loggedIn=true;
 const tables={leads:[b],businesses:[z],matches:[],anon_distributions:[],record_notes:[]};
 const client={auth:{getUser:async()=>loggedIn?{data:{user:{id:'admin'}}}:{error:{message:'no'}}},from(table){
  if(table==='profiles')return {select(){return this},eq(){return this},maybeSingle:async()=>({data:{role,status,can_use_ai_match:false}})};
  if(table==='reports_config')return {select(){return this},eq(){return this},maybeSingle:async()=>({data:null})};
  return {select(){return this},eq(){return this},or(){return this},is(){return this},not(){return this},in(){return this},order(){return this},range:async(a,c)=>({data:(tables[table]||[]).slice(a,c+1),error:null})};
 }};
 let src=readFileSync(new URL('../supabase/functions/match-suggestions-report/index.ts',import.meta.url),'utf8').replace(/^import .*;$/gm,'');
 src=stripTypeScriptTypes(src);
 const engine=await import('../supabase/functions/match-suggestions-report/engine.js');
 const context={...engine,readAll,parseSelection,selectRecords,visiblePhones,createClient:()=>client,Deno:{env:{get:()=>''},serve:h=>{handler=h}},Response,Date,fetch:()=>{throw new Error('No emails in tests')}};
 vm.runInNewContext(src,context);
 const request=body=>new Request('https://test/',{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify(body)});
 let response=await handler(request({action:'options'}));let data=await response.json();assert.equal(response.status,200);assert.equal(data.businesses.length,1);assert.equal(data.buyers.length,1);
 assert.equal(data.buyers[0].phone,undefined);assert.deepEqual(data.buyers[0].phones,[]);assert.deepEqual(data.businesses[0].phones,[]);
 for(const type of ['buyer','business']){response=await handler(request({target_type:type,target_id:type==='buyer'?b.id:z.id}));data=await response.json();assert.equal(data.suggestions.length,1);assert.equal(data.selection.type,type);assert.ok(data.suggestions[0].score>60);assert.match(data.suggestions[0].buyer_brief.looking,/מזון/);assert.match(data.suggestions[0].business_brief.looking,/מסעדה/);assert.equal(data.suggestions[0].buyer_brief.latest.includes('שיחה'),false);}
 response=await handler(request({target_type:'buyer',target_id:'55555555-5555-4555-8555-555555555555'}));assert.equal(response.status,404);
 response=await handler(request({target_type:'buyer',target_id:'bad'}));assert.equal(response.status,400);
 role='agent';response=await handler(request({action:'options'}));assert.equal(response.status,403);
 role='admin';status='inactive';response=await handler(request({action:'options'}));assert.equal(response.status,403);
 loggedIn=false;response=await handler(request({action:'options'}));assert.equal(response.status,401);
});

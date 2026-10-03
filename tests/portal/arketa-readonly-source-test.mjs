import {createSourceHandler} from '../../supabase/functions/arketa-preview-readonly/index.ts';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
// Synthetic source responses only. No network access.
globalThis.fetch=()=>{throw Error('Network forbidden in tests');};
const token='a'.repeat(64),tokenHash=createHash('sha256').update(token).digest('hex');
const businessId='a2eaafcf-b900-4c10-a5b8-fb175d0d417c';
const newestId='11111111-1111-4111-8111-111111111111',oldId='22222222-2222-4222-8222-222222222222';
let archived=false,signed=true,badPdf=false,failed=false;const reads=[];
const file={id:newestId,business_id:businessId,category:'exec_summary',document_type:'internal_full_summary',file_name:'test.pdf',storage_path:businessId+'/test.pdf',file_type:'application/pdf',created_at:'2026-10-01T00:00:00Z'};
const source=createSourceHandler({serviceKey:'synthetic-only',tokenHash,fetcher:async(url,options)=>{
 assert.equal(options.method,'GET');const u=new URL(url);assert.equal(u.origin,'https://zcdlegcvfirwzitfxjcs.supabase.co');reads.push(u);
 if(failed)return new Response('failure',{status:500});
 if(u.pathname.includes('/storage/'))return new Response(badPdf?'invalid':'%PDF-test');
 const table=u.pathname.split('/').at(-1);
 if(table==='businesses'){assert.equal(u.searchParams.get('id'),'eq.'+businessId);return Response.json([{id:businessId,is_archived:archived,agreement_status:signed?'יש הסכם חתום':'ללא הסכם'}]);}
 assert.equal(u.searchParams.get('business_id'),'eq.'+businessId);
 if(table==='business_sale_files')return Response.json([{...file,id:oldId,created_at:'2026-01-01T00:00:00Z'},file]);
 if(table==='matches')return Response.json([]);throw Error('Unexpected table');
}});
const call=(body,key=token,method='POST')=>source(new Request('https://function.test',{method,headers:{'x-portal-read-key':key},...(method==='POST'?{body:JSON.stringify(body)}:{})}));
assert.equal((await call({action:'dashboard'},'bad')).status,401);assert.equal(reads.length,0);
assert.equal((await call({action:'dashboard'},token,'GET')).status,405);
assert.equal((await call({action:'dashboard',business_id:'another-business'})).status,403);assert.equal(reads.length,0);
assert.equal((await call({action:'update'})).status,400);assert.equal(reads.length,0);
let r=await call({action:'dashboard'});assert.equal(r.status,200);let d=await r.json();assert.equal(d.files.length,1);assert.equal(d.files[0].id,newestId);
assert.equal((await call({action:'file',file_id:oldId})).status,404);
assert.equal((await call({action:'file',file_id:'33333333-3333-4333-8333-333333333333'})).status,404);
r=await call({action:'file',file_id:newestId});assert.equal(r.status,200);assert.equal(await r.text(),'%PDF-test');
badPdf=true;assert.equal((await call({action:'file',file_id:newestId})).status,422);badPdf=false;
archived=true;assert.equal((await call({action:'dashboard'})).status,409);archived=false;
signed=false;assert.equal((await call({action:'dashboard'})).status,409);signed=true;
failed=true;assert.equal((await call({action:'dashboard'})).status,503);
console.log('PASS: read-only GETs, fixed Arketa scope, server-only auth, newest documents, old/foreign file denial, original PDF validation, archive/agreement revocation, fail-closed source errors');

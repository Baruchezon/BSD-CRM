import {readFile} from 'node:fs/promises';import vm from 'node:vm';import assert from 'node:assert/strict';
// Synthetic PDFs and mocked CRM/storage only. No external requests or report writes.
const id='11111111-1111-4111-8111-111111111111';let uploads=[],inserts=[],removed=[],unauthorized=false,insertFails=false,pdfBuilds=0;
const pdf=new Blob(['%PDF-1.7\nSYNTHETIC TEST'],{type:'application/pdf'});
const context={Blob,TextDecoder,crypto,confirm:()=>true,BUSINESSES:[{dateFrom:new Date('2026-10-01'),dateTo:new Date('2026-10-03')}],getPages:()=>['test'],buildPdfBlobFromPages:async()=>{pdfBuilds++;return pdf;},fetch:async(_url,options)=>{const body=JSON.parse(options.body);assert.equal(body.action,'admin_detail');assert.equal(body.business_id,id);return Response.json(unauthorized?{error:'forbidden'}:{business:{id,internal_name:'TEST BUSINESS',is_archived:false},account:{status:'active'}},{status:unauthorized?403:200});}};
context.window={BSD_CONFIG:{SELLER_PORTAL_API_URL:'https://synthetic.test'},supabaseClient:{auth:{getSession:async()=>({data:{session:{access_token:'TEST',user:{id:'manager'}}}})},storage:{from:()=>({upload:async(path,blob)=>{uploads.push({path,blob});return {error:null};},remove:async(paths)=>{removed.push(...paths);return {error:null};}})},from:table=>({insert:async(value)=>{assert.equal(table,'business_sale_files');inserts.push(value);return {error:insertFails?Error('TEST FAILURE'):null};}})}};
vm.runInNewContext(await readFile(new URL('../../js/portal-ad-reports.js',import.meta.url),'utf8'),context);
const api=context.window,g={name:'TEST REPORT',bizIndex:0};
assert.equal(await api.getAdReportPdf(g),pdf);assert.equal(await api.getAdReportPdf(g),pdf);assert.equal(pdfBuilds,1);
await assert.rejects(()=>api.saveAdReportToSellerPortal(g,pdf,''));assert.equal(uploads.length,0);
unauthorized=true;await assert.rejects(()=>api.saveAdReportToSellerPortal(g,pdf,id));assert.equal(uploads.length,0);unauthorized=false;
await api.saveAdReportToSellerPortal(g,pdf,id);assert.equal(uploads.length,1);assert.equal(uploads[0].blob,pdf);assert.ok(uploads[0].path.startsWith(id+'/'));
assert.equal(inserts[0].business_id,id);assert.equal(inserts[0].portal_kind,'advertising');assert.equal(inserts[0].portal_visible,true);
await api.saveAdReportToSellerPortal(g,pdf,id);assert.equal(uploads.length,1);
await assert.rejects(()=>api.saveAdReportToSellerPortal(g,pdf,'another-business'));assert.equal(uploads.length,1);
insertFails=true;await assert.rejects(()=>api.saveAdReportToSellerPortal({name:'FAILED TEST',bizIndex:0},pdf,id));assert.equal(removed.length,1);assert.equal(removed[0],uploads[1].path);
console.log('PASS report option: explicit business selection, manager authorization, original PDF identity, exact business/path scope, duplicate prevention, wrong-target denial, upload cleanup');

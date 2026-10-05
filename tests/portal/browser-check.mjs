// Browser checks for seller portal v2 (portal, admin screen, business-card control).
// Every API call is answered by a local mock: QA fixtures only, never a real client.
import {chromium} from 'playwright';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const repoRoot=fileURLToPath(new URL('../../',import.meta.url));
const shots=process.env.PORTAL_SCREENSHOTS||os.tmpdir();
const API='https://zcdlegcvfirwzitfxjcs.supabase.co/functions/v1/seller-portal-api';
const BIZ='11111111-1111-4111-8111-111111111111';
const CARD_HTML=`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:Arial;margin:16px}button{padding:6px 10px}</style></head><body><div id="host"></div>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script><script src="/js/config.js"></script><script src="/js/supabaseClient.js"></script><script src="/js/portal-invite.js"></script><script src="/js/portal-business-card.js"></script>
<script>const biz={id:'${BIZ}',internal_name:'עסק בדיקה',agreement_status:'יש הסכם חתום',is_archived:false};document.getElementById('host').innerHTML=BSDSellerPortal.markup(biz);BSDSellerPortal.mount(biz);</script></body></html>`;
const server=createServer(async(req,res)=>{try{let path=req.url.split('?')[0];if(path==='/__card.html'){res.setHeader('Content-Type','text/html');res.end(CARD_HTML);return;}if(path.endsWith('/'))path+='index.html';const type=path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.png')?'image/png':'text/html';res.setHeader('Content-Type',type);res.end(await readFile(repoRoot+path));}catch{res.statusCode=404;res.end();}});
await new Promise(resolve=>server.listen(8766,'127.0.0.1',resolve));
const browser=await chromium.launch({...(process.env.PORTAL_TEST_CHROMIUM?{executablePath:process.env.PORTAL_TEST_CHROMIUM}:{}),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const errors=[];
// Tiny 1x1 PNG.
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const SUPABASE_STUB=`window.supabase={createClient(){const calls=window.__storageCalls=[];const chain={select(){return chain},eq(){return chain},maybeSingle:async()=>({data:{role:'admin',status:'active'},error:null})};return{auth:{getSession:async()=>({data:{session:{access_token:'QA-ONLY-JWT',user:{id:'qa-admin'}}}})},from(){return chain},storage:{from(bucket){return{uploadToSignedUrl:async(path,token,file,opts)=>{calls.push({bucket,path,token,name:file.name,size:file.size,contentType:opts&&opts.contentType});return{data:{path},error:null};}}}}};}};`;
async function newPage(width,height,handler,calls){
 const context=await browser.newContext({viewport:{width,height},acceptDownloads:true});
 await context.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:SUPABASE_STUB}));
 await context.route('https://wa.me/**',r=>r.fulfill({contentType:'text/html',body:'<p>wa.me stub</p>'}));
 await context.route(API,async r=>{if(r.request().method()==='OPTIONS')return r.fulfill({status:204});const b=JSON.parse(r.request().postData()||'{}');calls.push({...b,headers:r.request().headers()});const out=await handler(b);if(out.body!==undefined)return r.fulfill({status:200,contentType:out.type,body:out.body});return r.fulfill({status:out.status||200,contentType:'application/json',body:JSON.stringify(out.json)});});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 return {context,page};
}
const noOverflow=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
// ---------- 1. Seller portal ----------
const docs=[['anonymous_summary','תקציר אנונימי'],['full_summary','תקציר מלא'],['valuation','הערכת שווי'],['market_research','חקר שוק']].map(([bucket,type],i)=>({id:`0000000${i}-0000-4000-8000-00000000000${i}`,file_source:'sale',name:`QA-${bucket}.pdf`,kind:'document',bucket,type,date:'2026-10-0'+(i+1)+'T08:00:00Z',mime:'application/pdf'}));
const extras=[{id:'e0000000-0000-4000-8000-000000000001',file_source:'extra',name:'QA-photo.png',kind:'extra',type:'קובץ נוסף',date:'2026-10-04T07:00:00Z',mime:'image/png',size:68},{id:'e0000000-0000-4000-8000-000000000002',file_source:'extra',name:'QA-plan.docx',kind:'extra',type:'קובץ נוסף',date:'2026-10-04T07:10:00Z',mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',size:10}];
const report={id:'r0000000-0000-4000-8000-000000000001',file_source:'sale',name:'QA-ads.pdf',kind:'advertising',type:'דוח פרסום',date:'2026-10-02T08:00:00Z',mime:'application/pdf'};
// Buyers table (approved 05.10.2026): fake rows only. The API returns names and badges, never contact details.
const QA_MATCHES=[{ref:1,buyer:'קונה בדיקה א (QA)',agreement:{key:'signed',label:'חתום',date:'2026-09-08T00:00:00Z'},stage:{label:'מתנהל משא ומתן',step:5,closed:false},materials:{level:'full',label:'חומרים מלאים',items:[{label:'תקציר מלא',date:'2026-09-12T00:00:00Z'}],date:'2026-09-12T00:00:00Z'},updated_at:'2026-10-01T00:00:00Z',notes:[{text:'הערה לבעל העסק (QA)',date:'2026-09-29T00:00:00Z'}]},
 {ref:2,buyer:'קונה בדיקה ב (QA)',agreement:{key:'none',label:'לא נשלח',date:null},stage:{label:'קיבל מידע ראשוני על העסק',step:2,closed:false},materials:{level:'anonymous',label:'מידע אנונימי בלבד',items:[{label:'תקציר אנונימי',date:'2026-09-26T00:00:00Z'}],date:'2026-09-26T00:00:00Z'},updated_at:'2026-09-26T00:00:00Z',notes:[]}];
for(const [name,width,height] of [['desktop',1440,1000],['mobile-375',375,812]]){
 const calls=[];let forced=false;
 const {context,page}=await newPage(width,height,async b=>{
  if(b.action==='login')return b.password==='QA-wrong'?{status:401,json:{error:'invalid_credentials'}}:{json:{ok:true,token:'QA-ONLY-TOKEN',must_change_password:forced}};
  if(b.action==='dashboard')return {json:{ok:true,business:{internal_name:'עסק בדיקה (QA)',owner_name:'בעלים לדוגמה',owner_phone:'050-0000000',city:''},files:[...docs,report,...extras],matches:QA_MATCHES,match_summary:{total:2,active:2,signed:1,full:1},update:null,contact:{phone:'03-0000000'}}};
  if(b.action==='change_password'){if(!forced&&b.current_password!=='QA-current-1')return {status:400,json:{error:'wrong_current_password'}};forced=false;return {json:{ok:true}};}
  if(b.action==='file'){const f=[...docs,report,...extras].find(x=>x.id===b.file_id);if(!f)return {status:404,json:{error:'not_found'}};return f.mime==='application/pdf'?{type:'application/pdf',body:'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF'}:f.mime==='image/png'?{type:'image/png',body:PNG}:{type:f.mime,body:'QA-DOCX'};}
  return {json:{ok:true}};
 },calls);
 await page.goto('http://127.0.0.1:8766/portal/');await page.waitForSelector('#loginForm');assert.ok(await noOverflow(page),'login overflow '+name);
 const loginText=await page.locator('#loginPage').innerText();assert.ok(!loginText.includes('התאמות'),'login text mentions matches');
 await page.screenshot({path:`${shots}/portal-login-${name}.png`,fullPage:true});
 await page.locator('#loginUsername').fill('23456');await page.locator('#loginPassword').fill('QA-wrong');await page.locator('#loginForm button[type=submit]').click();
 await page.waitForFunction(()=>document.getElementById('status').textContent.includes('אינם תקינים'));
 await page.locator('#loginPassword').fill('QA-current-1');await page.locator('#loginForm button[type=submit]').click();await page.waitForSelector('#dashboard:not([hidden])');
 assert.ok(await noOverflow(page),'dashboard overflow '+name);
 const dash=await page.locator('#dashboard').innerText();assert.ok(!/עמל/.test(dash),'dashboard mentions commissions');
 assert.equal(await page.locator('#matchCount').innerText(),'2');
 await page.locator('.sidebar [data-tab=matches]').click();assert.ok(await page.locator('#matches').isVisible(),'buyers tab visible');
 assert.equal(await page.locator('#matchList .mt-row').count(),2,'two buyer rows');assert.equal(await page.locator('#matchList .agr-signed').count(),1,'green signed badge');
 assert.ok(await page.locator('#matchList').getByText('מידע אנונימי בלבד').isVisible(),'unsigned buyer shows anonymous only');
 assert.ok(await noOverflow(page),'buyers table overflow '+name);await page.screenshot({path:`${shots}/portal-matches-${name}.png`,fullPage:true});
 await page.locator('.sidebar [data-tab=home]').click();
 assert.equal(await page.locator('#docCount').innerText(),'4');assert.equal(await page.locator('#extraCount').innerText(),'2');
 await page.screenshot({path:`${shots}/portal-home-${name}.png`,fullPage:true});
 await page.locator(width<720?'.sidebar [data-tab=documents]':'.sidebar [data-tab=documents]').click();assert.ok(await page.locator('#documents').isVisible());
 for(const [,label] of [[0,'תקציר אנונימי'],[0,'תקציר מלא'],[0,'הערכת שווי'],[0,'חקר שוק']])assert.ok(await page.locator('#documentList').getByText(label,{exact:true}).isVisible(),'doc label '+label);
 assert.equal(await page.locator('#documentList .file-row').count(),4);assert.equal(await page.locator('#extraList .file-row').count(),2);
 assert.equal(await page.locator(`#extraList [data-file="${extras[1].id}"][data-mode=view]`).count(),0,'docx must not offer inline view');
 await page.screenshot({path:`${shots}/portal-documents-${name}.png`,fullPage:true});
 // PDF view
 await page.locator(`#documentList [data-file="${docs[2].id}"][data-mode=view]`).click();await page.waitForSelector('#pdfFrame');assert.ok((await page.locator('#pdfFrame').getAttribute('src')).startsWith('blob:'));await page.locator('#closeDialog').click();
 // Image view
 await page.locator(`#extraList [data-file="${extras[0].id}"][data-mode=view]`).click();await page.waitForSelector('#imageView');await page.waitForFunction(()=>document.getElementById('imageView').naturalWidth>0);
 await page.screenshot({path:`${shots}/portal-image-view-${name}.png`});await page.locator('#closeDialog').click();
 // Downloads
 let dl=page.waitForEvent('download');await page.locator(`#extraList [data-file="${extras[1].id}"][data-mode=download]`).click();assert.equal((await dl).suggestedFilename(),'QA-plan.docx');
 dl=page.waitForEvent('download');await page.locator(`#documentList [data-file="${docs[0].id}"][data-mode=download]`).click();assert.equal((await dl).suggestedFilename(),'QA-anonymous_summary.pdf');
 const fileCalls=calls.filter(c=>c.action==='file');assert.deepEqual(fileCalls.map(c=>[c.file_source,c.mode]),[['sale','view'],['extra','view'],['extra','download'],['sale','download']]);
 assert.ok(fileCalls.every(c=>c.headers['x-seller-token']==='QA-ONLY-TOKEN'));
 // Change password (voluntary: current password required)
 await page.locator('.sidebar [data-tab=business]').click();await page.locator('#business [data-change-password]').click();await page.waitForSelector('#passwordForm input[name=current]');
 const pf=page.locator('#passwordForm');await pf.locator('[name=current]').fill('QA-bad-1234');await pf.locator('[name=password]').fill('QA-new-pass-77');await pf.locator('[name=confirm]').fill('QA-new-pass-78');await pf.locator('button').click();
 assert.equal(await page.locator('#passwordError').innerText(),'הסיסמאות החדשות אינן זהות');
 await pf.locator('[name=confirm]').fill('QA-new-pass-77');await pf.locator('button').click();await page.waitForFunction(()=>document.getElementById('passwordError')?.textContent.includes('הנוכחית'));
 await page.screenshot({path:`${shots}/portal-change-password-${name}.png`});
 await pf.locator('[name=current]').fill('QA-current-1');await pf.locator('button').click();await page.waitForFunction(()=>!document.getElementById('dialog').open);
 assert.ok((await page.locator('#status').innerText()).includes('הסיסמה עודכנה'));
 const cp=calls.filter(c=>c.action==='change_password');assert.equal(cp.length,2);assert.equal(cp[1].current_password,'QA-current-1');assert.equal(cp[1].password,'QA-new-pass-77');
 // Logout, then forced change (legacy temporary password): no current-password field
 await page.locator('#logout').click();await page.waitForSelector('#loginForm');forced=true;
 await page.locator('#loginUsername').fill('23456');await page.locator('#loginPassword').fill('QA-temp-1234');await page.locator('#loginForm button[type=submit]').click();await page.waitForSelector('#passwordForm');
 assert.equal(await page.locator('#passwordForm input[name=current]').count(),0);await page.locator('#passwordForm [name=password]').fill('QA-new-pass-77');await page.locator('#passwordForm [name=confirm]').fill('QA-new-pass-77');await page.locator('#passwordForm button').click();await page.waitForSelector('#dashboard:not([hidden])');
 assert.ok(!calls.some(c=>/^admin_/.test(c.action)),'portal must never call admin actions');
 console.log(`PASS portal ${name}: login (bad/good), 4 documents auto, extras, PDF+image view, downloads, change password (voluntary+forced), buyers table (names + badges), no overflow`);
 await context.close();
}
// ---------- 2. Admin screen ----------
const accounts=[
 {id:'a1',business_id:BIZ,username:'23456',status:'active',created_at:'2026-10-04T05:00:00Z',pending:false,login_count:3,last_login_at:'2026-10-04T07:30:00Z',logins:['2026-10-04T07:30:00Z','2026-10-04T06:30:00Z','2026-10-04T05:30:00Z'],download_count:2,view_count:1,files:[{name:'QA-valuation.pdf',mode:'download',at:'2026-10-04T07:31:00Z'},{name:'QA-photo.png',mode:'view',at:'2026-10-04T07:32:00Z'}],business:{id:BIZ,internal_name:'עסק בדיקה א',owner_name:'בעלים א',owner_phone:'050-0000000',agreement_status:'יש הסכם חתום',is_archived:false}},
 {id:'a2',business_id:'22222222-2222-4222-8222-222222222222',username:'34567',status:'active',created_at:'2026-10-03T19:00:00Z',pending:true,login_count:0,last_login_at:null,logins:[],download_count:0,view_count:0,files:[],business:{id:'22222222-2222-4222-8222-222222222222',internal_name:'עסק בדיקה ב',owner_name:'בעלים ב',owner_phone:'',agreement_status:'יש הסכם חתום',is_archived:false}},
 {id:'a3',business_id:'33333333-3333-4333-8333-333333333333',username:'45678',status:'blocked',created_at:'2026-10-02T19:00:00Z',pending:false,login_count:1,last_login_at:'2026-10-02T20:00:00Z',logins:['2026-10-02T20:00:00Z'],download_count:0,view_count:0,files:[],business:{id:'33333333-3333-4333-8333-333333333333',internal_name:'עסק בדיקה ג',owner_name:'בעלים ג',owner_phone:'',agreement_status:'יש הסכם חתום',is_archived:false}}];
for(const [name,width,height] of [['desktop',1440,1000],['mobile-375',375,812]]){
 const calls=[];let extraList=[...extras];
 const {context,page}=await newPage(width,height,async b=>{
  if(b.action==='admin_overview')return {json:{ok:true,accounts,requests:[{id:'q1',kind:'password',requester_name:'פונה לדוגמה',business_name:'עסק בדיקה א',phone:'050-0000000',message:'',status:'new',created_at:'2026-10-04T06:00:00Z'}]}};
  if(b.action==='admin_detail'){const a=accounts.find(x=>x.business_id===b.business_id);return {json:{ok:true,account:a,business:a.business,portal:{files:[...docs,report,...extraList]},files:[]}};}
  if(b.action==='admin_upload_url')return {json:{ok:true,file_id:'e0000000-0000-4000-8000-000000000009',path:`${b.business_id}/seller-portal-extra/e0000000-0000-4000-8000-000000000009.jpg`,token:'QA-UPLOAD-TOKEN',bucket:'business-files',content_type:'image/jpeg'}};
  if(b.action==='admin_upload_done'){extraList.push({...extras[0],id:b.file_id,name:'QA-new.jpg',mime:'image/jpeg'});return {json:{ok:true}};}
  if(b.action==='admin_open')return {json:{ok:true,username:'23456',password:'Qa7Kd9mPx2',name:'בעלים א',phone:'050-0000000',contact_phone:'03-0000000',site:'www.bsd-bbi.co.il'}};
  return {json:{ok:true}};
 },calls);
 await page.goto('http://127.0.0.1:8766/portal-admin.html?business_id='+BIZ);await page.waitForSelector('#dialog[open] #extraFiles');
 assert.ok(await page.locator('#dialogBody').getByText('קבצים שבעל העסק פתח או הוריד').isVisible());
 const body=await page.locator('#dialogBody').innerText();for(const t of ['QA-valuation.pdf','הורדה','צפייה','תקציר אנונימי','חקר שוק','QA-photo.png','(3)'])assert.ok(body.includes(t),'admin detail missing '+t);
 await page.screenshot({path:`${shots}/admin-detail-${name}.png`,fullPage:true});
 // Upload extra file
 await page.locator('#extraFiles').setInputFiles({name:'QA-new.jpg',mimeType:'image/jpeg',buffer:Buffer.from('QA-JPEG')});await page.locator('[data-upload]').click();
 await page.waitForFunction(()=>document.getElementById('status').textContent.includes('1 מתוך 1'));
 const storageCalls=await page.evaluate(()=>window.__storageCalls);assert.equal(storageCalls.length,1);assert.equal(storageCalls[0].token,'QA-UPLOAD-TOKEN');assert.ok(storageCalls[0].path.startsWith(BIZ+'/seller-portal-extra/'));
 assert.deepEqual(calls.filter(c=>c.action.startsWith('admin_upload')).map(c=>c.action),['admin_upload_url','admin_upload_done']);
 assert.ok(await page.locator('#dialogBody').getByText('QA-new.jpg').isVisible());
 // Reset password -> WhatsApp tab
 const popup=page.waitForEvent('popup');await page.locator('[data-reset]').click();const tab=await popup;await tab.waitForURL(/wa\.me/);const wa=decodeURIComponent(tab.url());
 assert.ok(wa.startsWith('https://wa.me/972500000000?text='));for(const t of ['www.bsd-bbi.co.il','«פורטל בעלי עסקים»','שם משתמש: 23456','סיסמה: Qa7Kd9mPx2'])assert.ok(wa.includes(t),'wa text missing '+t);assert.ok(!/https?:\/\/[^ ]*portal/.test(wa),'no direct portal link');await tab.close();
 // Block in one click
 await page.locator('[data-status=blocked]').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('נחסם'));assert.deepEqual(calls.filter(c=>c.action==='admin_status').map(c=>c.status),['blocked']);
 await page.locator('#closeDialog').click();
 // Active users list (clickable stat)
 assert.equal(await page.locator('[data-show-active] b').innerText(),'2');await page.locator('[data-show-active]').click();await page.waitForSelector('table[data-active-users]');
 assert.equal(await page.locator('table[data-active-users] tbody tr').count(),2);const t=await page.locator('table[data-active-users]').innerText();assert.ok(t.includes('עסק בדיקה א')&&t.includes('34567')&&t.includes('ממתין לסיסמה')&&!t.includes('עסק בדיקה ג'));
 await page.screenshot({path:`${shots}/admin-active-users-${name}.png`});await page.locator('#closeDialog').click();
 assert.ok(await noOverflow(page),'admin overflow '+name);await page.screenshot({path:`${shots}/admin-overview-${name}.png`,fullPage:true});
 assert.ok(calls.every(c=>c.headers.authorization==='Bearer QA-ONLY-JWT'));
 console.log(`PASS admin ${name}: overview, logins/downloads, upload extra (signed URL), reset->WhatsApp, block, active users list, no overflow`);
 await context.close();
}
// ---------- 3. Business card checkbox ----------
for(const [name,width,height] of [['desktop',1200,800],['mobile-375',375,812]]){
 const calls=[];let account=null;
 const {context,page}=await newPage(width,height,async b=>{
  if(b.action==='admin_detail')return {json:{ok:true,account,business:{id:BIZ},portal:{files:[]},files:[]}};
  if(b.action==='admin_open'){account={id:'a1',business_id:BIZ,username:'23456',status:'active',pending:false,login_count:0,last_login_at:null};return {json:{ok:true,username:'23456',password:'Qa7Kd9mPx2',name:'בעלים א',phone:'050-0000000',contact_phone:'03-0000000',site:'www.bsd-bbi.co.il'}};}
  if(b.action==='admin_status'){account={...account,status:b.status};return {json:{ok:true}};}
  return {json:{ok:true}};
 },calls);
 await page.goto('http://127.0.0.1:8766/__card.html');await page.waitForFunction(()=>document.querySelector('[data-portal-summary]').textContent.includes('לא קיים'));
 assert.ok(await page.getByText('פתח חשבון בפורטל').isVisible());
 const popup=page.waitForEvent('popup');await page.locator('#sellerPortalEnabled').check();const tab=await popup;await tab.waitForURL(/wa\.me/);const wa=decodeURIComponent(tab.url());await tab.close();
 for(const t of ['שם משתמש: 23456','סיסמה: Qa7Kd9mPx2','www.bsd-bbi.co.il','«פורטל בעלי עסקים»'])assert.ok(wa.includes(t),'card wa missing '+t);
 await page.waitForSelector('[data-portal-new]');assert.ok((await page.locator('[data-portal-invite]').inputValue()).includes('Qa7Kd9mPx2'));
 await page.waitForFunction(()=>document.querySelector('[data-portal-summary]').textContent.includes('פעיל'));assert.equal(await page.locator('#sellerPortalEnabled').isChecked(),true);
 await page.screenshot({path:`${shots}/card-opened-${name}.png`,fullPage:true});
 assert.equal(calls.filter(c=>c.action==='admin_open').length,1);
 await page.locator('#sellerPortalEnabled').uncheck();await page.waitForFunction(()=>document.querySelector('[data-portal-summary]').textContent.includes('חסום'));
 assert.deepEqual(calls.filter(c=>c.action==='admin_status').map(c=>c.status),['blocked']);
 console.log(`PASS business card ${name}: V opens account, WhatsApp text with username+password+site button, uncheck blocks`);
 await context.close();
}
assert.deepEqual(errors,[]);console.log('PASS: no JavaScript page errors');await browser.close();server.close();

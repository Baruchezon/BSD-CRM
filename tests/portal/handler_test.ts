import {createHandler} from '../../supabase/functions/seller-portal-api/handler.ts';
import {digest,hashPassword,verifyPassword,strongPassword} from '../../supabase/functions/seller-portal-api/security.ts';
const assert=(v:unknown,m='assertion failed')=>{if(!v)throw Error(m);};
const biz='11111111-1111-1111-1111-111111111111',other='22222222-2222-2222-2222-222222222222',file='33333333-3333-3333-3333-333333333333';
const PDF='%PDF-1.7\nTEST ORIGINAL BYTES';
function mock(tables:Record<string,any[]>,objects:Record<string,string>={}){
 const rates:Record<string,number>={};
 const db:any={auth:{getUser:(token:string)=>Promise.resolve({data:{user:token==='admin'||token==='agent'?{id:token}:null},error:null})},rpc:(name:string,args:any)=>{const {p_key,p_max}=args||{};
  if(name==='seller_portal_take_attempt')return Promise.resolve({data:(rates[p_key]=(rates[p_key]||0)+1)<=p_max,error:null});
  if(name==='seller_portal_attempts_exceeded')return Promise.resolve({data:(rates[p_key]||0)>=p_max,error:null});
  if(name==='seller_portal_prune')return Promise.resolve({data:null,error:null});
  if(name==='seller_portal_record_activity'){(tables._activityCalls||=[]).push(args);return Promise.resolve({data:0,error:null});}
  if(name==='seller_portal_activate'){const a=(tables.seller_portal_accounts||[]).find((r:any)=>r.activation_token_hash===args.p_token_hash&&Date.parse(r.activation_expires_at)>Date.now()&&r.status==='active');if(!a)return Promise.resolve({data:[],error:null});Object.assign(a,{password_hash:args.p_password_hash,must_change_password:false,activation_token_hash:null,activation_expires_at:null});(tables.seller_portal_sessions||=[]).push({id:crypto.randomUUID(),account_id:a.id,token_hash:args.p_session_hash,expires_at:args.p_session_expires,last_activity_at:new Date().toISOString()});return Promise.resolve({data:[{account_id:a.id,username:a.username}],error:null});}
  return Promise.resolve({data:null,error:{message:'unknown rpc'}});},
  storage:{from:()=>({
   download:(path:string)=>Promise.resolve(path in objects?{data:new Blob([objects[path]]),error:null}:{data:null,error:{message:'not found'}}),
   createSignedUploadUrl:(path:string)=>Promise.resolve({data:{token:'signed-'+path.length,path,signedUrl:'https://storage.test/'+path},error:null}),
   list:(dir:string,o:any)=>Promise.resolve({data:Object.keys(objects).filter(k=>k.startsWith(dir+'/')&&k.slice(dir.length+1)===o.search).map(k=>({name:k.slice(dir.length+1),metadata:{size:objects[k].length}})),error:null}),
   remove:(paths:string[])=>{paths.forEach(p=>delete objects[p]);return Promise.resolve({data:null,error:null});}
  })}};
 db.from=(table:string)=>{const filters:((r:any)=>boolean)[]=[],rows=tables[table]||=[];let operation='select',value:any,single=false,limit=Infinity;
 const q:any={select:()=>q,eq:(k:string,v:any)=>{filters.push(r=>r[k]===v);return q;},neq:(k:string,v:any)=>{filters.push(r=>r[k]!==v);return q;},is:(k:string,v:any)=>{filters.push(r=>r[k]==v);return q;},in:(k:string,v:any[])=>{filters.push(r=>v.includes(r[k]));return q;},gte:(k:string,v:any)=>{filters.push(r=>r[k]>=v);return q;},lte:(k:string,v:any)=>{filters.push(r=>r[k]<=v);return q;},order:()=>q,limit:(n:number)=>{limit=n;return q;},maybeSingle:()=>{single=true;return q;},single:()=>{single=true;return q;},insert:(v:any)=>{operation='insert';value=v;return q;},update:(v:any)=>{operation='update';value=v;return q;},upsert:(v:any)=>{operation='insert';value=v;return q;},then:(resolve:any,reject:any)=>{try{let found=rows.filter(r=>filters.every(f=>f(r))).slice(0,limit);if(operation==='insert'){if(table==='seller_portal_accounts'&&rows.some(r=>r.username===value.username))return Promise.resolve({data:null,error:{code:'23505'}}).then(resolve,reject);const r={id:crypto.randomUUID(),created_at:new Date().toISOString(),last_activity_at:new Date().toISOString(),...value};rows.push(r);found=[r];}if(operation==='update')found.forEach(r=>Object.assign(r,value));return Promise.resolve({data:single?found[0]||null:found,error:null}).then(resolve,reject);}catch(e){return Promise.reject(e).then(resolve,reject);}}};return q;};return db;
}
const doc=(id:string,business_id:string,category:string,document_type:string|null,created_at:string,extra:any={})=>({id,business_id,category,document_type,status:'active',deleted_at:null,portal_visible:false,portal_kind:'document',file_type:'application/pdf',file_name:`${category}-${document_type}-${created_at.slice(0,10)}.pdf`,storage_path:`${business_id}/sale-file/${category}/${id}.pdf`,created_at,...extra});
async function fixture(extra:any={}){
 const tables:any={businesses:[{id:biz,internal_name:'TEST BUSINESS',owner_name:'TEST OWNER',owner_phone:'050-0000000',city:'TEST',is_archived:false,agreement_status:'יש הסכם חתום'},{id:other,internal_name:'OTHER TEST',owner_name:'OTHER OWNER',owner_phone:'050-0000001',city:'X',is_archived:false,agreement_status:'יש הסכם חתום'}],
  seller_portal_accounts:[{id:'account',business_id:biz,username:'23456',status:'active',password_hash:await hashPassword('Correct234!'),must_change_password:false},{id:'account-b',business_id:other,username:'34567',status:'active',password_hash:await hashPassword('OtherPass234'),must_change_password:false}],
  seller_portal_sessions:[{id:'session',account_id:'account',token_hash:await digest('test-token'),expires_at:new Date(Date.now()+3600000).toISOString(),last_activity_at:new Date().toISOString()},{id:'session-b',account_id:'account-b',token_hash:await digest('token-b'),expires_at:new Date(Date.now()+3600000).toISOString(),last_activity_at:new Date().toISOString()}],
  business_sale_files:[doc(file,biz,'exec_summary','anonymous_summary','2026-09-01T00:00:00Z'),doc('44444444-4444-4444-4444-444444444444',other,'exec_summary','anonymous_summary','2026-09-01T00:00:00Z',{portal_visible:true})],
  seller_portal_files:[],matches:[],profiles:[{id:'admin',role:'admin',status:'active'},{id:'agent',role:'agent',status:'active'}]};
 const objects:Record<string,string>={};for(const f of tables.business_sale_files)objects[f.storage_path]=PDF;
 const handle=createHandler(mock(tables,objects),{origins:['https://preview.test'],portalUrl:'https://preview.test/portal/',phone:'054-0000000',ipSalt:'test-only-salt',pruneRate:0,...extra});
 const request=(action:string,payload={},headers={})=>handle(new Request('https://api.test',{method:'POST',headers:{'Content-Type':'application/json','origin':'https://preview.test','x-seller-token':'test-token',...headers},body:JSON.stringify({action,...payload})}));
 const admin=(action:string,payload={})=>request(action,payload,{authorization:'Bearer admin','x-seller-token':''});
 const seller=(token:string)=>(action:string,payload={})=>request(action,payload,{'x-seller-token':token});
 return {tables,objects,request,admin,seller,handle};
}
const json=async(r:Response)=>{const t=await r.text();try{return JSON.parse(t);}catch{return t;}};

Deno.test('v2 one-click opening: random strong password returned once, only hash stored, login works, reset replaces it',async()=>{
 const f=await fixture();f.tables.seller_portal_accounts.length=0;f.tables.seller_portal_sessions.length=0;
 assert((await f.request('admin_open',{business_id:biz},{authorization:'Bearer agent','x-seller-token':''})).status===403,'agent forbidden');
 assert((await f.request('admin_open',{business_id:biz},{'x-seller-token':'test-token'})).status===401,'seller token cannot open accounts');
 const r=await f.admin('admin_open',{business_id:biz});assert(r.status===200,'open '+r.status);const d=await r.json();
 assert(/^[1-9][0-9]{4}$/.test(d.username),'username');assert(strongPassword(d.password)&&d.password.length===10,'strong password');
 assert(d.name==='TEST OWNER'&&d.phone==='050-0000000'&&d.site==='www.bsd-bbi.co.il'&&!('activation_url' in d),'whatsapp data');
 const acc=f.tables.seller_portal_accounts[0];assert(acc.password_hash!==d.password&&!JSON.stringify(acc).includes(d.password),'plaintext never stored');
 assert(await verifyPassword(d.password,acc.password_hash)&&acc.must_change_password===false&&acc.activation_token_hash===null,'hash and flags');
 const login=await f.request('login',{username:d.username,password:d.password},{'x-seller-token':''});assert(login.status===200,'login with generated password');const s=await login.json();
 assert((await f.seller(s.token)('dashboard')).status===200,'dashboard after login');
 const again=await (await f.admin('admin_open',{business_id:biz})).json();assert(again.username===d.username&&again.password!==d.password,'reset keeps username, new password');
 assert((await f.seller(s.token)('dashboard')).status===401,'reset revokes open sessions');
 assert((await f.request('login',{username:d.username,password:d.password},{'x-seller-token':''})).status===401,'old password rejected');
 assert((await f.request('login',{username:d.username,password:again.password},{'x-seller-token':''})).status===200,'new password works');
 f.tables.businesses[0].agreement_status='אין הסכם';assert((await f.admin('admin_open',{business_id:biz})).status===409,'signed agreement required');
});
Deno.test('v2 open on a blocked or deleted account re-activates; legacy link account gets a password',async()=>{
 const f=await fixture();const acc=f.tables.seller_portal_accounts[0];
 acc.status='blocked';let d=await (await f.admin('admin_open',{business_id:biz})).json();assert(acc.status==='active'&&d.username==='23456','unblocked');
 acc.status='deleted';d=await (await f.admin('admin_open',{business_id:biz})).json();assert(acc.status==='active'&&d.username!=='23456','restored with a new username');
 Object.assign(acc,{password_hash:'!pending-activation',must_change_password:true,activation_token_hash:'x',activation_expires_at:new Date(Date.now()+3600000).toISOString()});
 const detail=await (await f.admin('admin_detail',{business_id:biz})).json();assert(detail.account.pending===true&&!('password_hash' in detail.account),'pending flag, no hash');
 d=await (await f.admin('admin_open',{business_id:biz})).json();assert(acc.activation_token_hash===null&&acc.must_change_password===false,'legacy link cancelled');
 assert((await f.request('login',{username:d.username,password:d.password},{'x-seller-token':''})).status===200,'login after conversion');
});
Deno.test('v2 documents: newest of the 4 business-card types appear automatically; nothing else, no other business',async()=>{
 const f=await fixture();const t=f.tables.business_sale_files;
 const add=(x:any)=>{t.push(x);f.objects[x.storage_path]=PDF;return x;};
 const anonNew=add(doc('a0000000-0000-4000-8000-000000000001',biz,'exec_summary','anonymous_summary','2026-10-01T00:00:00Z'));
 add(doc('a0000000-0000-4000-8000-000000000002',biz,'exec_summary','anonymous_summary','2026-10-02T00:00:00Z',{status:'deleted',deleted_at:'2026-10-02'}));
 const full=add(doc('a0000000-0000-4000-8000-000000000003',biz,'exec_summary','internal_full_summary','2026-09-20T00:00:00Z'));
 const val=add(doc('a0000000-0000-4000-8000-000000000004',biz,'economic_analysis',null,'2026-09-10T00:00:00Z'));
 add(doc('a0000000-0000-4000-8000-000000000005',biz,'economic_analysis',null,'2026-09-30T00:00:00Z',{file_type:'image/jpeg',file_name:'scan.jpg'}));
 const mr=add(doc('a0000000-0000-4000-8000-000000000006',biz,'other','market_research','2026-09-15T00:00:00Z'));
 const photo=add(doc('a0000000-0000-4000-8000-000000000007',biz,'business_photo',null,'2026-09-15T00:00:00Z',{file_type:'image/jpeg',file_name:'p.jpg'}));
 const misc=add(doc('a0000000-0000-4000-8000-000000000008',biz,'other',null,'2026-09-15T00:00:00Z'));
 const ad=add(doc('a0000000-0000-4000-8000-000000000009',biz,'דוח פעילות פרסום','activity_report','2026-09-15T00:00:00Z',{portal_kind:'advertising',portal_visible:true}));
 add(doc('a0000000-0000-4000-8000-000000000010',biz,'דוח פעילות פרסום','activity_report','2026-09-16T00:00:00Z',{portal_kind:'advertising',portal_visible:false}));
 const bad=add(doc('a0000000-0000-4000-8000-000000000011',biz,'other','market_research','2026-10-03T00:00:00Z',{storage_path:other+'/sale-file/x.pdf'}));
 f.tables.matches=[{id:'m1',business_id:biz,buyer_id:'buyer',counterparty_type:'buyer',created_at:'2026-01-01'}];f.tables.seller_portal_match_permissions=[{match_id:'m1',visible:true,disclose_identity:true,client_status:'x'}];
 const d=await json(await f.request('dashboard'));
 const ids=d.files.map((x:any)=>x.id);
 assert(JSON.stringify(d.files.filter((x:any)=>x.kind==='document').map((x:any)=>x.bucket))==='["anonymous_summary","full_summary","valuation","market_research"]','4 types in order '+JSON.stringify(d.files.map((x:any)=>x.bucket)));
 assert(ids.includes(anonNew.id)&&ids.includes(full.id)&&ids.includes(val.id)&&ids.includes(mr.id)&&ids.includes(ad.id)&&ids.length===5,'exact set '+JSON.stringify(ids));
 assert(!ids.includes(file)&&!ids.includes(photo.id)&&!ids.includes(misc.id)&&!ids.includes(bad.id),'superseded, photos, misc and foreign paths excluded');
 assert(d.files.find((x:any)=>x.id===val.id).type==='הערכת שווי','label');
 assert(Array.isArray(d.matches)&&d.matches.length===0,'a match without a buyer record is never shown');
 const ser=JSON.stringify(d);assert(!ser.includes('storage_path')&&!ser.includes('password_hash')&&!ser.includes('OTHER')&&!ser.includes('buyer'),'no leaks');
 assert((await f.request('file',{file_id:anonNew.id,mode:'download'})).status===200,'auto doc downloadable');
 assert((await f.request('file',{file_id:file,mode:'view'})).status===404,'superseded version 404');
 assert((await f.request('file',{file_id:photo.id,mode:'view'})).status===404,'photo not a portal document');
 assert((await f.request('file',{file_id:bad.id,mode:'view'})).status===404,'foreign path 404');
 assert((await f.request('file',{file_id:'44444444-4444-4444-4444-444444444444',mode:'view'})).status===404,'other business document 404 even if flagged visible');
 assert((await f.request('file',{file_id:'44444444-4444-4444-4444-444444444444',mode:'view',file_source:'attachment'})).status===404,'source switch does not help');
 const adm=await json(await f.admin('admin_detail',{business_id:biz}));assert(adm.matches.length===0&&adm.permissions.length===0&&!JSON.stringify(adm).includes('buyer'),'admin detail carries no buyer data');
 const ev=f.tables.seller_portal_events.filter((e:any)=>e.event_type==='document_download');assert(ev.length===1&&ev[0].file_id===anonNew.id&&ev[0].account_id==='account','download tracked');
});
Deno.test('v2 extra files: signed upload to a server path, allow-list, seller sees and downloads own extras only, delete hides',async()=>{
 const f=await fixture();
 assert((await f.admin('admin_upload_url',{business_id:biz,file_name:'x.html',size:10})).status===400,'html rejected');
 assert((await f.admin('admin_upload_url',{business_id:biz,file_name:'x.svg',size:10})).status===400,'svg rejected');
 assert((await f.admin('admin_upload_url',{business_id:biz,file_name:'big.jpg',size:21*1024*1024})).status===400,'too large rejected');
 assert((await f.request('admin_upload_url',{business_id:biz,file_name:'a.jpg',size:10},{authorization:'Bearer agent','x-seller-token':''})).status===403,'agent cannot upload');
 const u=await json(await f.admin('admin_upload_url',{business_id:biz,file_name:'../../תמונה של העסק.JPG',size:5}));
 assert(u.ok&&u.path===`${biz}/seller-portal-extra/${u.file_id}.jpg`&&u.token&&u.content_type==='image/jpeg','server chosen path '+u.path);
 assert((await f.admin('admin_upload_done',{business_id:biz,file_id:u.file_id})).status===409,'not uploaded yet');
 assert((await json(await f.request('dashboard'))).files.every((x:any)=>x.kind!=='extra'),'pending not visible');
 f.objects[u.path]='JPEG!';
 assert((await f.admin('admin_upload_done',{business_id:other,file_id:u.file_id})).status===404,'cannot finish under another business');
 const done=await json(await f.admin('admin_upload_done',{business_id:biz,file_id:u.file_id}));assert(done.ok&&done.file.kind==='extra','activated');
 const row=f.tables.seller_portal_files[0];assert(row.status==='active'&&row.size_bytes===5&&!row.file_name.includes('/'),'stored safely '+row.file_name);
 const d=await json(await f.request('dashboard'));const x=d.files.find((y:any)=>y.kind==='extra');assert(x&&x.id===u.file_id&&x.mime==='image/jpeg','seller sees extra');
 const dl=await f.request('file',{file_id:u.file_id,file_source:'extra',mode:'download'});assert(dl.status===200&&dl.headers.get('content-type')==='image/jpeg'&&await dl.text()==='JPEG!','seller downloads extra');
 const ev=f.tables.seller_portal_events.find((e:any)=>e.event_type==='document_download'&&e.extra_file_id===u.file_id);assert(ev&&ev.account_id==='account','extra download tracked');
 const sb=f.seller('token-b');
 assert((await sb('file',{file_id:u.file_id,file_source:'extra',mode:'download'})).status===404,'other seller cannot fetch extra');
 assert((await sb('file',{file_id:u.file_id,mode:'download'})).status===404,'other seller, other source');
 assert(!(JSON.stringify(await json(await sb('dashboard')))).includes(u.file_id),'not listed for other seller');
 assert((await f.admin('admin_extra_delete',{business_id:other,file_id:u.file_id})).status===404,'delete scoped to business');
 assert((await f.admin('admin_extra_delete',{business_id:biz,file_id:u.file_id})).status===200,'delete');
 assert(!(u.path in f.objects)&&(await f.request('file',{file_id:u.file_id,file_source:'extra',mode:'download'})).status===404,'deleted extra gone');
 const big=await json(await f.admin('admin_upload_url',{business_id:biz,file_name:'v.mp4',size:100}));f.objects[big.path]='x'.repeat(21*1024*1024);
 assert((await f.admin('admin_upload_done',{business_id:biz,file_id:big.file_id})).status===400&&!(big.path in f.objects),'actual size enforced');
});
Deno.test('v2 tracking: overview shows logins count/time and which files were downloaded; no hashes',async()=>{
 const f=await fixture();
 for(let i=0;i<3;i++)assert((await f.request('login',{username:'23456',password:'Correct234!'},{'x-seller-token':''})).status===200);
 assert((await f.request('file',{file_id:file,mode:'download'})).status===200);assert((await f.request('file',{file_id:file,mode:'view'})).status===200);
 const o=await json(await f.admin('admin_overview'));assert(o.ok,'overview');
 const a=o.accounts.find((x:any)=>x.id==='account');assert(a.login_count===3&&a.last_login_at&&a.logins.length===3,'login count '+a.login_count);
 assert(a.download_count===1&&a.view_count===1&&a.files.some((x:any)=>x.mode==='download'&&x.name.endsWith('.pdf')),'downloads listed');
 assert(a.business.internal_name==='TEST BUSINESS'&&a.username==='23456'&&a.pending===false,'who');
 assert(!JSON.stringify(o).includes('password_hash')&&!JSON.stringify(o).includes('600000.'),'no hashes');
 const b=o.accounts.find((x:any)=>x.id==='account-b');assert(b.login_count===0&&b.files.length===0,'other account separate');
 assert((await f.request('admin_overview')).status===401&&(await f.request('admin_overview',{}, {authorization:'Bearer agent','x-seller-token':''})).status===403,'admin only');
});
Deno.test('v2 change password inside the portal needs the current password',async()=>{
 const f=await fixture();f.tables.seller_portal_sessions.push({id:'s2',account_id:'account',token_hash:await digest('second'),expires_at:new Date(Date.now()+3600000).toISOString(),last_activity_at:new Date().toISOString()});
 assert((await f.request('change_password',{current_password:'wrong',password:'BrandNew2026'})).status===400,'wrong current');
 assert((await f.request('change_password',{current_password:'Correct234!',password:'short'})).status===400,'weak');
 assert((await f.request('change_password',{current_password:'Correct234!',password:'BrandNew2026'})).status===200,'changed');
 assert((await f.seller('second')('dashboard')).status===401,'other sessions revoked');assert((await f.request('dashboard')).status===200,'current session kept');
 assert((await f.request('login',{username:'23456',password:'BrandNew2026'},{'x-seller-token':''})).status===200,'login with new');
 for(let i=0;i<8;i++)await f.request('change_password',{current_password:'wrong',password:'BrandNew2027'});
 assert((await f.request('change_password',{current_password:'BrandNew2026',password:'BrandNew2027'})).status===429,'rate limited');
});
Deno.test('existing session is denied immediately after archive or account blocking',async()=>{const f=await fixture();f.tables.businesses[0].is_archived=true;assert((await f.request('dashboard')).status===401);f.tables.businesses[0].is_archived=false;f.tables.seller_portal_accounts[0].status='blocked';assert((await f.request('dashboard')).status===401);});
Deno.test('seller cannot call CRM admin endpoints and agents cannot manage portal',async()=>{const f=await fixture();for(const a of ['admin_list','admin_overview','admin_open','admin_upload_url','admin_status','admin_preview']){assert((await f.request(a,{business_id:biz})).status===401,a);assert((await f.request(a,{business_id:biz},{authorization:'Bearer agent'})).status===403,a);}assert((await f.request('admin_list',{}, {authorization:'Bearer admin'})).status===200);});
Deno.test('login has generic errors and rate limiting across unknown user attempts',async()=>{const f=await fixture();const wrong=await f.request('login',{username:'23456',password:'wrong'});const missing=await f.request('login',{username:'99999',password:'wrong'});assert(JSON.stringify(await wrong.json())===JSON.stringify(await missing.json()));for(let i=0;i<7;i++)await f.request('login',{username:'99999',password:'wrong'});assert((await f.request('login',{username:'99999',password:'wrong'})).status===429);});
Deno.test('legacy must-change-password accounts must change password before retrieving business information',async()=>{const f=await fixture();f.tables.seller_portal_accounts[0].must_change_password=true;assert((await f.request('dashboard')).status===403);assert((await f.request('change_password',{password:'abc'})).status===400);assert((await f.request('change_password',{password:'SafePassword234!'})).status===200);assert((await f.request('dashboard')).status===200);});
Deno.test('disallowed origin never gets authenticated response',async()=>{const f=await fixture();assert((await f.request('dashboard',{}, {origin:'https://evil.test'})).status===403);});
Deno.test('portal deletion revokes access and preserves business documents',async()=>{
 const f=await fixture();const count=f.tables.business_sale_files.length;
 assert((await f.admin('admin_delete',{business_id:biz})).status===200);
 assert(f.tables.seller_portal_accounts[0].status==='deleted');assert(f.tables.seller_portal_sessions[0].revoked_at);
 assert(f.tables.business_sale_files.length===count&&f.tables.businesses.length===2);
 assert((await f.request('dashboard')).status===401);
 assert((await f.admin('admin_status',{business_id:biz,status:'active'})).status===409);
 assert((await f.admin('admin_open',{business_id:biz})).status===200);assert(f.tables.seller_portal_accounts[0].status==='active');
});
Deno.test('activity requires a valid seller and a bounded known page',async()=>{
 const f=await fixture();assert((await f.request('activity',{page:'documents',kind:'heartbeat',seconds:30})).status===200);
 assert((await f.request('activity',{page:'private',kind:'heartbeat',seconds:30})).status===400);
 assert((await f.request('activity',{page:'home',kind:'heartbeat',seconds:1000})).status===400);
 assert((await f.request('activity',{page:'home',kind:'page_view',seconds:0},{'x-seller-token':''})).status===401);
});
Deno.test('legacy activation link (accounts opened before v2) still works once',async()=>{
 const f=await fixture();f.tables.seller_portal_accounts.length=0;f.tables.seller_portal_sessions.length=0;
 const d=await (await f.admin('admin_credentials',{business_id:biz})).json();
 const m=/#activate=([A-Za-z0-9]{43})$/.exec(d.activation_url)!;assert(m);
 assert((await f.request('login',{username:d.username,password:'anything123'},{'x-seller-token':''})).status===401,'pending cannot log in');
 const ok=await f.request('activate',{token:m[1],password:'NewSecret2026x'},{'x-seller-token':''});assert(ok.status===200);
 assert((await f.request('activate',{token:m[1],password:'OtherSecret2026x'},{'x-seller-token':''})).status===400,'reuse rejected');
});
Deno.test('spoofed left-most X-Forwarded-For cannot bypass the per-address login limit',async()=>{
 const f=await fixture();let last=0;
 for(let i=0;i<31;i++){const r=await f.request('login',{username:String(10000+i),password:'wrong'},{'x-seller-token':'','x-forwarded-for':`10.0.0.${i}, 198.51.100.7`});last=r.status;}
 assert(last===429,'31st attempt from same proxy-appended address limited, got '+last);
});
Deno.test('admin_match rejects non-UUID ids with 400',async()=>{const f=await fixture();assert((await f.admin('admin_match',{business_id:biz,match_id:'x',visible:true,disclose_identity:false,client_status:'בבדיקה'})).status===400);});
Deno.test('recovery accepts phone numbers with dashes',async()=>{const f=await fixture();assert((await f.request('recovery',{kind:'password',name:'TEST',business:'TEST',phone:'050-000-0000'},{'x-seller-token':''})).status===200);});
Deno.test('buyers table: own business only, names + agreement badge, full materials only when signed, no contact data or internal notes',async()=>{
 const f=await fixture();
 const B=(id:string,name:string,agreement_status:string,extra:any={})=>({id,type:'buyer',full_name:name,phone:'052-9999'+id.slice(-3),email:id+'@buyer.test',id_number:'0123456'+id.slice(-2),notes:'INTERNAL-LEAD-NOTE',agreement_status,agreement_signed_date:agreement_status==='יש הסכם חתום'?'2026-09-10':null,...extra});
 f.tables.leads=[B('b-signed','דנה כהן','יש הסכם חתום'),B('b-sent','יוסי לוי','נשלח הסכם לחתימה'),B('b-none','רון אבן','אין הסכם'),B('b-unsigned-full','מיכל רז','אין הסכם'),B('b-other','OTHER BUYER','יש הסכם חתום'),B('b-hidden','HIDDEN BUYER','יש הסכם חתום')];
 const sa='a1000000-0000-4000-8000-000000000001',sv='a1000000-0000-4000-8000-000000000002';
 f.tables.business_sale_files.push(doc(sa,biz,'exec_summary','internal_full_summary','2026-09-01T00:00:00Z'),doc(sv,biz,'economic_analysis',null,'2026-09-01T00:00:00Z'));
 f.tables.matches=[
  {id:'m-signed',business_id:biz,buyer_id:'b-signed',counterparty_type:'buyer',status:'במשא ומתן',notes:'INTERNAL-MATCH-NOTE commission 3%',created_at:'2026-09-01T00:00:00Z',status_changed_at:'2026-10-01T00:00:00Z'},
  {id:'m-sent',business_id:biz,buyer_id:'b-sent',counterparty_type:'buyer',status:'מידע ראשוני נשלח',created_at:'2026-09-02T00:00:00Z'},
  {id:'m-none',business_id:biz,buyer_id:'b-none',counterparty_type:'buyer',status:'התאמה חדשה',created_at:'2026-09-03T00:00:00Z'},
  {id:'m-unsigned-full',business_id:biz,buyer_id:'b-unsigned-full',counterparty_type:'buyer',status:'חומרים מלאים נשלחו',created_at:'2026-09-03T00:00:00Z'},
  {id:'m-other',business_id:other,buyer_id:'b-other',counterparty_type:'buyer',status:'במשא ומתן',created_at:'2026-09-03T00:00:00Z'},
  {id:'m-hidden',business_id:biz,buyer_id:'b-hidden',counterparty_type:'buyer',status:'התאמה חדשה',created_at:'2026-09-03T00:00:00Z'},
  {id:'m-broker',business_id:biz,buyer_id:null,broker_id:'br',counterparty_type:'broker',status:'חומרים מלאים נשלחו',created_at:'2026-09-03T00:00:00Z'}];
 f.tables.seller_portal_match_permissions=[{match_id:'m-hidden',visible:false,disclose_identity:false,client_status:'x'}];
 f.tables.match_status_history=[{match_id:'m-signed',status:'חומרים מלאים נשלחו',changed_at:'2026-09-20T00:00:00Z'}];
 f.tables.anon_distributions=[{business_id:biz,buyer_id:'b-sent',distribution_type:'extended',delivery_status:'sent',sent_at:'2026-09-05T00:00:00Z'},{business_id:biz,buyer_id:'b-signed',distribution_type:'primary',delivery_status:'sent',sent_at:'2026-09-04T00:00:00Z'},{business_id:biz,buyer_id:'b-none',distribution_type:'primary',delivery_status:'failed',sent_at:'2026-09-04T00:00:00Z'}];
 f.tables.audit_log=[{action:'send_sale_files_to_buyer',record_id:biz,occurred_at:'2026-09-21T00:00:00Z',details:{status:'sent',recipient_type:'buyer',recipient_id:'b-signed',buyer_email:'b-signed@buyer.test',file_ids:[sa,sv]}},
  {action:'send_sale_files_to_buyer',record_id:biz,occurred_at:'2026-09-22T00:00:00Z',details:{status:'sent',recipient_type:'buyer',recipient_id:'b-unsigned-full',file_ids:[sa]}}];
 f.tables.match_activity_log=[{match_id:'m-signed',note:'הקונה ביקש לראות את דוחות 2025',occurred_at:'2026-10-02T00:00:00Z',visible_to_client:true,deleted_at:null},{match_id:'m-signed',note:'INTERNAL-ACTIVITY',occurred_at:'2026-10-03T00:00:00Z',visible_to_client:false,deleted_at:null},{match_id:'m-signed',note:'DELETED-NOTE',occurred_at:'2026-10-03T00:00:00Z',visible_to_client:true,deleted_at:'2026-10-03'}];
 const d=await json(await f.request('dashboard'));const rows=d.matches;
 assert(rows.length===4,'own buyer matches only, hidden and broker excluded: '+rows.map((r:any)=>r.buyer).join(','));
 const by=(n:string)=>rows.find((r:any)=>r.buyer===n);
 const s=by('דנה כהן');assert(s.agreement.key==='signed'&&s.agreement.label==='חתום','signed badge');
 assert(s.materials.level==='full'&&s.materials.items.map((x:any)=>x.label).join('|')==='תקציר מלא|הערכת שווי','full items '+JSON.stringify(s.materials));
 assert(s.stage.step===5&&s.stage.label==='מתנהל משא ומתן','stage');
 assert(s.notes.length===1&&s.notes[0].text.includes('2025'),'only owner-visible, non-deleted notes');
 assert(by('יוסי לוי').agreement.label==='נשלח הסכם'&&by('יוסי לוי').materials.level==='anonymous'&&by('יוסי לוי').materials.items[0].label==='תקציר אנונימי מורחב','sent + anonymous');
 assert(by('רון אבן').agreement.label==='לא נשלח'&&by('רון אבן').materials.level==='none','failed send is not material');
 const u=by('מיכל רז');assert(u.materials.level==='anonymous'&&u.stage.step<=2&&u.stage.label==='קיבל מידע ראשוני על העסק','unsigned buyer never shown with full materials, even if the CRM says so');
 assert(rows[0].buyer==='דנה כהן','most advanced first');
 assert(s.updated_at==='2026-10-02T00:00:00.000Z'&&s.materials.date==='2026-09-21T00:00:00.000Z'&&rows.every((r:any)=>r.updated_at),'dates '+JSON.stringify([s.updated_at,s.materials.date]));
 assert(d.match_summary.total===4&&d.match_summary.signed===1&&d.match_summary.full===1,'summary '+JSON.stringify(d.match_summary));
 const ser=JSON.stringify(d);
 for(const bad of ['052-9999','@buyer.test','0123456','INTERNAL','DELETED-NOTE','OTHER BUYER','HIDDEN BUYER','b-signed','m-signed','commission','storage_path'])assert(!ser.includes(bad),'leak: '+bad);
 const other_=await json(await f.seller('token-b')('dashboard'));assert(other_.matches.length===1&&other_.matches[0].buyer==='OTHER BUYER'&&!JSON.stringify(other_).includes('דנה'),'other seller sees only his own buyers');
});
Deno.test('admin preview opens the owner home without counting login, files, or activity',async()=>{
 const f=await fixture();const acc=f.tables.seller_portal_accounts[0];const bizRow=f.tables.businesses[0];
 assert((await f.admin('admin_preview',{business_id:'99999999-9999-4999-8999-999999999999'})).status===404,'missing business');
 acc.status='deleted';assert((await f.admin('admin_preview',{business_id:biz})).status===409,'deleted account');
 acc.status='blocked';assert((await json(await f.admin('admin_preview',{business_id:biz}))).error==='preview_unavailable','blocked');
 acc.status='active';bizRow.agreement_status='אין הסכם';assert((await json(await f.admin('admin_preview',{business_id:biz}))).error==='preview_unavailable','unsigned');
 bizRow.is_archived=true;bizRow.agreement_status='יש הסכם חתום';assert((await f.admin('admin_preview',{business_id:biz})).status===409,'archived');
 bizRow.is_archived=false;
 const sessionsBefore=f.tables.seller_portal_sessions.length;const owner=f.tables.seller_portal_sessions[0];
 const r=await f.admin('admin_preview',{business_id:biz});assert(r.status===200,'preview '+r.status);const d=await r.json();
 assert(d.preview===true&&d.token&&d.token.length===48&&d.portal_url==='https://preview.test/portal/'&&d.business_name==='TEST BUSINESS','payload');
 assert(!('password' in d),'no password');
 const created=f.tables.seller_portal_sessions.at(-1);
 assert(f.tables.seller_portal_sessions.length===sessionsBefore+1&&created.preview===true&&created.actor_id==='admin'&&created.account_id==='account','preview session');
 assert(created.token_hash!==d.token&&!JSON.stringify(created).includes(d.token),'token stored only as a hash');
 assert(!owner.revoked_at,'owner session stays open');
 assert((await f.request('dashboard')).status===200,'owner session still works');
 const home=await json(await f.seller(d.token)('dashboard'));
 assert(home.ok&&home.preview===true&&home.business.internal_name==='TEST BUSINESS','owner home');
 const events=()=>f.tables.seller_portal_events||[];
 const n=(type:string)=>events().filter((e:any)=>e.event_type===type).length;
 assert((await f.seller(d.token)('file',{file_id:file,mode:'view'})).status===200);
 assert((await f.seller(d.token)('file',{file_id:file,mode:'download'})).status===200);
 assert(n('login')===0&&n('document_view')===0&&n('document_download')===0,'preview file access is not counted');
 assert((await f.seller(d.token)('activity',{page:'home',kind:'page_view',seconds:0})).status===200);
 assert((await f.seller(d.token)('activity',{page:'documents',kind:'heartbeat',seconds:30})).status===200);
 assert((f.tables._activityCalls||[]).length===0,'preview does not record activity');
 const hash=acc.password_hash;
 assert((await f.seller(d.token)('change_password',{current_password:'Correct234!',password:'BrandNew2026'})).status===403);
 assert((await f.seller(d.token)('message',{message:'QA preview'})).status===403);
 assert(acc.password_hash===hash&&!(f.tables.seller_portal_requests||[]).length,'preview cannot change the account');
 acc.must_change_password=true;
 const pending=await json(await f.admin('admin_preview',{business_id:biz}));
 assert((await f.seller(pending.token)('dashboard')).status===200,'preview sees home even if a password change is pending');
 assert((await f.request('dashboard')).status===403,'real session still must change password');
 acc.must_change_password=false;
 const o=await json(await f.admin('admin_overview'));
 assert(o.accounts.find((x:any)=>x.id==='account').login_count===0,'overview logins unchanged');
 assert((await f.request('file',{file_id:file,mode:'download'})).status===200);
 assert(n('document_download')===1,'a real session still counts a download');
 assert((await f.request('activity',{page:'home',kind:'page_view',seconds:0})).status===200);
 assert((f.tables._activityCalls||[]).length===1,'a real session still records activity');
 assert(f.tables.businesses.length===2&&f.tables.seller_portal_accounts.length===2,'no business or account deleted');
});
Deno.test('buyers table failure never blocks the documents dashboard',async()=>{
 const f=await fixture();f.tables.matches=[{id:'m1',business_id:biz,buyer_id:'b1',counterparty_type:'buyer',status:'התאמה חדשה',created_at:'2026-09-01'}];
 Object.defineProperty(f.tables,'leads',{get(){throw Error('boom');}});
 const r=await f.request('dashboard');assert(r.status===200,'dashboard still 200: '+r.status);const d=await r.json();
 assert(d.matches.length===0&&d.matches_unavailable===true&&d.files.length>0,'files shown, buyers flagged unavailable');
});
Deno.test('«איפה העסק מופץ»: dashboard returns only three booleans from existing CRM fields, own business only, never blocks',async()=>{
 const f=await fixture();
 let d=await json(await f.request('dashboard'));
 assert(d.distribution&&d.distribution.started===false&&!d.distribution.channels.vip&&!d.distribution.channels.agents&&!d.distribution.channels.media,'nothing ticked: not started');
 Object.assign(f.tables.businesses[0],{distribution_status:'all_authorized',public_listing_active:true,anon_card_active:true,listing_status:'active'});
 Object.assign(f.tables.businesses[1],{distribution_status:'all_authorized'});
 f.tables.vip_business_publications=[{business_id:other,enabled:true}];
 d=await json(await f.request('dashboard'));
 assert(d.distribution.started===true&&d.distribution.channels.agents===true&&d.distribution.channels.media===true,'agents + website ticked');
 assert(d.distribution.channels.vip===false,'another business VIP publication is not ours');
 assert(JSON.stringify(Object.keys(d.distribution.channels).sort())==='["agents","media","vip"]','booleans only');
 f.tables.vip_business_publications.push({business_id:biz,enabled:true});
 f.tables.businesses[0].listing_status='sold';f.tables.businesses[0].distribution_status='selective';
 d=await json(await f.request('dashboard'));
 assert(d.distribution.channels.vip===true&&d.distribution.channels.media===false&&d.distribution.channels.agents===false,'VIP on; website off when not active; selective is not all agents');
 Object.defineProperty(f.tables,'vip_business_publications',{get(){throw Error('boom');}});
 const r=await f.request('dashboard');assert(r.status===200,'dashboard still 200');d=await r.json();
 assert(d.files.length>0&&d.distribution.channels.vip===false&&d.distribution.channels.agents===false&&d.distribution.channels.media===false&&d.distribution.started===false,'VIP read error: never blocks; VIP «טרם בוצע»; and the error never turns anything into ✓');
});
Deno.test('«איפה העסק מופץ» certainty rule: missing row / null / other value / read error -> false («טרם בוצע»), never true',async()=>{
 const f=await fixture();const B=f.tables.businesses[0];
 const ch=async()=>{const r=await f.request('dashboard');assert(r.status===200,'dashboard '+r.status);return (await r.json()).distribution.channels;};
 // fully ticked baseline
 Object.assign(B,{distribution_status:'all_authorized',public_listing_active:true,anon_card_active:true,listing_status:'active',is_archived:false});
 f.tables.vip_business_publications=[{business_id:biz,enabled:true}];
 let c=await ch();assert(c.vip&&c.agents&&c.media,'all three ticked from real fields');
 // missing VIP row
 f.tables.vip_business_publications=[];c=await ch();assert(c.vip===false&&c.agents&&c.media,'no VIP row -> VIP false, others unaffected');
 // null / non-boolean values
 f.tables.vip_business_publications=[{business_id:biz,enabled:null}];c=await ch();assert(c.vip===false,'enabled null -> false');
 f.tables.vip_business_publications=[{business_id:biz,enabled:'true'}];c=await ch();assert(c.vip===false,'enabled not strictly true -> false');
 B.distribution_status=null;c=await ch();assert(c.agents===false,'distribution_status null -> false');
 B.distribution_status='selective';c=await ch();assert(c.agents===false,'selective -> false');
 B.distribution_status='all_authorized';
 for(const [k,v] of [['public_listing_active',null],['anon_card_active',null],['listing_status',null],['is_archived',null],['public_listing_active','true']] as [string,any][]){
  const keep=B[k];B[k]=v;c=await ch();assert(c.media===false,`${k}=${v} -> media false`);B[k]=keep;}
 c=await ch();assert(c.media===true,'restored');
 // businesses read error: agents + media false; VIP (separate read) still real
 f.tables.vip_business_publications=[{business_id:biz,enabled:true}];
 const real=f.tables.businesses;let calls=0;
 Object.defineProperty(f.tables,'businesses',{configurable:true,get(){calls++;if(calls>1)throw Error('boom');return real;}});
 const r=await f.request('dashboard');
 assert(r.status===200,'dashboard still loads: '+r.status);const d=await r.json();assert(calls>1,'distribution read hit the error');
 assert(d.distribution.channels.vip===true&&d.distribution.channels.agents===false&&d.distribution.channels.media===false,'businesses read error -> agents/media «טרם בוצע», VIP still real');
});
Deno.test('«איפה העסק מופץ» every portal, including a brand-new one, gets the section with no per-business setup',async()=>{
 const f=await fixture();const fresh='55555555-5555-4555-8555-555555555555';
 f.tables.businesses.push({id:fresh,internal_name:'NEW TEST BUSINESS',owner_name:'NEW OWNER',owner_phone:'050-0000002',city:'Y',is_archived:false,agreement_status:'יש הסכם חתום'});
 const opened=await (await f.admin('admin_open',{business_id:fresh})).json();assert(opened.username,'portal opened for the new test business');
 const login=await (await f.request('login',{username:opened.username,password:opened.password},{'x-seller-token':''})).json();
 let d=await json(await f.seller(login.token)('dashboard'));
 assert(d.distribution&&d.distribution.started===false&&Object.values(d.distribution.channels).every(v=>v===false),'new portal: section present, nothing ticked yet');
 Object.assign(f.tables.businesses.at(-1),{distribution_status:'all_authorized'});
 f.tables.vip_business_publications=[{business_id:fresh,enabled:true}];
 d=await json(await f.seller(login.token)('dashboard'));
 assert(d.distribution.channels.vip===true&&d.distribution.channels.agents===true&&d.distribution.channels.media===false&&d.distribution.started===true,'ticks follow the card live, on the next load');
});

// «שליחה במייל» (08.10.2026): new password per send, Resend mocked, commit only after the email was accepted.
async function mailFixture(opts:{from?:string;apiKey?:string;respond?:(req:any)=>Response|Promise<Response>;status?:(url:string)=>Response|Promise<Response>}={}){
 const calls:any[]=[];
 const f=await fixture({mail:{from:opts.from??'info@bsd-bbi.co.il',apiKey:opts.apiKey??'test-key',fetch:async(url:string,init:any)=>{const body=init.body?JSON.parse(init.body):null;calls.push({url,method:init.method,headers:init.headers,body});if(init.method==='GET')return opts.status?opts.status(url):new Response(JSON.stringify({object:'email',id:url.split('/').pop(),last_event:'delivered',html:'<b>FULL EMAIL WITH PASSWORD</b>',text:'FULL EMAIL WITH PASSWORD'}),{status:200});return opts.respond?opts.respond(body):new Response(JSON.stringify({id:'re_test_1'}),{status:200});}}});
 f.tables.businesses[0].owner_email='owner@example.com';
 f.tables.audit_log=[];
 return {...f,calls};
}
const pw=(text:string)=>(/סיסמה: (\S+)/.exec(text)||[])[1];
Deno.test('email access: admin only; owner email from the DB; new password emailed, then committed; old one stops; nothing secret logged',async()=>{
 const f=await mailFixture();const acc=f.tables.seller_portal_accounts[0],oldHash=acc.password_hash;
 assert((await f.request('admin_email_access',{business_id:biz},{authorization:'Bearer agent','x-seller-token':''})).status===403,'agent forbidden');
 assert((await f.request('admin_email_access',{business_id:biz},{'x-seller-token':'test-token'})).status===401,'seller token cannot send');
 const r=await f.admin('admin_email_access',{business_id:biz,to:'evil@example.com',owner_email:'evil@example.com'});assert(r.status===200,'sent '+r.status);
 assert(f.calls.length===1&&f.calls[0].url==='https://api.resend.com/emails','one Resend call');
 const m=f.calls[0].body;assert(m.from==='צוות BSD <info@bsd-bbi.co.il>'&&m.reply_to==='info@bsd-bbi.co.il'&&JSON.stringify(m.bcc)==='["baruch@bsd-bbi.co.il"]','sender info@, replies to info@, BCC baruch@');
 assert(JSON.stringify(m.to)==='["owner@example.com"]','to = owner email from the DB, never from the request');
 const password=pw(m.text);assert(password&&strongPassword(password)&&m.html.includes(password)&&m.text.includes('שם משתמש: 23456'),'username + new password in the email');
 assert(m.text.includes('«פורטל בעלי עסקים»')&&m.text.includes('צוות BSD')&&m.text.includes('https://www.bsd-bbi.co.il/')&&!m.text.includes('מטעמי אבטחה'),'Baruch wording');
 assert(acc.password_hash!==oldHash&&await verifyPassword(password,acc.password_hash),'new hash committed');
 assert((await f.request('login',{username:'23456',password:'Correct234!'},{'x-seller-token':''})).status===401,'old password stops');
 assert((await f.request('login',{username:'23456',password},{'x-seller-token':''})).status===200,'new password works');
 assert(f.tables.seller_portal_sessions.filter((x:any)=>x.account_id==='account'&&!x.preview).slice(0,1).every((x:any)=>x.revoked_at),'old sessions revoked');
 const log=f.tables.audit_log.at(-1);assert(log.action==='portal_access_email'&&log.record_id===biz&&log.actor_id==='admin'&&log.details.status==='sent'&&log.details.to==='owner@example.com'&&log.details.resend_id==='re_test_1','audit row');
 const everything=JSON.stringify(f.tables);assert(!everything.includes(password),'plaintext never stored or logged');
});
Deno.test('email access: send failure never changes the working password; failure is logged without the password',async()=>{
 for(const respond of [()=>new Response(JSON.stringify({message:'The bsd-bbi.co.il domain is not verified.'}),{status:403}),()=>{throw new Error('network');},()=>new Response('{}',{status:200})]){
  const f=await mailFixture({respond});const acc=f.tables.seller_portal_accounts[0],oldHash=acc.password_hash;
  const r=await f.admin('admin_email_access',{business_id:biz});assert(r.status===502&&(await r.json()).error==='send_failed','send_failed');
  assert(acc.password_hash===oldHash,'hash unchanged');
  assert((await f.request('login',{username:'23456',password:'Correct234!'},{'x-seller-token':''})).status===200,'old password still works');
  const log=f.tables.audit_log.at(-1);assert(log.details.status==='failed'&&log.details.reason,'failure logged');
  const password=pw(f.calls[0]?.text??'');assert(!password||!JSON.stringify(f.tables).includes(password),'no plaintext');
 }
});
Deno.test('email access: sender must be on bsd-bbi.co.il and a key must exist, else refuse before generating anything',async()=>{
 for(const o of [{from:'onboarding@resend.dev'},{from:'BSD <noreply@gmail.com>'},{from:''},{apiKey:''}]){
  const f=await mailFixture(o as any);const oldHash=f.tables.seller_portal_accounts[0].password_hash;
  const r=await f.admin('admin_email_access',{business_id:biz});assert(r.status===503&&(await r.json()).error==='sender_not_ready',JSON.stringify(o));
  assert(f.calls.length===0&&f.tables.seller_portal_accounts[0].password_hash===oldHash,'nothing sent, nothing changed');
 }
 const ok=await mailFixture({from:'BSD Team <Baruch@BSD-BBI.co.il>'});assert((await ok.admin('admin_email_access',{business_id:biz})).status===200,'display-name form accepted');
});
Deno.test('email access: no email / no account / no signed agreement / rate limit',async()=>{
 let f=await mailFixture();f.tables.businesses[0].owner_email='not an email';
 let r=await f.admin('admin_email_access',{business_id:biz});assert(r.status===409&&(await r.json()).error==='email_missing'&&f.calls.length===0,'email_missing');
 f=await mailFixture();f.tables.seller_portal_accounts[0].status='blocked';assert((await f.admin('admin_email_access',{business_id:biz})).status===409,'blocked account');
 f=await mailFixture();f.tables.businesses[0].agreement_status='אין הסכם';assert((await f.admin('admin_email_access',{business_id:biz})).status===409,'no signed agreement');
 f=await mailFixture();for(let i=0;i<5;i++)assert((await f.admin('admin_email_access',{business_id:biz})).status===200,'send '+i);
 r=await f.admin('admin_email_access',{business_id:biz});assert(r.status===429&&f.calls.length===5,'6th within the window is refused');
});
Deno.test('email access: email accepted but saving the new password fails -> old password keeps working, admin told to resend',async()=>{
 let broken=false;
 const f=await mailFixture({respond:()=>{broken=true;return new Response(JSON.stringify({id:'re_x'}),{status:200});}});
 const accounts=f.tables.seller_portal_accounts,oldHash=accounts[0].password_hash;
 Object.defineProperty(f.tables,'seller_portal_accounts',{configurable:true,get(){if(broken)throw Error('db down');return accounts;}});
 const r=await f.admin('admin_email_access',{business_id:biz});assert(r.status===500&&(await r.json()).error==='sent_not_saved','sent_not_saved');
 assert(accounts[0].password_hash===oldHash,'old password still the working one');
 assert(f.tables.audit_log.at(-1).details.status==='sent_not_saved','logged');
});
Deno.test('WhatsApp reset still issues a strong password through the shared helper',async()=>{
 const f=await fixture();const d=await (await f.admin('admin_open',{business_id:biz})).json();assert(strongPassword(d.password)&&d.password.length===10,'unchanged behaviour');
});

Deno.test('email access: sender defaults to info@bsd-bbi.co.il (BCC baruch@bsd-bbi.co.il); SELLER_PORTAL_MAIL_FROM overrides only with @bsd-bbi.co.il',async()=>{
 const {portalMailFrom,PORTAL_MAIL_FROM_DEFAULT,PORTAL_MAIL_NAME,PORTAL_MAIL_BCC}=await import('../../supabase/functions/seller-portal-api/access-email.ts');
 assert(PORTAL_MAIL_FROM_DEFAULT==='info@bsd-bbi.co.il'&&PORTAL_MAIL_NAME==='צוות BSD'&&PORTAL_MAIL_BCC==='baruch@bsd-bbi.co.il','default sender + BCC');
 for(const v of [undefined,null,'','  ','onboarding@resend.dev','BSD <noreply@bsd-crm.co.il>','baruch@bsd-bbi.co.il.evil.com','x@sub.bsd-bbi.co.il','not an email'])
  assert(portalMailFrom(v)==='info@bsd-bbi.co.il','ignored override '+String(v));
 assert(portalMailFrom('office@bsd-bbi.co.il')==='office@bsd-bbi.co.il','bsd override');
 assert(portalMailFrom('BSD <Office@BSD-BBI.co.il>')==='office@bsd-bbi.co.il','named bsd override');
 const idx=await Deno.readTextFile(new URL('../../supabase/functions/seller-portal-api/index.ts',import.meta.url));
 const hsrc=await Deno.readTextFile(new URL('../../supabase/functions/seller-portal-api/handler.ts',import.meta.url));
 assert(!/env\.get\(\s*['"]RESEND_FROM_EMAIL/.test(idx)&&!/RESEND_FROM_EMAIL/.test(hsrc),'shared RESEND_FROM_EMAIL never read');
 assert(/mail:\{from:portalMailFrom\(Deno\.env\.get\('SELLER_PORTAL_MAIL_FROM'\)\),apiKey:\(Deno\.env\.get\('RESEND_API_KEY'\)\|\|''\)\.trim\(\)\}/.test(idx),'index wiring');
});

// 08.10.2026 (Baruch): preview before sending, BCC copy, masked copy in the log, delivery status.
Deno.test('email preview: same template as the real email, nothing sent, no new password, nothing logged',async()=>{
 const {PREVIEW_PASSWORD,MASKED_PASSWORD}=await import('../../supabase/functions/seller-portal-api/access-email.ts');
 const f=await mailFixture();const acc=f.tables.seller_portal_accounts[0],oldHash=acc.password_hash;
 assert((await f.request('admin_email_preview',{business_id:biz},{authorization:'Bearer agent','x-seller-token':''})).status===403,'agent forbidden');
 assert((await f.request('admin_email_preview',{business_id:biz},{'x-seller-token':'test-token'})).status===401,'seller token cannot preview');
 const r=await f.admin('admin_email_preview',{business_id:biz,owner_email:'evil@example.com'});assert(r.status===200,'preview '+r.status);const d=await r.json();
 assert(d.preview===true&&d.from==='צוות BSD <info@bsd-bbi.co.il>'&&d.reply_to==='info@bsd-bbi.co.il'&&d.to==='owner@example.com'&&d.bcc==='baruch@bsd-bbi.co.il'&&d.subject==='האזור האישי שלך ב-BSD: פרטי כניסה','envelope');
 assert(d.text.includes('שם משתמש: 23456')&&d.text.includes('סיסמה: '+PREVIEW_PASSWORD)&&d.html.includes(PREVIEW_PASSWORD)&&d.username_known===true,'username + placeholder');
 assert(f.calls.length===0&&acc.password_hash===oldHash&&f.tables.audit_log.length===0,'nothing sent, changed or logged');
 assert((await f.request('login',{username:'23456',password:'Correct234!'},{'x-seller-token':''})).status===200,'old password still works');
 // The real email is the same template: only the password differs.
 const sent=await (await f.admin('admin_email_access',{business_id:biz})).json();const m=f.calls[0].body,password=pw(m.text);
 assert(m.html.split(password).join(PREVIEW_PASSWORD)===d.html&&m.text.split(password).join(PREVIEW_PASSWORD)===d.text,'preview == real email');
 assert(m.subject===d.subject&&JSON.stringify(m.bcc)==='["baruch@bsd-bbi.co.il"]'&&JSON.stringify(m.to)==='["owner@example.com"]','BCC copy to baruch@bsd-bbi.co.il');
 const log=f.tables.audit_log.at(-1);
 assert(sent.ok&&sent.status==='sent'&&sent.log_id===log.id&&sent.resend_id==='re_test_1'&&sent.bcc==='baruch@bsd-bbi.co.il','response carries log id + resend id');
 assert(log.details.subject===d.subject&&log.details.bcc==='baruch@bsd-bbi.co.il'&&log.details.body_text===m.text.split(password).join(MASKED_PASSWORD)&&log.details.body_html===m.html.split(password).join(MASKED_PASSWORD),'masked copy stored');
 assert(!JSON.stringify(f.tables).includes(password)&&!JSON.stringify(sent).includes(password),'plaintext never stored or returned');
});
Deno.test('email preview: account not opened yet shows a username placeholder; same refusals as sending',async()=>{
 const {PREVIEW_USERNAME}=await import('../../supabase/functions/seller-portal-api/access-email.ts');
 let f=await mailFixture();f.tables.seller_portal_accounts.splice(0,1);
 let d=await (await f.admin('admin_email_preview',{business_id:biz})).json();assert(d.ok&&d.username_known===false&&d.text.includes('שם משתמש: '+PREVIEW_USERNAME),'no account yet');
 assert(f.tables.seller_portal_accounts.every((x:any)=>x.business_id!==biz),'preview never opens an account');
 f=await mailFixture();f.tables.seller_portal_accounts[0].status='deleted';d=await (await f.admin('admin_email_preview',{business_id:biz})).json();assert(d.text.includes(PREVIEW_USERNAME),'deleted account gets a new username on opening');
 f=await mailFixture();f.tables.businesses[0].owner_email='bad';assert((await json(await f.admin('admin_email_preview',{business_id:biz}))).error==='email_missing','email_missing');
 f=await mailFixture();f.tables.businesses[0].agreement_status='אין הסכם';assert((await f.admin('admin_email_preview',{business_id:biz})).status===409,'signed agreement');
 f=await mailFixture({apiKey:''});assert((await json(await f.admin('admin_email_preview',{business_id:biz}))).error==='sender_not_ready'&&f.tables.audit_log.length===0,'sender not ready, not logged');
 f=await mailFixture();for(let i=0;i<8;i++)assert((await f.admin('admin_email_preview',{business_id:biz})).status===200,'preview does not use the send limit');
 assert((await f.admin('admin_email_access',{business_id:biz})).status===200,'send still allowed after previews');
 f=await mailFixture();f.tables.businesses[0].owner_email='Baruch@bsd-bbi.co.il';d=await (await f.admin('admin_email_preview',{business_id:biz})).json();assert(d.bcc==='','no BCC when the owner email is the BCC mailbox');
 f=await mailFixture();f.tables.businesses[0].owner_email='Info@bsd-bbi.co.il';d=await (await f.admin('admin_email_preview',{business_id:biz})).json();assert(d.bcc==='baruch@bsd-bbi.co.il','BCC still sent when the owner email is the sender');
});
Deno.test('email failure answers with the reason and the log id; copy logged masked',async()=>{
 const f=await mailFixture({respond:()=>new Response(JSON.stringify({message:'The bsd-bbi.co.il domain is not verified.'}),{status:403})});
 const r=await f.admin('admin_email_access',{business_id:biz});const d=await r.json();const log=f.tables.audit_log.at(-1);
 assert(r.status===502&&d.error==='send_failed'&&d.reason==='The bsd-bbi.co.il domain is not verified.'&&d.log_id===log.id,'reason + log id');
 const password=pw(f.calls[0].body.text);assert(log.details.body_text&&!log.details.body_text.includes(password)&&!JSON.stringify(f.tables).includes(password),'masked');
});
Deno.test('email status: asks Resend for that email only, returns last_event only, records changes as new rows',async()=>{
 let event='sent';
 const f=await mailFixture({status:(url)=>new Response(JSON.stringify({id:url.split('/').pop(),last_event:event,html:'SECRET-HTML',text:'SECRET-TEXT',to:['owner@example.com']}),{status:200})});
 const sent=await (await f.admin('admin_email_access',{business_id:biz})).json();const original=JSON.stringify(f.tables.audit_log[0]);
 assert((await f.request('admin_email_status',{business_id:biz,log_id:sent.log_id},{authorization:'Bearer agent','x-seller-token':''})).status===403,'agent forbidden');
 let r=await f.admin('admin_email_status',{business_id:biz,log_id:sent.log_id});let d=await r.json();
 const get=f.calls.at(-1);assert(get.method==='GET'&&get.url==='https://api.resend.com/emails/re_test_1'&&get.headers.Authorization==='Bearer test-key','GET that email');
 assert(r.status===200&&d.last_event==='sent'&&d.log_id===sent.log_id&&!JSON.stringify(d).includes('SECRET'),'only last_event returned');
 const rows=()=>f.tables.audit_log.filter((x:any)=>x.action==='portal_access_email_status');
 assert(rows().length===1&&rows()[0].details.log_id===sent.log_id&&rows()[0].details.last_event==='sent'&&!JSON.stringify(rows()).includes('SECRET'),'recorded');
 await f.admin('admin_email_status',{business_id:biz,log_id:sent.log_id});assert(rows().length===1,'same status not recorded twice');
 event='delivered';d=await (await f.admin('admin_email_status',{business_id:biz,log_id:sent.log_id})).json();assert(d.last_event==='delivered'&&rows().length===2,'change recorded');
 assert(JSON.stringify(f.tables.audit_log[0])===original,'original send row never edited');
 assert((await f.admin('admin_email_status',{business_id:other,log_id:sent.log_id})).status===404,'another business cannot read it');
 assert((await f.admin('admin_email_status',{business_id:biz,log_id:'nope'})).status===400,'bad id');
 f.tables.audit_log.push({id:'99999999-9999-4999-8999-999999999999',action:'portal_access_email',record_id:biz,details:{status:'failed',to:'x@y.com'}});
 assert((await json(await f.admin('admin_email_status',{business_id:biz,log_id:'99999999-9999-4999-8999-999999999999'}))).error==='no_resend_id','failed send has no status');
 const g=await mailFixture({status:()=>new Response('{"message":"not found"}',{status:404})});const s2=await (await g.admin('admin_email_access',{business_id:biz})).json();
 r=await g.admin('admin_email_status',{business_id:biz,log_id:s2.log_id});assert(r.status===502&&(await r.json()).error==='status_unavailable','provider error');
});

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
  if(name==='seller_portal_record_activity')return Promise.resolve({data:0,error:null});
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
async function fixture(){
 const tables:any={businesses:[{id:biz,internal_name:'TEST BUSINESS',owner_name:'TEST OWNER',owner_phone:'050-0000000',city:'TEST',is_archived:false,agreement_status:'יש הסכם חתום'},{id:other,internal_name:'OTHER TEST',owner_name:'OTHER OWNER',owner_phone:'050-0000001',city:'X',is_archived:false,agreement_status:'יש הסכם חתום'}],
  seller_portal_accounts:[{id:'account',business_id:biz,username:'23456',status:'active',password_hash:await hashPassword('Correct234!'),must_change_password:false},{id:'account-b',business_id:other,username:'34567',status:'active',password_hash:await hashPassword('OtherPass234'),must_change_password:false}],
  seller_portal_sessions:[{id:'session',account_id:'account',token_hash:await digest('test-token'),expires_at:new Date(Date.now()+3600000).toISOString(),last_activity_at:new Date().toISOString()},{id:'session-b',account_id:'account-b',token_hash:await digest('token-b'),expires_at:new Date(Date.now()+3600000).toISOString(),last_activity_at:new Date().toISOString()}],
  business_sale_files:[doc(file,biz,'exec_summary','anonymous_summary','2026-09-01T00:00:00Z'),doc('44444444-4444-4444-4444-444444444444',other,'exec_summary','anonymous_summary','2026-09-01T00:00:00Z',{portal_visible:true})],
  seller_portal_files:[],matches:[],profiles:[{id:'admin',role:'admin',status:'active'},{id:'agent',role:'agent',status:'active'}]};
 const objects:Record<string,string>={};for(const f of tables.business_sale_files)objects[f.storage_path]=PDF;
 const handle=createHandler(mock(tables,objects),{origins:['https://preview.test'],portalUrl:'https://preview.test/portal/',phone:'054-0000000',ipSalt:'test-only-salt',pruneRate:0});
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
 assert(Array.isArray(d.matches)&&d.matches.length===0,'no buyers/matches ever');
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
Deno.test('seller cannot call CRM admin endpoints and agents cannot manage portal',async()=>{const f=await fixture();for(const a of ['admin_list','admin_overview','admin_open','admin_upload_url','admin_status']){assert((await f.request(a,{business_id:biz})).status===401,a);assert((await f.request(a,{business_id:biz},{authorization:'Bearer agent'})).status===403,a);}assert((await f.request('admin_list',{}, {authorization:'Bearer admin'})).status===200);});
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

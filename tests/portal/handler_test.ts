import {createHandler} from '../../supabase/functions/seller-portal-api/handler.ts';
import {digest,hashPassword} from '../../supabase/functions/seller-portal-api/security.ts';
const assert=(v:unknown,m='assertion failed')=>{if(!v)throw Error(m);};
const biz='11111111-1111-1111-1111-111111111111',other='22222222-2222-2222-2222-222222222222',file='33333333-3333-3333-3333-333333333333';
function mock(tables:Record<string,any[]>){
 const rates:Record<string,number>={};
 const db:any={auth:{getUser:(token:string)=>Promise.resolve({data:{user:token==='admin'||token==='agent'?{id:token}:null},error:null})},rpc:(name:string,args:any)=>{const {p_key,p_max}=args||{};
  if(name==='seller_portal_take_attempt')return Promise.resolve({data:(rates[p_key]=(rates[p_key]||0)+1)<=p_max,error:null});
  if(name==='seller_portal_attempts_exceeded')return Promise.resolve({data:(rates[p_key]||0)>=p_max,error:null});
  if(name==='seller_portal_prune')return Promise.resolve({data:null,error:null});
  if(name==='seller_portal_record_activity')return Promise.resolve({data:0,error:null});
  if(name==='seller_portal_activate'){const a=(tables.seller_portal_accounts||[]).find((r:any)=>r.activation_token_hash===args.p_token_hash&&Date.parse(r.activation_expires_at)>Date.now()&&r.status==='active');if(!a)return Promise.resolve({data:[],error:null});Object.assign(a,{password_hash:args.p_password_hash,must_change_password:false,activation_token_hash:null,activation_expires_at:null});(tables.seller_portal_sessions||=[]).push({id:crypto.randomUUID(),account_id:a.id,token_hash:args.p_session_hash,expires_at:args.p_session_expires,last_activity_at:new Date().toISOString()});return Promise.resolve({data:[{account_id:a.id,username:a.username}],error:null});}
  return Promise.resolve({data:null,error:{message:'unknown rpc'}});},storage:{from:()=>({download:()=>Promise.resolve({data:new Blob(['%PDF-1.7\nTEST ORIGINAL BYTES']),error:null})})}};
 db.from=(table:string)=>{const filters:((r:any)=>boolean)[]=[],rows=tables[table]||=[];let operation='select',value:any,single=false,limit=Infinity;
 const q:any={select:()=>q,eq:(k:string,v:any)=>{filters.push(r=>r[k]===v);return q;},neq:(k:string,v:any)=>{filters.push(r=>r[k]!==v);return q;},is:(k:string,v:any)=>{filters.push(r=>r[k]==v);return q;},in:(k:string,v:any[])=>{filters.push(r=>v.includes(r[k]));return q;},gte:(k:string,v:any)=>{filters.push(r=>r[k]>=v);return q;},lte:(k:string,v:any)=>{filters.push(r=>r[k]<=v);return q;},order:()=>q,limit:(n:number)=>{limit=n;return q;},maybeSingle:()=>{single=true;return q;},single:()=>{single=true;return q;},insert:(v:any)=>{operation='insert';value=v;return q;},update:(v:any)=>{operation='update';value=v;return q;},upsert:(v:any)=>{operation='insert';value=v;return q;},then:(resolve:any,reject:any)=>{try{let found=rows.filter(r=>filters.every(f=>f(r))).slice(0,limit);if(operation==='insert'){const r={id:crypto.randomUUID(),created_at:new Date().toISOString(),last_activity_at:new Date().toISOString(),...value};rows.push(r);found=[r];}if(operation==='update')found.forEach(r=>Object.assign(r,value));return Promise.resolve({data:single?found[0]||null:found,error:null}).then(resolve,reject);}catch(e){return Promise.reject(e).then(resolve,reject);}}};return q;};return db;
}
async function fixture(){const tables:any={businesses:[{id:biz,internal_name:'TEST BUSINESS',owner_name:'TEST OWNER',owner_phone:'',city:'TEST',is_archived:false,agreement_status:'יש הסכם חתום'}],seller_portal_accounts:[{id:'account',business_id:biz,username:'23456',status:'active',password_hash:await hashPassword('Correct234!'),must_change_password:false}],seller_portal_sessions:[{id:'session',account_id:'account',token_hash:await digest('test-token'),expires_at:new Date(Date.now()+3600000).toISOString(),last_activity_at:new Date().toISOString()}],business_sale_files:[{id:file,business_id:biz,status:'active',deleted_at:null,portal_visible:true,file_type:'application/pdf',file_name:'test.pdf',storage_path:biz+'/test.pdf',portal_kind:'document'},{id:'44444444-4444-4444-4444-444444444444',business_id:other,status:'active',portal_visible:true,file_type:'application/pdf',storage_path:other+'/secret.pdf'}],matches:[],profiles:[{id:'admin',role:'admin',status:'active'},{id:'agent',role:'agent',status:'active'}]};const handle=createHandler(mock(tables),{origins:['https://preview.test'],portalUrl:'https://preview.test/portal/',phone:'',ipSalt:'test-only-salt',pruneRate:0});const request=(action:string,payload={},headers={})=>handle(new Request('https://api.test',{method:'POST',headers:{'Content-Type':'application/json','origin':'https://preview.test','x-seller-token':'test-token',...headers},body:JSON.stringify({action,...payload})}));return {tables,request,handle};}
Deno.test('file endpoint returns original PDF and rejects another business, revoked approval and unsigned requests',async()=>{const f=await fixture();let r=await f.request('file',{file_id:file,mode:'view'});assert(r.status===200);assert(await r.text()==='%PDF-1.7\nTEST ORIGINAL BYTES');r=await f.request('file',{file_id:'44444444-4444-4444-4444-444444444444',mode:'view'});assert(r.status===404);f.tables.business_sale_files[0].portal_visible=false;assert((await f.request('file',{file_id:file,mode:'download'})).status===404);assert((await f.request('dashboard',{}, {'x-seller-token':''})).status===401);});
Deno.test('existing session is denied immediately after archive or account blocking',async()=>{const f=await fixture();f.tables.businesses[0].is_archived=true;assert((await f.request('dashboard')).status===401);f.tables.businesses[0].is_archived=false;f.tables.seller_portal_accounts[0].status='blocked';assert((await f.request('dashboard')).status===401);});
Deno.test('seller cannot call CRM admin endpoints and agents cannot manage portal',async()=>{const f=await fixture();assert((await f.request('admin_list')).status===401);assert((await f.request('admin_list',{}, {authorization:'Bearer agent'})).status===403);assert((await f.request('admin_list',{}, {authorization:'Bearer admin'})).status===200);});
Deno.test('dashboard includes no private paths, hashes, buyer contacts or unapproved matches',async()=>{const f=await fixture();f.tables.matches=[{id:'match',business_id:biz,buyer_id:'buyer',counterparty_type:'buyer',created_at:'2026-01-01'}];const r=await f.request('dashboard');const d=await r.json();assert(d.matches.length===0);assert(d.files.length===1);const serialized=JSON.stringify(d);assert(!serialized.includes('storage_path')&&!serialized.includes('password_hash')&&!serialized.includes('secret.pdf'));});
Deno.test('login has generic errors and rate limiting across unknown user attempts',async()=>{const f=await fixture();const wrong=await f.request('login',{username:'23456',password:'wrong'});const missing=await f.request('login',{username:'99999',password:'wrong'});assert(JSON.stringify(await wrong.json())===JSON.stringify(await missing.json()));for(let i=0;i<7;i++)await f.request('login',{username:'99999',password:'wrong'});assert((await f.request('login',{username:'99999',password:'wrong'})).status===429);});
Deno.test('legacy must-change-password accounts must change password before retrieving business information',async()=>{const f=await fixture();f.tables.seller_portal_accounts[0].must_change_password=true;assert((await f.request('dashboard')).status===403);assert((await f.request('change_password',{password:'abc'})).status===400);assert((await f.request('change_password',{password:'SafePassword234!'})).status===200);assert((await f.request('dashboard')).status===200);});
Deno.test('disallowed origin never gets authenticated response',async()=>{const f=await fixture();assert((await f.request('dashboard',{}, {origin:'https://evil.test'})).status===403);});


Deno.test('portal deletion revokes access and preserves business documents',async()=>{
 const f=await fixture();const count=f.tables.business_sale_files.length;
 assert((await f.request('admin_delete',{business_id:biz},{authorization:'Bearer admin'})).status===200);
 assert(f.tables.seller_portal_accounts[0].status==='deleted');assert(f.tables.seller_portal_sessions[0].revoked_at);
 assert(f.tables.business_sale_files.length===count&&f.tables.businesses.length===1);
 assert((await f.request('dashboard')).status===401);
 assert((await f.request('admin_status',{business_id:biz,status:'active'},{authorization:'Bearer admin'})).status===409);
 const restored=await f.request('admin_credentials',{business_id:biz},{authorization:'Bearer admin'});assert(restored.status===200);
 assert(f.tables.seller_portal_accounts[0].status==='active');assert(f.tables.business_sale_files.length===count);
});
Deno.test('latest APPROVED document per type is shown; unapproved newer versions never hide or leak',async()=>{
 const f=await fixture();const old=f.tables.business_sale_files[0];old.created_at='2026-01-01T00:00:00Z';old.document_type='internal_full_summary';old.portal_kind='document';
 const latest={...old,id:'77777777-7777-4777-8777-777777777777',created_at:'2026-10-03T00:00:00Z',version_number:1};old.version_number=99;
 f.tables.business_sale_files.push(latest);f.tables.business_file_meta=[{...old,id:'88888888-8888-4888-8888-888888888888',created_at:'2026-12-01T00:00:00Z',display_name:'duplicate.pdf'}];
 let d=await (await f.request('dashboard')).json();assert(d.files.length===1&&d.files[0].id===latest.id,'newest approved shown');
 assert((await f.request('file',{file_id:old.id,mode:'view'})).status===404,'superseded approved version not downloadable');
 latest.portal_visible=false;d=await (await f.request('dashboard')).json();assert(d.files.length===1&&d.files[0].id===old.id,'older approved shown when newer unapproved');
 assert((await f.request('file',{file_id:latest.id,mode:'view'})).status===404,'unapproved newer not downloadable');
 assert((await f.request('file',{file_id:old.id,mode:'view'})).status===200,'older approved downloadable');
});
Deno.test('activity requires a valid seller and a bounded known page',async()=>{
 const f=await fixture();assert((await f.request('activity',{page:'documents',kind:'heartbeat',seconds:30})).status===200);
 assert((await f.request('activity',{page:'private',kind:'heartbeat',seconds:30})).status===400);
 assert((await f.request('activity',{page:'home',kind:'heartbeat',seconds:1000})).status===400);
 assert((await f.request('activity',{page:'home',kind:'page_view',seconds:0},{'x-seller-token':''})).status===401);
});

Deno.test('activation link: no password in response, single use, expiry, pending account cannot log in',async()=>{
 const f=await fixture();f.tables.seller_portal_accounts.length=0;f.tables.seller_portal_sessions.length=0;
 const r=await f.request('admin_credentials',{business_id:biz},{authorization:'Bearer admin','x-seller-token':''});assert(r.status===200);const d=await r.json();
 assert(!('temporary_password' in d)&&!JSON.stringify(d).match(/password"\s*:/),'no password returned');
 const m=/^https:\/\/preview\.test\/portal\/#activate=([A-Za-z0-9]{43})$/.exec(d.activation_url)!;assert(m,'activation url shape '+d.activation_url);
 const acc=f.tables.seller_portal_accounts[0];assert(acc.activation_token_hash&&acc.activation_token_hash!==m[1],'only hash stored');
 assert((await f.request('login',{username:d.username,password:'anything123'},{'x-seller-token':''})).status===401,'pending cannot log in');
 assert((await f.request('activate',{token:m[1],password:'short'},{'x-seller-token':''})).status===400,'weak password');
 const ok=await f.request('activate',{token:m[1],password:'NewSecret2026x'},{'x-seller-token':''});assert(ok.status===200);const s=await ok.json();assert(s.token&&s.username===d.username);
 assert((await f.request('dashboard',{},{'x-seller-token':s.token})).status===200,'session after activation');
 assert((await f.request('activate',{token:m[1],password:'OtherSecret2026x'},{'x-seller-token':''})).status===400,'reuse rejected');
 assert((await f.request('login',{username:d.username,password:'NewSecret2026x'},{'x-seller-token':''})).status===200,'login with chosen password');
 const again=await (await f.request('admin_credentials',{business_id:biz},{authorization:'Bearer admin','x-seller-token':''})).json();
 const t2=/#activate=(.+)$/.exec(again.activation_url)![1];acc.activation_expires_at=new Date(Date.now()-1000).toISOString();
 assert((await f.request('activate',{token:t2,password:'NewSecret2026y'},{'x-seller-token':''})).status===400,'expired rejected');
 assert((await f.request('login',{username:d.username,password:'NewSecret2026x'},{'x-seller-token':''})).status===401,'reset invalidates old password');
});
Deno.test('spoofed left-most X-Forwarded-For cannot bypass the per-address login limit',async()=>{
 const f=await fixture();let last=0;
 for(let i=0;i<31;i++){const r=await f.request('login',{username:String(10000+i),password:'wrong'},{'x-seller-token':'','x-forwarded-for':`10.0.0.${i}, 198.51.100.7`});last=r.status;}
 assert(last===429,'31st attempt from same proxy-appended address limited, got '+last);
});
Deno.test('admin_match rejects non-UUID ids with 400',async()=>{const f=await fixture();assert((await f.request('admin_match',{business_id:biz,match_id:'x',visible:true,disclose_identity:false,client_status:'בבדיקה'},{authorization:'Bearer admin'})).status===400);});

import {digest,randomText,temporaryPassword,hashPassword,verifyPassword,sessionAllowed,fileAllowed} from './security.ts';
type Options={origins:string[];portalUrl:string;phone:string;ipSalt:string};
const text=(v:unknown,n=1000)=>String(v??'').trim().slice(0,n);
const uuid=(v:unknown)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v));
export function createHandler(db:any,opts:Options){
 const dummyHash=hashPassword('fixed-dummy-password-never-a-credential');
 const query=async(q:any)=>{const r=await q;if(r.error)throw new Error('database_error');return r.data;};
 const event=async(account_id:string,event_type:string,file_id:string|null=null,actor_id:string|null=null,meta_file_id:string|null=null)=>query(db.from('seller_portal_events').insert({account_id,event_type,file_id,actor_id,meta_file_id}));
 const normalize=(f:any,source='sale')=>source==='sale'?{...f,file_source:source}:{...f,file_source:source,file_name:f.display_name||f.original_filename,status:'active',deleted_at:null,document_type:f.category,portal_kind:'document'};
 const allFiles=async(id:string)=>{const sale=await query(db.from('business_sale_files').select('*').eq('business_id',id).eq('status','active').is('deleted_at',null));const attachment=await query(db.from('business_file_meta').select('*').eq('business_id',id));return [...sale.map((f:any)=>normalize(f)),...attachment.map((f:any)=>normalize(f,'attachment'))];};
 return async(req:Request):Promise<Response>=>{
  const origin=req.headers.get('origin')||'';
  const headers:Record<string,string>={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff','Access-Control-Allow-Headers':'content-type,authorization,x-seller-token,apikey','Access-Control-Allow-Methods':'POST, OPTIONS'};
  if(opts.origins.includes(origin))headers['Access-Control-Allow-Origin']=origin;
  const reply=(status:number,data:any)=>new Response(JSON.stringify(data),{status,headers});
  if(origin&&!opts.origins.includes(origin))return reply(403,{error:'forbidden'});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply(405,{error:'method_not_allowed'});
  try{
   const raw=await req.text();if(raw.length>16000)return reply(413,{error:'too_large'});
   let b:any;try{b=JSON.parse(raw);}catch{return reply(400,{error:'invalid_request'});}
   const action=text(b.action,40);
   const ip=req.headers.get('cf-connecting-ip')||req.headers.get('x-forwarded-for')?.split(',')[0]||'unknown';
   const attempt=async(scope:string,max:number)=>query(db.rpc('seller_portal_take_attempt',{p_key:await digest(opts.ipSalt+scope),p_max:max}));
   if(action==='login'||action==='recovery'){
    if(!await attempt(action+':ip:'+ip,action==='login'?30:5))return reply(429,{error:'try_later'});
    if(action==='recovery'){
     if(!['username','password'].includes(b.kind)||!text(b.name,100)||!text(b.business,160)||!/^\+?[0-9 ()]{7,25}$/.test(text(b.phone,25)))return reply(400,{error:'invalid_request'});
     await query(db.from('seller_portal_requests').insert({kind:b.kind,requester_name:text(b.name,100),business_name:text(b.business,160),phone:text(b.phone,25),message:text(b.message,2000)}));
     return reply(200,{ok:true,message:'הבקשה התקבלה ותועבר לצוות BSD'});
    }
    const username=text(b.username,5),password=text(b.password,128);
    if(!await attempt('login:username:'+username,8))return reply(429,{error:'try_later'});
    const a=await query(db.from('seller_portal_accounts').select('*').eq('username',username).maybeSingle());
    // Same expensive hash path for unknown users. No account-existence errors.
    const dummy=await dummyHash;const valid=await verifyPassword(password,a?.password_hash||dummy);
    const business=a?await query(db.from('businesses').select('id,is_archived,agreement_status').eq('id',a.business_id).maybeSingle()):null;
    if(!valid||!a||a.status!=='active'||!business||business.is_archived||business.agreement_status!=='יש הסכם חתום'||(a.must_change_password&&(!Number.isFinite(Date.parse(a.temporary_expires_at))||Date.parse(a.temporary_expires_at)<=Date.now())))return reply(401,{error:'invalid_credentials'});
    const token=randomText(48),expires_at=new Date(Date.now()+8*3600000).toISOString();
    await query(db.from('seller_portal_sessions').insert({account_id:a.id,token_hash:await digest(token),expires_at}));
    await event(a.id,'login');return reply(200,{ok:true,token,must_change_password:a.must_change_password,expires_at});
   }
   if(action.startsWith('admin_')){
    const auth=req.headers.get('authorization')||'';
    const r=await db.auth.getUser(auth.startsWith('Bearer ')?auth.slice(7):'');
    if(r.error||!r.data?.user)return reply(401,{error:'unauthorized'});
    const p=await query(db.from('profiles').select('id,role,status').eq('id',r.data.user.id).maybeSingle());
    if(!p||p.status!=='active'||!['admin','manager'].includes(p.role))return reply(403,{error:'forbidden'});
    if(action==='admin_list'){
     const accounts=await query(db.from('seller_portal_accounts').select('id,business_id,username,status,client_update,client_updated_at,created_at'));
     const businesses=await query(db.from('businesses').select('id,internal_name,owner_name,owner_phone,agreement_status,is_archived'));
     const start=text(b.from,40)||new Date(Date.now()-30*86400000).toISOString();
     const end=text(b.to,40)||new Date().toISOString();
     if(!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end)))return reply(400,{error:'invalid_request'});
     const lastLogins=await query(db.from('seller_portal_events').select('account_id,created_at').eq('event_type','login').order('created_at',{ascending:false}).limit(10000));
     const events=await query(db.from('seller_portal_events').select('id,account_id,event_type,file_id,created_at').gte('created_at',start).lte('created_at',end).order('created_at',{ascending:false}).limit(10000));
     const requests=await query(db.from('seller_portal_requests').select('*').order('created_at',{ascending:false}).limit(200));
     return reply(200,{ok:true,accounts,businesses,events,requests,last_logins:lastLogins,events_truncated:events.length===10000,portal_url:opts.portalUrl});
    }
    if(action==='admin_request'){
     if(!uuid(b.request_id))return reply(400,{error:'invalid_request'});
     await query(db.from('seller_portal_requests').update({status:'handled'}).eq('id',b.request_id));
     // Admin request handling is audited without retaining message content.
     await query(db.from('seller_portal_events').insert({event_type:'request_handled',actor_id:p.id}));return reply(200,{ok:true});
    }
    if(!uuid(b.business_id))return reply(400,{error:'invalid_request'});
    const business=await query(db.from('businesses').select('id,internal_name,owner_name,owner_phone,agreement_status,is_archived').eq('id',b.business_id).maybeSingle());
    if(!business)return reply(404,{error:'not_found'});
    let a=await query(db.from('seller_portal_accounts').select('id,business_id,username,status').eq('business_id',business.id).maybeSingle());
    if(action==='admin_detail'){
     const files=(await allFiles(business.id)).map(({storage_path:_path,...f}:any)=>f);
     const matches=await query(db.from('matches').select('id,buyer_id,created_at').eq('business_id',business.id).eq('counterparty_type','buyer'));
     const permissions=matches.length?await query(db.from('seller_portal_match_permissions').select('*').in('match_id',matches.map((m:any)=>m.id))):[];
     return reply(200,{ok:true,account:a,business,files,matches,permissions});
    }
    if(action==='admin_credentials'){
     if(business.is_archived||business.agreement_status!=='יש הסכם חתום')return reply(409,{error:'signed_agreement_required'});
     const password=temporaryPassword(),password_hash=await hashPassword(password),temporary_expires_at=new Date(Date.now()+86400000).toISOString();
     if(a){
      await query(db.from('seller_portal_accounts').update({password_hash,must_change_password:true,temporary_expires_at}).eq('id',a.id));
      await query(db.from('seller_portal_sessions').update({revoked_at:new Date().toISOString()}).eq('account_id',a.id));
     }else{
      for(let i=0;i<20;i++){
       const username=randomText(1,'123456789')+randomText(4,'0123456789');
       const r=await db.from('seller_portal_accounts').insert({business_id:business.id,username,password_hash,temporary_expires_at,created_by:p.id}).select('id,username').single();
       if(!r.error){a=r.data;break;} if(r.error.code!=='23505')throw new Error('database_error');
      }
      if(!a)throw new Error('username_capacity');
     }
     await event(a.id,'credentials_reset',null,p.id);
     return reply(200,{ok:true,username:a.username,temporary_password:password,portal_url:opts.portalUrl,phone:business.owner_phone,name:business.owner_name});
    }
    if(!a)return reply(409,{error:'account_required'});
    if(action==='admin_status'){
     if(!['active','blocked'].includes(b.status))return reply(400,{error:'invalid_request'});
     if(b.status==='active'&&(business.is_archived||business.agreement_status!=='יש הסכם חתום'))return reply(409,{error:'signed_agreement_required'});
     await query(db.from('seller_portal_accounts').update({status:b.status}).eq('id',a.id));
     await query(db.from('seller_portal_sessions').update({revoked_at:new Date().toISOString()}).eq('account_id',a.id));
    }else if(action==='admin_update'){
     await query(db.from('seller_portal_accounts').update({client_update:text(b.message,2000),client_updated_at:new Date().toISOString()}).eq('id',a.id));
    }else if(action==='admin_file'){
     if(!uuid(b.file_id)||typeof b.visible!=='boolean')return reply(400,{error:'invalid_request'});
     const table=b.file_source==='attachment'?'business_file_meta':'business_sale_files';
     const raw=await query(db.from(table).select('*').eq('id',b.file_id).eq('business_id',business.id).maybeSingle());const f=raw?normalize(raw,b.file_source==='attachment'?'attachment':'sale'):null;
     if(!f||!fileAllowed({...f,portal_visible:true},business.id))return reply(404,{error:'not_found'});
     await query(db.from(table).update({portal_visible:b.visible}).eq('id',f.id).eq('business_id',business.id));
    }else if(action==='admin_match'){
     const m=await query(db.from('matches').select('id,counterparty_type').eq('id',b.match_id).eq('business_id',business.id).maybeSingle());
     if(!m||m.counterparty_type!=='buyer'||!text(b.client_status,120)||typeof b.visible!=='boolean'||typeof b.disclose_identity!=='boolean')return reply(400,{error:'invalid_request'});
     await query(db.from('seller_portal_match_permissions').upsert({match_id:m.id,visible:b.visible,disclose_identity:b.disclose_identity,client_status:text(b.client_status,120),approved_by:p.id,approved_at:new Date().toISOString()}));
    }else return reply(400,{error:'invalid_action'});
    await event(a.id,action,null,p.id);return reply(200,{ok:true});
   }
   const token=req.headers.get('x-seller-token')||'';
   if(!token)return reply(401,{error:'unauthorized'});
   const s=await query(db.from('seller_portal_sessions').select('*').eq('token_hash',await digest(token)).maybeSingle());
   const a=s?await query(db.from('seller_portal_accounts').select('*').eq('id',s.account_id).maybeSingle()):null;
   const business=a?await query(db.from('businesses').select('id,internal_name,owner_name,owner_phone,city,is_archived,agreement_status').eq('id',a.business_id).maybeSingle()):null;
   if(!sessionAllowed(s,a,business))return reply(401,{error:'unauthorized'});
   await query(db.from('seller_portal_sessions').update({last_activity_at:new Date().toISOString()}).eq('id',s.id));
   if(action==='logout'){
    await query(db.from('seller_portal_sessions').update({revoked_at:new Date().toISOString()}).eq('id',s.id));return reply(200,{ok:true});
   }
   if(action==='change_password'){
    const password=text(b.password,128);
    if(password.length<10||!/[A-Za-z]/.test(password)||!/[0-9]/.test(password))return reply(400,{error:'strong_password_required'});
    await query(db.from('seller_portal_accounts').update({password_hash:await hashPassword(password),must_change_password:false,temporary_expires_at:null}).eq('id',a.id));
    await query(db.from('seller_portal_sessions').update({revoked_at:new Date().toISOString()}).eq('account_id',a.id).neq('id',s.id));
    await event(a.id,'password_changed');return reply(200,{ok:true});
   }
   if(a.must_change_password)return reply(403,{error:'password_change_required'});
   if(action==='dashboard'){
    const files=(await allFiles(business.id)).sort((a:any,b:any)=>Date.parse(b.created_at)-Date.parse(a.created_at));
    const matches=await query(db.from('matches').select('id,buyer_id,created_at').eq('business_id',business.id).eq('counterparty_type','buyer'));
    const permissions=matches.length?await query(db.from('seller_portal_match_permissions').select('*').eq('visible',true).in('match_id',matches.map((m:any)=>m.id))):[];
    const safeMatches=[];
    for(const m of matches){
     const permission=permissions.find((p:any)=>p.match_id===m.id);if(!permission)continue;
     const buyer=await query(db.from('leads').select('full_name,company,agreement_status').eq('id',m.buyer_id).maybeSingle());
     safeMatches.push({id:m.id,date:m.created_at,name:permission.disclose_identity?buyer?.full_name:'מתעניין חסוי',company:permission.disclose_identity?buyer?.company:null,agreement_status:buyer?.agreement_status==='יש הסכם חתום'?'חתם':buyer?.agreement_status==='נשלח הסכם לחתימה'?'ממתין לחתימה':'לא נחתם',status:permission.client_status});
    }
    const {is_archived:_arch,agreement_status:_agr,...safeBusiness}=business;
    return reply(200,{ok:true,business:safeBusiness,files:files.filter((f:any)=>fileAllowed(f,business.id)).map((f:any)=>({id:f.id,file_source:f.file_source,name:f.file_name,type:f.document_type||f.category,kind:f.portal_kind,date:f.created_at,period_from:f.portal_period_from,period_to:f.portal_period_to})),matches:safeMatches,update:a.client_update?{message:a.client_update,date:a.client_updated_at}:null,contact:{phone:opts.phone}});
   }
   if(action==='file'){
    if(!uuid(b.file_id)||!['view','download'].includes(b.mode))return reply(404,{error:'not_found'});
    const raw=await query(db.from(b.file_source==='attachment'?'business_file_meta':'business_sale_files').select('*').eq('id',b.file_id).eq('business_id',business.id).maybeSingle());const f=raw?normalize(raw,b.file_source==='attachment'?'attachment':'sale'):null;
    if(!fileAllowed(f,business.id))return reply(404,{error:'not_found'});
    // Stream original PDF through authenticated API. Never expose a bearer storage URL.
    const r=await db.storage.from('business-files').download(f.storage_path);if(r.error||!r.data)return reply(404,{error:'not_found'});
    const bytes=await r.data.arrayBuffer();if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')return reply(422,{error:'invalid_pdf'});
    await event(a.id,(f.portal_kind==='advertising'?'report_':'document_')+(b.mode==='view'?'view':'download'),f.file_source==='attachment'?null:f.id,null,f.file_source==='attachment'?f.id:null);
    return new Response(bytes,{headers:{...headers,'Content-Type':'application/pdf','Content-Disposition':`${b.mode==='view'?'inline':'attachment'}; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(f.file_name)}`}});
   }
   if(action==='message'){
    if(!text(b.message,2000))return reply(400,{error:'invalid_request'});
    await query(db.from('seller_portal_requests').insert({account_id:a.id,kind:'message',requester_name:business.owner_name||a.username,business_name:business.internal_name,phone:business.owner_phone||'',message:text(b.message,2000)}));await event(a.id,'message');return reply(200,{ok:true});
   }
   return reply(400,{error:'invalid_action'});
  }catch{return reply(503,{error:'temporarily_unavailable'});}
 };
}

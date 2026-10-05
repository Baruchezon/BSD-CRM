import {portalDocuments,DOC_LABELS} from './latest-files.ts';
import {buildOwnerMatches} from './matches.ts';
import {digest,randomText,activationToken,validActivationToken,PENDING_ACTIVATION,strongPassword,hashPassword,verifyPassword,usableHash,sessionAllowed,fileAllowed,pathAllowed,clientIp,generatePassword,extraFileType,safeFileName,EXTRA_MAX_BYTES} from './security.ts';
type Options={origins:string[];portalUrl:string;phone:string;ipSalt:string;ipHeader?:string;activationHours?:number;pruneRate?:number;site?:string};
// Rate limit ceilings per 15 minutes. Global ceilings bound abuse even if a
// caller can rotate or spoof its address.
const LIMITS={loginIp:30,loginUser:8,loginGlobalFailures:300,recoveryIp:5,recoveryGlobal:100,activateIp:20,activateGlobal:200,passwordChange:8};
const SIGNED='יש הסכם חתום';
const BUCKET='business-files';
const EXTRA_DIR='seller-portal-extra';
// Events shown in the simple admin screen: logins and file access.
const ACCESS_EVENTS=['login','document_view','document_download','report_view','report_download'];
const text=(v:unknown,n=1000)=>String(v??'').trim().slice(0,n);
const uuid=(v:unknown)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v));
const newUsername=()=>randomText(1,'123456789')+randomText(4,'0123456789');
const eligible=(b:any)=>!!b&&!b.is_archived&&b.agreement_status===SIGNED;
export function createHandler(db:any,opts:Options){
 const dummyHash=hashPassword('fixed-dummy-password-never-a-credential');
 const query=async(q:any)=>{const r=await q;if(r.error)throw new Error('database_error');return r.data;};
 const event=async(account_id:string|null,event_type:string,file_id:string|null=null,actor_id:string|null=null,meta_file_id:string|null=null,extra_file_id:string|null=null)=>query(db.from('seller_portal_events').insert({account_id,event_type,file_id,actor_id,meta_file_id,...(extra_file_id?{extra_file_id}:{})}));
 // Legacy (v1) helpers, kept only so the previous admin screen keeps working until the new CRM pages are live.
 const normalize=(f:any,source='sale')=>source==='sale'?{...f,file_source:source}:{...f,file_source:source,file_name:f.display_name||f.original_filename,status:'active',deleted_at:null,document_type:f.category,portal_kind:'document'};
 const allFiles=async(id:string)=>{const registered=await query(db.from('business_sale_files').select('*').eq('business_id',id));const sale=registered.filter((f:any)=>f.status==='active'&&!f.deleted_at);const attachment=await query(db.from('business_file_meta').select('*').eq('business_id',id));const paths=new Set(registered.map((f:any)=>f.storage_path));return [...sale.map((f:any)=>normalize(f)),...attachment.filter((f:any)=>!paths.has(f.storage_path)).map((f:any)=>normalize(f,'attachment'))];};
 // v2: what a seller sees. Every query is filtered by the seller's own business id,
 // and every storage path is re-checked to start with "{business_id}/".
 const portalFiles=async(id:string)=>{
  const sale=await query(db.from('business_sale_files').select('id,business_id,category,document_type,file_name,file_type,file_size,storage_path,status,deleted_at,created_at,portal_visible,portal_kind,portal_period_from,portal_period_to').eq('business_id',id));
  const {documents,reports}=portalDocuments(sale,id);
  const extras=(await query(db.from('seller_portal_files').select('id,business_id,storage_path,file_name,mime_type,size_bytes,status,created_at').eq('business_id',id).eq('status','active'))).filter((f:any)=>f.business_id===id&&pathAllowed(f.storage_path,id)).sort((a:any,b:any)=>(Date.parse(b.created_at)||0)-(Date.parse(a.created_at)||0));
  return {documents,reports,extras};
 };
 // Buyers matched to the seller's OWN business (05.10.2026). Every query is scoped by
 // business id; buyer rows are read with name/agreement columns only (never phone,
 // email, ID number or internal notes). Only notes marked visible_to_client are read.
 const ownerMatches=async(id:string)=>{
  const matches=(await query(db.from('matches').select('id,business_id,buyer_id,counterparty_type,status,legacy_status,status_changed_at,last_action_at,created_at').eq('business_id',id).limit(300))).filter((m:any)=>m.business_id===id&&m.buyer_id&&(m.counterparty_type??'buyer')==='buyer');
  if(!matches.length)return buildOwnerMatches({businessId:id,matches:[],buyers:[]});
  const mids=matches.map((m:any)=>m.id),bids=[...new Set(matches.map((m:any)=>m.buyer_id))];
  const [buyers,permissions,anonSends,fullSends,history,notes]=await Promise.all([
   query(db.from('leads').select('id,type,full_name,first_name,last_name,agreement_status,agreement_sent,agreement_signed_date').in('id',bids).eq('type','buyer')),
   query(db.from('seller_portal_match_permissions').select('match_id,visible').in('match_id',mids)),
   query(db.from('anon_distributions').select('business_id,buyer_id,distribution_type,delivery_status,sent_at,created_at').eq('business_id',id).in('buyer_id',bids)),
   query(db.from('audit_log').select('record_id,details,occurred_at').eq('action','send_sale_files_to_buyer').eq('record_id',id).limit(500)),
   query(db.from('match_status_history').select('match_id,status,changed_at').in('match_id',mids)),
   query(db.from('match_activity_log').select('match_id,note,description,occurred_at,created_at,visible_to_client,deleted_at').in('match_id',mids).eq('visible_to_client',true).is('deleted_at',null))]);
  const fileIds=[...new Set(fullSends.flatMap((s:any)=>Array.isArray(s.details?.file_ids)?s.details.file_ids:[]).filter(uuid))];
  const files=fileIds.length?await query(db.from('business_sale_files').select('id,business_id,category,document_type,file_name').eq('business_id',id).in('id',fileIds)):[];
  return buildOwnerMatches({businessId:id,matches,buyers,permissions,anonSends,fullSends,files,history,notes});
 };
 const publicFile=(f:any,kind:'document'|'advertising'|'extra')=>({id:f.id,file_source:kind==='extra'?'extra':'sale',name:f.file_name,kind,bucket:kind==='document'?f.bucket:kind,type:kind==='document'?DOC_LABELS[f.bucket]:kind==='advertising'?'דוח פרסום':'קובץ נוסף',date:f.created_at,period_from:f.portal_period_from??null,period_to:f.portal_period_to??null,mime:kind==='extra'?f.mime_type:'application/pdf',size:kind==='extra'?f.size_bytes:f.file_size??null});
 const publicFiles=(p:{documents:any[];reports:any[];extras:any[]})=>[...p.documents.map(f=>publicFile(f,'document')),...p.reports.map(f=>publicFile(f,'advertising')),...p.extras.map(f=>publicFile(f,'extra'))];
 // Logins and file access per account, for the admin screen.
 const accessSummary=async(accounts:any[])=>{
  const ids=accounts.map(a=>a.id);
  const events=ids.length?await query(db.from('seller_portal_events').select('account_id,event_type,file_id,meta_file_id,extra_file_id,created_at').in('account_id',ids).in('event_type',ACCESS_EVENTS).order('created_at',{ascending:false}).limit(5000)):[];
  const pick=(k:string)=>[...new Set(events.map((e:any)=>e[k]).filter(Boolean))];
  const saleIds=pick('file_id'),extraIds=pick('extra_file_id'),metaIds=pick('meta_file_id');
  const sale=saleIds.length?await query(db.from('business_sale_files').select('id,file_name').in('id',saleIds)):[];
  const extra=extraIds.length?await query(db.from('seller_portal_files').select('id,file_name').in('id',extraIds)):[];
  const meta=metaIds.length?await query(db.from('business_file_meta').select('id,display_name,original_filename').in('id',metaIds)):[];
  const nameOf=(e:any)=>sale.find((f:any)=>f.id===e.file_id)?.file_name||extra.find((f:any)=>f.id===e.extra_file_id)?.file_name||(m=>m&&(m.display_name||m.original_filename))(meta.find((f:any)=>f.id===e.meta_file_id))||'קובץ שהוסר';
  const sorted=[...events].sort((x:any,y:any)=>Date.parse(y.created_at)-Date.parse(x.created_at));
  const out:Record<string,any>={};
  for(const a of accounts){
   const mine=sorted.filter((e:any)=>e.account_id===a.id),logins=mine.filter((e:any)=>e.event_type==='login'),files=mine.filter((e:any)=>e.event_type!=='login');
   out[a.id]={login_count:logins.length,last_login_at:logins[0]?.created_at||null,logins:logins.slice(0,30).map((e:any)=>e.created_at),download_count:files.filter((e:any)=>e.event_type.endsWith('_download')).length,view_count:files.filter((e:any)=>e.event_type.endsWith('_view')).length,files:files.slice(0,60).map((e:any)=>({name:nameOf(e),mode:e.event_type.endsWith('_download')?'download':'view',at:e.created_at}))};
  }
  return out;
 };
 const accountView=(a:any,summary:any)=>a?{id:a.id,business_id:a.business_id,username:a.username,status:a.status,created_at:a.created_at,pending:!usableHash(a.password_hash),...(summary||{login_count:0,last_login_at:null,logins:[],download_count:0,view_count:0,files:[]})}:null;
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
   if(!b||typeof b!=='object')return reply(400,{error:'invalid_request'});
   const action=text(b.action,40);
   const ip=clientIp(req,opts.ipHeader??'cf-connecting-ip');
   const attempt=async(scope:string,max:number)=>query(db.rpc('seller_portal_take_attempt',{p_key:await digest(opts.ipSalt+scope),p_max:max}));
   const exceeded=async(scope:string,max:number)=>query(db.rpc('seller_portal_attempts_exceeded',{p_key:await digest(opts.ipSalt+scope),p_max:max}));
   // On-write housekeeping: occasionally prune expired rate-limit, session and activity rows.
   const prune=async()=>{if(Math.random()<(opts.pruneRate??0.02)){try{await query(db.rpc('seller_portal_prune'));}catch{}}};
   if(action==='activate'){
    // Legacy one-time link (accounts opened before 04.10.2026). New accounts get a password instead.
    if(!await attempt('activate:ip:'+ip,LIMITS.activateIp)||!await attempt('activate:global',LIMITS.activateGlobal))return reply(429,{error:'try_later'});
    const password=text(b.password,128);
    if(!validActivationToken(b.token))return reply(400,{error:'invalid_or_expired_link'});
    if(!strongPassword(password))return reply(400,{error:'strong_password_required'});
    const token=randomText(48),expires_at=new Date(Date.now()+8*3600000).toISOString();
    const rows=await query(db.rpc('seller_portal_activate',{p_token_hash:await digest(b.token),p_password_hash:await hashPassword(password),p_session_hash:await digest(token),p_session_expires:expires_at}));
    const row=Array.isArray(rows)?rows[0]:rows;
    if(!row?.account_id)return reply(400,{error:'invalid_or_expired_link'});
    return reply(200,{ok:true,token,username:row.username,must_change_password:false,expires_at});
   }
   if(action==='login'||action==='recovery'){
    await prune();
    if(!await attempt(action+':ip:'+ip,action==='login'?LIMITS.loginIp:LIMITS.recoveryIp))return reply(429,{error:'try_later'});
    if(action==='recovery'){
     if(!await attempt('recovery:global',LIMITS.recoveryGlobal))return reply(429,{error:'try_later'});
     if(!['username','password'].includes(b.kind)||!text(b.name,100)||!text(b.business,160)||!/^\+?[0-9 ()-]{7,25}$/.test(text(b.phone,25)))return reply(400,{error:'invalid_request'});
     await query(db.from('seller_portal_requests').insert({kind:b.kind,requester_name:text(b.name,100),business_name:text(b.business,160),phone:text(b.phone,25),message:text(b.message,2000)}));
     return reply(200,{ok:true,message:'הבקשה התקבלה ותועבר לצוות BSD'});
    }
    const username=text(b.username,5),password=text(b.password,128);
    if(!await attempt('login:username:'+username,LIMITS.loginUser))return reply(429,{error:'try_later'});
    if(await exceeded('login:global_failures',LIMITS.loginGlobalFailures))return reply(429,{error:'try_later'});
    const a=/^[1-9][0-9]{4}$/.test(username)?await query(db.from('seller_portal_accounts').select('*').eq('username',username).maybeSingle()):null;
    // Same expensive hash path for unknown users and accounts without a usable password.
    const dummy=await dummyHash;const stored=usableHash(a?.password_hash)?a.password_hash:dummy;const valid=await verifyPassword(password,stored)&&stored!==dummy;
    const business=a?await query(db.from('businesses').select('id,is_archived,agreement_status').eq('id',a.business_id).maybeSingle()):null;
    if(!valid||!a||a.status!=='active'||!eligible(business)||(a.must_change_password&&(!Number.isFinite(Date.parse(a.temporary_expires_at))||Date.parse(a.temporary_expires_at)<=Date.now()))){if(!valid)await attempt('login:global_failures',1000000);return reply(401,{error:'invalid_credentials'});}
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
    if(action==='admin_overview'){
     // Simple admin screen: who has an account, when and how often they logged in, which files they opened.
     const accounts=(await query(db.from('seller_portal_accounts').select('id,business_id,username,status,created_at,password_hash'))).filter((a:any)=>a.status!=='deleted'&&a.business_id);
     const businesses=accounts.length?await query(db.from('businesses').select('id,internal_name,owner_name,owner_phone,agreement_status,is_archived').in('id',accounts.map((a:any)=>a.business_id))):[];
     const summary=await accessSummary(accounts);
     const requests=await query(db.from('seller_portal_requests').select('id,account_id,kind,requester_name,business_name,phone,message,status,created_at').order('created_at',{ascending:false}).limit(100));
     return reply(200,{ok:true,accounts:accounts.map((a:any)=>({...accountView(a,summary[a.id]),business:businesses.find((x:any)=>x.id===a.business_id)||null})),requests});
    }
    if(action==='admin_list'){
     const accounts=await query(db.from('seller_portal_accounts').select('id,business_id,username,status,client_update,client_updated_at,created_at'));
     const businesses=await query(db.from('businesses').select('id,internal_name,owner_name,owner_phone,agreement_status,is_archived'));
     const start=text(b.from,40)||new Date(Date.now()-30*86400000).toISOString();
     const end=text(b.to,40)||new Date().toISOString();
     if(!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end)))return reply(400,{error:'invalid_request'});
     const lastLogins=await query(db.from('seller_portal_events').select('account_id,created_at').eq('event_type','login').order('created_at',{ascending:false}).limit(10000));
     const events=await query(db.from('seller_portal_events').select('id,account_id,event_type,file_id,meta_file_id,session_id,page,duration_seconds,created_at').gte('created_at',start).lte('created_at',end).order('created_at',{ascending:false}).limit(10000));
     const requests=await query(db.from('seller_portal_requests').select('*').order('created_at',{ascending:false}).limit(200));
     return reply(200,{ok:true,accounts,businesses,events,requests,last_logins:lastLogins,events_truncated:events.length===10000,activity_files:await query(db.from('business_sale_files').select('id,file_name').in('id',events.map((e:any)=>e.file_id).filter(Boolean))),activity_attachments:await query(db.from('business_file_meta').select('id,display_name,original_filename').in('id',events.map((e:any)=>e.meta_file_id).filter(Boolean))),portal_url:opts.portalUrl});
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
    let a=await query(db.from('seller_portal_accounts').select('id,business_id,username,status,created_at,password_hash').eq('business_id',business.id).maybeSingle());
    if(action==='admin_detail'){
     const live=a&&a.status!=='deleted'?a:null;
     const summary=live?(await accessSummary([live]))[live.id]:null;
     const portal=await portalFiles(business.id);
     const files=(await allFiles(business.id)).map(({storage_path:_path,...f}:any)=>f);
     return reply(200,{ok:true,account:a?accountView(a,summary):null,business,portal:{files:publicFiles(portal)},files,matches:[],permissions:[]});
    }
    if(action==='admin_open'){
     // One-click account opening / password reset. The random password is returned
     // once for the WhatsApp text and stored only as a PBKDF2 hash.
     if(!eligible(business))return reply(409,{error:'signed_agreement_required'});
     const password=generatePassword();
     const creds={password_hash:await hashPassword(password),must_change_password:false,temporary_expires_at:null,activation_token_hash:null,activation_expires_at:null};
     if(a){
      const restore=a.status==='deleted';let saved=false;
      for(let i=0;i<(restore?20:1);i++){
       const username=restore?newUsername():a.username;
       const result=await db.from('seller_portal_accounts').update({...creds,status:'active',...(restore?{username,client_update:null,client_updated_at:null}:{})}).eq('id',a.id);
       if(!result.error){a.username=username;saved=true;break;}if(result.error.code!=='23505')throw Error('database_error');
      }
      if(!saved)throw Error('username_capacity');
      await query(db.from('seller_portal_sessions').update({revoked_at:new Date().toISOString()}).eq('account_id',a.id).is('revoked_at',null));
     }else{
      for(let i=0;i<20;i++){
       const ins=await db.from('seller_portal_accounts').insert({business_id:business.id,username:newUsername(),status:'active',...creds,created_by:p.id}).select('id,username').single();
       if(!ins.error){a=ins.data;break;} if(ins.error.code!=='23505')throw new Error('database_error');
      }
      if(!a)throw new Error('username_capacity');
     }
     await event(a.id,'credentials_reset',null,p.id);
     return reply(200,{ok:true,username:a.username,password,name:business.owner_name||'',phone:business.owner_phone||'',contact_phone:opts.phone,site:opts.site||'www.bsd-bbi.co.il'});
    }
    if(action==='admin_upload_url'){
     // Extra files (images, Office, etc.) go straight from the CRM browser to a
     // server-chosen path through a signed upload URL; the API never trusts a
     // client path or content type.
     if(business.is_archived)return reply(409,{error:'archived'});
     const t=extraFileType(b.file_name),size=Number(b.size);
     if(!t)return reply(400,{error:'file_type_not_allowed'});
     if(!Number.isInteger(size)||size<1||size>EXTRA_MAX_BYTES)return reply(400,{error:'file_too_large'});
     const id=crypto.randomUUID(),path=`${business.id}/${EXTRA_DIR}/${id}.${t.ext}`;
     await query(db.from('seller_portal_files').insert({id,business_id:business.id,storage_path:path,file_name:safeFileName(b.file_name),mime_type:t.mime,size_bytes:size,status:'pending',uploaded_by:p.id}));
     const s=await db.storage.from(BUCKET).createSignedUploadUrl(path);
     if(s.error||!s.data?.token){await query(db.from('seller_portal_files').update({status:'deleted',deleted_at:new Date().toISOString()}).eq('id',id));throw Error('storage_error');}
     return reply(200,{ok:true,file_id:id,path,token:s.data.token,bucket:BUCKET,content_type:t.mime});
    }
    if(action==='admin_upload_done'||action==='admin_extra_delete'){
     if(!uuid(b.file_id))return reply(400,{error:'invalid_request'});
     const f=await query(db.from('seller_portal_files').select('*').eq('id',b.file_id).eq('business_id',business.id).maybeSingle());
     if(!f||!pathAllowed(f.storage_path,business.id))return reply(404,{error:'not_found'});
     const now=new Date().toISOString();
     if(action==='admin_extra_delete'){
      if(f.status==='deleted')return reply(200,{ok:true});
      await query(db.from('seller_portal_files').update({status:'deleted',deleted_at:now}).eq('id',f.id).eq('business_id',business.id));
      await db.storage.from(BUCKET).remove([f.storage_path]);
      await event(a?.id??null,'admin_extra_delete',null,p.id,null,f.id);return reply(200,{ok:true});
     }
     if(f.status!=='pending')return reply(409,{error:'invalid_state'});
     const dir=f.storage_path.slice(0,f.storage_path.lastIndexOf('/')),name=f.storage_path.slice(f.storage_path.lastIndexOf('/')+1);
     const listed=await db.storage.from(BUCKET).list(dir,{search:name,limit:10});
     const obj=(listed.data||[]).find((o:any)=>o.name===name);
     if(listed.error||!obj)return reply(409,{error:'upload_missing'});
     const size=Number(obj.metadata?.size);
     if(!(size>0&&size<=EXTRA_MAX_BYTES)){await db.storage.from(BUCKET).remove([f.storage_path]);await query(db.from('seller_portal_files').update({status:'deleted',deleted_at:now}).eq('id',f.id));return reply(400,{error:'file_too_large'});}
     await query(db.from('seller_portal_files').update({status:'active',size_bytes:size}).eq('id',f.id).eq('business_id',business.id));
     await event(a?.id??null,'admin_extra_upload',null,p.id,null,f.id);
     return reply(200,{ok:true,file:publicFile({...f,status:'active',size_bytes:size},'extra')});
    }
    if(action==='admin_credentials'){
     // Legacy one-time activation link (previous CRM screens). New screens use admin_open.
     if(!eligible(business))return reply(409,{error:'signed_agreement_required'});
     const secret=activationToken(),activation_token_hash=await digest(secret),activation_expires_at=new Date(Date.now()+(opts.activationHours??24)*3600000).toISOString();
     const pending={password_hash:PENDING_ACTIVATION,must_change_password:true,temporary_expires_at:activation_expires_at,activation_token_hash,activation_expires_at};
     if(a){
      const restore=a.status==='deleted';
      let saved=false;
      for(let i=0;i<(restore?20:1);i++){
       const username=restore?newUsername():a.username;
       const result=await db.from('seller_portal_accounts').update({...pending,...(restore?{status:'active',username}:{})}).eq('id',a.id);
       if(!result.error){a.username=username;saved=true;break;}if(result.error.code!=='23505')throw Error('database_error');
      }
      if(!saved)throw Error('username_capacity');
      await query(db.from('seller_portal_sessions').update({revoked_at:new Date().toISOString()}).eq('account_id',a.id).is('revoked_at',null));
     }else{
      for(let i=0;i<20;i++){
       const ins=await db.from('seller_portal_accounts').insert({business_id:business.id,username:newUsername(),status:'active',...pending,created_by:p.id}).select('id,username').single();
       if(!ins.error){a=ins.data;break;} if(ins.error.code!=='23505')throw new Error('database_error');
      }
      if(!a)throw new Error('username_capacity');
     }
     await event(a.id,'credentials_reset',null,p.id);
     const activation_url=opts.portalUrl.replace(/#.*$/,'')+'#activate='+secret;
     const contact=await query(db.from('businesses').select('owner_email').eq('id',business.id).maybeSingle());
     return reply(200,{ok:true,username:a.username,activation_url,activation_expires_at,portal_url:opts.portalUrl,phone:business.owner_phone,email:contact?.owner_email||'',name:business.owner_name,contact_phone:opts.phone});
    }
    if(!a)return reply(409,{error:'account_required'});
    if(action==='admin_delete'){
     await query(db.from('seller_portal_accounts').update({status:'deleted',password_hash:PENDING_ACTIVATION,must_change_password:true,temporary_expires_at:null,activation_token_hash:null,activation_expires_at:null,client_update:null,client_updated_at:null}).eq('id',a.id));
     await query(db.from('seller_portal_sessions').update({revoked_at:new Date().toISOString()}).eq('account_id',a.id));
    }else if(action==='admin_status'){
     if(a.status==='deleted')return reply(409,{error:'account_required'});
     if(!['active','blocked'].includes(b.status))return reply(400,{error:'invalid_request'});
     if(b.status==='active'&&!eligible(business))return reply(409,{error:'signed_agreement_required'});
     await query(db.from('seller_portal_accounts').update({status:b.status}).eq('id',a.id));
     await query(db.from('seller_portal_sessions').update({revoked_at:new Date().toISOString()}).eq('account_id',a.id));
    }else if(action==='admin_update'){
     await query(db.from('seller_portal_accounts').update({client_update:text(b.message,2000),client_updated_at:new Date().toISOString()}).eq('id',a.id));
    }else if(action==='admin_file'){
     // Legacy per-file switch. Since v2 documents appear automatically and this switch has no effect on them.
     if(!uuid(b.file_id)||typeof b.visible!=='boolean')return reply(400,{error:'invalid_request'});
     const table=b.file_source==='attachment'?'business_file_meta':'business_sale_files';
     const raw=await query(db.from(table).select('*').eq('id',b.file_id).eq('business_id',business.id).maybeSingle());const f=raw?normalize(raw,b.file_source==='attachment'?'attachment':'sale'):null;
     if(!f||!fileAllowed({...f,portal_visible:true},business.id))return reply(404,{error:'not_found'});
     await query(db.from(table).update({portal_visible:b.visible}).eq('id',f.id).eq('business_id',business.id));
    }else if(action==='admin_match'){
     if(!uuid(b.match_id))return reply(400,{error:'invalid_request'});
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
    if(!strongPassword(password))return reply(400,{error:'strong_password_required'});
    if(!a.must_change_password){
     // Voluntary change from inside the portal: the current password is required.
     if(!await attempt('password:account:'+a.id,LIMITS.passwordChange))return reply(429,{error:'try_later'});
     if(!await verifyPassword(text(b.current_password,128),a.password_hash))return reply(400,{error:'wrong_current_password'});
    }
    await query(db.from('seller_portal_accounts').update({password_hash:await hashPassword(password),must_change_password:false,temporary_expires_at:null}).eq('id',a.id));
    await query(db.from('seller_portal_sessions').update({revoked_at:new Date().toISOString()}).eq('account_id',a.id).neq('id',s.id));
    await event(a.id,'password_changed');return reply(200,{ok:true});
   }
   if(a.must_change_password)return reply(403,{error:'password_change_required'});
   if(action==='activity'){
    if(!['home','documents','matches','reports','business'].includes(b.page)||!['page_view','heartbeat'].includes(b.kind)||!Number.isInteger(b.seconds)||b.seconds<0||b.seconds>90)return reply(400,{error:'invalid_request'});
    await query(db.rpc('seller_portal_record_activity',{p_session:s.id,p_account:a.id,p_page:b.page,p_seconds:b.seconds,p_kind:b.kind}));return reply(200,{ok:true});
   }
   if(action==='dashboard'){
    // Own business only. Buyers: display name, agreement badge, stage, materials and
    // owner-visible notes for THIS business's matches. No contact details, other sellers, prices or commissions.
    const {is_archived:_arch,agreement_status:_agr,...safeBusiness}=business;
    // The buyers table never blocks documents: on any error the dashboard still loads, without buyers.
    let owner:any={rows:[],summary:{total:0,active:0,signed:0,full:0}};try{owner=await ownerMatches(business.id);}catch{owner.unavailable=true;}
    return reply(200,{ok:true,business:safeBusiness,files:publicFiles(await portalFiles(business.id)),matches:owner.rows,match_summary:owner.summary,...(owner.unavailable?{matches_unavailable:true}:{}),update:a.client_update?{message:a.client_update,date:a.client_updated_at}:null,contact:{phone:opts.phone}});
   }
   if(action==='file'){
    if(!uuid(b.file_id)||!['view','download'].includes(b.mode))return reply(404,{error:'not_found'});
    const portal=await portalFiles(business.id);
    const extra=b.file_source==='extra';
    const f=extra?portal.extras.find((x:any)=>x.id===b.file_id):[...portal.documents,...portal.reports].find((x:any)=>x.id===b.file_id);
    if(!f||f.business_id!==business.id||!pathAllowed(f.storage_path,business.id))return reply(404,{error:'not_found'});
    // Stream the original file through the authenticated API. Never expose a bearer storage URL.
    const r=await db.storage.from(BUCKET).download(f.storage_path);if(r.error||!r.data)return reply(404,{error:'not_found'});
    const bytes=await r.data.arrayBuffer();
    if(!extra&&new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')return reply(422,{error:'invalid_pdf'});
    const mime=extra?(extraFileType(f.storage_path)?.mime||'application/octet-stream'):'application/pdf';
    await event(a.id,(f.portal_kind==='advertising'?'report_':'document_')+(b.mode==='view'?'view':'download'),extra?null:f.id,null,null,extra?f.id:null);
    const inline=b.mode==='view'&&(mime==='application/pdf'||mime.startsWith('image/'));
    return new Response(bytes,{headers:{...headers,'Content-Type':mime,'Content-Disposition':`${inline?'inline':'attachment'}; filename="file"; filename*=UTF-8''${encodeURIComponent(f.file_name)}`}});
   }
   if(action==='message'){
    if(!text(b.message,2000))return reply(400,{error:'invalid_request'});
    await query(db.from('seller_portal_requests').insert({account_id:a.id,kind:'message',requester_name:business.owner_name||a.username,business_name:business.internal_name,phone:business.owner_phone||'',message:text(b.message,2000)}));await event(a.id,'message');return reply(200,{ok:true});
   }
   return reply(400,{error:'invalid_action'});
  }catch{return reply(503,{error:'temporarily_unavailable'});}
 };
}

import {randomText,activationToken,validActivationToken,PENDING_ACTIVATION,clientIp,hashPassword,verifyPassword,sessionAllowed,fileAllowed} from '../../supabase/functions/seller-portal-api/security.ts';
const assert=(v:unknown,m='assertion failed')=>{if(!v)throw Error(m);};
Deno.test('credentials are random, unique samples and password is one-way',async()=>{
 const names=new Set<string>();for(let i=0;i<1000;i++){const n=randomText(1,'123456789')+randomText(4,'0123456789');assert(/^[1-9][0-9]{4}$/.test(n));names.add(n);const t=activationToken();assert(validActivationToken(t));}assert(names.size>980);
 const p='Abc234xyz!',h=await hashPassword(p);assert(!h.includes(p));assert(await verifyPassword(p,h));assert(!await verifyPassword('wrong',h));assert(await hashPassword(p)!==h);
});
Deno.test('each document is scoped to business and explicit approval',()=>{
 const id='11111111-1111-1111-1111-111111111111',f={business_id:id,status:'active',deleted_at:null,portal_visible:true,file_type:'application/pdf',storage_path:id+'/files/a.pdf'};
 assert(fileAllowed(f,id));assert(!fileAllowed(f,'other'));for(const change of [{portal_visible:false},{status:'deleted'},{deleted_at:'today'},{storage_path:'other/a.pdf'},{file_type:'text/html'},{storage_path:id+'/../other.pdf'}])assert(!fileAllowed({...f,...change},id));
});
Deno.test('archive, blocking, missing agreement, idle timeout and expiry reject existing sessions',()=>{
 const now=Date.now(),s={expires_at:new Date(now+3600000).toISOString(),last_activity_at:new Date(now).toISOString(),revoked_at:null},a={status:'active'},b={is_archived:false,agreement_status:'יש הסכם חתום'};assert(sessionAllowed(s,a,b,now));assert(!sessionAllowed(s,a,{...b,is_archived:true},now));assert(!sessionAllowed(s,a,{...b,agreement_status:'אין הסכם'},now));assert(!sessionAllowed(s,{status:'blocked'},b,now));assert(!sessionAllowed({...s,revoked_at:'today'},a,b,now));assert(!sessionAllowed(s,a,b,now+31*60000));assert(!sessionAllowed({...s,expires_at:new Date(now-1).toISOString()},a,b,now));
});
Deno.test('pending-activation marker never verifies and client IP ignores caller-controlled left-most XFF',async()=>{
 assert(!await verifyPassword('',PENDING_ACTIVATION));assert(!validActivationToken('short'));
 const req=(h:Record<string,string>)=>new Request('https://x.test',{headers:h});
 assert(clientIp(req({'x-forwarded-for':'1.2.3.4, 203.0.113.9'}),'')==='203.0.113.9');
 assert(clientIp(req({'cf-connecting-ip':'198.51.100.1','x-forwarded-for':'1.2.3.4'}))==='198.51.100.1');
 assert(clientIp(req({}))==='unknown');
});
Deno.test('stored iteration count is honoured',async()=>{const h=await hashPassword('Abc234xyz!',undefined,310000);assert(h.startsWith('310000.'));assert(await verifyPassword('Abc234xyz!',h));});
import {generatePassword,pathAllowed,extraFileType,safeFileName,strongPassword} from '../../supabase/functions/seller-portal-api/security.ts';
import {documentBucket} from '../../supabase/functions/seller-portal-api/latest-files.ts';
Deno.test('v2 generated passwords are strong, unambiguous and unique',()=>{
 const seen=new Set<string>();for(let i=0;i<2000;i++){const p=generatePassword();assert(p.length===10&&strongPassword(p)&&!/[0O1lI]/.test(p)&&(p.match(/[0-9]/g)||[]).length>=2,p);seen.add(p);}assert(seen.size===2000);
});
Deno.test('v2 storage path scoping',()=>{
 const id='11111111-1111-1111-1111-111111111111';
 assert(pathAllowed(id+'/seller-portal-extra/a.jpg',id));
 for(const p of [id+'x/a.jpg','other/'+id+'/a.jpg',id+'/../x.pdf',id+'//a.pdf',id+'/./a.pdf',id+'/a\\b.pdf','',null])assert(!pathAllowed(p,id),String(p));
 assert(!pathAllowed(id+'/a.pdf',''));assert(!pathAllowed(id+'/a.pdf',null));
});
Deno.test('v2 extra file allow-list and safe names',()=>{
 for(const n of ['a.jpg','B.PNG','x.pdf','d.docx','s.xlsx','m.mp4'])assert(extraFileType(n),n);
 for(const n of ['a.html','a.htm','a.svg','a.js','a.xml','a.exe','noext','a.jpg.html'])assert(!extraFileType(n),n);
 assert(extraFileType('photo.JPG')!.mime==='image/jpeg');
 assert(!safeFileName('../../a<b>.jpg').includes('/')&&!safeFileName('../../a<b>.jpg').includes('<'));assert(safeFileName('')==='file');
});
Deno.test('v2 document types follow the CRM business-card mapping',()=>{
 assert(documentBucket({category:'exec_summary',document_type:'anonymous_summary'})==='anonymous_summary');
 assert(documentBucket({category:'anon_presentation',document_type:null})==='anonymous_summary');
 assert(documentBucket({category:'exec_summary',document_type:'internal_full_summary'})==='full_summary');
 assert(documentBucket({category:'exec_summary',document_type:null})==='full_summary');
 assert(documentBucket({category:'economic_analysis',document_type:null})==='valuation');
 assert(documentBucket({category:'other',document_type:'market_research'})==='market_research');
 for(const f of [{category:'other',document_type:null},{category:'business_photo'},{category:'דוח פעילות פרסום',document_type:'activity_report'}])assert(documentBucket(f)===null);
});
